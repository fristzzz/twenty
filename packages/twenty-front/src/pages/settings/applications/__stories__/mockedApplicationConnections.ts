import { graphql, HttpResponse } from 'msw';

import {
  type ApplicationConnectedAccountsQuery,
  type ApplicationConnectionProvidersQuery,
} from '~/generated-metadata/graphql';
import { graphqlMocks } from '~/testing/graphqlMocks';

export const APPLICATION_ID = '20202020-0000-4000-8000-000000000001';
export const CONNECTED_ACCOUNT_ID = '20202020-0000-4000-8000-000000000002';
const CONNECTION_PROVIDER_ID = '20202020-0000-4000-8000-000000000003';

export const buildApplicationConnectionHandlers = () => [
  graphql.query<ApplicationConnectionProvidersQuery>(
    'ApplicationConnectionProviders',
    () =>
      HttpResponse.json({
        data: {
          applicationConnectionProviders: [
            {
              __typename: 'ApplicationConnectionProvider',
              id: CONNECTION_PROVIDER_ID,
              applicationId: APPLICATION_ID,
              type: 'oauth',
              name: 'calendar',
              displayName: 'Calendar provider',
              logoUrl: null,
              oauth: {
                scopes: ['calendar.readonly'],
                isClientCredentialsConfigured: true,
              },
            },
          ],
        },
      }),
  ),
  graphql.query<ApplicationConnectedAccountsQuery>(
    'ApplicationConnectedAccounts',
    () =>
      HttpResponse.json({
        data: {
          applicationConnectedAccounts: [
            {
              __typename: 'ApplicationConnectedAccountDTO',
              id: CONNECTED_ACCOUNT_ID,
              connectionProviderId: CONNECTION_PROVIDER_ID,
              handle: 'calendar@example.com',
              name: 'Main calendar',
              visibility: 'workspace',
              scopes: ['calendar.readonly'],
              authFailedAt: null,
              authFailedReason: null,
              lastSignedInAt: null,
              lastCredentialsRefreshedAt: null,
              createdAt: '2026-09-01T00:00:00.000Z',
              updatedAt: '2026-09-01T00:00:00.000Z',
            },
          ],
        },
      }),
  ),
  graphql.query('FindOneApplication', () =>
    HttpResponse.json({ data: { findOneApplication: null } }),
  ),
  ...graphqlMocks.handlers,
];
