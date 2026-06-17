/**
 * "Data return to Epicor": turn the planned board back into the rows Epicor
 * expects (one per scheduled job), mirroring the workbook's
 * `data return to Epicor` sheet columns. The schedule already carries every
 * field — start time, die/insert change flags, setup time — so this is a pure
 * projection the planner can copy back.
 */

import type { ScheduledJob } from '@/domain/types';
import type { LaneView } from '@/store/selectors';

export interface EpicorRow {
  jobNum: string;
  partNum: string;
  startDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM (24h)
  dieChange: 'Y' | 'N';
  dieName: string;
  insertChange: 'Y' | 'N';
  insertName: string;
  setupMinutes: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function toEpicorRow(sj: ScheduledJob): EpicorRow {
  const { changeover, routing } = sj;
  return {
    jobNum: String(sj.job.id),
    partNum: String(sj.job.partNum),
    startDate: isoDate(sj.start),
    startTime: isoTime(sj.start),
    dieChange: changeover.kinds.includes('tool') ? 'Y' : 'N',
    dieName: String(changeover.toTool ?? routing?.tool ?? ''),
    insertChange: changeover.kinds.includes('insert') ? 'Y' : 'N',
    insertName: String(routing?.insert ?? ''),
    setupMinutes: Math.round(changeover.minutes),
  };
}

/** All scheduled jobs across all lanes, ordered by line then start time. */
export function buildEpicorRows(lanes: LaneView[]): EpicorRow[] {
  return lanes.flatMap((lane) => lane.jobs.map(toEpicorRow));
}

const HEADERS = [
  'JobNum',
  'PartNum',
  'Start Date',
  'Start Time',
  'Die Change Y/N',
  'Die Name',
  'Insert Change Y/N',
  'Insert Name',
  'Setup Time',
] as const;

/** Tab-separated text ready to paste into the Epicor return sheet. */
export function toTsv(rows: EpicorRow[]): string {
  const lines = [HEADERS.join('\t')];
  for (const r of rows) {
    lines.push(
      [
        r.jobNum,
        r.partNum,
        r.startDate,
        r.startTime,
        r.dieChange,
        r.dieName,
        r.insertChange,
        r.insertName,
        String(r.setupMinutes),
      ].join('\t'),
    );
  }
  return lines.join('\n');
}
