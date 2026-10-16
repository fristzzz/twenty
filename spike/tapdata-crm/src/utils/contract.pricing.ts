import { determineRate } from './fx';
import { findOne, findMany, updateOne } from './records';
import { amountOf, codeOf, equals, isSet, money, round2 } from './money';

// Port of custom/Espo/Modules/TapdataContract/Hooks/TapdataContract/ExchangeRateHook.php:
// currency anchoring + amountCny + installment rollups.
const RECEIVED = ['PAID', 'PAID_PENDING_INVOICE'];
const TO_INVOICE = ['PENDING_INVOICE', 'PAID_PENDING_INVOICE'];

const CONTRACT_FIELDS = {
  id: true,
  signDate: true,
  exchangeRate: true,
  rateDate: true,
  rateSource: true,
  collectionRate: true,
  amount: { amountMicros: true, currencyCode: true },
  amountCny: { amountMicros: true, currencyCode: true },
  paymentReceived: { amountMicros: true, currencyCode: true },
  toInvoiced: { amountMicros: true, currencyCode: true },
  receivable: { amountMicros: true, currencyCode: true },
};

const INSTALLMENT_FIELDS = {
  id: true,
  position: true,
  percentage: true,
  status: true,
  amount: { amountMicros: true, currencyCode: true },
};

const round6 = (value: number) => Math.round((value + Number.EPSILON) * 1e6) / 1e6;

export async function syncContract(contractId: string): Promise<Record<string, unknown>> {
  const contract = await findOne('tapdataContracts', { id: { eq: contractId } }, CONTRACT_FIELDS);
  if (!contract) {
    return { skipped: 'contract not found' };
  }

  const currencyCode = codeOf(contract.amount, 'CNY');
  const amount = amountOf(contract.amount);
  const data: Record<string, unknown> = {};

  // A rate whose source says Manual Override was keyed in by a human and is left alone,
  // same rule as the Espo before-save hook.
  let rate = Number(contract.exchangeRate ?? 0);
  let rateDate = contract.rateDate as string | null;
  let rateSource = contract.rateSource as string | null;

  if (rateSource !== 'Manual Override' || !(rate > 0)) {
    const resolved = await determineRate(currencyCode, contract.signDate ?? null);
    rate = resolved.rate;
    rateDate = resolved.rateDate;
    rateSource = resolved.rateSource;
  }

  if (Number(contract.exchangeRate ?? 0) !== round6(rate)) {
    data.exchangeRate = round6(rate);
  }
  if (contract.rateDate !== rateDate) {
    data.rateDate = rateDate;
  }
  if (contract.rateSource !== rateSource) {
    data.rateSource = rateSource;
  }

  const targetCny = money(round2(amount * rate), 'CNY');
  if (!equals(contract.amountCny, targetCny)) {
    data.amountCny = targetCny;
  }

  const installments = await findMany(
    'tapdataInstallments',
    { contract: { id: { eq: contractId } } },
    INSTALLMENT_FIELDS,
  );

  let paymentReceived = 0;
  let toInvoiced = 0;

  for (const installment of installments) {
    const percentage = Number(installment.percentage ?? 0);
    let value = isSet(installment.amount) ? amountOf(installment.amount) : 0;

    if (!value && percentage > 0 && amount > 0) {
      value = round2((amount * percentage) / 100);
      await updateOne('TapdataInstallment', installment.id, {
        amount: money(value, currencyCode),
      });
    }

    if (RECEIVED.includes(String(installment.status))) {
      paymentReceived += value;
    }
    if (TO_INVOICE.includes(String(installment.status))) {
      toInvoiced += value;
    }
  }

  paymentReceived = round2(paymentReceived);
  toInvoiced = round2(toInvoiced);
  const receivable = round2(amount - paymentReceived);
  const collectionRate = amount > 0 ? round2((paymentReceived / amount) * 100) : 0;

  if (!equals(contract.paymentReceived, money(paymentReceived, currencyCode))) {
    data.paymentReceived = money(paymentReceived, currencyCode);
  }
  if (!equals(contract.toInvoiced, money(toInvoiced, currencyCode))) {
    data.toInvoiced = money(toInvoiced, currencyCode);
  }
  if (!equals(contract.receivable, money(receivable, currencyCode))) {
    data.receivable = money(receivable, currencyCode);
  }
  if (Number(contract.collectionRate ?? 0) !== collectionRate) {
    data.collectionRate = collectionRate;
  }

  if (Object.keys(data).length > 0) {
    await updateOne('TapdataContract', contractId, data);
  }

  return {
    contractId,
    rate: round6(rate),
    rateSource,
    amountCny: round2(amount * rate),
    paymentReceived,
    toInvoiced,
    receivable,
    collectionRate,
    written: Object.keys(data),
  };
}

const CONTRACT_ITEM_FIELDS = {
  id: true,
  quantity: true,
  unitPrice: { amountMicros: true, currencyCode: true },
  totalAmount: { amountMicros: true, currencyCode: true },
};

// Port of custom/Espo/Modules/TapdataContract/Hooks/TapdataContractItem/CalculationHook.php
export async function syncContractItem(recordId: string): Promise<Record<string, unknown>> {
  const item = await findOne('tapdataContractItems', { id: { eq: recordId } }, CONTRACT_ITEM_FIELDS);
  if (!item) {
    return { skipped: 'contract item not found' };
  }

  const quantity = Number(item.quantity ?? 0);
  const currencyCode = codeOf(item.unitPrice, 'CNY');
  const target = money(round2(quantity * amountOf(item.unitPrice)), currencyCode);

  if (!equals(item.totalAmount, target)) {
    await updateOne('TapdataContractItem', item.id, { totalAmount: target });
  }

  return { itemId: item.id, totalAmount: amountOf(target) };
}
