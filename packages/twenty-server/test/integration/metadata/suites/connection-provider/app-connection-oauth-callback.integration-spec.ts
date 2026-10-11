import { createHash } from 'crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { http, HttpResponse } from 'msw';
import request from 'supertest';
import { buildBaseManifest } from 'test/integration/metadata/suites/application/utils/build-base-manifest.util';
import { cleanupApplicationAndAppRegistration } from 'test/integration/metadata/suites/application/utils/cleanup-application-and-app-registration.util';
import { setupApplicationForSync } from 'test/integration/metadata/suites/application/utils/setup-application-for-sync.util';
import { syncApplication } from 'test/integration/metadata/suites/application/utils/sync-application.util';
import { uploadApplicationFile } from 'test/integration/metadata/suites/application/utils/upload-application-file.util';
import { generateTransientTokenResponse } from 'test/integration/utils/generate-transient-token.util';
import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';
import { setupHttpMock } from 'test/integration/utils/http-mock.util';
import { waitForAllJobsToFinish } from 'test/integration/utils/wait-for-all-jobs-to-finish.util';
import { v4 } from 'uuid';
import { z } from 'zod';

import { type ConnectionProviderEntity } from 'src/engine/core-modules/application/connection-provider/connection-provider.entity';
import { ConnectionProviderExceptionCode } from 'src/engine/core-modules/application/connection-provider/connection-provider-exception-code.enum';
import { type ConnectionProviderIdentityService } from 'src/engine/core-modules/application/connection-provider/connection-provider-identity.service';
import { plaintextStringSchema } from 'src/engine/core-modules/secret-encryption/branded-strings/plaintext-string.type';
import { type SecretEncryptionService } from 'src/engine/core-modules/secret-encryption/secret-encryption.service';
import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { type ConnectedAccountTokenEncryptionService } from 'src/engine/metadata-modules/connected-account/services/connected-account-token-encryption.service';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';
import { USER_WORKSPACE_DATA_SEED_IDS } from 'src/engine/workspace-manager/dev-seeder/core/utils/seed-user-workspaces.util';

const APPLICATION_IDENTIFIER = v4();
const PROVIDER_IDENTIFIER = v4();
const IDENTITY_IDENTIFIER = v4();
const ON_CONNECT_IDENTIFIER = v4();
const TOKEN_ENDPOINT = 'https://connection-provider.example.com/token';

