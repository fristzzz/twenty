import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { type ConnectionAccountIdentity } from 'twenty-shared/application';
import { ConnectedAccountProvider } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { IsNull, Repository } from 'typeorm';

import { AppConnectionAccessService } from 'src/engine/core-modules/application/connection-provider/app-connection-access.service';
import { ConnectionProviderExceptionCode } from 'src/engine/core-modules/application/connection-provider/connection-provider-exception-code.enum';
import { ConnectionProviderIdentityService } from 'src/engine/core-modules/application/connection-provider/connection-provider-identity.service';
import { ConnectionProviderException } from 'src/engine/core-modules/application/connection-provider/connection-provider.exception';
import { type TokenExchangeResponse } from 'src/engine/core-modules/application/connection-provider/types/token-exchange-response.type';
import { type OAuthConnectionProvider } from 'src/engine/core-modules/application/connection-provider/utils/assert-oauth-provider.util';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { ConnectedAccountTokenEncryptionService } from 'src/engine/metadata-modules/connected-account/services/connected-account-token-encryption.service';

type SaveConnectionArgs = {
  provider: OAuthConnectionProvider;
  tokenResponse: TokenExchangeResponse;
  identity: ConnectionAccountIdentity | null;
  handle: string;
  workspaceId: string;
  userId: string;
  userWorkspaceId: string;
  visibility: 'user' | 'workspace';
  reconnectingConnectedAccountId: string | null;
};

@Injectable()
export class ConnectionProviderAccountService {
  constructor(
    private readonly connectionProviderIdentityService: ConnectionProviderIdentityService,
    private readonly connectedAccountTokenEncryptionService: ConnectedAccountTokenEncryptionService,
    private readonly appConnectionAccessService: AppConnectionAccessService,
    @InjectRepository(ConnectedAccountEntity)
    private readonly connectedAccountRepository: Repository<ConnectedAccountEntity>,
  ) {}

