import { defineLogicFunction } from 'twenty-sdk/define';

import { syncContractItem } from '../utils/contract.pricing';

type ItemEvent = { recordId: string };

const handler = async (event: ItemEvent) => {
  const result = await syncContractItem(event.recordId);
  console.log('[tapdata-crm] contract item synced', JSON.stringify(result));

  return result;
};

export default defineLogicFunction({
  universalIdentifier: '10c01600-fd55-4c6d-bff9-ca8b288e4bc5',
  name: 'sync-contract-item-on-change',
  description: 'Line total = quantity x unit price, ported from the Espo contract item hook',
  timeoutSeconds: 30,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'tapdataContractItem.*',
  },
});
