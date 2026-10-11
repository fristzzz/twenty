import { createHash } from 'crypto';

import { http, HttpResponse } from 'msw';
import { buildBaseManifest } from 'test/integration/metadata/suites/application/utils/build-base-manifest.util';
import { cleanupApplicationAndAppRegistration } from 'test/integration/metadata/suites/application/utils/cleanup-application-and-app-registration.util';
import { setupApplicationForSync } from 'test/integration/metadata/suites/application/utils/setup-application-for-sync.util';
import { syncApplication } from 'test/integration/metadata/suites/application/utils/sync-application.util';
import { uploadApplicationFile } from 'test/integration/metadata/suites/application/utils/upload-application-file.util';
import { upsertPermissionFlags } from 'test/integration/metadata/suites/role-permission-flag/utils/upsert-permission-flags.util';
import { createOneRole } from 'test/integration/metadata/suites/role/utils/create-one-role.util';
import { deleteOneRole } from 'test/integration/metadata/suites/role/utils/delete-one-role.util';
import { findOneRoleByLabel } from 'test/integration/metadata/suites/role/utils/find-one-role-by-label.util';
import { updateWorkspaceMemberRole } from 'test/integration/metadata/suites/role/utils/update-workspace-member-role.util';
import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';
import { getCoreRepository } from 'test/integration/utils/get-core-repository.util';
import { setupHttpMock } from 'test/integration/utils/http-mock.util';
import { PermissionFlagType } from 'twenty-shared/constants';
import { type ConnectedAccountVisibility } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { v4 } from 'uuid';

