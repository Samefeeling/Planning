/**
 * Dispatch (outbound logistics) domain: what a waybill order is, how each
 * delivery zone is routed, and the equipment each route ships in.
 *
 * Three ways an order leaves the factory, decided by the waybill's
 * `Description` (the delivery zone):
 *
 * - **NSW fleet** — the factory's own trucks deliver to the customer. Orders
 *   for nearby customers share a run; an order is only split when it is
 *   bigger than the biggest truck.
 * - **Interstate linehaul** — everything for a state is consolidated and
 *   trucked to that state's hub city; the local carrier there does the last
 *   mile. A departure is a full truck (FTL) or, when small, a part load (LTL).
 * - **Export containers** — consolidated per destination into FCL containers,
 *   or LCL when too small to fill one. Volume decides the container count, so
 *   fill is shown on every container.
 *
 * Customer pickup orders are only scheduled for the dock, never loaded.
 */

import type { OrderCube } from './cubics';

/** ISO local day, `YYYY-MM-DD`. */
export type DayKey = string;

export type DispatchMode = 'fleet' | 'linehaul' | 'container' | 'pickup';

export const DISPATCH_MODE_LABEL: Record<DispatchMode, string> = {
  fleet: 'NSW fleet',
  linehaul: 'Interstate linehaul',
  container: 'Export containers',
  pickup: 'Customer pickup',
};

/** One row of the waybill export, with source field values preserved. */
export interface WaybillLine {
  order: string;
  line: string;
  rel: string;
  custId: string;
  shipVia: string;
  /** Delivery zone, the export's `Description` column (e.g. `NSW-Metro-South`). */
  zone: string;
  city: string;
  part: string;
  requestedQty: number;
  shippedQty: number;
  leftToShip: number;
  allocatedQty: number;
  uom: string;
  expDelivery: DayKey | null;
  shipBy: DayKey | null;
  needBy: DayKey | null;
  releaseValue: number;
  /** `Stock`, `Job`, `BTO` or `Other` (freight and services). */
  fulfillment: string;
  /** `Ready`, `PARTIAL`, `Non-Inventory` or blank. */
  status: string;
  inPicking: boolean;
  onHold: boolean;
  creditHold: boolean;
}

/**
 * Whether the goods on an order are in the warehouse.
 *
 * `no-goods` is an order carrying nothing but freight or service lines.
 */
export type Readiness = 'ready' | 'partial' | 'not-ready' | 'no-goods';

/** One customer order, the unit dispatch plans with. */
export interface ShipmentOrder {
  id: string;
  custId: string;
  shipVia: string;
  zone: string;
  city: string;
  shipBy: DayKey | null;
  needBy: DayKey | null;
  expDelivery: DayKey | null;
  /**
   * Cubic metres still to ship, from the order's freight line (a `CBM` line
   * such as `FRTNSW`). Null when the order carries no freight volume.
   */
  volumeM3: number | null;
  /** Sum of `ReleaseVal` over the order's lines. */
  value: number;
  lineCount: number;
  goodsLines: number;
  readyLines: number;
  readiness: Readiness;
  inPicking: boolean;
  onHold: boolean;
  creditHold: boolean;
  /** Data problems found while reading the order, for the exceptions list. */
  notes: string[];
  /** Cube worked out from the cubics sheet, when one is loaded. */
  cube?: OrderCube | null;
}

/** Where an order's volume came from, best first. */
export type VolumeSource = 'entered' | 'cubics' | 'freight' | 'cubics-partial' | 'none';

export const VOLUME_SOURCE_LABEL: Record<VolumeSource, string> = {
  entered: 'Entered by the planner',
  cubics: 'Cubics sheet (stacked)',
  freight: 'Freight CBM line',
  'cubics-partial': 'Cubics sheet — some parts missing',
  none: 'Unknown',
};

/**
 * Freight lines whose quantity is the order's shipping volume in m³.
 *
 * `FRT911` is deliberately absent: it carries a quantity of 1 with a charge,
 * a surcharge rather than a volume.
 */
export const FREIGHT_VOLUME_PARTS = [
  'FRTNSW',
  'FRTACT',
  'FRTQLD',
  'FRTVIC',
  'FRTSA',
  'FRTWAU',
  'FRTTAS',
  'FRTNT',
  'FRTSEB',
  'FRTEXP',
] as const;

/** A truck, linehaul trailer or shipping container, by usable volume. */
export interface Equipment {
  id: string;
  name: string;
  /** Usable (loadable) volume, not the internal cube. */
  capacityM3: number;
}

