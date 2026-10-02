/**
 * Outbound load planning: which orders leave on which day, in what.
 *
 * The plan is deadline-driven consolidation, the standard practice for a
 * factory shipping to order:
 *
 * 1. **Every order has a dispatch window.** It must leave by its `Ship By`
 *    (the last dispatch day of its route on or before that date) and may
 *    leave up to `earlyDays` working days sooner. The early limit is the
 *    warehouse limit — an order shipped early has to be finished and staged
 *    early — so it is the one number to tighten in peak season.
 * 2. **A day's loads are opened only by orders that are due that day.**
 *    Orders with time left never cause a truck or container on their own.
 * 3. **Due orders are packed whole.** An order is split only when it is
 *    bigger than the largest vehicle, into full loads plus a remainder.
 * 4. **Spare space is topped up** with orders from the same route whose
 *    window is open — nearest customers first for the NSW fleet, the
 *    earliest Ship By first otherwise. Inside the firm window only orders
 *    whose goods are already ready are pulled forward.
 * 5. **Each load is then right-sized** to the smallest vehicle or container
 *    that holds it. Interstate and export shipments too small for a full
 *    load go as a part load (LTL / LCL) unless open orders can fill one.
 *
 * Loads the planner has confirmed are frozen and passed through unchanged.
 * The function is pure: the same export, settings, decisions and day give
 * the same plan.
 */

import {
  routeFor,
  type DayKey,
  type DispatchDecisions,
  type DispatchMode,
  type DispatchSettings,
  type Equipment,
  type FirmLoad,
  type Route,
  type ShipmentOrder,
} from '@/domain/dispatch';
import { distanceKm, locate, normalizeCity, type LatLon } from '@/domain/dispatchLocations';
import {
  addCalendarDays,
  addWorkingDays,
  dispatchDays,
  workingDaysBetween,
} from './calendar';

const EPS = 1e-6;

export type OrderFlag =
  | 'overdue'
  | 'late'
  | 'not-ready'
  | 'credit-hold'
  | 'on-hold'
  | 'held'
  | 'no-volume'
  | 'no-ship-by'
  | 'unrouted'
  | 'split'
  | 'pulled-forward'
  | 'pinned'
  | 'firm'
  | 'no-location';

export const ORDER_FLAG_LABEL: Record<OrderFlag, string> = {
  overdue: 'Ship By already passed',
  late: 'No dispatch day on or before Ship By',
  'not-ready': 'Due inside the firm window but goods not ready',
  'credit-hold': 'Credit hold — release before dispatch',
  'on-hold': 'Order on hold',
  held: 'Held back by the planner',
  'no-volume': 'Volume unknown — enter m³',
  'no-ship-by': 'No Ship By date — pin a day',
  unrouted: 'Delivery zone not routed — add it in Settings',
  split: 'Split across loads (bigger than the largest vehicle)',
  'pulled-forward': 'Pulled forward to fill a load',
  pinned: 'Day pinned by the planner',
  firm: 'On a confirmed load',
  'no-location': 'City has no map location — grouped by zone only',
};

/** Flags that keep an order off every load until someone acts. */
export const BLOCKING_FLAGS: readonly OrderFlag[] = [
  'credit-hold',
  'on-hold',
  'held',
  'no-ship-by',
  'unrouted',
];

export interface PlannedDrop {
  orderId: string;
  /** Null when a confirmed load names an order no longer in the export. */
  order: ShipmentOrder | null;
  volumeM3: number;
  volumeKnown: boolean;
  /** Set when the order is split across loads. */
  piece: { index: number; of: number } | null;
  /** Working days ahead of the order's latest dispatch day. */
  daysEarly: number;
}

export interface PlannedLoad {
  id: string;
  group: string;
  mode: DispatchMode;
  label: string;
  day: DayKey;
  /** Vehicle or container name, or `Carrier`, `LTL`, `LCL`, `Pickup`. */
  equipment: string;
  capacityM3: number | null;
  drops: PlannedDrop[];
  volumeM3: number;
  /** Volume over capacity, 0–1+; null for part loads and pickups. */
  fill: number | null;
  /** Status when the planner has confirmed it; null for a proposal. */
  firm: FirmLoad['status'] | null;
  warnings: string[];
}

