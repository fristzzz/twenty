import { defineLogicFunction } from 'twenty-sdk/define';

import { syncContract, syncContractItem } from '../utils/contract.pricing';
import { syncQuoteItem, syncQuoteTotals } from '../utils/quote.pricing';

type RoutePayload = {
  body?: { contractId?: string; quoteItemId?: string; quoteId?: string; contractItemId?: string };
};

// Replaces the two Espo custom actions: POST /TapdataContract/action/fetchRate and
// POST /TapdataQuote/action/recalculate.
const handler = async (event: RoutePayload) => {
  const { contractId, contractItemId, quoteItemId, quoteId } = event?.body ?? {};

  if (contractId) {
    return syncContract(String(contractId));
  }
  if (contractItemId) {
    return syncContractItem(String(contractItemId));
  }
  if (quoteItemId) {
    const parent = await syncQuoteItem(String(quoteItemId));

    return parent ? syncQuoteTotals(parent) : { skipped: 'quote item not found' };
  }
  if (quoteId) {
    return syncQuoteTotals(String(quoteId));
  }

  return { error: 'pass contractId, contractItemId, quoteItemId or quoteId' };
};

export default defineLogicFunction({
  universalIdentifier: 'e6ef5883-d86e-4197-89f3-0e7495461ce2',
  name: 'recalculate-manual',
  description: 'Force a recalculation, like the Espo action endpoints',
  timeoutSeconds: 30,
  handler,
  httpRouteTriggerSettings: {
    path: '/tapdata/recalculate',
    httpMethod: 'POST',
    isAuthRequired: true,
  },
});
