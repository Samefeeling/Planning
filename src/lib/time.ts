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