import { type ConnectionProviderAccountService } from 'src/engine/core-modules/application/connection-provider/connection-provider-account.service';
import { ConnectionProviderExceptionCode } from 'src/engine/core-modules/application/connection-provider/connection-provider-exception-code.enum';
import { type ConnectionProviderIdentityService } from 'src/engine/core-modules/application/connection-provider/connection-provider-identity.service';
import { type ConnectionProviderOAuthFlowService } from 'src/engine/core-modules/application/connection-provider/connection-provider-oauth-flow.service';
import { ConnectionProviderEntity } from 'src/engine/core-modules/application/connection-provider/connection-provider.entity';
import { assertOAuthProvider } from 'src/engine/core-modules/application/connection-provider/utils/assert-oauth-provider.util';
import { plaintextStringSchema } from 'src/engine/core-modules/secret-encryption/branded-strings/plaintext-string.type';
import { type SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { type ConnectedAccountMetadataService } from 'src/engine/metadata-modules/connected-account/connected-account-metadata.service';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { PermissionsExceptionCode } from 'src/engine/metadata-modules/permissions/permissions.exception';
import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';
import { USER_WORKSPACE_DATA_SEED_IDS } from 'src/engine/workspace-manager/dev-seeder/core/utils/seed-user-workspaces.util';
import { USER_DATA_SEED_IDS } from 'src/engine/workspace-manager/dev-seeder/core/utils/seed-users.util';
import { WORKSPACE_MEMBER_DATA_SEED_IDS } from 'src/engine/workspace-manager/dev-seeder/data/constants/workspace-member-data-seeds.constant';

const applicationIdentifier = v4();
const providerIdentifier = v4();
const functionIdentifier = v4();
const roleIdentifier = v4();
const workspaceId = SEED_APPLE_WORKSPACE_ID;
const TOKEN_ENDPOINT = 'https://connection-choices.example.com/token';
const IDENTITY_SOURCE =
  "export const handler = () => ({ externalAccountId: 'stable-account', handle: 'account' });";

const buildManifest = (allowedVisibilities?: ConnectedAccountVisibility[]) =>
  buildBaseManifest({
    appId: applicationIdentifier,
    roleId: roleIdentifier,
    overrides: {
      connectionProviders: [
        {
          universalIdentifier: providerIdentifier,
          name: 'visibility-provider',
          displayName: 'Visibility provider',
          type: 'oauth',
          ...(isDefined(allowedVisibilities) ? { allowedVisibilities } : {}),
          oauth: {
            authorizationEndpoint: 'https://example.com/authorize',
            tokenEndpoint: TOKEN_ENDPOINT,
            scopes: ['read'],
            clientIdVariable: 'CLIENT_ID',
            clientSecretVariable: 'CLIENT_SECRET',
          },
          identifyAccountLogicFunction: {
            universalIdentifier: functionIdentifier,
          },
        },
      ],
      logicFunctions: [
        {
          universalIdentifier: functionIdentifier,
          name: 'Identify account',
          handlerName: 'handler',
          sourceHandlerPath: 'src/identity.ts',
          builtHandlerPath: 'dist/identity.mjs',
          builtHandlerChecksum: createHash('sha256')
            .update(IDENTITY_SOURCE)
            .digest('hex'),
          timeoutSeconds: 10,
        },
      ],
    },
  });

describe('app manifest connection visibility choices', () => {
  let accountService: ConnectionProviderAccountService;
  let oauthFlow: ConnectionProviderOAuthFlowService;
  let identityService: ConnectionProviderIdentityService;
  let metadataService: ConnectedAccountMetadataService;
  let applicationId: string;
  let tokenExchanges: number;
  const member = {
    id: USER_WORKSPACE_DATA_SEED_IDS.JANE,
    userId: USER_DATA_SEED_IDS.JANE,
  };

  const providers = () =>
    getCoreRepository<ConnectionProviderEntity>(ConnectionProviderEntity);
  const accounts = () =>
    getCoreRepository<ConnectedAccountEntity>(ConnectedAccountEntity);
  const readProvider = async () => {
    const provider = await providers().findOneByOrFail({
      universalIdentifier: providerIdentifier,
      workspaceId,
    });
    assertOAuthProvider(provider);
    return provider;
  };
  const setChoices = async (
    allowedVisibilities: ConnectedAccountVisibility[],
  ) => {
    const { errors } = await syncApplication({
      manifest: buildManifest(allowedVisibilities),
    });
    expect(errors).toBeUndefined();
  };
  const tokenResponse = () =>
    HttpResponse.json({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      scope: 'read',
    });
  const providerHttp = setupHttpMock(
    http.post(TOKEN_ENDPOINT, () => {
      tokenExchanges += 1;
      return tokenResponse();
    }),
  );
  const save = async (
    overrides: Partial<
      Parameters<ConnectionProviderAccountService['saveConnection']>[0]
    > = {},
  ) =>
    accountService.saveConnection({
      provider: await readProvider(),
      workspaceId,
      userId: member.userId,
      userWorkspaceId: member.id,
      visibility: 'user',
      reconnectingConnectedAccountId: null,
      identity: { externalAccountId: 'stable-account', handle: 'account' },
      handle: 'account',
      tokenResponse: {
        accessToken: plaintextStringSchema.parse('initial-access'),
        refreshToken: plaintextStringSchema.parse('initial-refresh'),
        idToken: null,
        scopes: ['read'],
      },
      ...overrides,
    });
  const authorize = async (
    overrides: Partial<
      Parameters<
        ConnectionProviderOAuthFlowService['startAuthorizationFlow']
      >[0]
    > = {},
  ) => {
    const { authorizationUrl } = await oauthFlow.startAuthorizationFlow({
      connectionProvider: await readProvider(),
      workspaceId,
      userId: member.userId,
      userWorkspaceId: member.id,
      reconnectingConnectedAccountId: null,
      redirectLocation: null,
      ...overrides,
    });
    const state = new URL(authorizationUrl).searchParams.get('state');
    if (!isDefined(state)) {
      throw new Error('Authorization did not provide signed state');
    }
    return state;
  };
  const complete = (state: string) =>
    oauthFlow.completeAuthorizationFlow({ state, code: 'authorization-code' });

  beforeAll(async () => {
    await setupApplicationForSync({
      applicationUniversalIdentifier: applicationIdentifier,
      name: 'Connection visibility choices',
      description: 'Connection visibility regression tests',
      sourcePath: 'connection-visibility-tests',
    });
    jest.useRealTimers();
    const uploaded = await uploadApplicationFile({
      applicationUniversalIdentifier: applicationIdentifier,
      fileFolder: 'BuiltLogicFunction',
      filePath: 'dist/identity.mjs',
      filename: 'identity.mjs',
      contentType: 'application/javascript',
      fileBuffer: Buffer.from(IDENTITY_SOURCE),
    });
    expect(uploaded.errors).toBeUndefined();
    const { errors } = await syncApplication({ manifest: buildManifest() });
    expect(errors).toBeUndefined();
    const createdProvider = await readProvider();
    expect(createdProvider.allowedVisibilities).toEqual(['user', 'workspace']);
    applicationId = createdProvider.applicationId;
    const encryption = getAppProviderByClassName<SecretEncryptionService>(
      'SecretEncryptionService',
    );
    for (const key of ['CLIENT_ID', 'CLIENT_SECRET']) {
      await globalThis.testDataSource.query(
        `INSERT INTO core."applicationRegistrationVariable" (key, "encryptedValue", "applicationRegistrationId")
         SELECT $1, $2, "applicationRegistrationId" FROM core.application WHERE id = $3`,
        [
          key,
          encryption.encryptVersioned(
            plaintextStringSchema.parse(`test-${key}`),
          ),
          applicationId,
        ],
      );
    }
    accountService = getAppProviderByClassName(
      'ConnectionProviderAccountService',
    );
    oauthFlow = getAppProviderByClassName('ConnectionProviderOAuthFlowService');
    identityService = getAppProviderByClassName(
      'ConnectionProviderIdentityService',
    );
    metadataService = getAppProviderByClassName(
      'ConnectedAccountMetadataService',
    );
  }, 120000);

  beforeEach(async () => {
    await setChoices(['user', 'workspace']);
    tokenExchanges = 0;
    jest.spyOn(identityService, 'identifyAccount');
  }, 60000);

  afterEach(async () => {
    jest.restoreAllMocks();
    if (isDefined(applicationId)) {
      await accounts().delete({ applicationId, workspaceId });
    }
  });

  afterAll(async () => {
    await cleanupApplicationAndAppRegistration({
      applicationUniversalIdentifier: applicationIdentifier,
    });
  }, 120000);

  it('defaults an omitted declaration to both choices and omitted authorization visibility to personal', async () => {
    expect((await readProvider()).allowedVisibilities).toEqual([
      'user',
      'workspace',
    ]);
    const result = await complete(await authorize());
    expect(
      await accounts().findOneByOrFail({ id: result.connectedAccountId }),
    ).toMatchObject({ visibility: 'user' });
    await expect(authorize({ visibility: 'workspace' })).resolves.toEqual(
      expect.any(String),
    );
  });

  it.each(['user', 'workspace'] as const)(
    'enforces a %s-only declaration at both authorization and persistence',
    async (allowed) => {
      const forbidden = allowed === 'user' ? 'workspace' : 'user';
      await setChoices([allowed]);
      await expect(authorize({ visibility: forbidden })).rejects.toMatchObject({
        code: ConnectionProviderExceptionCode.INVALID_REQUEST,
      });
      await expect(save({ visibility: forbidden })).rejects.toMatchObject({
        code: ConnectionProviderExceptionCode.INVALID_REQUEST,
      });
      expect(tokenExchanges).toBe(0);
      const result = await complete(await authorize({ visibility: allowed }));
      expect(
        await accounts().findOneByOrFail({ id: result.connectedAccountId }),
      ).toMatchObject({ visibility: allowed });
    },
  );

  it.each(['user', 'workspace'] as const)(
    'grandfathers only an explicit same-visibility reconnect of an existing %s account',
    async (visibility) => {
      const original = await save({ visibility });
      await setChoices([visibility === 'user' ? 'workspace' : 'user']);
      await expect(authorize({ visibility })).rejects.toMatchObject({
        code: ConnectionProviderExceptionCode.INVALID_REQUEST,
      });
      await expect(save({ visibility })).rejects.toMatchObject({
        code: ConnectionProviderExceptionCode.INVALID_REQUEST,
      });
      const result = await complete(
        await authorize({
          reconnectingConnectedAccountId: original.connectedAccount.id,
        }),
      );
      expect(result.connectedAccountId).toBe(original.connectedAccount.id);
      expect(
        await accounts().findOneByOrFail({ id: result.connectedAccountId }),
      ).toMatchObject({ visibility });
    },
  );

  it('permits sharing only when the current declaration allows workspace connections', async () => {
    const original = await save();
    await setChoices(['user']);
    const share = {
      reconnectingConnectedAccountId: original.connectedAccount.id,
      visibility: 'workspace' as const,
    };
    await expect(authorize(share)).rejects.toMatchObject({
      code: ConnectionProviderExceptionCode.INVALID_REQUEST,
    });
    await expect(save(share)).rejects.toMatchObject({
      code: ConnectionProviderExceptionCode.INVALID_REQUEST,
    });
    await setChoices(['workspace']);
    const result = await complete(await authorize(share));
    expect(result.connectedAccountId).toBe(original.connectedAccount.id);
    expect(
      await accounts().findOneByOrFail({ id: result.connectedAccountId }),
    ).toMatchObject({ visibility: 'workspace' });
  });

  it('rejects an already-signed Add callback after the app removes its visibility choice', async () => {
    const state = await authorize({ visibility: 'workspace' });
    await setChoices(['user']);
    await expect(complete(state)).rejects.toMatchObject({
      code: ConnectionProviderExceptionCode.INVALID_REQUEST,
    });
    expect(tokenExchanges).toBe(0);
    expect(identityService.identifyAccount).not.toHaveBeenCalled();
    expect(await accounts().countBy({ applicationId })).toBe(0);
  });

  it('rejects changed choices during token exchange before sending the token to the identity hook', async () => {
    const state = await authorize({ visibility: 'workspace' });
    providerHttp.use(
      http.post(TOKEN_ENDPOINT, async () => {
        await setChoices(['user']);
        return tokenResponse();
      }),
    );
    await expect(complete(state)).rejects.toMatchObject({
      code: ConnectionProviderExceptionCode.INVALID_REQUEST,
    });
    expect(identityService.identifyAccount).not.toHaveBeenCalled();
    expect(await accounts().countBy({ applicationId })).toBe(0);
  });

  it('checks the locked provider if its choices change while identifying the account', async () => {
    const state = await authorize({ visibility: 'workspace' });
    jest.mocked(identityService.identifyAccount).mockRestore();
    const identifyAccount =
      identityService.identifyAccount.bind(identityService);
    jest
      .spyOn(identityService, 'identifyAccount')
      .mockImplementationOnce(async (args) => {
        const identity = await identifyAccount(args);
        await setChoices(['user']);
        return identity;
      });

    await expect(complete(state)).rejects.toMatchObject({
      code: ConnectionProviderExceptionCode.INVALID_REQUEST,
    });
    expect(await accounts().countBy({ applicationId })).toBe(0);
  });

  it('rechecks real permissions for a grandfathered shared reconnect before exchanging tokens', async () => {
    const original = await save({ visibility: 'workspace' });
    const originalRole = await findOneRoleByLabel({ label: 'Member' });
    const { data, errors } = await createOneRole({
      input: {
        label: `Connection permissions ${v4()}`,
        canUpdateAllSettings: false,
        canBeAssignedToUsers: true,
      },
    });
    expect(errors).toBeUndefined();
    const roleId = data.createOneRole.id;

    try {
      expect(
        (
          await updateWorkspaceMemberRole({
            input: {
              workspaceMemberId: WORKSPACE_MEMBER_DATA_SEED_IDS.JONY,
              roleId,
            },
          })
        ).errors,
      ).toBeUndefined();
      expect(
        (
          await upsertPermissionFlags({
            input: {
              roleId,
              permissionFlagKeys: [PermissionFlagType.APPLICATIONS],
            },
          })
        ).errors,
      ).toBeUndefined();
      const reconnect = {
        reconnectingConnectedAccountId: original.connectedAccount.id,
        userId: USER_DATA_SEED_IDS.JONY,
        userWorkspaceId: USER_WORKSPACE_DATA_SEED_IDS.JONY,
      };
      const state = await authorize(reconnect);
      await setChoices(['user']);
      expect(
        (
          await upsertPermissionFlags({
            input: { roleId, permissionFlagKeys: [] },
          })
        ).errors,
      ).toBeUndefined();

      await expect(authorize(reconnect)).rejects.toMatchObject({
        code: PermissionsExceptionCode.PERMISSION_DENIED,
      });
      await expect(complete(state)).rejects.toMatchObject({
        code: PermissionsExceptionCode.PERMISSION_DENIED,
      });
      expect(tokenExchanges).toBe(0);
      expect(identityService.identifyAccount).not.toHaveBeenCalled();
      expect(
        await accounts().findOneByOrFail({ id: original.connectedAccount.id }),
      ).toMatchObject({
        userWorkspaceId: member.id,
        accessToken: original.connectedAccount.accessToken,
        refreshToken: original.connectedAccount.refreshToken,
      });
    } finally {
      await updateWorkspaceMemberRole({
        input: {
          workspaceMemberId: WORKSPACE_MEMBER_DATA_SEED_IDS.JONY,
          roleId: originalRole.id,
        },
      });
      await deleteOneRole({ input: { idToDelete: roleId } });
    }
  }, 60000);

  it('keeps old shared rows visible and disconnectable after a personal-only update', async () => {
    const original = await save({ visibility: 'workspace' });
    await setChoices(['user']);
    const list = () =>
      metadataService.findApplicationConnectedAccountsUsableByCaller({
        applicationId,
        workspaceId,
        userWorkspaceId: member.id,
      });
    expect((await list()).map(({ id }) => id)).toContain(
      original.connectedAccount.id,
    );
    expect(
      await metadataService.disconnect({
        id: original.connectedAccount.id,
        workspaceId,
      }),
    ).toMatchObject({
      archivedAt: expect.anything(),
      accessToken: null,
      refreshToken: null,
    });
    expect(await list()).toHaveLength(0);
  });
});