export interface OrderPlan {
  orderId: string;
  route: Route | null;
  /** First day the order may leave; null when it is not planned. */
  earliest: DayKey | null;
  /** Last dispatch day that still meets Ship By (or the first open one if none). */
  latest: DayKey | null;
  /** Day the order is planned to leave (the first piece, when split). */
  day: DayKey | null;
  loadIds: string[];
  volumeM3: number;
  volumeKnown: boolean;
  flags: OrderFlag[];
}

export interface DayTotal {
  day: DayKey;
  volumeM3: number;
  loads: number;
  fleetRuns: number;
  /** Over the marshalling area's capacity. */
  overStaging: boolean;
  /** More fleet runs than trucks available. */
  overFleet: boolean;
}

export interface DispatchPlan {
  today: DayKey;
  loads: PlannedLoad[];
  orders: Map<string, OrderPlan>;
  days: DayTotal[];
}

interface Candidate {
  order: ShipmentOrder;
  plan: OrderPlan;
  route: Route;
  volume: number;
  loc: LatLon | null;
  city: string;
}

interface Piece {
  c: Candidate;
  volume: number;
  piece: { index: number; of: number } | null;
  daysEarly: number;
}

interface Bin {
  pieces: Piece[];
  volume: number;
}

const byCapacity = (list: readonly Equipment[]): Equipment[] =>
  [...list].filter((e) => e.capacityM3 > 0).sort((a, b) => a.capacityM3 - b.capacityM3);

/** Smallest equipment that holds `volume`; the largest when none does. */
const rightSize = (list: Equipment[], volume: number): Equipment =>
  list.find((e) => e.capacityM3 + EPS >= volume) ?? list[list.length - 1];

/** Full loads of `max` plus a remainder; one piece when it fits. */
function splitPieces(c: Candidate, max: number): Piece[] {
  if (c.volume <= max + EPS) return [{ c, volume: c.volume, piece: null, daysEarly: 0 }];
  const full = Math.floor(c.volume / max);
  const rest = c.volume - full * max;
  const volumes = Array<number>(full).fill(max);
  if (rest > 0.01) volumes.push(rest);
  return volumes.map((volume, i) => ({
    c,
    volume,
    piece: { index: i + 1, of: volumes.length },
    daysEarly: 0,
  }));
}

/** First-fit decreasing into bins of `capacity`; pieces are never divided. */
function packFirstFit(pieces: Piece[], capacity: number): Bin[] {
  const bins: Bin[] = [];
  for (const p of [...pieces].sort((a, b) => b.volume - a.volume)) {
    const bin = bins.find((b) => b.volume + p.volume <= capacity + EPS);
    if (bin) {
      bin.pieces.push(p);
      bin.volume += p.volume;
    } else {
      bins.push({ pieces: [p], volume: p.volume });
    }
  }
  return bins;
}

// ---- NSW fleet geography --------------------------------------------------

const sameCity = (a: Candidate, b: Candidate) => a.city === b.city;

/** Can `c` ride with every drop already on the bin? */
function geoFits(bin: Bin, c: Candidate, radiusKm: number): boolean {
  return bin.pieces.every(({ c: other }) => {
    if (other.order.id === c.order.id || sameCity(other, c)) return true;
    if (other.loc && c.loc) return distanceKm(other.loc, c.loc) <= radiusKm;
    // Without a map location, the delivery zone is the only proximity known.
    return other.order.zone === c.order.zone;
  });
}

const dropsOn = (bin: Bin): number => new Set(bin.pieces.map((p) => p.c.order.id)).size;

/** Lower is better: same customer, then same city, then distance. */
function affinity(bin: Bin, c: Candidate): [number, number] {
  if (bin.pieces.some((p) => p.c.order.custId && p.c.order.custId === c.order.custId)) return [0, 0];
  if (bin.pieces.some((p) => sameCity(p.c, c))) return [1, 0];
  let far = 0;
  for (const { c: other } of bin.pieces) {
    if (other.loc && c.loc) far = Math.max(far, distanceKm(other.loc, c.loc));
  }
  return [2, far];
}

