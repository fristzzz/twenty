import { defineLogicFunction } from 'twenty-sdk/define';

import { syncQuoteItem, syncQuoteTotals } from '../utils/quote.pricing';

type ItemEvent = {
  recordId: string;
  operation?: string;
  properties?: {
    before?: Record<string, any>;
    after?: Record<string, any>;
  };
};

const handler = async (event: ItemEvent) => {
  const quoteId =
    (await syncQuoteItem(event.recordId)) ??
    event.properties?.before?.quoteId ??
    event.properties?.before?.quote?.id ??
    null;

  if (!quoteId) {
    return { recordId: event.recordId, skipped: 'no parent quote on this event' };
  }

  const result = await syncQuoteTotals(quoteId);
  console.log(`[tapdata-crm] quote ${quoteId} recalculated`, JSON.stringify(result));

  return { quoteId, ...result };
};

export default defineLogicFunction({
  universalIdentifier: '3198f136-a1bd-4e93-920b-2e67c9c1e8e8',
  name: 'recalc-quote-on-item-change',
  description: 'Line pricing + parent quote rollup, ported from the Espo quote hooks',
  timeoutSeconds: 30,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'tapdataQuoteItem.*',
  },
});
