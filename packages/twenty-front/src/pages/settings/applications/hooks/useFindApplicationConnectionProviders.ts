import { useQuery } from '@apollo/client/react';

import { useRefetchOnApplicationOperation } from '@/applications/hooks/useRefetchOnApplicationOperation';
import { FIND_APPLICATION_CONNECTION_PROVIDERS } from '@/settings/applications/graphql/queries/findApplicationConnectionProviders';
import { type FrontendApplicationConnectionProvider } from '~/pages/settings/applications/types/FrontendApplicationConnectionProvider';

type QueryResult = {
  applicationConnectionProviders: FrontendApplicationConnectionProvider[];
};

export const useFindApplicationConnectionProviders = (
  applicationId?: string,
) => {
  const { data, loading, refetch } = useQuery<QueryResult>(
    FIND_APPLICATION_CONNECTION_PROVIDERS,
    {
      skip: !applicationId,
      variables: { applicationId: applicationId ?? '' },
      fetchPolicy: 'cache-and-network',
    },
  );

  useRefetchOnApplicationOperation({ applicationId, refetch });

  return {
    connectionProviders: data?.applicationConnectionProviders ?? [],
    loading,
    refetch,
  };
};
