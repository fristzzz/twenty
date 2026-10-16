export type CurrencyValue = {
  amountMicros: number;
  currencyCode: string;
} | null | undefined;

const MICROS = 1_000_000;

export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export const amountOf = (value: CurrencyValue): number => (value?.amountMicros ?? 0) / MICROS;

export const codeOf = (value: CurrencyValue, fallback = 'CNY'): string =>
  value?.currencyCode ?? fallback;

export const money = (value: number, currencyCode: string) => ({
  amountMicros: Math.round(round2(value) * MICROS),
  currencyCode,
});

export const isSet = (value: CurrencyValue): boolean =>
  (value?.amountMicros ?? null) !== null && value?.amountMicros !== 0;

export const equals = (a: CurrencyValue, b: CurrencyValue): boolean =>
  (a?.amountMicros ?? 0) === (b?.amountMicros ?? 0) &&
  codeOf(a) === codeOf(b);