describe('app connection OAuth callback', () => {
  let provider: ConnectionProviderEntity;
  let fixtureDirectory: string;
  let identityExecutionsPath: string;
  let onConnectExecutionsPath: string;
  let tokenExchanges: string[];

  const providerHttp = setupHttpMock(
    http.post(TOKEN_ENDPOINT, async ({ request: tokenRequest }) => {
      const { code } = z
        .object({ code: z.string().min(1) })
        .parse(await tokenRequest.json());

      tokenExchanges.push(code);

      return HttpResponse.json({
        access_token: code,
        refresh_token: `refresh-${code}`,
        token_type: 'Bearer',
        scope: 'read',
      });
    }),
  );

  const readExecutions = (path: string): string[] =>
    existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n') : [];

  const readAccounts = (): Promise<ConnectedAccountEntity[]> =>
    globalThis.testDataSource.query(
      'SELECT * FROM core."connectedAccount" WHERE "connectionProviderId" = $1 ORDER BY "createdAt", id',
      [provider.id],
    );

  const authorize = async ({
    reconnectingConnectedAccountId,
    redirectLocation,
    token = APPLE_JANE_ADMIN_ACCESS_TOKEN,
  }: {
    reconnectingConnectedAccountId?: string;
    redirectLocation?: string;
    token?: string;
  } = {}): Promise<string> => {
    const transient = await generateTransientTokenResponse({ token });

    expect(transient.errors).toBeUndefined();

    const response = await request(`http://localhost:${APP_PORT}`)
      .get('/auth/apps/authorize')
      .query({
        applicationId: provider.applicationId,
        providerName: provider.name,
        transientToken:
          transient.data.generateTransientToken.transientToken.token,
        visibility: 'workspace',
        reconnectingConnectedAccountId,
        redirectLocation,
      });

    expect(response.status).toBe(302);
    const authorizationUrl = new URL(response.headers.location);

    expect(authorizationUrl.origin).toBe(
      'https://connection-provider.example.com',
    );
    const state = authorizationUrl.searchParams.get('state');

    expect(state).not.toBeNull();

    return state!;
  };

  const callback = async (state: string, code: string): Promise<URL> => {
    const response = await request(`http://localhost:${APP_PORT}`)
      .get('/auth/apps/callback')
      .query({ state, code });

    expect(response.status).toBe(302);
    await waitForAllJobsToFinish();

    return new URL(response.headers.location);
  };

  beforeAll(async () => {
    fixtureDirectory = mkdtempSync(join(tmpdir(), 'app-connection-callback-'));
    identityExecutionsPath = join(fixtureDirectory, 'identity-executions');
    onConnectExecutionsPath = join(fixtureDirectory, 'on-connect-executions');

    await setupApplicationForSync({
      applicationUniversalIdentifier: APPLICATION_IDENTIFIER,
      name: 'OAuth callback integration',
      description:
        'Actual provider identity execution and callback persistence',
      sourcePath: 'oauth-callback-integration',
    });
    jest.useRealTimers();

    const functions = [
      {
        universalIdentifier: IDENTITY_IDENTIFIER,
        name: 'identify',
        source: `import { appendFileSync } from 'node:fs';
export const handler = ({ accessToken }) => {
  appendFileSync(${JSON.stringify(identityExecutionsPath)}, 'executed\\n');
  if (accessToken === 'failed') throw new Error('Provider failed: ' + accessToken);
  if (accessToken === 'unknown') return null;
  if (accessToken === 'malformed') return { externalAccountId: ' ' };
  return {
    externalAccountId: accessToken === 'account-b' ? 'organization:account-b' : 'organization:account-a',
    handle: accessToken + '@provider.example.com',
  };
};`,
      },
      {
        universalIdentifier: ON_CONNECT_IDENTIFIER,
        name: 'on-connect',
        source: `import { appendFileSync } from 'node:fs';
export const handler = ({ connectedAccountId }) => {
  appendFileSync(${JSON.stringify(onConnectExecutionsPath)}, connectedAccountId + '\\n');
};`,
      },
    ];

    for (const logicFunction of functions) {
      const uploaded = await uploadApplicationFile({
        applicationUniversalIdentifier: APPLICATION_IDENTIFIER,
        fileFolder: 'BuiltLogicFunction',
        filePath: `dist/${logicFunction.name}.mjs`,
        filename: `${logicFunction.name}.mjs`,
        contentType: 'application/javascript',
        fileBuffer: Buffer.from(logicFunction.source),
      });

      expect(uploaded.errors).toBeUndefined();
    }

    const { errors } = await syncApplication({
      manifest: buildBaseManifest({
        appId: APPLICATION_IDENTIFIER,
        roleId: v4(),
        overrides: {
          logicFunctions: functions.map((logicFunction) => ({
            universalIdentifier: logicFunction.universalIdentifier,
            name: logicFunction.name,
            handlerName: 'handler',
            sourceHandlerPath: `src/${logicFunction.name}.ts`,
            builtHandlerPath: `dist/${logicFunction.name}.mjs`,
            builtHandlerChecksum: createHash('sha256')
              .update(logicFunction.source)
              .digest('hex'),
            timeoutSeconds: 10,
          })),
          connectionProviders: [
            {
              universalIdentifier: PROVIDER_IDENTIFIER,
              name: 'callback-provider',
              displayName: 'Callback provider',
              type: 'oauth',
              oauth: {
                authorizationEndpoint:
                  'https://connection-provider.example.com/authorize',
                tokenEndpoint: TOKEN_ENDPOINT,
                scopes: ['read'],
                clientIdVariable: 'CLIENT_ID',
                clientSecretVariable: 'CLIENT_SECRET',
              },
              identifyAccountLogicFunction: {
                universalIdentifier: IDENTITY_IDENTIFIER,
              },
              onConnectLogicFunction: {
                universalIdentifier: ON_CONNECT_IDENTIFIER,
              },
            },
          ],
        },
      }),
    });

    expect(errors).toBeUndefined();
    jest.useRealTimers();
    [provider] = await globalThis.testDataSource.query(
      'SELECT * FROM core."connectionProvider" WHERE "universalIdentifier" = $1',
      [PROVIDER_IDENTIFIER],
    );
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
          provider.applicationId,
        ],
      );
    }
  }, 120000);

  beforeEach(() => {
    tokenExchanges = [];
    rmSync(identityExecutionsPath, { force: true });
    rmSync(onConnectExecutionsPath, { force: true });
  });

  afterEach(async () => {
    await globalThis.testDataSource.query(
      'DELETE FROM core."connectedAccount" WHERE "applicationId" = $1',
      [provider.applicationId],
    );
  });

  afterAll(async () => {
    await cleanupApplicationAndAppRegistration({
      applicationUniversalIdentifier: APPLICATION_IDENTIFIER,
    });
    rmSync(fixtureDirectory, { recursive: true, force: true });
  });

  it('does not replace credentials or run onConnect when a hook reports a duplicate', async () => {
    const initialRedirect = await callback(await authorize(), 'account-a');

    expect(initialRedirect.searchParams.get('errorMessage')).toBeNull();
    expect(
      initialRedirect.searchParams.has('appConnectionAlreadyConnected'),
    ).toBe(false);
    const [original] = await readAccounts();

    expect(readExecutions(onConnectExecutionsPath)).toEqual([original.id]);
    const duplicateRedirect = await callback(
      await authorize(),
      'another-account-reported-as-a',
    );

    expect(await readAccounts()).toEqual([original]);
    expect(readExecutions(identityExecutionsPath)).toHaveLength(2);
    expect(readExecutions(onConnectExecutionsPath)).toEqual([original.id]);
    expect(duplicateRedirect.pathname).toBe(
      `/settings/applications/${provider.applicationId}/connections/${original.id}`,
    );
    expect(
      duplicateRedirect.searchParams.get('appConnectionAlreadyConnected'),
    ).toBe('true');
  }, 60000);

  it('keeps the requested return page and permits distinct accounts', async () => {
    await callback(await authorize(), 'account-a');
    const returnPage = `/settings/applications/${provider.applicationId}?tab=account#general`;
    const duplicateRedirect = await callback(
      await authorize({ redirectLocation: returnPage }),
      'account-a-new-token',
    );

    expect(duplicateRedirect.pathname).toBe(
      `/settings/applications/${provider.applicationId}`,
    );
    expect(duplicateRedirect.searchParams.get('tab')).toBe('account');
    expect(duplicateRedirect.hash).toBe('#general');
    expect(
      duplicateRedirect.searchParams.get('appConnectionAlreadyConnected'),
    ).toBe('true');

    const newRedirect = await callback(
      await authorize({
        redirectLocation: `${returnPage.replace('#general', '')}&appConnectionAlreadyConnected=true`,
      }),
      'account-b',
    );

    expect(newRedirect.searchParams.has('appConnectionAlreadyConnected')).toBe(
      false,
    );
    expect(await readAccounts()).toHaveLength(2);
    expect(readExecutions(onConnectExecutionsPath)).toHaveLength(2);
  });

  it('only replaces credentials on an explicit reconnect to the same account', async () => {
    await callback(await authorize(), 'account-a');
    const [original] = await readAccounts();
    const wrongAccountRedirect = await callback(
      await authorize({ reconnectingConnectedAccountId: original.id }),
      'account-b',
    );

    expect(wrongAccountRedirect.searchParams.get('errorMessage')).toContain(
      'different account',
    );
    expect(await readAccounts()).toEqual([original]);
    expect(readExecutions(onConnectExecutionsPath)).toEqual([original.id]);

    const reconnectedRedirect = await callback(
      await authorize({ reconnectingConnectedAccountId: original.id }),
      'account-a-new-token',
    );
    const [reconnected] = await readAccounts();
    const encryption =
      getAppProviderByClassName<ConnectedAccountTokenEncryptionService>(
        'ConnectedAccountTokenEncryptionService',
      );

    expect(reconnectedRedirect.searchParams.has('errorMessage')).toBe(false);
    expect(
      reconnectedRedirect.searchParams.has('appConnectionAlreadyConnected'),
    ).toBe(false);
    expect(reconnected.id).toBe(original.id);
    expect(
      encryption.decrypt({
        ciphertext: reconnected.accessToken!,
        workspaceId: SEED_APPLE_WORKSPACE_ID,
      }),
    ).toBe('account-a-new-token');
    expect(readExecutions(onConnectExecutionsPath)).toEqual([
      original.id,
      original.id,
    ]);
  });

  it.each(['failed', 'unknown', 'malformed'])(
    'leaves no connection or lifecycle work when identification is %s',
    async (code) => {
      const redirect = await callback(await authorize(), code);

      expect(redirect.searchParams.get('errorMessage')).toContain(
        'could not identify',
      );
      expect(redirect.searchParams.get('errorMessage')).not.toContain(
        'Provider failed',
      );
      expect(await readAccounts()).toEqual([]);
      expect(readExecutions(onConnectExecutionsPath)).toEqual([]);
      expect(readExecutions(identityExecutionsPath)).toEqual(['executed']);
    },
  );

  it('rechecks revoked permissions before giving the new credential to the app', async () => {
    const [administrator, member] = await globalThis.testDataSource.query(
      `SELECT "userWorkspaceId", "roleId" FROM core."roleTarget"
       WHERE "userWorkspaceId" = ANY($1::uuid[]) ORDER BY "userWorkspaceId"`,
      [[USER_WORKSPACE_DATA_SEED_IDS.JANE, USER_WORKSPACE_DATA_SEED_IDS.JONY]],
    );
    const cache = getAppProviderByClassName<WorkspaceCacheService>(
      'WorkspaceCacheService',
    );
    const setMemberRole = async (roleId: string) => {
      await globalThis.testDataSource.query(
        'UPDATE core."roleTarget" SET "roleId" = $1 WHERE "userWorkspaceId" = $2',
        [roleId, member.userWorkspaceId],
      );
      await cache.invalidateAndRecompute(SEED_APPLE_WORKSPACE_ID, [
        'flatRoleTargetMaps',
      ]);
    };

    let state: string;

    try {
      await setMemberRole(administrator.roleId);
      state = await authorize({ token: APPLE_JONY_MEMBER_ACCESS_TOKEN });
    } finally {
      await setMemberRole(member.roleId);
    }

    const redirect = await callback(state, 'account-a');

    expect(redirect.searchParams.get('errorMessage')).toContain('permission');
    expect(readExecutions(identityExecutionsPath)).toEqual([]);
    expect(readExecutions(onConnectExecutionsPath)).toEqual([]);
    expect(await readAccounts()).toEqual([]);
  });

  it('rejects a provider changed during token exchange before executing its identity hook', async () => {
    const state = await authorize();

    providerHttp.use(
      http.post(TOKEN_ENDPOINT, async () => {
        await globalThis.testDataSource.query(
          'UPDATE core."connectionProvider" SET "identifyAccountLogicFunctionUniversalIdentifier" = NULL WHERE id = $1',
          [provider.id],
        );

        return HttpResponse.json({ access_token: 'account-a' });
      }),
    );

    try {
      const redirect = await callback(state, 'account-a');

      expect(redirect.searchParams.get('errorMessage')).toBeTruthy();
      expect(readExecutions(identityExecutionsPath)).toEqual([]);
      expect(await readAccounts()).toEqual([]);
    } finally {
      await globalThis.testDataSource.query(
        'UPDATE core."connectionProvider" SET "identifyAccountLogicFunctionUniversalIdentifier" = $1 WHERE id = $2',
        [IDENTITY_IDENTIFIER, provider.id],
      );
    }
  });

  it.each([
    { applicationId: v4() },
    { workspaceId: v4() },
    { identifyAccountLogicFunctionUniversalIdentifier: v4() },
  ])(
    'does not execute a missing or foreign identity function',
    async (overrides) => {
      const identityService =
        getAppProviderByClassName<ConnectionProviderIdentityService>(
          'ConnectionProviderIdentityService',
        );

      await expect(
        identityService.identifyAccount({
          provider: { ...provider, ...overrides },
          workspaceId: SEED_APPLE_WORKSPACE_ID,
          accessToken: plaintextStringSchema.parse('account-a'),
          scopes: ['read'],
        }),
      ).rejects.toMatchObject({
        code: ConnectionProviderExceptionCode.ACCOUNT_IDENTIFICATION_FAILED,
      });
      expect(readExecutions(identityExecutionsPath)).toEqual([]);
    },
  );

  it('rejects tampered state before exchanging a code or executing the app', async () => {
    const state = await authorize();
    const redirect = await callback(`${state}invalid`, 'account-a');

    expect(redirect.searchParams.get('errorMessage')).toContain(
      'invalid or expired',
    );
    expect(tokenExchanges).toEqual([]);
    expect(readExecutions(identityExecutionsPath)).toEqual([]);
    expect(await readAccounts()).toEqual([]);
  });
});
