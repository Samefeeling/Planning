# Incremental daily order updates

## Current workflow

The first successful load for each data source creates a known-order baseline.
It does not label the whole starting schedule as new. Later automatic or manual
refreshes compare the assembly job numbers in the latest `Planning1.csv` with
that baseline.

An unseen job is stamped with the local first-seen date. The header shows
`N new today`, with the job numbers in its tooltip, and each new row has a
`NEW` marker. A removed order remains in the known set, so an old job that
reappears is not falsely counted as new.

Refresh already reconciles rather than rebuilding the plan:

- existing line placement, crew, pinned start, overtime approval, production
  history and row order are retained;
- genuinely new jobs are appended to their home production line;
- completed or removed jobs leave the live board;
- `Crew N orders` can staff only the unstaffed jobs without changing existing
  manual allocations.

This lets the planner review the green `NEW` rows, adjust their line or start,
and crew them without recreating the rest of the schedule.

## An order that leaves the export

`Planning1.csv` is re-exported twice a day, and an order missing from one of
them is more often a bad export than a finished job: a filter changed upstream,
the file was written while the BAQ was still running, a row lost its part
number and was skipped.

So an absence is recorded, not acted on. `planStore` keeps a `lastSeen` day per
job — persisted with the plan — and an order that stops appearing keeps its
crew, its pinned start, its overtime approval, its bookings and its place in
its line for `PLAN_RETENTION_DAYS` (14). Only after a fortnight of absences is
any of it let go.

Nothing is drawn in the meantime. The board builds its rows from the export, so
an order that is not in one has no row either way; what is being held is the
planning, against the order coming back. When it does, in the next export or a
week later, it comes back with everything on it and in the same place on its
line.

## Shared production deployment

The browser baseline is intentionally a first deployment step. It is scoped by
data-source name and stored in local storage, so different computers can have
different first-seen dates. Before several planners share the board, move this
authority to `ASSY_Plan` (or a small `ASSY_OrderIntake` list) with these fields:

| Field | Purpose |
| --- | --- |
| `JobNum` | Unique indexed job key |
| `FirstSeenAt` | UTC timestamp of the first successful import |
| `FirstSeenDate` | Sydney production date used by the daily count |
| `SourceExportAt` | Timestamp or export ID from `Planning1.csv` |
| `AcknowledgedAt` | When a planner reviewed the new job |
| `AcknowledgedBy` | Planner who accepted it into the schedule |

The refresh service should upsert unseen job numbers before publishing the new
snapshot. Use the SharePoint item eTag or a single import revision so two
planners cannot stamp the same order independently. The UI can then count
unacknowledged orders from the shared list instead of browser storage while the
existing reconciliation behavior remains unchanged.

Do not use a CSV row position, description or due date as identity. `JobNum`
is the stable key; those other values can change during normal Epicor updates.
