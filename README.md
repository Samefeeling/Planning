# Resero Planning — Production Schedule Board

Planning for **two departments over one shared order book**:

- **Moulding (PMD)** — a drag-and-drop **Gantt** across the injection-moulding
  lines, with die/colour/insert **changeovers** and **material readiness**.
- **Assembly** — a four-area **planning board** for the sofa / chair / table
  lines, with **route stages**, a **release gate** and **people-hours load**.

It replaces the manual juggling in `PMD_Schedule_master_epicor.xlsm`. Source
data (orders, inventory, BOM, POs, routing) is read from the same Epicor →
SharePoint workbook, refreshed **hourly and on demand**.

## What it does

### Moulding board

- **One lane per production line** (1300T, 1600T, Batt1, HS, … ~12 machines).
- **Bars sized by `Calculated_LaborHrs`** — a job's run time is its width.
- **Drag orders between lines and the pool**; the timeline re-flows instantly.
- **Changeover detection** — when the next job needs a different **Die/Tool**,
  **Colour** or **Insert** than the one before it, a hatched setup marker and a
  badge appear, and the setup time is added before the bar.
- **Material status per job** — green = in stock, amber = short but an incoming
  **PO** covers it (with the date), red = short with no PO. Jobs that wait for
  material start later, which shows up as a gap on the board.
- **Inspector** with the full routing, shortage breakdown (component, qty short,
  covering PO + date) and plan warnings.
- **Whole-line delay** — when a line goes down, one control pushes every job on
  it back at once instead of dragging each order.
- **Copy → Epicor** — projects the board back into the `data return to Epicor`
  columns (start time, die/insert change Y/N, setup time) as paste-ready TSV.

### Assembly board

Sized for the real department: ~15 people, one white shift, supervisor
dispatches on the floor. Deliberately **not** a multi-level routing system.

- **Four area columns** — A · General Assembly, Shared Cutting/Sewing, B · Sofa,
  C · Chair Upholstery. Drag an order between areas to re-assign it.
- **Three fixed routes** — A: `General Assembly`; B: `Cutting/Sewing → Frame &
  Foam → Upholstery/Final`; C: `Cutting/Sewing → Chair Upholstery → Final
  Assembly`. An order sits in the area its current stage runs in; C's final
  assembly defaults to area A, as on the floor.
- **Release gate** — an order is startable only when the *engine* says stock
  exists **and** the material handler says the kit is picked. Anything else is
  amber (wait) or red (blocked, needs a supervisor override with a reason).
- **People-hours load per area** — crew size × productive hours vs the standard
  hours queued there, so the planner sees over/under commitment before the day
  starts. This is the assembly analogue of machine hours on the Gantt.
- **Shortages flow from moulding** — an assembly order whose moulded component
  is short shows red here, because both departments share one material engine.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173 — runs on bundled mock data
npm test           # engine + integration tests (24)
npm run build      # type-check + production build
```

The app starts on a **mock data source** (`src/data/mock/seed.json`, a real
slice extracted from the master workbook), so it is fully populated with no
network or credentials.

## Data sources

Configure via `.env.local` (see `.env.example`):

| `VITE_DATA_SOURCE` | Behaviour |
| ------------------ | --------- |
| `mock` (default)   | Bundled `seed.json`. Instant, offline. |
| `excel`            | Fetch the master workbook from SharePoint (Microsoft Graph) and parse it with SheetJS. Falls back to a manual file upload if Graph isn't configured. |

The Excel source (and the heavy `xlsx` dependency) is **lazy-loaded**, so the
default mock build never ships the parser.

### Sheet → domain mapping

| Workbook sheet            | Parser                          | Domain |
| ------------------------- | ------------------------------- | ------ |
| `planning`                | `job.parser`                    | `Job` (orders, machine, die, qty/hr) |
| `resource`                | `toolToPart` / `machine` / `tool` / `machineToTool` | `RoutingEntry` (part↔machine↔die↔colour↔insert) |
| `ohb`                     | `inventory.parser`              | `InventoryItem` (free-on-hand) |
| `part req`                | `bom.parser`                    | `BomLine` (exploded components) |
| `po`                      | `supply.parser`                 | `PoLine` (incoming raw material) |
| `total req`               | `demand.parser`                 | `DemandLine` |
| `data return to Epicor`   | `engine/epicorExport`           | output projection |

To feed both departments from one sheet, add these columns to `planning`
(the parser reads them when present and defaults every row to moulding
otherwise): `Department`, `ProductType`, `Priority`, `MaterialStatus`.

## Architecture

A strict one-way dependency flow keeps the core testable and the data source
swappable:

```
domain  →  lib  →  engine  →  store  →  features (UI)
                      ↑           ↑
              data (adapters)  persistence
