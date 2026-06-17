# Resero Planning — PMD Schedule Board

A drag-and-drop **Gantt board** for scheduling the PMD injection-moulding lines.
It replaces the manual juggling in `PMD_Schedule_master_epicor.xlsm` with a
live board where a planner can drag production orders between machines and
instantly see **changeovers** and **material readiness**.

The source data (jobs, inventory, BOM, POs, routing) is read from the same
Epicor → SharePoint master workbook, refreshed **hourly and on demand**.

## What it does

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
- **Copy → Epicor** — projects the board back into the `data return to Epicor`
  columns (start time, die/insert change Y/N, setup time) as paste-ready TSV.

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

## Architecture

A strict one-way dependency flow keeps the core testable and the data source
swappable:

```
domain  →  lib  →  engine  →  store  →  features (UI)
                      ↑           ↑
              data (adapters)  persistence
```

- **`domain/`** — pure types, branded ids (`MachineId`, `PartId`, …) and tunable
  constants (`DIE_CHANGE_MINUTES`, shift patterns). Zero dependencies.
- **`data/`** — the `DataSource` contract with two implementations (`mock`,
  `excel`). Each sheet has its own lenient parser with explicit column mapping.
- **`engine/`** — pure, unit-tested functions: `changeover`, `materialAvailability`,
  `netRequirements`, `materialExplosion`, `routing`, `duration`, `constraints`,
  `validate`, `epicorExport`. No React, no I/O.
- **`store/`** — Zustand. `dataStore` (loaded data + indexes), `planStore`
  (which job is on which line — the only mutable plan state), `selectors`
  (derives the scheduled timeline), `uiStore` (selection + zoom).
- **`persistence/`** — `PlanRepository` with a REST (`ApiPlanRepository`) and a
  localStorage fallback; the working layout autosaves.
- **`features/`** — `gantt` (board, lanes, cards, badges, dnd), `jobpool`,
  `inspector`, `refresh`.

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
