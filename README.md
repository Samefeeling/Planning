# Resero Planning — Assembly Schedule Board

A day-scale **Gantt** for the sofa / chair / table assembly lines: crew
allocation, **Due / Expect / Ship** dates, and end-of-shift booking.

Sized for the real department — ~15 people, one white shift, the supervisor
dispatches on the floor. Nobody reports by the hour: the shift's output is
booked once at the end of the day, so there is no event stream and no live
polling.

Source data comes from Epicor via SharePoint, refreshed **every five minutes
and on demand**: orders from the `Planning1.csv` export, people from the
`ASSY_Operator` list, and the material picture from the master workbook. The
plan goes back the other way, into the `ASSY_Plan` list.

## What it does

- **Four row groups** — `PMD` (the moulding plan, mirrored for context: greyed
  out, not draggable, never scheduled here), then `UPL`, `ASSY` and `TABLE`.
- **Three kinds of work order** — Cutting/Sewing and Upholstery run on UPL;
  Final Assembly runs on ASSY and TABLE.
- **One row per order**: Order · Order Qty · Start Date · Due Date · Expect
  Date · Ship Date · Team, beside the day grid with a draggable bar. Start is
  Epicor's own scheduled start, to the hour; any date column can be hidden to
  make room.
- **A load histogram along the top** — one bar per day, hours booked against
  the hours the shift can deliver, so the week reads as a shape before anyone
  reads a number. Green below 80%, orange to 90%, red beyond. Drag a bar to a
  greener day to level the week.
- **Work load, in standard hours** — the remaining hours of an order
  (`Calculated_RemainingLaborHrs`), shared by its crew and spread over the days
  its bar covers. Shown three ways: per line on the group header, for the whole
  board beside the zoom, and per person — click a name in the "Today on site"
  row for their week, day by day, against a shift's capacity. Someone on two
  orders at once shows a day over 7.25 h and is flagged.
- **Crew drives duration** — up to **4 people** per order; bar length is
  remaining standard hours ÷ (crew × productive hours), so adding someone
  visibly shortens it and pulls the Expect Date in. The picker offers only
  people who are on shift *and* qualified for that line.
- **Book the shift** — enter the quantity finished today; the Expect Date moves
  on its own: short of the daily target it slips out, ahead of it pulls in.
- **Production actuals** — Shift Output, Complete, Reject, Rework, Job Completed and Pause
  reasons are captured as daily records for the `ASSY_Production` SharePoint
  list. Its columns intentionally mirror `PMD_Production`, allowing KPI.ts to
  aggregate the two departments without a second mapping layer.
- **Drag** a bar sideways to move its start day, or drag an order between the
  pool and a line.
- **Colour by date** (Ship is the booked departure, Due the later customer date):

  | | Condition | Meaning |
  | --- | --- | --- |
  | 🟢 green | `Expect ≤ Ship` | makes the booked shipment |
  | 🟠 orange | `Ship < Expect < Due` | misses the shipment, customer date still reachable |
  | 🔴 red | `Expect ≥ Due` | the customer date will be missed |

  The bands are exhaustive and non-overlapping.

- **Predecessors** — an order waiting on another (moulding feeding upholstery,
  upholstery feeding final assembly) starts only when that one finishes.
- **Material gates release** — a short component is flagged, and material that
  only lands on a future PO pushes the bar out.

## Quick start

