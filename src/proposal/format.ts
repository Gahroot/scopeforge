import type { Range, TriEstimate } from "../core/types.js";

const MONEY_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

const MONTH_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

export function formatMoney(value: number): string {
  return MONEY_FORMATTER.format(Math.round(value));
}

export function formatMoneyRange(range: Range): string {
  const low = Math.round(range.low);
  const high = Math.round(range.high);
  if (low === high) return formatMoney(low);
  return `${formatMoney(low)}–${formatMoney(high)}`;
}

export function formatTriEstimateRange(estimate: TriEstimate, unit: string): string {
  return `${formatNumber(estimate.optimistic)}–${formatNumber(estimate.pessimistic)} ${unit}`;
}

export function formatPercent(value: number): string {
  return PERCENT_FORMATTER.format(value);
}

export function formatMonths(value: number | null): string {
  if (value === null) return "Not applicable";
  if (value < 1) return "Under 1 month";
  const rounded = Math.round(value * 10) / 10;
  return `${MONTH_FORMATTER.format(rounded)} months`;
}

export function formatProposalDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}