const compareAffinity = (a: [number, number], b: [number, number]): number =>
  a[0] - b[0] || a[1] - b[1];

function fitsFleet(bin: Bin, c: Candidate, volume: number, cap: number, route: Route): boolean {
  if (route.mode !== 'fleet') return false;
  if (bin.volume + volume > cap + EPS) return false;
  const newDrop = !bin.pieces.some((p) => p.c.order.id === c.order.id);
  if (newDrop && dropsOn(bin) + 1 > route.runClass.maxDrops) return false;
  return geoFits(bin, c, route.runClass.radiusKm);
}

function packFleet(pieces: Piece[], cap: number, route: Route): Bin[] {
  const bins: Bin[] = [];
  for (const p of [...pieces].sort((a, b) => b.volume - a.volume)) {
    let best: Bin | null = null;
    let bestScore: [number, number] | null = null;
    for (const bin of bins) {
      if (!fitsFleet(bin, p.c, p.volume, cap, route)) continue;
      const score = affinity(bin, p.c);
      if (!bestScore || compareAffinity(score, bestScore) < 0) {
        best = bin;
        bestScore = score;
      }
    }
    if (best) {
      best.pieces.push(p);
      best.volume += p.volume;
    } else {
      bins.push({ pieces: [p], volume: p.volume });
    }
  }
  return bins;
}

/**
 * What a planner should know about a full load's cube: space going empty, or
 * a load only just too big for the next size down.
 */
export function volumeAdvice(
  equipment: readonly Equipment[],
  unit: Equipment,
  volume: number,
  minFill: number,
): string[] {
  const advice: string[] = [];
  const fill = volume / unit.capacityM3;
  if (fill < minFill - EPS) {
    advice.push(
      `Low fill ${Math.round(fill * 100)}% — ${(unit.capacityM3 - volume).toFixed(1)} m³ spare`,
    );
  }
  const smaller = equipment.filter((e) => e.capacityM3 < unit.capacityM3).pop();
  if (smaller && volume - smaller.capacityM3 <= smaller.capacityM3 * 0.1) {
    advice.push(
      `Only ${(volume - smaller.capacityM3).toFixed(1)} m³ over a ${smaller.name} — ` +
        'holding that back would save a size',
    );
  }
  return advice;
}

// ---- the plan -------------------------------------------------------------

interface RouteRules {
  equipment: Equipment[];
  weekdays: readonly number[] | null;
  earlyDays: number;
  /** Part-load label and ceiling for pooled routes; null for the fleet. */
  partLoad: { label: 'LTL' | 'LCL'; maxM3: number; minFill: number } | null;
}

