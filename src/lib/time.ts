/**
 * Small date helpers shared across the board. Day-level scheduling maths lives
 * in `engine/assembly/dates.ts`.
 */

export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export const maxDate = (a: Date, b: Date): Date => (a > b ? a : b);

const DAY_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

export const formatDay = (d: Date): string => DAY_FMT.format(d);
export const formatTime = (d: Date): string => TIME_FMT.format(d);

/**
 * A local calendar day as `YYYY-MM-DD` — the board's key for a shift.
 *
 * Local, deliberately. `toISOString().slice(0, 10)` is the same string only
 * at Greenwich; east of it a local midnight is the previous date in UTC, and
 * the day a shift ran is a local day everywhere else on this board.
 *
 * There were five of these, one per module that needed a day key, and four
 * different ways of reading one back. Two of them disagreed about whether the
 * answer was local or UTC, which is how a SharePoint row stopped matching its
 * own shift.
 */
export const toDayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

/**
 * The local midnight a `YYYY-MM-DD` names.
 *
 * `new Date('2026-09-10')` is *UTC* midnight, which is the ninth in Sydney's
 * afternoon and the ninth in New York's evening. Reading a day key has to say
 * which day it means, so it is built from the parts.
 */
export function fromDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}
