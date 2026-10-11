import { buildBaseManifest } from 'test/integration/metadata/suites/application/utils/build-base-manifest.util';
import { cleanupApplicationAndAppRegistration } from 'test/integration/metadata/suites/application/utils/cleanup-application-and-app-registration.util';
import { setupApplicationForSync } from 'test/integration/metadata/suites/application/utils/setup-application-for-sync.util';
import { uploadApplicationFile } from 'test/integration/metadata/suites/application/utils/upload-application-file.util';
import { syncApplication } from 'test/integration/metadata/suites/application/utils/sync-application.util';
import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';
import { type Manifest } from 'twenty-shared/application';
import { ConnectedAccountProvider } from 'twenty-shared/types';
import { v4 } from 'uuid';

import { type ConnectionProviderAccountService } from 'src/engine/core-modules/application/connection-provider/connection-provider-account.service';
import { ConnectionProviderExceptionCode } from 'src/engine/core-modules/application/connection-provider/connection-provider-exception-code.enum';
import { type OAuthConnectionProvider } from 'src/engine/core-modules/application/connection-provider/utils/assert-oauth-provider.util';
import { plaintextStringSchema } from 'src/engine/core-modules/secret-encryption/branded-strings/plaintext-string.type';
import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { PermissionsExceptionCode } from 'src/engine/metadata-modules/permissions/permissions.exception';
import { USER_WORKSPACE_DATA_SEED_IDS } from 'src/engine/workspace-manager/dev-seeder/core/utils/seed-user-workspaces.util';
import {
  SEED_APPLE_WORKSPACE_ID,
  SEED_YCOMBINATOR_WORKSPACE_ID,
} from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';

const applicationIdentifier = v4();
const providerIdentifier = v4();
const secondProviderIdentifier = v4();
const unidentifiedProviderIdentifier = v4();
const functionIdentifier = v4();
const roleIdentifier = v4();
const workspaceId = SEED_APPLE_WORKSPACE_ID;

const buildManifest = (
  identityIdentifier: string | null = functionIdentifier,
): Manifest =>
  buildBaseManifest({
    appId: applicationIdentifier,
    roleId: roleIdentifier,
    overrides: {
      connectionProviders: [
        providerIdentifier,
        secondProviderIdentifier,
        unidentifiedProviderIdentifier,
      ].map((identifier, index) => ({
        universalIdentifier: identifier,
        name: `identity-provider-${index}`,
        displayName: 'Identity provider',
        type: 'oauth',
        oauth: {
          authorizationEndpoint: 'https://example.com/authorize',
          tokenEndpoint: 'https://example.com/token',
          scopes: ['read'],
          clientIdVariable: 'CLIENT_ID',
          clientSecretVariable: 'CLIENT_SECRET',
        },
        ...(identityIdentifier === null || index === 2
          ? {}
          : {
              identifyAccountLogicFunction: {
                universalIdentifier: identityIdentifier,
              },
            }),
      })),
      logicFunctions: [
        {
          universalIdentifier: functionIdentifier,
          name: 'Identify account',
          description: 'Identifies the account before persistence',
          handlerName: 'handler',
          sourceHandlerPath: 'src/identity.ts',
          builtHandlerPath: 'dist/identity.mjs',
          builtHandlerChecksum: 'identity-checksum',
          timeoutSeconds: 10,
        },
      ],
    },
  });

