# Dispatch planning

The **Dispatch** page (switch at the top left of the app) plans outbound
shipments from the waybill export: which orders leave on which day, in what
vehicle or container, and how full it is. It runs beside the Assembly board
and does not change it.

## Input: the waybill export

One row per order line. Columns are matched by header name, so their order
does not matter; the Orders tab lists, under *Waybill columns read*, which
column (by spreadsheet letter) each field was read from.

| Column | Used for |
| --- | --- |
| `Order` | the shipment unit — lines are rolled up per order |
| `Description` | delivery zone (how it ships), which decides the route (`NSW-Metro-South`, `QLD- Metro`, `NZ-North`, …). If the export has two `Description` columns (a part description too), the one whose values look like zones is used |
| `City` (or `ShipToCity`) | ship-to city: proximity for NSW runs; destination port for `Export-ROW`. If there are two `City` columns, the last one is the ship-to city |
| `Need By` | **the last day the order may leave** (Australian `d/mm/yyyy`). Settings can switch this to `Ship By`; an order without the chosen date uses the other one |
| `ExpDeliveryDt` | the day the customer receives it — on every load card and the booking sheet |
| `Ship By` | shown for reference (or the due date, if Settings say so) |
| `PickListComment` | what the warehouse wrote once packed. A cube in it — `2C`, `1.5 C`, `3CBM`, `0.8 m3` — is the order's **packed volume** and beats every estimate. Shown on every drop |
| `ShipToCustName` | who the load goes to: on the card's title row, each drop and the booking sheet |
| `ShipToAddress1-3`, `ShipToState`, `ShipToZip` | ship-to address on the booking sheet, when the export has them |
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
| NSW zones in a run class | **NSW delivery** — a contractor's truck, booked for the run, delivers to the customer. Consolidated per `Description` + `Ship Via` (`NSW-Metro-South` / `ANMS`, `NSW-Metro-North` / `ANMN`, …), nearby customers first; Settings can let neighbouring zones of a run class share a truck | Rigid 8-pallet, Rigid 12-pallet, Semi 22-pallet, or a part load (pallet freight) |
| Other states (`QLD`, `VIC`, `SA`, `WA`, `TAS`, `NT`) | **Interstate linehaul** — to the state's hub city, where the local carrier does the last mile. Consolidated per `Description` + `Ship Via` (`QLD- Metro` / `AQMC`, `QLD- Reg-North` / `AQRN`, …): different carriers or regions never share a departure | FTL semi, or LTL part load |
| `NZ`, `Export`, `Hong Kong` | **Export containers** — consolidated per destination and `Ship Via` (`Export-ROW` per city, since its cities are different ports) | 20' GP, 40' GP, 40' HC, or LCL |
| `NSW-Customer Pickup` | **Customer pickup** — dock schedule only | — |

A zone that matches none of these is flagged *unrouted*; add it in Settings.

There is no own fleet: every load is booked with a contractor. Settings →
**Contractors** names the transport company for each `Ship Via` code; the
name shows on the load cards, the booking sheet and its CSV.

## How loads are built

1. **Window.** Each order must leave on the last dispatch day of its route on
   or before its `Need By`, and may leave up to *Pull forward* working days sooner
   (3 for NSW delivery and linehaul, 10 for containers by default). This is the
   warehouse limit: shipping early means finishing and staging early, so
   tighten it in peak season.
2. **Only due orders open a load.** An order with time left never causes a
   truck or container on its own.
3. **Orders stay whole.** An order is split only when it is bigger than the
   largest vehicle: full loads plus a remainder.
4. **Top-up.** Spare space is filled with open orders on the same route.
   For NSW delivery the nearest are taken first — same customer, then same
   city, then distance — and every drop on a run must be within the run
   class's radius of every other drop (30 km metro, 120 km regional) and the
   drop limit (8 metro, 4 regional). Inside the firm window (2 working days)
   only orders whose goods are ready are pulled forward.
5. **Right-size.** Each load takes the smallest vehicle or container that
   holds it. An NSW run of 2 m³ or less is booked as a part load (pallet freight)
   rather than a whole truck. A linehaul or
   container shipment at or below the part-load limit (25 m³ LTL, 15 m³ LCL)
   goes as a part load, unless open orders together reach a properly filled
   full load (80% FTL, 85% FCL).
6. **Volume advice.** A full load under its fill target, or only just over the
   next size down (within 10%), says so on the card.

Each day shows its loads' total volume against the marshalling area's daily
capacity (150 m³ by default), and the NSW truck runs against the contractor trucks set per day.

## Who it is for, and the page

Three readers: the **warehouse manager** (space, labour, what is not ready),
the **dispatch office** (what to book, what has gone) and **their manager**
(dollars out the door, service level, vehicles). The page is laid out in
that order of the working day.

### Headline figures

Five tiles on every tab, each opening the view behind it:

| Tile | What it counts |
| --- | --- |
| **Shipped today** | value of the loads marked dispatched today; under it, what is still to go today |
| **Shipped month to date** | value dispatched this month; under it, the month-end forecast (shipped + still planned this month) |
| **SIFOT month to date** | Shipped In Full, On Time — orders due this month that left complete by their due date, against the target (95% by default: green at or above, amber within 10 points, red below) |
| **Trucks today** | contractor trucks leaving today — NSW truck runs and linehaul FTL trailers; how many have gone; NSW part loads and LTL apart |
| **Containers this week** | FCL containers leaving Monday–Sunday, by size; LCL apart |

