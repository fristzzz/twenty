// Exchange-rate lookup: mirrors custom/Espo/Modules/TapdataContract/Services/TapdataExchangeRateService.php
// Espo's tier 2 (local CurrencyRecordRate cache table) has no equivalent in Twenty, so the spike
// goes straight from the live ECB fixing to a static fallback table.
export const BASE_CURRENCY = 'CNY';

const FALLBACK_RATES: Record<string, number> = {
  USD: 7.235,
  HKD: 0.925,
  EUR: 7.8,
  GBP: 9.1,
  JPY: 0.047,
  AUD: 4.7,
  CAD: 5.2,
  SGD: 5.4,
  CHF: 8.1,
};

export type RateResult = {
  rate: number;
  rateDate: string;
  rateSource: string;
};

export const today = (): string => new Date().toISOString().slice(0, 10);

export async function determineRate(
  currencyCode: string,
  date?: string | null,
): Promise<RateResult> {
  const rateDate = date ?? today();

  if (!currencyCode || currencyCode === BASE_CURRENCY) {
    return { rate: 1, rateDate, rateSource: 'Base Currency (1.000000)' };
  }

  try {
    const response = await fetch(
      `https://api.frankfurter.dev/v1/${rateDate}?from=${currencyCode}&to=${BASE_CURRENCY}`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = (await response.json()) as { rates?: Record<string, number> };
    const rate = body.rates?.[BASE_CURRENCY];
    if (typeof rate === 'number' && rate > 0) {
      return { rate, rateDate, rateSource: `Frankfurter ECB fixing ${rateDate}` };
    }
    throw new Error('no rate in payload');
  } catch {
    const rate = FALLBACK_RATES[currencyCode];
    if (rate) {
      return { rate, rateDate, rateSource: 'Fallback Reference Rate' };
    }

    return { rate: 1, rateDate, rateSource: `Unknown Currency ${currencyCode} (1.000000)` };
  }
}
