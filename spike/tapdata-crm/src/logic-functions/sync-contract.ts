import { defineLogicFunction } from 'twenty-sdk/define';

import { syncContract } from '../utils/contract.pricing';

type ContractEvent = {
  recordId: string;
  properties?: { updatedFields?: string[] };
};

const handler = async (event: ContractEvent) => {
  const result = await syncContract(event.recordId);
  console.log('[tapdata-crm] contract synced', JSON.stringify(result));

  return result;
};

export default defineLogicFunction({
  universalIdentifier: '3da89aea-0f55-4134-aa94-1dd319f3e334',
  name: 'sync-contract',
  description: 'Exchange rate anchoring, amountCny and installment rollups',
  timeoutSeconds: 30,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'tapdataContract.*',
    // Only these fields matter for the money maths; keeps the event storm down.
    updatedFields: [
      'amount',
      'signDate',
      'exchangeRate',
      'rateSource',
      'installmentMethod',
      'status',
    ],
  },
});