Needs **Node 18, 20 or 22** (Vite 6's requirement). `.nvmrc` and
`.devcontainer/` pin 22; on an older Node, `npm run dev` fails with
`crypto$2.getRandomValues is not a function`.

```bash
nvm use            # or: nvm install 22
npm install
npm run dev        # http://localhost:5173 — runs on bundled mock data
npm test           # engine, adapter and integration tests (115)
npm run build      # type-check + production build
```

### GitHub Codespaces

If a Codespace was created before the Node 22 dev-container configuration was
added, **Update Branch does not rebuild the running container**. In the
Codespaces command palette run **Codespaces: Rebuild Container**, then run:

```bash
npm run doctor     # checks Node, Web Crypto and installed Vite
npm run dev
```

The dev container runs `npm ci` both when it is created and when its checked-out
content is updated. `npm run dev` also runs the doctor first, so an old Node
runtime or missing install produces an actionable message rather than Vite's
indirect `crypto.getRandomValues` or `vite: not found` error.

The app starts on a **mock data source** (`src/data/mock/seed.json`, a real
slice extracted from the master workbook, plus a 15-person roster with one
person absent), so it is fully populated with no network or credentials.

## Data sources

Configure via `.env.local` (see `.env.example`):

| `VITE_DATA_SOURCE` | Behaviour |
| ------------------ | --------- |
| `mock` (default)   | Bundled `seed.json`. Instant, offline. |
| `planning-csv`     | Orders from `Planning1.csv`, people from the `ASSY_Operator` SharePoint list. |
| `excel`            | Fetch the master workbook from SharePoint (Microsoft Graph) and parse it with SheetJS. Falls back to a manual file upload if Graph isn't configured. |

The Excel source (and the heavy `xlsx` dependency) is **lazy-loaded**, so
neither the mock nor the CSV build ships the parser.

Whichever is configured, **Load CSV** in the header parses a `Planning1.csv`
picked from disk through exactly the same code — the quickest way to check an
export against the board without wiring up Graph auth.

### `Planning1.csv` → domain

Columns are matched **by header name, not position** (`mapHeaders` strips the
`JobHead_` / `JobOper_` / `Calculated_` prefix), so reordering the BAQ is safe.

| CSV column | Becomes | Note |
| --- | --- | --- |
| `JobHead_JobNum` | order id | first occurrence wins |
| `JobHead_PartNum` / `PartDescription` | part, description | |
| the `PMD` / `ASSY` column | line + department | `PMD` and press names → moulding; `UPL`/`ASSY`/`TABLE` → assembly |
| `JobHead_ProdQty` − `Calculated_RemainingQty` | completed qty | drives the progress fill |
| `JobHead_StartDate` + `JobHead_StartHour` | **Start Date** and material `Req. By` | the hour is decimal — `23.67` is 23:40 |
| `JobHead_ReqDueDate` | **Due Date** | |
| `Calculated_RemainingLaborHrs` | work load and bar length | falls back to `Calculated_LaborHrs`, then to `RemainingQty × JobOper_ProdStandard` |
| `JobOper_ProdStandard` | run rate | inverted to qty/hr |

Both hours columns hold the work **remaining**, not the order total — in the
sample `LaborHrs` equals `RemainingQty × ProdStandard` exactly. The board needs
a total, because booking output during the shift has to shrink the bar, so the
adapter reduces the export to hours-per-unit and grosses it back up. Reading the
remaining figure as the total would discount it a second time and under-schedule
every part-run order.

If no header matches the `PMD`/`ASSY` column, the parser finds it by looking for
the column whose values *are* line names — so an unfamiliar BAQ alias still
works.

**Not in today's export**, and read automatically once added: `ShipDate`,
`OrderType`, `Predecessor`, `MaterialStatus`. Two consequences worth knowing:

- **No Ship Date means no green/orange band.** The colour rule compares Expect
  against Ship first; with Ship absent every order is green until it passes its
  Due Date. This is the one column worth adding first.
- **Order type** is inferred from the line where that is unambiguous — ASSY and
  TABLE only run Final Assembly. UPL runs both Cutting/Sewing and Upholstery, so
  its orders show no type until the column exists.

The CSV carries no inventory, BOM or POs, so under `planning-csv` the material
engine sees nothing and every order reads as material-OK. Use `excel` when the
shortage view matters.

### `ASSY_Operator` → roster

| List column | Becomes |
| --- | --- |
| `Operator` | name |
| `Skills` | which lines the person may be allocated to |
| `Position`, `Supervisor` | shown on the crew chip / picker |
| `PlannedAnnualLeave` | ISO dates excluded from future daily load-rate capacity |

`Skills` is normalised onto the four lines, so both short codes and what people
actually type work: *Cutting/Sewing* and *Upholstery* → `UPL`, *Final Assembly*
→ `ASSY`, *Table* → `TABLE`. A multi-choice column (array) and a delimited text
column both parse. Anyone with no recognised skill is reported in the warning
banner, because they can never be allocated.

Attendance is **not** in the list — the supervisor confirms who is in each
morning — so everyone counts as on shift unless an `OnShift` column is added.

Workers are keyed by SharePoint **list item id**, not name, so renaming someone
does not orphan the allocations already saved against them.

### The plan → `ASSY_Plan`

The board mirrors itself back into a SharePoint list, one row per order. Set
`VITE_PLAN_LIST` to the list name to turn it on; **blank disables it entirely**,
so the mock demo never writes.

Two directions of information meet in that list, and the split is the whole
design:

| Column | Owner | Written when |
| --- | --- | --- |
| `Title` (job number) | key | on first sight of the order |
| `Operators`, `OperatorIds` | the planner | someone is allocated or taken off |
| `StartDate` | the planner | a bar is dragged |
| `Line` | the planner | an order moves between lines |
| `DueDate` | `Planning1.csv` | a refreshed export changes it |
| `OrderQty`, `RemainingQty` | `Planning1.csv` | a refreshed export changes them |
| `ExpectDate` | derived | the crew or the queue moves it |

So **dragging a bar to level the load writes `StartDate` only** — Epicor owns
the Due Date and this board never changes it. Conversely a refreshed export
updates `DueDate` and `RemainingQty` without disturbing the crew.

`StartDate` is the *effective* start — the later of the planner's drag, the
line's queue, the predecessor's finish and any material date. That is when work
actually begins, which is what a reader of the list wants; dragging an order
earlier than its line can take it will not move the date.

Rows are diffed before writing, so a five-minute refresh with nothing changed
costs one read and no writes. Orders that leave the export keep their row — the
list is the record of what was planned, not a copy of today's CSV. A write
failure shows in the header badge and the warning banner; it never blocks the
board.

### Sheet → domain mapping (`excel` source)

| Workbook sheet | Parser | Used for |
| --- | --- | --- |
| `planning` | `job.parser` | orders — assembly rows, and moulding jobs for the PMD context row |
| `ohb` | `inventory.parser` | free-on-hand |
| `part req` | `bom.parser` | components per order |
| `po` | `supply.parser` | incoming raw material |
| `total req` | `demand.parser` | period demand |
| `resource` | `machine.parser` | which moulding lines' jobs to load |

To drive assembly from the same sheet, add these columns to `planning`
(`job.parser` reads them when present and defaults every row to moulding
otherwise): `Department`, `OrderType`, `Priority`, `MaterialStatus`, `Line`,
`ShipDate`, `CompletedQty`.

The shift roster is **not** in the workbook — it is the `ASSY_Operator` list
above. The mock source supplies one; `SharePointExcelSource.fetchWorkers()`
returns empty.

## Architecture

A strict one-way dependency flow keeps the core testable and the data source
swappable:

```
domain  →  lib  →  engine  →  store  →  features (UI)
                      ↑           ↑
              data (adapters)  persistence
```

- **`domain/`** — pure types, branded ids, constants. Zero dependencies.
  `assembly.ts` holds the lines, the three work-order types and the shift
  constants.
- **`data/`** — the `DataSource` contract with three implementations (`mock`,
  `csv/PlanningCsvSource`, `excel`). Every parser is lenient and reports what it
  could not read as a warning rather than failing the load.
- **`engine/`** — pure, unit-tested functions. Shared: `materialAvailability`,
  `materialExplosion`, `netRequirements`, `indexes`. Assembly:
  `assembly/{duration,dates,release,board,workload}`. No React, no I/O.
- **`store/`** — Zustand. `dataStore` (loaded data + indexes), `planStore`
  (placement, crew, pinned starts, booked output — the only mutable plan
  state), `assemblySelectors` (derives the schedule), `uiStore` (selection).
- **`persistence/`** — `PlanRepository` with a REST (`ApiPlanRepository`) and a
  localStorage fallback; the working plan autosaves.
- **`features/`** — `assembly` (board, rows, bars, crew chips, inspector, dnd),
  `refresh`, `source` (the manual CSV loader) and `sync` (write-back).

### How the schedule is derived

`engine/assembly/board.computeAssemblyGantt` is a pure function from
(orders + placement + crew + bookings) to the view model. Per order it:

1. folds in the booked output, shrinking the remaining work;
2. divides that by the crew to get the bar length in days;
3. starts it at the later of the line's queue, the planner's drag, the
   predecessor's finish, and any incoming-PO date for short material;
4. sets Expect Date at the bar's end and colours it against Ship and Due.

Because the whole schedule is derived, allocating a person or booking output
re-lays-out the board with no separate update path.

## Roadmap

| Stage | Scope | Backend |
| --- | --- | --- |
| 1 ✅ | Assembly Gantt on mock data: crew, dates, booking, colours, predecessors | no |
| 1b ✅ | Read the real sources: `Planning1.csv` orders, `ASSY_Operator` roster | no |
| 2 ✅ | Write the plan back to the `ASSY_Plan` SharePoint list | no |
| 3 | Merge with the PMD dashboard into one page | yes |
| 4 | KPI view; actual hours feed back to correct standard hours | yes |

Stage 2 landed as a **direct Graph write** to `ASSY_Plan` (see above) rather
than a service: crew, start day and line go straight to the list, and a
refreshed export pushes Due Date and remaining quantity back into it. No
backend to run.

The booked shift output is the part still without a home. It is kept in
`PlanRepository` — localStorage by default, or a REST service when
`VITE_PERSIST_API_URL` is set — because `ASSY_Production` wants one row per job
*per day*, which is a different shape from the one-row-per-order mirror.

The persistence service receives `X-Production-List: ASSY_Production` and
upserts `assembly.production` by Job + Date. Each entry has `Complete`,
`ShiftOutput`, `Complete`, `Reject`, `Rework`, `JobCompleted`, `Paused`,
`PauseReason`, and `Notes` fields.
Without `VITE_PERSIST_API_URL`, the same payload is retained in localStorage
for offline development, but is not yet in SharePoint.

Stage 3 is already half-built: `Planning1.csv` holds PMD and assembly rows in
one file, and `PlanningCsvSource` splits them by the `PMD`/`ASSY` column, so
both pages can read one source without a second fetch.

## Notes

- **The moulding (PMD) board was removed.** Its jobs still load so the PMD row
  can mirror the plan, but there is no moulding scheduling, changeover or
  Epicor-export code any more. It is recoverable from git history if wanted.
- **Calendar days.** Assembly counts calendar days on one 8 h shift (0.75 h
  break); flip `WORKING_DAYS_ONLY` in `domain/assembly.ts` to skip weekends.
- **Mock dates** are anchored to a fixed epoch and shifted forward on load, so
  the demo always reads as the current week.
- **`xlsx`** is the npm SheetJS build; it carries known advisories and is only
  loaded for the (trusted, internal) Excel source.