/**
 * A family of NSW fleet runs. Only orders in the same class share a truck,
 * and only when they are within `radiusKm` of every other drop on it.
 */
export interface FleetRunClass {
  id: string;
  label: string;
  zones: string[];
  radiusKm: number;
  maxDrops: number;
}

/** An interstate hub: every order for the state is consolidated to it. */
export interface LinehaulHub {
  id: string;
  label: string;
  /** Zone prefixes routed to this hub, e.g. `QLD` covers `QLD- Metro`. */
  zonePrefixes: string[];
  /** ISO weekdays the linehaul leaves: 1 = Monday … 5 = Friday. */
  departureWeekdays: number[];
}

export interface DispatchSettings {
  fleet: {
    trucks: Equipment[];
    runClasses: FleetRunClass[];
    /**
     * How many working days before Ship By an order may go to fill a truck.
     * This is the warehouse limit: an order pulled forward has to be finished
     * and staged that much earlier.
     */
    earlyDays: number;
    /** Trucks available per day; 0 means no limit is checked. */
    maxRunsPerDay: number;
    /** A run carrying no more than this goes by carrier instead; 0 disables. */
    carrierMaxM3: number;
  };
  linehaul: {
    hubs: LinehaulHub[];
    /** The full-truck trailer used for an FTL departure. */
    trailer: Equipment;
    /** Below this volume a departure is booked as a part load (LTL). */
    ltlMaxM3: number;
    /** An FTL is only built from pulled-forward orders if it reaches this fill. */
    minFtlFill: number;
    earlyDays: number;
  };
  container: {
    containers: Equipment[];
    /** Zone prefixes shipped by container. */
    zonePrefixes: string[];
    /** Zones whose cities are different ports, consolidated per city. */
    splitByCityZones: string[];
    /** ISO weekdays a container can be stuffed and leave for the port. */
    departureWeekdays: number[];
    /** Below this volume the shipment goes LCL. */
    lclMaxM3: number;
    /** A container is only built from pulled-forward orders if it reaches this fill. */
    minFclFill: number;
    earlyDays: number;
  };
  pickupZones: string[];
  /**
   * Which volume wins when both are there: the cubics sheet (stack-aware, per
   * part) or the freight CBM line on the order. The cubics sheet is only used
   * when it covers every goods line; a partial match falls back to freight.
   */
  preferVolume: 'cubics' | 'freight';
  /**
   * Firm (frozen) window in working days from today. Inside it, an order is
   * only pulled forward when its goods are already ready.
   */
  firmDays: number;
  /** Volume the dispatch marshalling area can hold for one day's loads. */
  stagingCapacityM3: number;
  /** Non-working days as `YYYY-MM-DD`, on top of weekends. */
  holidays: DayKey[];
}

/**
 * Starting values. Every capacity, window and departure day here is an
 * assumption to be confirmed by logistics and is editable on the Settings tab.
 */
export const DEFAULT_DISPATCH_SETTINGS: DispatchSettings = {
  fleet: {
    trucks: [
      { id: 'rigid-8', name: 'Rigid 8-pallet', capacityM3: 30 },
      { id: 'rigid-12', name: 'Rigid 12-pallet', capacityM3: 45 },
      { id: 'semi-22', name: 'Semi 22-pallet', capacityM3: 75 },
    ],
    runClasses: [
      {
        id: 'metro',
        label: 'Sydney metro',
        zones: [
          'NSW-Metro',
          'NSW-Metro-North',
          'NSW-Metro-South',
          'NSW-WINC',
          'NSW Conroys',
        ],
        radiusKm: 30,
        maxDrops: 8,
      },
      {
        id: 'reg-north',
        label: 'NSW regional north',
        zones: ['NSW-Reg-North'],
        radiusKm: 120,
        maxDrops: 4,
      },
      {
        id: 'reg-south',
        label: 'NSW regional south',
        zones: ['NSW-Reg-South'],
        radiusKm: 120,
        maxDrops: 4,
      },
    ],
    earlyDays: 3,
    maxRunsPerDay: 0,
    carrierMaxM3: 2,
  },
  linehaul: {
    hubs: [
      { id: 'QLD', label: 'Brisbane hub', zonePrefixes: ['QLD'], departureWeekdays: [2, 4] },
      { id: 'VIC', label: 'Melbourne hub', zonePrefixes: ['VIC'], departureWeekdays: [2, 4] },
      { id: 'SA', label: 'Adelaide hub', zonePrefixes: ['SA'], departureWeekdays: [3] },
      { id: 'WA', label: 'Perth hub', zonePrefixes: ['WA'], departureWeekdays: [1] },
      { id: 'TAS', label: 'Hobart hub', zonePrefixes: ['TAS'], departureWeekdays: [3] },
      { id: 'NT', label: 'Darwin hub', zonePrefixes: ['NT'], departureWeekdays: [1] },
    ],
    trailer: { id: 'ftl-semi', name: 'FTL semi', capacityM3: 75 },
    ltlMaxM3: 25,
    minFtlFill: 0.8,
    earlyDays: 3,
  },
  container: {
    containers: [
      { id: '20GP', name: "20' GP", capacityM3: 28 },
      { id: '40GP', name: "40' GP", capacityM3: 58 },
      { id: '40HC', name: "40' HC", capacityM3: 68 },
    ],
    zonePrefixes: ['NZ', 'Export', 'Hong Kong'],
    splitByCityZones: ['Export-ROW'],
    departureWeekdays: [4],
    lclMaxM3: 15,
    minFclFill: 0.85,
    earlyDays: 10,
  },
  pickupZones: ['NSW-Customer Pickup'],
  preferVolume: 'cubics',
  firmDays: 2,
  stagingCapacityM3: 150,
  holidays: [],
};

