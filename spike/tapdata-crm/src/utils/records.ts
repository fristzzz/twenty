import { CoreApiClient } from 'twenty-client-sdk/core';

// Constructed lazily: the manifest build imports app modules, and CoreApiClient can only be
// instantiated once the typed client has been generated against a live workspace.
let cached: CoreApiClient | null = null;

const getClient = (): CoreApiClient => {
  if (!cached) {
    cached = new CoreApiClient();
  }

  return cached;
};

type Selection = Record<string, unknown>;

export async function findMany(plural: string, filter: Selection, node: Selection): Promise<any[]> {
  const result = (await getClient().query({
    [plural]: {
      __args: { filter },
      edges: { node },
    },
  } as unknown as Selection)) as Record<string, any>;

  return result?.[plural]?.edges?.map((edge: any) => edge.node) ?? [];
}

export async function findOne(plural: string, filter: Selection, node: Selection): Promise<any | null> {
  const result = (await getClient().query({
    [plural]: {
      __args: { filter },
      edges: { node },
    },
  } as unknown as Selection)) as Record<string, any>;

  return result?.[plural]?.edges?.[0]?.node ?? null;
}

export async function updateOne(singular: string, id: string, data: Selection): Promise<void> {
  await getClient().mutation({
    [`update${singular}`]: {
      __args: { id, data },
      id: true,
    },
  } as unknown as Selection);
}