function rulesFor(route: Route, s: DispatchSettings): RouteRules {
  switch (route.mode) {
    case 'fleet':
      return { equipment: byCapacity(s.fleet.trucks), weekdays: null, earlyDays: s.fleet.earlyDays, partLoad: null };
    case 'linehaul':
      return {
        equipment: byCapacity([s.linehaul.trailer]),
        weekdays: route.hub.departureWeekdays,
        earlyDays: s.linehaul.earlyDays,
        partLoad: { label: 'LTL', maxM3: s.linehaul.ltlMaxM3, minFill: s.linehaul.minFtlFill },
      };
    case 'container':
      return {
        equipment: byCapacity(s.container.containers),
        weekdays: s.container.departureWeekdays,
        earlyDays: s.container.earlyDays,
        partLoad: { label: 'LCL', maxM3: s.container.lclMaxM3, minFill: s.container.minFclFill },
      };
    case 'pickup':
      return { equipment: [], weekdays: null, earlyDays: 0, partLoad: null };
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function planDispatch(
  orders: readonly ShipmentOrder[],
  settings: DispatchSettings,
  decisions: DispatchDecisions,
  today: DayKey,
): DispatchPlan {
  const holidays = new Set(settings.holidays);
  const firmEnd = addWorkingDays(today, settings.firmDays, holidays);
  const byId = new Map(orders.map((o) => [o.id, o]));
  const loads: PlannedLoad[] = [];
  const plans = new Map<string, OrderPlan>();

  const volumeOf = (o: ShipmentOrder): { volume: number; known: boolean } => {
    const override = decisions.volumeOverrides[o.id];
    if (override !== undefined && Number.isFinite(override) && override >= 0) {
      return { volume: override, known: true };
    }
    return o.volumeM3 === null ? { volume: 0, known: false } : { volume: o.volumeM3, known: true };
  };

  // Confirmed loads are frozen: emitted as they were confirmed, and their
  // orders kept out of the optimiser.
  const inFirm = new Set<string>();
  for (const firm of decisions.firmLoads) {
    const drops: PlannedDrop[] = firm.orderIds.map((id) => {
      const order = byId.get(id) ?? null;
      const v = order ? volumeOf(order) : { volume: firm.volumes[id] ?? 0, known: id in firm.volumes };
      return { orderId: id, order, volumeM3: v.volume, volumeKnown: v.known, piece: null, daysEarly: 0 };
    });
    const volume = sum(drops.map((d) => d.volumeM3));
    const warnings: string[] = [];
    const gone = drops.filter((d) => !d.order).map((d) => d.orderId);
    if (gone.length > 0 && firm.status === 'confirmed') {
      warnings.push(`Not in the latest waybill: ${gone.join(', ')}`);
    }
    if (firm.status === 'confirmed' && firm.day < today) {
      warnings.push('Confirmed for a past day — mark dispatched or release');
    }
    if (firm.capacityM3 && volume > firm.capacityM3 + EPS) {
      warnings.push(`Over capacity by ${(volume - firm.capacityM3).toFixed(1)} m³`);
    }
    loads.push({
      id: firm.id,
      group: firm.group,
      mode: firm.mode,
      label: firm.label,
      day: firm.day,
      equipment: firm.equipment,
      capacityM3: firm.capacityM3,
      drops,
      volumeM3: volume,
      fill: firm.capacityM3 ? volume / firm.capacityM3 : null,
      firm: firm.status,
      warnings,
    });
    for (const d of drops) {
      inFirm.add(d.orderId);
      if (d.order) {
        const route = routeFor(d.order.zone, d.order.city, settings);
        const existing = plans.get(d.orderId);
        if (existing) {
          existing.loadIds.push(firm.id);
          continue;
        }
        plans.set(d.orderId, {
          orderId: d.orderId,
          route,
          earliest: firm.day,
          latest: firm.day,
          day: firm.day,
          loadIds: [firm.id],
          volumeM3: d.volumeM3,
          volumeKnown: d.volumeKnown,
          flags: ['firm'],
        });
      }
    }
  }

  // Route and window every other order.
  const groups = new Map<string, Candidate[]>();
  for (const order of orders) {
    if (inFirm.has(order.id)) continue;
    const route = routeFor(order.zone, order.city, settings);
    const { volume, known } = volumeOf(order);
    const flags: OrderFlag[] = [];
    if (!known) flags.push('no-volume');
    const plan: OrderPlan = {
      orderId: order.id,
      route,
      earliest: null,
      latest: null,
      day: null,
      loadIds: [],
      volumeM3: volume,
      volumeKnown: known,
      flags,
    };
    plans.set(order.id, plan);

    if (!route) flags.push('unrouted');
    if (order.creditHold) flags.push('credit-hold');
    if (order.onHold) flags.push('on-hold');
    if (decisions.holds[order.id] !== undefined) flags.push('held');
    const pin = decisions.pins[order.id];
    if (!order.shipBy && !pin) flags.push('no-ship-by');
    if (flags.some((f) => BLOCKING_FLAGS.includes(f)) || !route) continue;

    const loc = route.mode === 'fleet' ? locate(order.city) : null;
    if (route.mode === 'fleet' && !loc) flags.push('no-location');
    const c: Candidate = { order, plan, route, volume, loc, city: normalizeCity(order.city) };
    const list = groups.get(route.group);
    if (list) list.push(c);
    else groups.set(route.group, [c]);
  }

  for (const [group, candidates] of groups) {
    const route = candidates[0].route;
    const rules = rulesFor(route, settings);

    // Every dispatch day the route has, far enough out to cover the latest
    // Ship By or pin in the group.
    const lastDate = candidates
      .map((c) => decisions.pins[c.order.id] ?? c.order.shipBy ?? today)
      .reduce((a, b) => (a > b ? a : b), today);
    const days = dispatchDays(today, addCalendarDays(lastDate, 21), rules.weekdays, holidays);
    if (days.length === 0) continue;

    for (const c of candidates) {
      const pin = decisions.pins[c.order.id];
      if (pin) {
        const day = pin < today ? days[0] : pin;
        c.plan.earliest = day;
        c.plan.latest = day;
        c.plan.flags.push('pinned');
        if (c.order.shipBy && c.order.shipBy < today) c.plan.flags.push('overdue');
        continue;
      }
      const shipBy = c.order.shipBy!;
      const onOrBefore = days.filter((d) => d <= shipBy);
      const latest = onOrBefore.length > 0 ? onOrBefore[onOrBefore.length - 1] : days[0];
      if (shipBy < today) c.plan.flags.push('overdue');
      else if (latest > shipBy) c.plan.flags.push('late');
      const openFrom = addWorkingDays(shipBy, -rules.earlyDays, holidays);
      const earliest = days.find((d) => d >= openFrom) ?? latest;
      c.plan.earliest = earliest > latest ? latest : earliest;
      c.plan.latest = latest;
    }

    const assigned = new Set<string>();
    const scheduleDays = [...new Set(candidates.map((c) => c.plan.latest!))].sort();
    let counter = 0;

    for (const day of scheduleDays) {
      const due = candidates.filter((c) => c.plan.latest === day && !assigned.has(c.order.id));
      if (due.length === 0) continue;
      for (const c of due) {
        assigned.add(c.order.id);
        if (day < firmEnd && (c.order.readiness === 'not-ready' || c.order.readiness === 'partial')) {
          c.plan.flags.push('not-ready');
        }
      }

      // Orders with time left that may ride today.
      const open = candidates.filter(
        (c) =>
          !assigned.has(c.order.id) &&
          !decisions.pins[c.order.id] &&
          c.plan.volumeKnown &&
          c.volume > 0 &&
          c.plan.earliest! <= day &&
          day < c.plan.latest! &&
          (day >= firmEnd || c.order.readiness === 'ready' || c.order.readiness === 'no-goods'),
      );
      const daysEarly = (c: Candidate) => workingDaysBetween(day, c.plan.latest!, holidays);

      const emit = (bin: Bin, equipment: string, capacity: number | null, advice: string[] = []) => {
        const id = `${group}|${day}|${++counter}`;
        const warnings: string[] = [...advice];
        if (bin.pieces.some((p) => !p.c.plan.volumeKnown)) {
          warnings.push('Contains orders with unknown volume');
        }
        if (capacity !== null && bin.volume > capacity + EPS) {
          warnings.push(`Over capacity by ${(bin.volume - capacity).toFixed(1)} m³`);
        }
        loads.push({
          id,
          group,
          mode: route.mode,
          label: route.label,
          day,
          equipment,
          capacityM3: capacity,
          drops: bin.pieces.map((p) => ({
            orderId: p.c.order.id,
            order: p.c.order,
            volumeM3: p.volume,
            volumeKnown: p.c.plan.volumeKnown,
            piece: p.piece,
            daysEarly: p.daysEarly,
          })),
          volumeM3: bin.volume,
          fill: capacity ? bin.volume / capacity : null,
          firm: null,
          warnings,
        });
        for (const p of bin.pieces) {
          const plan = p.c.plan;
          plan.loadIds.push(id);
          if (!plan.day || day < plan.day) plan.day = day;
          if (p.piece && !plan.flags.includes('split')) plan.flags.push('split');
          if (p.daysEarly > 0 && !plan.flags.includes('pulled-forward')) plan.flags.push('pulled-forward');
        }
      };

      /** Add open orders to a bin while they fit, best first. */
      const topUp = (bin: Bin, capacity: number, fits: (c: Candidate) => boolean, rank: (a: Candidate, b: Candidate) => number) => {
        for (;;) {
          const choices = open.filter(
            (c) => !assigned.has(c.order.id) && bin.volume + c.volume <= capacity + EPS && fits(c),
          );
          if (choices.length === 0) return;
          choices.sort(rank);
          const pick = choices[0];
          assigned.add(pick.order.id);
          bin.pieces.push({ c: pick, volume: pick.volume, piece: null, daysEarly: daysEarly(pick) });
          bin.volume += pick.volume;
        }
      };

      const byDeadline = (a: Candidate, b: Candidate) =>
        a.plan.latest!.localeCompare(b.plan.latest!) || b.volume - a.volume;

      if (route.mode === 'pickup') {
        emit({ pieces: due.map((c) => ({ c, volume: c.volume, piece: null, daysEarly: 0 })), volume: sum(due.map((c) => c.volume)) }, 'Pickup', null);
        continue;
      }

      const equipment = rules.equipment;
      if (equipment.length === 0) continue;
      const maxCap = equipment[equipment.length - 1].capacityM3;
      const pieces = due.flatMap((c) => splitPieces(c, maxCap));

      if (route.mode === 'fleet') {
        const bins = packFleet(pieces, maxCap, route);
        for (const bin of bins) {
          topUp(
            bin,
            maxCap,
            (c) => fitsFleet(bin, c, c.volume, maxCap, route),
            (a, b) =>
              compareAffinity(affinity(bin, a), affinity(bin, b)) || byDeadline(a, b),
          );
          const known = bin.pieces.every((p) => p.c.plan.volumeKnown);
          if (known && bin.volume <= settings.fleet.carrierMaxM3 + EPS) {
            // A truck run for a pallet or two costs more than the freight is
            // worth; hand it to a carrier.
            emit(bin, 'Carrier', null, ['Too small for a truck run — send by carrier']);
            continue;
          }
          const truck = rightSize(equipment, bin.volume);
          emit(bin, truck.name, truck.capacityM3);
        }
        continue;
      }

      // Linehaul and containers: one consolidation per departure.
      const part = rules.partLoad!;
      const bins = packFirstFit(pieces, maxCap);
      for (const bin of bins) {
        if (bin.volume <= part.maxM3 + EPS) {
          // Too small for a full load on its own. Pull open orders forward
          // only if together they make a properly filled one.
          const smallest = equipment[0];
          const fillable = open
            .filter((c) => !assigned.has(c.order.id))
            .sort(byDeadline);
          let reach = bin.volume;
          for (const c of fillable) {
            if (reach + c.volume <= smallest.capacityM3 + EPS) reach += c.volume;
          }
          if (reach >= smallest.capacityM3 * part.minFill - EPS) {
            topUp(bin, smallest.capacityM3, () => true, byDeadline);
            emit(bin, smallest.name, smallest.capacityM3);
          } else {
            emit(bin, part.label, null);
          }
          continue;
        }
        topUp(bin, maxCap, () => true, byDeadline);
        const unit = rightSize(equipment, bin.volume);
        emit(bin, unit.name, unit.capacityM3, volumeAdvice(equipment, unit, bin.volume, part.minFill));
      }
    }
  }

  // Within a day: own fleet first, then linehaul, containers and pickups —
  // the order the dock loads them in.
  const rank: Record<DispatchMode, number> = { fleet: 0, linehaul: 1, container: 2, pickup: 3 };
  loads.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      rank[a.mode] - rank[b.mode] ||
      a.group.localeCompare(b.group) ||
      a.id.localeCompare(b.id, undefined, { numeric: true }),
  );

  const totals = new Map<DayKey, DayTotal>();
  for (const load of loads) {
    if (load.firm === 'dispatched') continue;
    const t =
      totals.get(load.day) ??
      { day: load.day, volumeM3: 0, loads: 0, fleetRuns: 0, overStaging: false, overFleet: false };
    t.volumeM3 += load.volumeM3;
    t.loads += 1;
    if (load.mode === 'fleet') t.fleetRuns += 1;
    totals.set(load.day, t);
  }
  for (const t of totals.values()) {
    t.overStaging = settings.stagingCapacityM3 > 0 && t.volumeM3 > settings.stagingCapacityM3 + EPS;
    t.overFleet = settings.fleet.maxRunsPerDay > 0 && t.fleetRuns > settings.fleet.maxRunsPerDay;
  }

  return {
    today,
    loads,
    orders: plans,
    days: [...totals.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}
