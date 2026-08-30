import { describe, it, expect } from 'vitest';
import { toEpicorRow, toTsv } from '@/engine/epicorExport';
import { JobId, MachineId, PartId, ToolId, InsertId } from '@/domain/ids';
import type { ChangeoverInfo, Job, ScheduledJob } from '@/domain/types';

const job: Job = {
  id: JobId('SFM507068'),
  department: 'moulding',
  partNum: PartId('V11694'),
  description: 'Ned Stool - Amber',
  remainingQty: 88,
  qtyPerHr: 30,
  laborHrs: 2.93,
  dueDate: null,
  reqBy: null,
  released: true,
  priority: 3,
  materialPrep: 'ready',
  tool: ToolId('Ned stool'),
  preferredMachine: MachineId('1300T'),
  productType: null,
  currentStage: null,
};

const changeover: ChangeoverInfo = {
  required: true,
  kinds: ['tool', 'insert'],
  minutes: 37.5,
  summary: 'D/C → Ned Stool, insert → 16',
  fromTool: ToolId('old'),
  toTool: ToolId('Ned stool'),
};

const scheduled: ScheduledJob = {
  job,
  machine: MachineId('1300T'),
  index: 0,
  start: new Date('2026-06-15T07:00:00'),
  end: new Date('2026-06-15T10:26:00'),
  runHours: 2.93,
  changeover,
  material: { level: 'ok', earliestStart: null, shortages: [] },
  routing: {
    partNum: PartId('V11694'),
    machine: MachineId('1300T'),
    tool: ToolId('Ned stool'),
    color: null,
    insert: InsertId('16'),
    description: '',
  },
  warnings: [],
};

describe('epicorExport', () => {
  it('projects a scheduled job onto the Epicor return columns', () => {
    const row = toEpicorRow(scheduled);
    expect(row.jobNum).toBe('SFM507068');
    expect(row.partNum).toBe('V11694');
    expect(row.startDate).toBe('2026-06-15');
    expect(row.startTime).toBe('07:00');
    expect(row.dieChange).toBe('Y');
    expect(row.insertChange).toBe('Y');
    expect(row.insertName).toBe('16');
    expect(row.setupMinutes).toBe(38); // rounded
  });

  it('marks no die/insert change when the changeover does not include them', () => {
    const row = toEpicorRow({
      ...scheduled,
      changeover: { ...changeover, kinds: ['color'] },
    });
    expect(row.dieChange).toBe('N');
    expect(row.insertChange).toBe('N');
  });

  it('renders a TSV with a header row and one line per job', () => {
    const tsv = toTsv([toEpicorRow(scheduled)]);
    const lines = tsv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0].split('\t')[0]).toBe('JobNum');
    expect(lines[1].split('\t')[0]).toBe('SFM507068');
  });
});