**Where the dollars come from.** The waybill lists open orders only — a
shipped order drops out of it — so shipped dollars and SIFOT come from the
*shipment log*: every load marked dispatched records what left, its value,
its due date and whether its goods were ready. `ReleaseVal` is the value still
open on each line (it falls as lines part-ship). By default the figures count
goods only; Settings can add the freight charged. A split order's value is
shared by m³. **Undo dispatch** removes the record.

**SIFOT rule.** Measured on orders *due* in the period (the strict form that
counts backlog): shipped complete on or before the due date with every goods
line ready is a hit; shipped late, shipped with goods not ready (a part
shipment), or still open after the due date are misses. Open orders are only
counted from the first load marked dispatched, since before that the app
cannot tell a shipped order from a missing one.

### Day board (opens on today)

- **Day head** — previous/next dispatch day, Today, a date picker, and the
  day's loads, m³ and value.
- **Where the day stands** — loads *To book → Booked → Dispatched*, each with
  m³ and value; **Goods not ready** on the loads still to go; **Marshalling**
  against the area's daily capacity.
- **Alerts** — loads from earlier days not marked dispatched, the orders not
  ready (check with production before booking), loads with warnings, more
  NSW truck runs than the contractor trucks set per day.
- **To book** and the route filter; **Load cards** or **Booking sheet**;
  **Edit loads**.
- Loads by route. **Mark booked** once the contractor has the load;
  **Mark dispatched** when it leaves. Mark dispatched is also on unbooked
  loads leaving today or earlier, for a load booked by phone and not marked.

### Look-ahead

Plan facts for the whole waybill (open orders, m³, loads, average fill,
orders pulled forward, orders sized by pick list or cubics, orders past their
due date), then the volume chart by day or week against the marshalling line,
the weekly table and the day strip. Clicking a day opens it on the Day board.

### Performance

The month: dollars shipped per working day with what is still planned on
top, a week-by-week table (shipped and planned dollars, trucks, containers,
part loads, orders due, SIFOT), and every SIFOT miss with its reason.

### Load cards

Each card's title row names the route and the ship-to customers on it
(`Sydney metro  Acme Fitout · Beta School +2`); loads are numbered per day
(`L1`, `L2`, …) the same way on cards and on the booking sheet. Each drop
shows ship-to name, city and customer ID, the pick-list comment, m³ with its
source (P packed, C cubics sheet, E entered, unmarked freight line),
`Need By`, `ExpDeliveryDt` and goods readiness. A drop leaving after its
`Need By` or after the customer's delivery date is shown in red.

## Booking sheet

The day's loads as one table the dock books carriers from: per load, what to
book, route, m³, fill, weight and status (Proposed, Edited, Booked); under
it, every order with ship-to name, address, zone, Ship Via, pick-list
comment, m³, kg, `Need By`, delivery date and readiness. **Download CSV**
writes one row per order with the load repeated on each row;
**Print** prints the sheet alone on landscape A4.

## What to book

Every load card leads with its recommendation — for example
`1 × Rigid 12-pallet truck — 45 m³ usable · 12 pallet spaces` or
`1 × 40' HC container — 68 m³ usable · Internal 12.03 × 2.35 × 2.69 m` —
and shows the route's whole size ladder beneath it: each truck or container
with how full this load would make it, the ones it does not fit marked
*too small*, and the chosen one outlined. Part loads read *book a part load (pallet freight)*,
*book LTL* or *book LCL*. The day header and the weekly table add up the
same picks into a booking list (`2 × Semi 22-pallet · 1 × 40' HC · 3 × LTL`).
Sizes, usable volumes and notes are edited on the Settings tab.

## Look and feel

The page follows the MES KPI page (`src/ui/kpi.ts` / `src/styles.css` in the
MES repository) so the two can merge: the same toolbar card with tab
buttons, one row of headline tiles with a traffic-light top border, dark
header tables, and the MES theme colours (read from the MES variables when
present, with the Day-shift values as fallback). The toolbar and tiles scroll
away with the page; only the filter row stays pinned. The route colours in
the chart are blue, teal, violet and orchid — never orange, amber or red,
which MES keeps for warnings.

## Planner decisions

- **Edit loads** (on the day) opens every card for hand changes, because a
  proposal can be wrong — two customers who must not share a truck, a site
  that only receives on Fridays:
  - **Move to** on a drop: onto another load (any day, same route type),
    onto a truck or container of its own, or *take off* and let the
    optimiser place it elsewhere. A split piece moves alone; the rest of the
    order stays planned.
  - **Size**: click a size on the ladder to book that truck or container.
  - **Dispatch day**: change the day.

  Every change freezes the loads it touches (*Edited*): re-planning keeps
  them as left and plans the rest around them. Unless a size was picked, an
  edited load is re-sized to what it now carries. Nothing is refused, but
  everything is checked: over capacity, more drops than the run takes, drops
  further apart than the run radius, an order on a load that does not go its
  way, a day the hub or port does not depart, and orders leaving after their
  `Need By` are all warned on the card. **Reset to plan** drops the edits.
- **Mark booked** records a proposal or an edited load as booked with the
  contractor: re-planning no longer touches it. **Mark dispatched** records
  it left; **Release** hands its orders back.
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
