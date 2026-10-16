import { findOne, findMany, updateOne } from './records';
import { amountOf, codeOf, equals, isSet, money, round2 } from './money';

// Port of custom/Espo/Modules/TapdataQuote/Hooks/TapdataQuoteItem/CalculationHook.php
// + TapdataQuote/CalculationHook.php (parent rollup).

const ITEM_FIELDS = {
  id: true,
  quantity: true,
  discountPercentage: true,
  listPrice: { amountMicros: true, currencyCode: true },
  unitPrice: { amountMicros: true, currencyCode: true },
  totalAmount: { amountMicros: true, currencyCode: true },
  quote: { id: true },
};

const QUOTE_FIELDS = {
  id: true,
  subtotal: { amountMicros: true, currencyCode: true },
  discountAmount: { amountMicros: true, currencyCode: true },
  amount: { amountMicros: true, currencyCode: true },
};

export async function syncQuoteItem(recordId: string): Promise<string | null> {
  const item = await findOne('tapdataQuoteItems', { id: { eq: recordId } }, ITEM_FIELDS);
  if (!item) {
    return null;
  }

  const quantity = Number(item.quantity ?? 0);
  const listAmount = amountOf(item.listPrice);
  const currencyCode = codeOf(item.listPrice, codeOf(item.unitPrice));
  const discount = Number(item.discountPercentage ?? 0);
  let unitPrice = isSet(item.unitPrice) ? amountOf(item.unitPrice) : null;

  if (unitPrice === null && listAmount) {
    unitPrice = round2(listAmount * (1 - discount / 100));
  }

  const targetUnit = unitPrice === null ? null : money(unitPrice, currencyCode);
  const targetDiscount = unitPrice !== null && listAmount > 0 && unitPrice < listAmount && !discount
    ? round2((1 - unitPrice / listAmount) * 100)
    : discount;
  const targetTotal = money(round2(quantity * (unitPrice ?? 0)), currencyCode);

  const data: Record<string, unknown> = {};
  if (targetUnit && !equals(item.unitPrice, targetUnit)) {
    data.unitPrice = targetUnit;
  }
  if (targetDiscount !== discount && Number(item.discountPercentage ?? 0) !== targetDiscount) {
    data.discountPercentage = targetDiscount;
  }
  if (!equals(item.totalAmount, targetTotal)) {
    data.totalAmount = targetTotal;
  }
  if (Object.keys(data).length > 0) {
    await updateOne('TapdataQuoteItem', item.id, data);
  }

  return item.quote?.id ?? null;
}

export async function syncQuoteTotals(quoteId: string): Promise<Record<string, unknown>> {
  const [quote, items] = await Promise.all([
    findOne('tapdataQuotes', { id: { eq: quoteId } }, QUOTE_FIELDS),
    findMany('tapdataQuoteItems', { quote: { id: { eq: quoteId } } }, ITEM_FIELDS),
  ]);
  if (!quote) {
    return { skipped: 'quote not found' };
  }

  const currencyCode =
    items.map((item) => codeOf(item.totalAmount)).find((code) => code !== 'CNY') ??
    codeOf(quote.amount, 'CNY');

  const subtotal = round2(
    items.reduce((sum, item) => sum + Number(item.quantity ?? 0) * amountOf(item.listPrice), 0),
  );
  const amount = round2(items.reduce((sum, item) => sum + amountOf(item.totalAmount), 0));
  const targets = {
    subtotal: money(subtotal, currencyCode),
    amount: money(amount, currencyCode),
    discountAmount: money(round2(subtotal - amount), currencyCode),
  };

  const data: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(targets)) {
    if (!equals((quote as Record<string, any>)[field], value)) {
      data[field] = value;
    }
  }
  if (Object.keys(data).length > 0) {
    await updateOne('TapdataQuote', quoteId, data);
  }

  return { quoteId, ...targets };
}
