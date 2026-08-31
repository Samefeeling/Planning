# Resero Planning — Assembly Schedule Board

A day-scale **Gantt** for the sofa / chair / table assembly lines: crew
allocation, **Due / Expect / Ship** dates, and end-of-shift booking.

Sized for the real department — ~15 people, one white shift, the supervisor
dispatches on the floor. Nobody reports by the hour: the shift's output is
booked once at the end of the day, so there is no event stream and no live
polling.

Source data (orders, inventory, BOM, POs) comes from the Epicor → SharePoint
master workbook, refreshed **hourly and on demand**.

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

```bash
npm install
npm run dev        # http://localhost:5173 — runs on bundled mock data
npm test           # engine + integration tests (39)
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
| `excel`            | Fetch the master workbook from SharePoint (Microsoft Graph) and parse it with SheetJS. Falls back to a manual file upload if Graph isn't configured. |

The Excel source (and the heavy `xlsx` dependency) is **lazy-loaded**, so the
default mock build never ships the parser.

### Sheet → domain mapping

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

The shift roster is **not** in the workbook — it comes from attendance. The
mock source supplies one; `SharePointExcelSource.fetchWorkers()` returns empty
until that feed is wired up.

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
- **`data/`** — the `DataSource` contract with two implementations (`mock`,
  `excel`). Each sheet has its own lenient parser with explicit column mapping.
- **`engine/`** — pure, unit-tested functions. Shared: `materialAvailability`,
  `materialExplosion`, `netRequirements`, `indexes`. Assembly:
  `assembly/{duration,dates,release,board}`. No React, no I/O.
- **`store/`** — Zustand. `dataStore` (loaded data + indexes), `planStore`
  (placement, crew, pinned starts, booked output — the only mutable plan
  state), `assemblySelectors` (derives the schedule), `uiStore` (selection).
- **`persistence/`** — `PlanRepository` with a REST (`ApiPlanRepository`) and a
  localStorage fallback; the working plan autosaves.
- **`features/`** — `assembly` (board, rows, bars, crew chips, inspector, dnd)
  and `refresh`.

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
| 2 | Persist to the real backend; attendance feed replaces the mock roster | **yes** |
| 3 | KPI view; actual hours feed back to correct standard hours | yes |

Because output is booked once per shift rather than reported hourly, stage 2
needs only a modest service — read orders + roster, write the day's plan and
booked quantities. `persistence/PlanRepository` is already the adapter seam:
point `VITE_PERSIST_API_URL` at the service (`PersistedPlan.assembly` carries
crew, pinned starts and booked output).

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
