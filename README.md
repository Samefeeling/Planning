# Resero Planning — Production Schedule Board

Planning for **two departments over one shared order book**:

- **Moulding (PMD)** — a drag-and-drop **Gantt** across the injection-moulding
  lines, with die/colour/insert **changeovers** and **material readiness**.
- **Assembly** — a day-scale **Gantt** for the sofa / chair / table lines, with
  crew allocation, **Due / Expect / Ship** dates and end-of-shift booking.

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

Sized for the real department: ~15 people, one white shift, the supervisor
dispatches on the floor. Nobody reports by the hour — the shift's output is
booked once at the end of the day, so there is no event stream and no live
polling.

- **Four row groups** — `PMD` (the moulding plan, shown for context only, not
  scheduled here), then `UPL`, `ASSY` and `TABLE`.
- **Three kinds of work order** — Cutting/Sewing and Upholstery run on UPL;
  Final Assembly runs on ASSY and TABLE.
- **One row per order**: Order · Due Date · Expect Date · Ship Date · Team, then
  the day grid with a draggable bar.
- **Crew drives duration** — up to **4 people** per order; the bar length is
  remaining standard hours ÷ (crew × productive hours), so adding someone
  visibly shortens it and pulls the Expect Date in. Only people who are on
  shift *and* qualified for that line can be picked.
- **Book the shift** — enter the quantity finished today and the Expect Date
  moves on its own: short of the daily target it slips out, ahead of it pulls in.
- **Colour by date** (Ship is the booked departure, Due the later customer date):

  | | Condition | Meaning |
  | --- | --- | --- |
  | 🟢 green | `Expect ≤ Ship` | makes the booked shipment |
  | 🟠 orange | `Ship < Expect < Due` | misses the shipment, customer date still reachable |
  | 🔴 red | `Expect ≥ Due` | the customer date will be missed |

- **Predecessors** — an order that waits on another (moulding feeding
  upholstery, upholstery feeding final assembly) starts only when that one
  finishes.
- **Material still gates release** — the shared engine flags a short component,
  and material that only lands on a future PO pushes the bar out.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173 — runs on bundled mock data
npm test           # engine + integration tests (56)
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
  `assembly/{duration,dates,release,board}`. No React, no I/O.
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
| Supervisor | which line, who is on each order, the shift's output |

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
| 2 ✅ | Assembly Gantt: crew, Due/Expect/Ship, booking, colour bands, predecessors | no |
| 3 | Persist to the real backend; attendance feed replaces the mock roster | **yes** |
| 4 | KPI page; actual hours feed back to correct standard hours | yes |

Because output is booked once per shift rather than reported hourly, stage 3
needs only a modest service — read orders + roster, write the day's plan and
booked quantities. `persistence/PlanRepository` is already the adapter seam:
point `VITE_PERSIST_API_URL` at the service (`PersistedPlan.assembly` carries
crew, pinned starts and booked output).

## Notes

- **Structure additions.** A few helper files extend the proposed layout where
  needed: `data/index.ts` & `persistence/index.ts` (config-driven factories),
  `engine/indexes.ts` (shared look-up maps), `engine/epicorExport.ts`,
  `store/uiStore.ts`, `data/excel/parsers/{cell,types}.ts` (parser helpers), and
  `data/excel/parsers/job.parser.ts` (the orders, from the `planning` sheet).
- **`xlsx`** is the npm SheetJS build; it carries known advisories and is only
  loaded for the (trusted, internal) Excel source. For production, consider the
  maintained SheetJS CDN build.
- **Shift calendar.** Moulding bars assume a continuous 3-shift (24 h) day.
  Assembly counts **calendar** days on one 8 h shift (0.75 h break); flip
  `WORKING_DAYS_ONLY` in `domain/assembly.ts` to skip weekends.
- **Mock dates** are anchored to a fixed epoch and shifted forward on load, so
  the demo always reads as the current week.
