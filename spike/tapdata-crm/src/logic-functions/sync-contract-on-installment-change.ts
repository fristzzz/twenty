import { defineLogicFunction } from 'twenty-sdk/define';

import { syncContract } from '../utils/contract.pricing';

type InstallmentEvent = {
  recordId: string;
  properties?: { before?: Record<string, any>; after?: Record<string, any> };
};

const handler = async (event: InstallmentEvent) => {
  const record = event.properties?.after ?? event.properties?.before ?? {};
  const contractId = record.contractId ?? record.contract?.id ?? null;

  if (!contractId) {
    return { recordId: event.recordId, skipped: 'no parent contract' };
  }

  const result = await syncContract(contractId);
  console.log(`[tapdata-crm] contract ${contractId} rolled up`, JSON.stringify(result));

  return { contractId, ...result };
};

export default defineLogicFunction({
  universalIdentifier: '88621a0a-2a1e-44e7-8d45-41df4aea1b1f',
  name: 'sync-contract-on-installment-change',
  description: 'Parent contract rollups when an installment row changes',
  timeoutSeconds: 30,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'tapdataInstallment.*',
  },
});