  async saveConnection(args: SaveConnectionArgs): Promise<{
    connectedAccount: ConnectedAccountEntity;
    isAlreadyConnected: boolean;
  }> {
    const {
      provider,
      identity,
      tokenResponse,
      workspaceId,
      userWorkspaceId,
      visibility,
    } = args;
    const { reconnectTarget: authorizedReconnectTarget } =
      await this.appConnectionAccessService.validateConnectionAccessOrThrow(
        args,
      );
    const legacyIdentity = await this.identifyLegacyReconnectOrThrow({
      args,
      target: authorizedReconnectTarget,
    });

    return this.connectedAccountRepository.manager.transaction(
      async (entityManager) => {
        const { reconnectTarget } =
          await this.appConnectionAccessService.validateConnectionAccessOrThrow(
            {
              ...args,
              entityManager,
            },
          );
        const repository = entityManager.getRepository(ConnectedAccountEntity);

        if (isDefined(reconnectTarget)) {
          const previousIdentity =
            reconnectTarget.externalAccountId ??
            (legacyIdentity?.accessToken === reconnectTarget.accessToken
              ? legacyIdentity?.externalAccountId
              : null);

          if (
            (isDefined(identity) && !isDefined(previousIdentity)) ||
            (isDefined(previousIdentity) && !isDefined(identity))
          ) {
            throw this.unknownIdentity();
          }

          if (
            isDefined(identity) &&
            previousIdentity !== identity.externalAccountId
          ) {
            throw new ConnectionProviderException(
              'Reconnect resolved a different external account.',
              ConnectionProviderExceptionCode.RECONNECT_ACCOUNT_MISMATCH,
            );
          }
        }

        const matchingAccount = isDefined(identity)
          ? await repository.findOne({
              where: {
                workspaceId,
                connectionProviderId: provider.id,
                provider: ConnectedAccountProvider.APP,
                externalAccountId: identity.externalAccountId,
                visibility,
                archivedAt: IsNull(),
                ...(visibility === 'user' ? { userWorkspaceId } : {}),
              },
              lock: { mode: 'pessimistic_write' },
            })
          : null;

        if (
          isDefined(reconnectTarget) &&
          isDefined(matchingAccount) &&
          reconnectTarget.id !== matchingAccount.id
        ) {
          throw new ConnectionProviderException(
            'Another active connection already represents this account with the requested visibility.',
            ConnectionProviderExceptionCode.ACCOUNT_ALREADY_CONNECTED,
          );
        }

        if (!isDefined(reconnectTarget) && isDefined(matchingAccount)) {
          return {
            connectedAccount: matchingAccount,
            isAlreadyConnected: true,
          };
        }

        const { encryptedAccessToken, encryptedRefreshToken } =
          this.connectedAccountTokenEncryptionService.encryptTokenPair({
            accessToken: tokenResponse.accessToken,
            refreshToken: tokenResponse.refreshToken,
            workspaceId,
          });
        const credentials = {
          accessToken: encryptedAccessToken,
          refreshToken:
            encryptedRefreshToken ??
            (isDefined(identity) ? reconnectTarget?.refreshToken : null) ??
            null,
          externalAccountId: identity?.externalAccountId ?? null,
          handle: identity?.handle ?? args.handle,
          scopes: tokenResponse.scopes ?? provider.oauthConfig.scopes,
          lastCredentialsRefreshedAt: new Date(),
          authFailedAt: null,
          authFailedReason: null,
          archivedAt: null,
          visibility,
          userWorkspaceId,
        };

        if (isDefined(reconnectTarget)) {
          await repository.update(
            { id: reconnectTarget.id, workspaceId },
            credentials,
          );

          return {
            connectedAccount: await repository.findOneByOrFail({
              id: reconnectTarget.id,
              workspaceId,
            }),
            isAlreadyConnected: false,
          };
        }

        const existingCount = await repository.count({
          where: { connectionProviderId: provider.id, workspaceId },
        });
        const connectedAccount = await repository.save(
          repository.create({
            ...credentials,
            name: `${provider.displayName} #${existingCount + 1}`,
            provider: ConnectedAccountProvider.APP,
            workspaceId,
            applicationId: provider.applicationId,
            connectionProviderId: provider.id,
          }),
        );

        return { connectedAccount, isAlreadyConnected: false };
      },
    );
  }

  private async identifyLegacyReconnectOrThrow({
    args,
    target,
  }: {
    args: Pick<SaveConnectionArgs, 'identity' | 'provider' | 'workspaceId'>;
    target: Pick<
      ConnectedAccountEntity,
      'externalAccountId' | 'accessToken' | 'archivedAt' | 'scopes'
    > | null;
  }) {
    if (
      !isDefined(args.identity) ||
      !isDefined(target) ||
      isDefined(target.externalAccountId)
    ) {
      return null;
    }

    if (!isDefined(target.accessToken) || isDefined(target.archivedAt)) {
      throw this.unknownIdentity();
    }

    try {
      const identity =
        await this.connectionProviderIdentityService.identifyAccount({
          provider: args.provider,
          workspaceId: args.workspaceId,
          accessToken: this.connectedAccountTokenEncryptionService.decrypt({
            ciphertext: target.accessToken,
            workspaceId: args.workspaceId,
          }),
          scopes: target.scopes ?? args.provider.oauthConfig.scopes,
        });

      if (!isDefined(identity)) {
        throw this.unknownIdentity();
      }

      return {
        accessToken: target.accessToken,
        externalAccountId: identity.externalAccountId,
      };
    } catch {
      throw this.unknownIdentity();
    }
  }

  private unknownIdentity(): ConnectionProviderException {
    return new ConnectionProviderException(
      'The original connection identity cannot be verified.',
      ConnectionProviderExceptionCode.RECONNECT_ACCOUNT_IDENTITY_UNKNOWN,
    );
  }
}