describe('app account identity persistence', () => {
  let service: ConnectionProviderAccountService;
  let provider: OAuthConnectionProvider;
  let secondProvider: OAuthConnectionProvider;
  let unidentifiedProvider: OAuthConnectionProvider;
  let firstMember: { id: string; userId: string };
  let secondMember: { id: string; userId: string };

  const readAccount = async (id: string): Promise<ConnectedAccountEntity> => {
    const [account] = await globalThis.testDataSource.query(
      'SELECT * FROM core."connectedAccount" WHERE id = $1',
      [id],
    );
    return account;
  };

  const save = (
    overrides: Partial<
      Parameters<ConnectionProviderAccountService['saveConnection']>[0]
    > = {},
  ) =>
    service.saveConnection({
      provider,
      workspaceId,
      userId: firstMember.userId,
      userWorkspaceId: firstMember.id,
      visibility: 'workspace',
      reconnectingConnectedAccountId: null,
      identity: {
        externalAccountId: 'organization:account-a',
        handle: 'external@example.com',
      },
      handle: 'twenty@example.com',
      tokenResponse: {
        accessToken: plaintextStringSchema.parse('access-one'),
        refreshToken: plaintextStringSchema.parse('refresh-one'),
        idToken: null,
        scopes: ['read'],
      },
      ...overrides,
    });

  beforeAll(async () => {
    await setupApplicationForSync({
      applicationUniversalIdentifier: applicationIdentifier,
      name: 'Account identity tests',
      description: 'Identity tests',
      sourcePath: 'identity-tests',
    });
    jest.useRealTimers();
    const uploaded = await uploadApplicationFile({
      applicationUniversalIdentifier: applicationIdentifier,
      fileFolder: 'BuiltLogicFunction',
      filePath: 'dist/identity.mjs',
      filename: 'identity.mjs',
      contentType: 'application/javascript',
      fileBuffer: Buffer.from(
        "export const handler = ({ accessToken }) => ({ externalAccountId: accessToken === 'access-one' ? 'organization:account-a' : 'organization:account-b' });",
      ),
    });
    expect(uploaded.errors).toBeUndefined();
    const { errors } = await syncApplication({ manifest: buildManifest() });
    expect(errors).toBeUndefined();
    jest.useRealTimers();

    [provider, secondProvider, unidentifiedProvider] =
      await globalThis.testDataSource.query(
        'SELECT * FROM core."connectionProvider" WHERE "universalIdentifier" = ANY($1::uuid[]) ORDER BY name',
        [
          [
            providerIdentifier,
            secondProviderIdentifier,
            unidentifiedProviderIdentifier,
          ],
        ],
      );
    [firstMember] = await globalThis.testDataSource.query(
      'SELECT id, "userId" FROM core."userWorkspace" WHERE id = $1',
      [USER_WORKSPACE_DATA_SEED_IDS.JANE],
    );
    [secondMember] = await globalThis.testDataSource.query(
      'SELECT id, "userId" FROM core."userWorkspace" WHERE id = $1',
      [USER_WORKSPACE_DATA_SEED_IDS.JONY],
    );
    service = getAppProviderByClassName('ConnectionProviderAccountService');
  }, 120000);

  afterEach(async () => {
    if (provider === undefined) {
      return;
    }
    await globalThis.testDataSource.query(
      'DELETE FROM core."connectedAccount" WHERE "applicationId" = $1',
      [provider.applicationId],
    );
  });

  afterAll(async () => {
    await cleanupApplicationAndAppRegistration({
      applicationUniversalIdentifier: applicationIdentifier,
    });
  });

  it('leaves every field untouched when Add identifies an existing account', async () => {
    const first = await save();
    await globalThis.testDataSource.query(
      'UPDATE core."connectedAccount" SET name = $1, "authFailedAt" = NOW(), "authFailedReason" = $2, "userWorkspaceId" = $3 WHERE id = $4',
      [
        'Important account',
        'expired',
        secondMember.id,
        first.connectedAccount.id,
      ],
    );
    const original = await readAccount(first.connectedAccount.id);
    const duplicate = await save({
      handle: 'another-label@example.com',
      tokenResponse: {
        accessToken: plaintextStringSchema.parse('access-two'),
        refreshToken: null,
        idToken: null,
        scopes: ['read', 'write'],
      },
    });

    expect(duplicate.isAlreadyConnected).toBe(true);
    expect(duplicate.connectedAccount.id).toBe(original.id);
    expect(await readAccount(original.id)).toEqual(original);
  });

  it('updates credentials only for an explicit reconnect to the same account', async () => {
    const { connectedAccount } = await save();
    await globalThis.testDataSource.query(
      'UPDATE core."connectedAccount" SET name = $1, "authFailedAt" = NOW(), "authFailedReason" = $2 WHERE id = $3',
      ['Important account', 'expired', connectedAccount.id],
    );
    const reconnected = await save({
      reconnectingConnectedAccountId: connectedAccount.id,
      tokenResponse: {
        accessToken: plaintextStringSchema.parse('access-two'),
        refreshToken: null,
        idToken: null,
        scopes: ['read', 'write'],
      },
    });

    expect(reconnected.isAlreadyConnected).toBe(false);
    expect(reconnected.connectedAccount).toMatchObject({
      id: connectedAccount.id,
      name: 'Important account',
      refreshToken: connectedAccount.refreshToken,
      authFailedAt: null,
      authFailedReason: null,
      scopes: ['read', 'write'],
    });
    expect(reconnected.connectedAccount.accessToken).not.toBe(
      connectedAccount.accessToken,
    );
  });

  it('serializes concurrent callbacks and creates one row', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        save({
          tokenResponse: {
            accessToken: plaintextStringSchema.parse(`access-${index}`),
            refreshToken: plaintextStringSchema.parse(`refresh-${index}`),
            idToken: null,
            scopes: ['read'],
          },
        }),
      ),
    );
    expect(
      new Set(results.map((result) => result.connectedAccount.id)).size,
    ).toBe(1);
    expect(results.filter((result) => !result.isAlreadyConnected)).toHaveLength(
      1,
    );
    expect(
      new Set(results.map((result) => result.connectedAccount.accessToken))
        .size,
    ).toBe(1);
  });

  it('does not retain an old refresh token when an unidentified reconnect may select another account', async () => {
    const { connectedAccount } = await save({
      provider: unidentifiedProvider,
      identity: null,
    });
    expect(connectedAccount.refreshToken).not.toBeNull();

    const reconnected = await save({
      provider: unidentifiedProvider,
      identity: null,
      reconnectingConnectedAccountId: connectedAccount.id,
      tokenResponse: {
        accessToken: plaintextStringSchema.parse('different-account-access'),
        refreshToken: null,
        idToken: null,
        scopes: ['read'],
      },
    });

    expect(reconnected.connectedAccount.id).toBe(connectedAccount.id);
    expect(reconnected.connectedAccount.refreshToken).toBeNull();
    expect((await readAccount(connectedAccount.id)).refreshToken).toBeNull();
  });

  it.each(['user', 'workspace'] as const)(
    'enforces %s identity uniqueness in PostgreSQL independently of the service',
    async (visibility) => {
      const { connectedAccount } = await save({ visibility });
      await expect(
        globalThis.testDataSource.query(
          'INSERT INTO core."connectedAccount" (id, handle, provider, visibility, "workspaceId", "userWorkspaceId", "applicationId", "connectionProviderId", "externalAccountId") SELECT $1, handle, provider, visibility, "workspaceId", "userWorkspaceId", "applicationId", "connectionProviderId", "externalAccountId" FROM core."connectedAccount" WHERE id = $2',
          [v4(), connectedAccount.id],
        ),
      ).rejects.toMatchObject({ code: '23505' });
      expect(connectedAccount.provider).toBe(ConnectedAccountProvider.APP);
    },
  );

  it('keeps different identities, providers, personal owners, and sharing separate', async () => {
    const results = await Promise.all([
      save(),
      save({ identity: { externalAccountId: 'organization:account-b' } }),
      save({ provider: secondProvider }),
      save({ visibility: 'user' }),
      save({
        visibility: 'user',
        userId: secondMember.userId,
        userWorkspaceId: secondMember.id,
      }),
    ]);
    expect(
      new Set(results.map((result) => result.connectedAccount.id)).size,
    ).toBe(5);
    const personalAgain = await save({ visibility: 'user' });
    expect(personalAgain.connectedAccount.id).toBe(
      results[3].connectedAccount.id,
    );
  });

  it('rejects a different account on reconnect without changing the saved credentials', async () => {
    const { connectedAccount } = await save();
    await expect(
      save({
        reconnectingConnectedAccountId: connectedAccount.id,
        identity: { externalAccountId: 'other-account' },
      }),
    ).rejects.toMatchObject({
      code: ConnectionProviderExceptionCode.RECONNECT_ACCOUNT_MISMATCH,
    });
    expect((await readAccount(connectedAccount.id)).accessToken).toBe(
      connectedAccount.accessToken,
    );
  });

  it('rejects a provider from another application or workspace without changing its account', async () => {
    const { connectedAccount } = await save();
    const original = await readAccount(connectedAccount.id);

    await expect(
      save({ provider: { ...provider, applicationId: v4() } }),
    ).rejects.toMatchObject({
      code: ConnectionProviderExceptionCode.INVALID_STATE,
    });
    await expect(
      save({ workspaceId: SEED_YCOMBINATOR_WORKSPACE_ID }),
    ).rejects.toMatchObject({
      code: ConnectionProviderExceptionCode.INVALID_STATE,
    });
    expect(await readAccount(connectedAccount.id)).toEqual(original);
  });

  it('verifies the original credential before identifying a legacy reconnect', async () => {
    const { connectedAccount } = await save();
    await globalThis.testDataSource.query(
      'UPDATE core."connectedAccount" SET "externalAccountId" = NULL WHERE id = $1',
      [connectedAccount.id],
    );
    const result = await save({
      reconnectingConnectedAccountId: connectedAccount.id,
    });
    expect(result.connectedAccount.externalAccountId).toBe(
      'organization:account-a',
    );
    expect(result.isAlreadyConnected).toBe(false);
  }, 60000);

  it('does not adopt a different account onto a legacy connection', async () => {
    const { connectedAccount } = await save();
    await globalThis.testDataSource.query(
      'UPDATE core."connectedAccount" SET "externalAccountId" = NULL WHERE id = $1',
      [connectedAccount.id],
    );
    await expect(
      save({
        reconnectingConnectedAccountId: connectedAccount.id,
        identity: { externalAccountId: 'other-account' },
      }),
    ).rejects.toMatchObject({
      code: ConnectionProviderExceptionCode.RECONNECT_ACCOUNT_MISMATCH,
    });
    expect(
      (await readAccount(connectedAccount.id)).externalAccountId,
    ).toBeNull();
  });

  it('never lets concurrent legacy reconnects adopt conflicting accounts', async () => {
    const { connectedAccount } = await save();
    await globalThis.testDataSource.query(
      'UPDATE core."connectedAccount" SET "externalAccountId" = NULL WHERE id = $1',
      [connectedAccount.id],
    );
    const results = await Promise.allSettled([
      save({ reconnectingConnectedAccountId: connectedAccount.id }),
      save({
        reconnectingConnectedAccountId: connectedAccount.id,
        identity: { externalAccountId: 'other-account' },
      }),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect((await readAccount(connectedAccount.id)).externalAccountId).toBe(
      'organization:account-a',
    );
  });

  it('leaves unverifiable legacy connections untouched', async () => {
    const { connectedAccount } = await save();
    await globalThis.testDataSource.query(
      'UPDATE core."connectedAccount" SET "externalAccountId" = NULL, "accessToken" = NULL WHERE id = $1',
      [connectedAccount.id],
    );
    await expect(
      save({ reconnectingConnectedAccountId: connectedAccount.id }),
    ).rejects.toMatchObject({
      code: ConnectionProviderExceptionCode.RECONNECT_ACCOUNT_IDENTITY_UNKNOWN,
    });
  });

  it('preserves unidentified rows instead of guessing their account from email', async () => {
    const first = await save({ identity: null });
    const second = await save();
    expect(first.connectedAccount.id).not.toBe(second.connectedAccount.id);
  });

  it('restores an identified archive, but never replaces another active connection', async () => {
    const first = await save();
    await globalThis.testDataSource.query(
      'UPDATE core."connectedAccount" SET "archivedAt" = NOW() WHERE id = $1',
      [first.connectedAccount.id],
    );
    const restored = await save({
      reconnectingConnectedAccountId: first.connectedAccount.id,
    });
    expect(restored.connectedAccount.archivedAt).toBeNull();
    await globalThis.testDataSource.query(
      'UPDATE core."connectedAccount" SET "archivedAt" = NOW() WHERE id = $1',
      [first.connectedAccount.id],
    );
    const replacement = await save();
    expect(replacement.connectedAccount.id).not.toBe(first.connectedAccount.id);
    await expect(
      save({ reconnectingConnectedAccountId: first.connectedAccount.id }),
    ).rejects.toMatchObject({
      code: ConnectionProviderExceptionCode.ACCOUNT_ALREADY_CONNECTED,
    });
  });

  it('preserves authorized sharing and refuses an existing shared identity', async () => {
    const personal = await save({ visibility: 'user' });
    const shared = await save({
      reconnectingConnectedAccountId: personal.connectedAccount.id,
    });
    expect(shared.connectedAccount).toMatchObject({
      id: personal.connectedAccount.id,
      visibility: 'workspace',
    });
    const anotherPersonal = await save({ visibility: 'user' });
    await expect(
      save({
        reconnectingConnectedAccountId: anotherPersonal.connectedAccount.id,
      }),
    ).rejects.toMatchObject({
      code: ConnectionProviderExceptionCode.ACCOUNT_ALREADY_CONNECTED,
    });
  });

  it('rejects workspace-to-personal conversion through reconnect', async () => {
    const { connectedAccount } = await save();
    await expect(
      save({
        reconnectingConnectedAccountId: connectedAccount.id,
        visibility: 'user',
      }),
    ).rejects.toMatchObject({
      code: ConnectionProviderExceptionCode.INVALID_REQUEST,
    });
  });

  it('rechecks membership, permissions, and personal ownership during callback persistence', async () => {
    await expect(save({ userWorkspaceId: v4() })).rejects.toMatchObject({
      code: ConnectionProviderExceptionCode.FORBIDDEN,
    });
    const personal = await save({ visibility: 'user' });
    await expect(
      save({
        reconnectingConnectedAccountId: personal.connectedAccount.id,
        userId: secondMember.userId,
        userWorkspaceId: secondMember.id,
      }),
    ).rejects.toMatchObject({
      code: ConnectionProviderExceptionCode.FORBIDDEN,
    });
    await expect(
      save({ userId: secondMember.userId, userWorkspaceId: secondMember.id }),
    ).rejects.toMatchObject({
      code: PermissionsExceptionCode.PERMISSION_DENIED,
    });
  });

  it('round-trips identity declaration updates and rejects missing function references', async () => {
    const { connectedAccount } = await save();
    const invalid = await syncApplication({
      manifest: buildManifest(v4()),
      expectToFail: true,
    });
    expect(invalid.errors).toBeDefined();
    const removed = await syncApplication({ manifest: buildManifest(null) });
    expect(removed.errors).toBeUndefined();
    const [withoutHook] = await globalThis.testDataSource.query(
      'SELECT "identifyAccountLogicFunctionUniversalIdentifier" FROM core."connectionProvider" WHERE id = $1',
      [provider.id],
    );
    expect(
      withoutHook.identifyAccountLogicFunctionUniversalIdentifier,
    ).toBeNull();
    await expect(
      save({
        provider: {
          ...provider,
          identifyAccountLogicFunctionUniversalIdentifier: null,
        },
        identity: null,
        reconnectingConnectedAccountId: connectedAccount.id,
      }),
    ).rejects.toMatchObject({
      code: ConnectionProviderExceptionCode.RECONNECT_ACCOUNT_IDENTITY_UNKNOWN,
    });
    const restored = await syncApplication({ manifest: buildManifest() });
    expect(restored.errors).toBeUndefined();
    const [withHook] = await globalThis.testDataSource.query(
      'SELECT "identifyAccountLogicFunctionUniversalIdentifier" FROM core."connectionProvider" WHERE id = $1',
      [provider.id],
    );
    expect(withHook.identifyAccountLogicFunctionUniversalIdentifier).toBe(
      functionIdentifier,
    );
    jest.useRealTimers();
  }, 60000);
});
