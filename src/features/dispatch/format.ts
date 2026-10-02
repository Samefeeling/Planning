/** Display helpers for the dispatch page. Dates are always Australian order. */

import type { DayKey, Readiness } from '@/domain/dispatch';
import type { BadgeVariant } from '@/ui';
import { formatDay, formatShortDay, fromDayKey } from '@/lib/time';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const weekdayOf = (day: DayKey): string => WEEKDAY[fromDayKey(day).getDay()];

/** `Thu 01/10/2026`. */
export const dayLabel = (day: DayKey | null): string =>
  day ? `${weekdayOf(day)} ${formatDay(fromDayKey(day))}` : '—';

/** `01/10`, for dense tables. */
export const shortDay = (day: DayKey | null): string =>
  day ? formatShortDay(fromDayKey(day)) : '—';

export const m3 = (v: number): string => `${v < 10 ? v.toFixed(2) : v.toFixed(1)} m³`;

export const money = (v: number): string =>
  v.toLocaleString('en-AU', { maximumFractionDigits: 0 });

export const pct = (v: number): string => `${Math.round(v * 100)}%`;

export const READINESS: Record<Readiness, { label: string; variant: BadgeVariant; title: string }> = {
  ready: { label: 'Ready', variant: 'ok', title: 'Every goods line is Ready or fully allocated' },
  partial: { label: 'Partial', variant: 'warn', title: 'Some goods lines are ready' },
  'not-ready': { label: 'In production', variant: 'neutral', title: 'No goods line is ready yet' },
  'no-goods': { label: 'Freight only', variant: 'neutral', title: 'Only freight or service lines' },
};

/**
 * Staging load against the marshalling area: green below 80%, amber to full,
 * red over — the same bands as the assembly board's load bars.
 */
export const stagingTone = (fraction: number): 'good' | 'mid' | 'bad' =>
  fraction > 1 ? 'bad' : fraction >= 0.8 ? 'mid' : 'good';

/** Vehicle fill is the other way round: a full truck is the good one. */
export const fillTone = (fraction: number): 'good' | 'mid' | 'bad' =>
  fraction > 1 ? 'bad' : fraction >= 0.85 ? 'good' : fraction >= 0.6 ? 'mid' : 'bad';
