export type Direction = 'up' | 'down';
export type CarPhase = 'idle' | 'moving' | 'opening' | 'open' | 'closing';

export interface RequestInput {
  /** Optional stable ID; generated when omitted. */
  id?: string;
  arrivalTick: number;
  originFloor: number;
  destinationFloor: number;
  people: number;
  /** Tick at which all not-yet-boarded people should be cancelled. */
  cancelTick?: number;
}

export interface SimConfig {
  floors: number;
  cars: number;
  capacity: number;
  travelTicks: number;
  doorTicks: number;
  requests: RequestInput[];
}

export interface RequestState {
  id: string;
  arrivalTick: number;
  originFloor: number;
  destinationFloor: number;
  people: number;
  cancelTick: number | null;
  carId: number | null;
  boarded: number;
  delivered: number;
  cancelled: number;
  pickupTick: number | null;
  deliveryTick: number | null;
  active: boolean;
}

export interface Stop {
  floor: number;
  /** Request IDs still expected to board at least one person. */
  pickupRequestIds: string[];
  /** Request IDs with people currently aboard who will leave here. */
  dropoffRequestIds: string[];
}

export interface CarLoad {
  requestId: string;
  people: number;
  destinationFloor: number;
}

export interface CarState {
  id: number;
  phase: CarPhase;
  floor: number;
  direction: Direction;
  phaseRemaining: number;
  route: Stop[];
  loads: CarLoad[];
  doorOpen: boolean;
  /** Number of floors, including partial floors, travelled in the current moving phase. */
  travelledFloors: number;
}

export type EventType =
  | 'request-arrival'
  | 'dispatch'
  | 'move-start'
  | 'move'
  | 'door-opening'
  | 'door-open'
  | 'board'
  | 'alight'
  | 'door-closing'
  | 'door-closed'
  | 'idle'
  | 'cancel'
  | 'cancel-rejected'
  | 'complete';

export interface SimEvent {
  tick: number;
  seq: number;
  type: EventType;
  carId?: number;
  requestId?: string;
  floor?: number;
  toFloor?: number;
  people?: number;
  remaining?: number;
  board?: number;
  waited?: number;
  destinationFloor?: number;
  selectedCarId?: number;
  candidates?: Array<{ carId: number; eta: number | null; reason: string }>;
  empty?: boolean;
  phase?: CarPhase;
  direction?: Direction;
  reason: string;
}

export interface SimSnapshot {
  tick: number;
  cars: CarState[];
  requests: RequestState[];
}

export interface Simulation {
  config: SimConfig;
  snapshots: SimSnapshot[];
  events: SimEvent[];
  finalTick: number;
  warnings: string[];
}