```

- **`domain/`** — pure types, branded ids and tunable constants. Zero
  dependencies. A `WorkCenter` is either a moulding machine or an assembly
  area, so both boards are lanes over one id space; `assembly.ts` holds the
  areas, routes and stages.
- **`data/`** — the `DataSource` contract with two implementations (`mock`,
  `excel`). Each sheet has its own lenient parser with explicit column mapping.
- **`engine/`** — pure, unit-tested functions. Shared: `materialAvailability`,
  `materialExplosion`, `netRequirements`, `validate`, `indexes`. Moulding:
  `changeover`, `routing`, `duration`, `constraints`, `epicorExport`. Assembly:
  `assembly/{route,capacity,release,board}`. No React, no I/O.
- **`store/`** — Zustand. `dataStore` (loaded data + indexes), `planStore`
  (which job is on which line — the only mutable plan state), `selectors`
  (derives the scheduled timeline), `uiStore` (selection + zoom).
- **`persistence/`** — `PlanRepository` with a REST (`ApiPlanRepository`) and a
  localStorage fallback; the working layout autosaves.
- **`features/`** — `gantt` (board, lanes, cards, badges, dnd), `jobpool`,
  `inspector`, `refresh`.

### How the two departments share one system

The **order is the seam**. Four roles write different columns of the same
record, so nothing has to be reconciled:

| Role | Writes |
| --- | --- |
| Planner | what / how many / when / which line or area |
| Material handler | `MaterialStatus` — is the kit picked |
| Supervisor | crew per area, and (stage 3) who is on each order |
| Worker | (stage 2) progress and exceptions |

Both boards are the **same derivation pattern** — a pure function from
(orders + assignments) to a view model: `computeBoardView` for the moulding
Gantt, `computeAssemblyBoard` for the assembly columns. The MES event log slots
into the second one without changing the UI.

The material engine is shared verbatim, which is what makes the combination
worth more than two separate apps: a short moulded part turns the downstream
assembly order red automatically.

### How the schedule is derived

`store/selectors.computeBoardView` walks each lane in order and places jobs
back-to-back. For each job it:

1. resolves the **routing** for that (part, machine);
2. compares it to the previous job → **changeover** (`engine/changeover`), whose
   minutes are added as setup before the bar;
3. explodes the **BOM** and checks **material** (`engine/materialAvailability`):
   a shortfall is chased against POs (earliest-due-first, cumulative) to find the
   date it clears — the job can't start before then;
4. emits a `ScheduledJob` with start/end, changeover, material and warnings.

Because positions are *computed from order*, a drag only changes the order array
and the whole timeline re-lays-out.

## Roadmap

The assembly side is being built in stages; **0 and 1 are done**.

| Stage | Scope | Backend |
| --- | --- | --- |
| 0 ✅ | Generalise the domain to work centres + departments | no |
| 1 ✅ | Assembly planning board: areas, routes, release gate, load | no |
| 2 | MES Live Status: event log, worker start/qty/complete, QR from the paper order | **yes** |
| 3 | Attendance sync, area allocation, job teams, actual labour hours | yes |
| 4 | KPI page; actual hours feed back to correct standard hours | yes |

Stage 2 onward needs a real backend — 15 people on shared devices, write-heavy,
append-only events, live refresh. `persistence/PlanRepository` is already the
adapter seam: point `VITE_PERSIST_API_URL` at the service and add an
`ApiPlanRepository`-style client for events/attendance.

## Notes

- **Structure additions.** A few helper files extend the proposed layout where
  needed: `data/index.ts` & `persistence/index.ts` (config-driven factories),
  `engine/indexes.ts` (shared look-up maps), `engine/epicorExport.ts`,
  `store/uiStore.ts`, `data/excel/parsers/{cell,types}.ts` (parser helpers), and
  `data/excel/parsers/job.parser.ts` (the orders, from the `planning` sheet).
- **`xlsx`** is the npm SheetJS build; it carries known advisories and is only
  loaded for the (trusted, internal) Excel source. For production, consider the
  maintained SheetJS CDN build.
- **Shift calendar.** Bars currently assume a continuous 3-shift (24 h) day;
  `lib/time` already models 1/2/3-shift stretch for when per-job shift patterns
  are wired in.