/** Where an order is routed. `group` is what may be consolidated together. */
export type Route =
  | { mode: 'fleet'; group: string; label: string; runClass: FleetRunClass }
  | { mode: 'linehaul'; group: string; label: string; hub: LinehaulHub }
  | { mode: 'container'; group: string; label: string }
  | { mode: 'pickup'; group: string; label: string };

const startsWithToken = (zone: string, prefix: string): boolean => {
  const z = zone.trim().toUpperCase();
  const p = prefix.trim().toUpperCase();
  if (!p || !z.startsWith(p)) return false;
  // `SA` must not claim a zone that merely begins with the letters, such as
  // `SAMOA`; the prefix has to end at a separator or the end of the zone.
  const next = z.charAt(p.length);
  return next === '' || /[\s\-_/]/.test(next);
};

/** Route a zone (and city, for zones consolidated per port), or null if unmapped. */
export function routeFor(
  zone: string,
  city: string,
  settings: DispatchSettings,
): Route | null {
  const key = zone.trim();
  if (settings.pickupZones.some((z) => z.trim() === key)) {
    return { mode: 'pickup', group: 'pickup', label: 'Customer pickup' };
  }
  const runClass = settings.fleet.runClasses.find((c) =>
    c.zones.some((z) => z.trim() === key),
  );
  if (runClass) {
    return { mode: 'fleet', group: `fleet:${runClass.id}`, label: runClass.label, runClass };
  }
  const hub = settings.linehaul.hubs.find((h) =>
    h.zonePrefixes.some((p) => startsWithToken(key, p)),
  );
  if (hub) {
    return { mode: 'linehaul', group: `linehaul:${hub.id}`, label: hub.label, hub };
  }
  if (settings.container.zonePrefixes.some((p) => startsWithToken(key, p))) {
    const perCity = settings.container.splitByCityZones.some((z) => z.trim() === key);
    const destination = perCity ? `${key} · ${city.trim()}` : key;
    return { mode: 'container', group: `container:${destination}`, label: destination };
  }
  return null;
}

/** A load the planner confirmed: frozen, no longer re-optimised. */
export interface FirmLoad {
  id: string;
  group: string;
  mode: DispatchMode;
  label: string;
  day: DayKey;
  /** Equipment name, `Carrier`, `LTL`, `LCL` or `Pickup`. */
  equipment: string;
  capacityM3: number | null;
  orderIds: string[];
  /** Volume per order when confirmed, for orders that later leave the export. */
  volumes: Record<string, number>;
  status: 'confirmed' | 'dispatched';
  confirmedAt: string;
  dispatchedAt?: string;
}

/** Planner decisions layered over the export. */
export interface DispatchDecisions {
  /** Order → the day it must go, overriding the optimiser. */
  pins: Record<string, DayKey>;
  /** Orders held back from planning (customer asked to wait, etc.). */
  holds: Record<string, string>;
  /** Order → volume in m³, overriding or filling in the freight line. */
  volumeOverrides: Record<string, number>;
  firmLoads: FirmLoad[];
}

export const EMPTY_DECISIONS: DispatchDecisions = {
  pins: {},
  holds: {},
  volumeOverrides: {},
  firmLoads: [],
};
