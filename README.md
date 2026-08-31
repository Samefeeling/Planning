# Resero Planning — Assembly Schedule Board

A day-scale **Gantt** for the sofa / chair / table assembly lines: crew
allocation, **Due / Expect / Ship** dates, and end-of-shift booking.

Sized for the real department — ~15 people, one white shift, the supervisor
dispatches on the floor. Nobody reports by the hour: the shift's output is
booked once at the end of the day, so there is no event stream and no live
polling.

Source data comes from Epicor via SharePoint, refreshed **hourly and on
demand**: orders from the `Planning1.csv` export, people from the
`ASSY_Operator` list, and the material picture from the master workbook.

## What it does

- **Four row groups** — `PMD` (the moulding plan, mirrored for context: greyed
  out, not draggable, never scheduled here), then `UPL`, `ASSY` and `TABLE`.
- **Three kinds of work order** — Cutting/Sewing and Upholstery run on UPL;
  Final Assembly runs on ASSY and TABLE.
- **One row per order**: Order · Due Date · Expect Date · Ship Date · Team,
  beside the day grid with a draggable bar.
- **Crew drives duration** — up to **4 people** per order; bar length is
  remaining standard hours ÷ (crew × productive hours), so adding someone
  visibly shortens it and pulls the Expect Date in. The picker offers only
  people who are on shift *and* qualified for that line.
- **Book the shift** — enter the quantity finished today; the Expect Date moves
  on its own: short of the daily target it slips out, ahead of it pulls in.
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
npm test           # engine, adapter and integration tests (77)
npm run build      # type-check + production build
```

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
| `JobHead_StartDate` | start (PMD row) + material `Req. By` | |
| `JobHead_ReqDueDate` | **Due Date** | |
| `Calculated_LaborHrs` | bar length | falls back to `RemainingQty × JobOper_ProdStandard` |
| `JobOper_ProdStandard` | run rate | inverted to qty/hr |

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

`Skills` is normalised onto the four lines, so both short codes and what people
actually type work: *Cutting/Sewing* and *Upholstery* → `UPL`, *Final Assembly*
→ `ASSY`, *Table* → `TABLE`. A multi-choice column (array) and a delimited text
column both parse. Anyone with no recognised skill is reported in the warning
banner, because they can never be allocated.

Attendance is **not** in the list — the supervisor confirms who is in each
morning — so everyone counts as on shift unless an `OnShift` column is added.

Workers are keyed by SharePoint **list item id**, not name, so renaming someone
does not orphan the allocations already saved against them.

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
  `assembly/{duration,dates,release,board}`. No React, no I/O.
- **`store/`** — Zustand. `dataStore` (loaded data + indexes), `planStore`
  (placement, crew, pinned starts, booked output — the only mutable plan
  state), `assemblySelectors` (derives the schedule), `uiStore` (selection).
- **`persistence/`** — `PlanRepository` with a REST (`ApiPlanRepository`) and a
  localStorage fallback; the working plan autosaves.
- **`features/`** — `assembly` (board, rows, bars, crew chips, inspector, dnd),
  `refresh` and `source` (the manual CSV loader).

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
| 2 | Persist the plan to the real backend | **yes** |
| 3 | Merge with the PMD dashboard into one page | yes |
| 4 | KPI view; actual hours feed back to correct standard hours | yes |

Because output is booked once per shift rather than reported hourly, stage 2
needs only a modest service — write the day's plan and booked quantities back.
`persistence/PlanRepository` is already the adapter seam: point
`VITE_PERSIST_API_URL` at the service (`PersistedPlan.assembly` carries crew,
pinned starts and booked output).

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
