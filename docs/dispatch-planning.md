# Dispatch planning

The **Dispatch** page (switch at the top left of the app) plans outbound
shipments from the waybill export: which orders leave on which day, in what
vehicle or container, and how full it is. It runs beside the Assembly board
and does not change it.

## Input: the waybill export

One row per order line. Columns are matched by header name:

| Column | Used for |
| --- | --- |
| `Order` | the shipment unit — lines are rolled up per order |
| `Description` | delivery zone, which decides the route (`NSW-Metro-South`, `QLD- Metro`, `NZ-North`, …) |
| `City` | proximity for NSW runs; destination port for `Export-ROW` |
| `Ship By` | the last day the order may leave (Australian `d/mm/yyyy`) |
| `Need By`, `ExpDeliveryDt` | shown for reference |
| `Part` + `UOM` = `CBM` + `LeftToShip` | **volume**: the freight line (`FRTNSW`, `FRTQLD`, `FRTWAU`, `FRTVIC`, `FRTSA`, `FRTTAS`, `FRTACT`, `FRTSEB`, `FRTEXP`) carries the order's cube in m³. `FRT911` is a charge, not a volume, and is ignored |
| `FulfillmentMethod`, `Status`, `AllocatedQty` | **readiness**: goods lines (not `Other`) are ready when `Status` is `Ready` or they are fully allocated |
| `CreditHold`, `On Hold` | keep the order off every load |
| `InPicking`, `Cust. ID`, `Ship Via`, `ReleaseVal` | shown |

## Input: the cubics sheet (optional, more precise)

**Load cubics** takes "Drews Cubics and Freight Calc" saved as CSV. One row
per part and stack size:

| Column | Used for |
| --- | --- |
| first (unnamed) | category, e.g. `SS` |
| `CODE` | matched to the waybill's `Part` (case and spaces ignored) |
| `Name` | shown |
| `Quantity` | units in the stack (the first `Quantity` column; the second is the sheet's own calculator input) |
| `Volume per STACK` | m³ of that stack; worked out from `Length` × `Depth` × `Height` (mm) when blank |
| `Weight Per Unit` | kg, summed into each load |

Section rows (`SOFT SEATING`) are read as headings; rows without a `CODE`
cannot be matched to the waybill and are counted in the page header.

Each goods line's quantity is packed into the part's stack sizes so the total
volume is smallest: five Astral ottomans are a stack of four plus a single
(1.27 + 0.41 m³), not two pairs and a single. An order is **sized by cubics**
only when the sheet lists every goods line; otherwise its freight line is
used, and failing that the part the sheet covers. Settings can make the
freight line the first choice instead, and a volume entered on the order
always wins. In the tables a `C` beside a volume means it came from the
sheet, `E` that it was entered. The Exceptions tab lists every part code the
sheet is missing, by how many open orders it holds up.

An order with no volume from either source has **unknown volume**: it is planned as 0 m³
and listed under Exceptions until someone enters its cube. An order carrying
two freight lines with the same cube (seen once: `FRTTAS` + `FRTSEB`) uses the
largest rather than the sum.

Load the file with **Load waybill**. Set `VITE_WAYBILL_CSV_URL` or
`VITE_WAYBILL_CSV_PATH` (SharePoint drive path) to add a **Refresh** button.

## Routing

| Zone | Route | Equipment |
| --- | --- | --- |
| NSW zones in a fleet run class | **NSW fleet** — own trucks deliver to the customer | Rigid 8-pallet, Rigid 12-pallet, Semi 22-pallet |
| Other states (`QLD`, `VIC`, `SA`, `WA`, `TAS`, `NT`) | **Interstate linehaul** — consolidated to the state's hub city; the local carrier there does the last mile | FTL semi, or LTL part load |
| `NZ`, `Export`, `Hong Kong` | **Export containers** — consolidated per destination (`Export-ROW` per city, since its cities are different ports) | 20' GP, 40' GP, 40' HC, or LCL |
| `NSW-Customer Pickup` | **Customer pickup** — dock schedule only | — |

A zone that matches none of these is flagged *unrouted*; add it in Settings.

## How loads are built

1. **Window.** Each order must leave on the last dispatch day of its route on
   or before `Ship By`, and may leave up to *Pull forward* working days sooner
   (3 for the fleet and linehaul, 10 for containers by default). This is the
   warehouse limit: shipping early means finishing and staging early, so
   tighten it in peak season.
2. **Only due orders open a load.** An order with time left never causes a
   truck or container on its own.
3. **Orders stay whole.** An order is split only when it is bigger than the
   largest vehicle: full loads plus a remainder.
4. **Top-up.** Spare space is filled with open orders on the same route.
   For the NSW fleet the nearest are taken first — same customer, then same
   city, then distance — and every drop on a run must be within the run
   class's radius of every other drop (30 km metro, 120 km regional) and the
   drop limit (8 metro, 4 regional). Inside the firm window (2 working days)
   only orders whose goods are ready are pulled forward.
5. **Right-size.** Each load takes the smallest vehicle or container that
   holds it. A fleet run of 2 m³ or less is handed to a carrier. A linehaul or
   container shipment at or below the part-load limit (25 m³ LTL, 15 m³ LCL)
   goes as a part load, unless open orders together reach a properly filled
   full load (80% FTL, 85% FCL).
6. **Volume advice.** A full load under its fill target, or only just over the
   next size down (within 10%), says so on the card.

Each day shows its loads' total volume against the marshalling area's daily
capacity (150 m³ by default), and the fleet runs against trucks available.

## Reading the plan

The Load plan tab reads top-down:

1. **Volume to ship** — a stacked column per day (or per ISO week), split by
   route, against the marshalling capacity line. Hover for the breakdown;
   click a column to open that day. The weekly view adds a table: orders,
   m³ per route with load counts, vehicles, part loads, fill, orders pulled
   forward and orders leaving after Ship By.
2. **Day strip** — every dispatch day in the window with its volume, loads
   and a marshalling status dot.
3. **The day** — totals, the marshalling meter, and the loads grouped by
   route.

## Planner decisions

- **Confirm load** freezes a proposal: re-planning no longer touches it.
  **Mark dispatched** records it left; **Release** hands its orders back.
- On an order: **Pin to day**, **Hold back** (with a reason), and **Volume m³**
  to enter or correct its cube.

Decisions, settings and the loaded waybill are kept in this browser
(`resero.dispatch.v1` in localStorage). They are not yet shared between
machines.

## Assumptions to confirm

Every default — vehicle and container usable volumes, pull-forward windows,
the firm window, staging capacity, hub departure days (Brisbane and
Melbourne Tue/Thu, Adelaide and Hobart Wed, Perth and Darwin Mon), container
stuffing day (Thu), part-load limits and fill targets — is a starting value
and editable on the Settings tab. Public holidays are entered there too.

NSW proximity uses approximate suburb centres in
`src/domain/dispatchLocations.ts`; a city missing from it only shares a run
with the same city or its own zone and is listed under Exceptions.
