import type {
  CarLoad,
  CarState,
  Direction,
  RequestInput,
  RequestState,
  SimConfig,
  SimEvent,
  SimSnapshot,
  Simulation,
  Stop
} from './types';

export const MIN_FLOORS = 3;
export const MAX_FLOORS = 16;
export const MIN_CARS = 2;
export const MAX_CARS = 4;
export const CAR_CAPACITY = 6;
export const MAX_REQUESTS = 100;
export const MAX_PEOPLE_PER_REQUEST = 100;
export const MAX_TICKS = 1_000_000;

let eventSeq = 0;

export function validateConfig(input: SimConfig): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(input.floors) || input.floors < MIN_FLOORS || input.floors > MAX_FLOORS) {
    errors.push(`楼层数必须是 ${MIN_FLOORS}～${MAX_FLOORS} 的整数。`);
  }
  if (!Number.isInteger(input.cars) || input.cars < MIN_CARS || input.cars > MAX_CARS) {
    errors.push(`电梯数量必须是 ${MIN_CARS}～${MAX_CARS} 的整数。`);
  }
  if (input.capacity !== CAR_CAPACITY) {
    errors.push(`本题规定每台电梯容量固定为 ${CAR_CAPACITY} 人。`);
  }
  if (!Number.isInteger(input.travelTicks) || input.travelTicks <= 0) {
    errors.push('行驶一层耗时必须是正整数 tick。');
  }
  if (!Number.isInteger(input.doorTicks) || input.doorTicks <= 0) {
    errors.push('开门和关门耗时必须是正整数 tick。');
  }
  if (input.requests.length > MAX_REQUESTS) {
    errors.push(`最多只能输入 ${MAX_REQUESTS} 个请求。`);
  }

  const ids = new Set<string>();
  input.requests.forEach((raw, index) => {
    const id = raw.id ?? `R${String(index + 1).padStart(3, '0')}`;
    const label = raw.id ?? `第 ${index + 1} 个请求`;
    if (ids.has(id)) errors.push(`请求 ID 重复：${id}`);
    ids.add(id);

    const validFloor = (floor: number) => Number.isInteger(floor) && floor >= 1 && floor <= input.floors;
    if (!Number.isInteger(raw.arrivalTick) || raw.arrivalTick < 0) {
      errors.push(`${label} 的到达 tick 必须是非负整数。`);
    }
    if (!validFloor(raw.originFloor)) errors.push(`${label} 的出发层必须在 1～${input.floors} 之间。`);
    if (!validFloor(raw.destinationFloor)) errors.push(`${label} 的目的层必须在 1～${input.floors} 之间。`);
    if (raw.originFloor === raw.destinationFloor) errors.push(`${label} 的出发层和目的层不能相同。`);
    if (!Number.isInteger(raw.people) || raw.people <= 0 || raw.people > MAX_PEOPLE_PER_REQUEST) {
      errors.push(`${label} 的人数必须是 1～${MAX_PEOPLE_PER_REQUEST} 的整数。`);
    }
    if (raw.cancelTick !== undefined) {
      if (!Number.isInteger(raw.cancelTick) || raw.cancelTick < 0) {
        errors.push(`${label} 的取消 tick 必须是非负整数。`);
      } else if (raw.cancelTick < raw.arrivalTick) {
        errors.push(`${label} 的取消 tick 不能早于到达 tick。`);
      }
    }
  });
  return errors;
}

interface InternalState {
  tick: number;
  cars: CarState[];
  requests: RequestState[];
  events: SimEvent[];
  warnings: string[];
  complete: boolean;
}

function makeEvent(partial: Omit<SimEvent, 'seq'>): SimEvent {
  return { seq: eventSeq++, ...partial };
}

function cloneStop(stop: Stop): Stop {
  return {
    floor: stop.floor,
    pickupRequestIds: [...stop.pickupRequestIds],
    dropoffRequestIds: [...stop.dropoffRequestIds]
  };
}

function cloneCar(car: CarState): CarState {
  return {
    ...car,
    route: car.route.map(cloneStop),
    loads: car.loads.map((load) => ({ ...load }))
  };
}

function cloneSnapshot(state: InternalState): SimSnapshot {
  return {
    tick: state.tick,
    cars: state.cars.map(cloneCar),
    requests: state.requests.map((request) => ({ ...request }))
  };
}

function directionTo(from: number, to: number): Direction {
  return to > from ? 'up' : 'down';
}

function onboardCount(car: CarState): number {
  return car.loads.reduce((sum, load) => sum + load.people, 0);
}

function activeRequest(request: RequestState): boolean {
  // Boarded people remain active until delivered; delivered and cancelled are
  // the two terminal states.
  return request.delivered + request.cancelled < request.people;
}

function waitingPeople(request: RequestState): number {
  return request.people - request.boarded - request.cancelled;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

interface SortableRouteState {
  floor: number;
  direction: Direction;
  phase: CarState['phase'];
  route: Stop[];
}

function chooseDirection(floor: number, preferred: Direction, stops: Stop[]): Direction {
  const ahead = stops.some((stop) => (preferred === 'up' ? stop.floor > floor : stop.floor < floor));
  if (ahead) return preferred;
  const behind = stops.some((stop) => (preferred === 'up' ? stop.floor < floor : stop.floor > floor));
  if (behind) return preferred === 'up' ? 'down' : 'up';
  return preferred;
}

function sortRouteState(state: SortableRouteState): void {
  const stops = state.route;
  if (stops.length === 0) return;

  const atCurrentFloor =
    state.phase === 'idle' || state.phase === 'opening' || state.phase === 'open' || state.phase === 'closing';
  const current = stops.find((stop) => stop.floor === state.floor);

  if (atCurrentFloor && current) {
    const others = stops.filter((stop) => stop.floor !== state.floor);
    const direction = chooseDirection(state.floor, state.direction, others);
    state.direction = direction;
    const up = others.filter((stop) => stop.floor > state.floor).sort((a, b) => a.floor - b.floor);
    const down = others.filter((stop) => stop.floor < state.floor).sort((a, b) => b.floor - a.floor);
    state.route = direction === 'up' ? [current, ...up, ...down] : [current, ...down, ...up];
    return;
  }

  const direction = chooseDirection(state.floor, state.direction, stops);
  state.direction = direction;
  const ahead = stops
    .filter((stop) => (direction === 'up' ? stop.floor > state.floor : stop.floor < state.floor))
    .sort((a, b) => (direction === 'up' ? a.floor - b.floor : b.floor - a.floor));
  const sameFloor = stops.filter((stop) => stop.floor === state.floor);
  const behind = stops
    .filter((stop) => (direction === 'up' ? stop.floor < state.floor : stop.floor > state.floor))
    .sort((a, b) => (direction === 'up' ? b.floor - a.floor : a.floor - b.floor));
  state.route = [...ahead, ...sameFloor, ...behind];
}

function sortCarRoute(car: CarState): void {
  sortRouteState(car);
}

/** Recreate stops from loads and assigned, not-yet-boarded people. */
function reconcileRoute(car: CarState, requests: RequestState[]): void {
  const byFloor = new Map<number, Stop>();
  const ensure = (floor: number): Stop => {
    let stop = byFloor.get(floor);
    if (!stop) {
      stop = { floor, pickupRequestIds: [], dropoffRequestIds: [] };
      byFloor.set(floor, stop);
    }
    return stop;
  };

  for (const load of car.loads) {
    ensure(load.destinationFloor).dropoffRequestIds.push(load.requestId);
  }
  for (const request of requests) {
    // A full car cannot accept anyone here. Its pick-up remains assigned and
    // reappears after passengers alight and capacity becomes available.
    if (
      request.carId === car.id &&
      activeRequest(request) &&
      request.boarded + request.cancelled < request.people &&
      onboardCount(car) < CAR_CAPACITY
    ) {
      ensure(request.originFloor).pickupRequestIds.push(request.id);
    }
  }

  car.route = [...byFloor.values()].map((stop) => ({
    floor: stop.floor,
    pickupRequestIds: uniqueSorted(stop.pickupRequestIds),
    dropoffRequestIds: uniqueSorted(stop.dropoffRequestIds)
  }));
  sortCarRoute(car);
}

function addPickup(car: CarState, request: RequestState): void {
  let stop = car.route.find((candidate) => candidate.floor === request.originFloor);
  if (!stop) {
    stop = { floor: request.originFloor, pickupRequestIds: [], dropoffRequestIds: [] };
    car.route.push(stop);
  }
  if (!stop.pickupRequestIds.includes(request.id)) stop.pickupRequestIds.push(request.id);
  stop.pickupRequestIds = uniqueSorted(stop.pickupRequestIds);
  sortCarRoute(car);
}

interface CandidateSimulation {
  phase: CarState['phase'];
  floor: number;
  direction: Direction;
  phaseRemaining: number;
  route: Stop[];
  loads: CarLoad[];
  waiting: Map<string, { origin: number; destination: number; people: number }>;
}

export interface PickupCommitment {
  origin: number;
  destination: number;
  people: number;
}

function createCandidateSimulation(
  car: CarState,
  request: RequestState,
  requests: RequestState[],
  hypothetical: Map<number, Map<string, PickupCommitment>>
): CandidateSimulation {
  const loads = car.loads.map((load) => ({ ...load }));
  const waiting = new Map<string, { origin: number; destination: number; people: number }>();

  const addWaiting = (requestId: string, origin: number, destination: number, people: number) => {
    if (people <= 0) return;
    const previous = waiting.get(requestId);
    waiting.set(requestId, {
      origin,
      destination,
      people: (previous?.people ?? 0) + people
    });
  };

  for (const existing of requests) {
    if (
      existing.carId === car.id &&
      activeRequest(existing) &&
      existing.boarded + existing.cancelled < existing.people
    ) {
      addWaiting(existing.id, existing.originFloor, existing.destinationFloor, waitingPeople(existing));
    }
  }
  for (const [requestId, commitment] of hypothetical.get(car.id) ?? []) {
    addWaiting(requestId, commitment.origin, commitment.destination, commitment.people);
  }
  addWaiting(request.id, request.originFloor, request.destinationFloor, request.people);

  const candidate: CandidateSimulation = {
    phase: car.phase,
    floor: car.floor,
    direction: car.direction,
    phaseRemaining: car.phaseRemaining,
    route: [],
    loads,
    waiting
  };
  rebuildCandidateRoute(candidate, request.id);
  return candidate;
}

function rebuildCandidateRoute(candidate: CandidateSimulation, targetId: string): void {
  const byFloor = new Map<number, Stop>();
  const ensure = (floor: number): Stop => {
    let stop = byFloor.get(floor);
    if (!stop) {
      stop = { floor, pickupRequestIds: [], dropoffRequestIds: [] };
      byFloor.set(floor, stop);
    }
    return stop;
  };

  for (const load of candidate.loads) {
    ensure(load.destinationFloor).dropoffRequestIds.push(load.requestId);
  }
  const onboard = candidate.loads.reduce((sum, load) => sum + load.people, 0);
  for (const [requestId, item] of candidate.waiting) {
    // Omit non-target waiting groups when earlier groups at the same origin
    // already fill the car. They stay waiting in reality and must not make
    // this projected stop physically impossible.
    if (requestId !== targetId) {
      const earlierAtOrigin = [...candidate.waiting.entries()]
        .filter(([id, waiting]) => id < requestId && waiting.origin === item.origin)
        .reduce((sum, [, waiting]) => sum + waiting.people, 0);
      if (onboard + earlierAtOrigin >= CAR_CAPACITY) continue;
    }
    ensure(item.origin).pickupRequestIds.push(requestId);
  }

  candidate.route = [...byFloor.values()].map((stop) => ({
    floor: stop.floor,
    pickupRequestIds: uniqueSorted(stop.pickupRequestIds),
    dropoffRequestIds: uniqueSorted(stop.dropoffRequestIds)
  }));
  sortRouteState(candidate);
}

export interface DispatchCandidate {
  carId: number;
  eta: number | null;
  reason: string;
}

function candidateOnboard(candidate: CandidateSimulation): number {
  return candidate.loads.reduce((sum, load) => sum + load.people, 0);
}

/**
 * Capacity-aware ETA. The projected car obeys existing drop-offs and pick-up
 * commitments, boards in request ID order, and only reports success when at
 * least one person from the new request can physically enter.
 */
function etaFor(
  car: CarState,
  request: RequestState,
  now: number,
  config: SimConfig,
  requests: RequestState[],
  hypothetical: Map<number, Map<string, PickupCommitment>>
): { eta: number | null; reason: string } {
  const candidate = createCandidateSimulation(car, request, requests, hypothetical);
  let time = now;
  let guard = 0;

  const serveAtOpenDoor = (): boolean => {
    // Alighting passengers free capacity before boarding.
    candidate.loads = candidate.loads.filter((load) => {
      if (load.destinationFloor !== candidate.floor) return true;
      return false;
    });

    let targetBoarded = false;
    const stop = candidate.route.find((item) => item.floor === candidate.floor);
    for (const requestId of [...(stop?.pickupRequestIds ?? [])].sort()) {
      const peopleWaiting = candidate.waiting.get(requestId)?.people ?? 0;
      if (peopleWaiting <= 0) continue;
      const available = CAR_CAPACITY - candidateOnboard(candidate);
      // ID-earlier waiting groups consume capacity first at a shared stop.
      const precedingPeople = [...(stop?.pickupRequestIds ?? [])]
        .sort()
        .filter((id) => id < requestId)
        .reduce((sum, id) => sum + (candidate.waiting.get(id)?.origin === candidate.floor ? candidate.waiting.get(id)?.people ?? 0 : 0), 0);
      const boarding = Math.max(0, Math.min(peopleWaiting, Math.max(0, available - precedingPeople)));
      if (boarding <= 0) continue;

      const commitment = candidate.waiting.get(requestId);
      if (!commitment) continue;
      candidate.waiting.set(requestId, { ...commitment, people: peopleWaiting - boarding });
      const existing = candidate.loads.find((load) => load.requestId === requestId);
      if (existing) existing.people += boarding;
      else candidate.loads.push({ requestId, people: boarding, destinationFloor: commitment.destination });
      if (requestId === request.id) targetBoarded = true;
    }

    rebuildCandidateRoute(candidate, request.id);
    if (!targetBoarded && request.originFloor === candidate.floor) {
      // The target cannot enter at this over-full door. The projected car must
      // first finish committed travel and come back, rather than looping here.
      candidate.route = candidate.route.filter((stop) => stop.floor !== candidate.floor);
      sortRouteState(candidate);
    }
    return targetBoarded;
  };

  while (guard++ < 500) {
    if (candidate.phase === 'open') {
      if (serveAtOpenDoor()) {
        return { eta: time, reason: '门已开且有容量，本 tick 可上客' };
      }
      time += candidate.phaseRemaining + config.doorTicks;
      candidate.phase = 'idle';
      candidate.phaseRemaining = 0;
      continue;
    }

    if (candidate.phase === 'opening') {
      time += candidate.phaseRemaining;
      candidate.phase = 'open';
      candidate.phaseRemaining = 1;
      if (serveAtOpenDoor()) {
        return { eta: time, reason: `等待开门完成后，于 tick=${time} 可上客` };
      }
      time += 1 + config.doorTicks;
      candidate.phase = 'idle';
      candidate.phaseRemaining = 0;
      continue;
    }

    if (candidate.phase === 'closing') {
      time += candidate.phaseRemaining;
      candidate.phase = 'idle';
      candidate.phaseRemaining = 0;
      rebuildCandidateRoute(candidate, request.id);
      continue;
    }

    if (candidate.phase === 'moving') {
      time += candidate.phaseRemaining;
      candidate.floor += candidate.direction === 'up' ? 1 : -1;
      candidate.phase = 'idle';
      candidate.phaseRemaining = 0;
      rebuildCandidateRoute(candidate, request.id);
      continue;
    }

    const next = candidate.route[0];
    if (!next) return { eta: null, reason: '候选路线没有可接客停靠点' };

    if (next.floor === candidate.floor) {
      time += config.doorTicks;
      candidate.phase = 'open';
      candidate.phaseRemaining = 1;
      if (serveAtOpenDoor()) {
        return { eta: time, reason: `开门 ${config.doorTicks} tick 后可上客` };
      }
      time += 1 + config.doorTicks;
      candidate.phase = 'idle';
      candidate.phaseRemaining = 0;
      continue;
    }

    candidate.direction = directionTo(candidate.floor, next.floor);
    candidate.phase = 'moving';
    candidate.phaseRemaining = config.travelTicks;
  }

  return { eta: null, reason: 'ETA 推算超过保护上限' };
}

function initialize(config: SimConfig): InternalState {
  const cars: CarState[] = Array.from({ length: config.cars }, (_unused, index) => ({
    id: index,
    phase: 'idle',
    floor: 1,
    direction: 'up',
    phaseRemaining: 0,
    route: [],
    loads: [],
    doorOpen: false,
    travelledFloors: 0
  }));

  const requests: RequestState[] = config.requests.map((raw, index) => ({
    id: raw.id ?? `R${String(index + 1).padStart(3, '0')}`,
    arrivalTick: raw.arrivalTick,
    originFloor: raw.originFloor,
    destinationFloor: raw.destinationFloor,
    people: raw.people,
    cancelTick: raw.cancelTick ?? null,
    carId: null,
    boarded: 0,
    delivered: 0,
    cancelled: 0,
    pickupTick: null,
    deliveryTick: null,
    active: true
  }));

  return { tick: 0, cars, requests, events: [], warnings: [], complete: false };
}

function allComplete(state: InternalState): boolean {
  return state.requests.every((request) => !activeRequest(request));
}

export function runSimulation(input: SimConfig): Simulation {
  const errors = validateConfig(input);
  if (errors.length > 0) {
    throw new Error(`配置无效：\n${errors.join('\n')}`);
  }

  eventSeq = 0;
  const config: SimConfig = { ...input, capacity: CAR_CAPACITY };
  const state = initialize(config);
  const snapshots: SimSnapshot[] = [];
  snapshots.push(cloneSnapshot(state));

  while (!state.complete && state.tick <= MAX_TICKS) {
    processCancellations(state);
    processArrivals(state);
    dispatchWaitingRequests(state, config);
    for (const car of state.cars) {
      processCar(car, state, config);
    }

    state.requests.forEach((request) => {
      request.active = activeRequest(request);
    });
    snapshots.push(cloneSnapshot(state));

    if (allComplete(state)) {
      state.complete = true;
      state.events.push(
        makeEvent({
          tick: state.tick,
          type: 'complete',
          reason: `所有 ${state.requests.length} 个请求已送达或取消，仿真结束。`
        })
      );
      snapshots[snapshots.length - 1] = cloneSnapshot(state);
    }
    state.tick++;
  }

  if (state.tick > MAX_TICKS) {
    throw new Error(`仿真在 ${MAX_TICKS} tick 后仍未结束，请检查输入。`);
  }

  const simulation: Simulation = {
    config,
    snapshots,
    events: state.events,
    finalTick: state.tick,
    warnings: state.warnings
  };
  return deepFreeze(simulation);
}

function requestMap(state: InternalState): Map<string, RequestState> {
  return new Map(state.requests.map((request) => [request.id, request]));
}

function processCancellations(state: InternalState): void {
  for (const request of state.requests) {
    if (request.cancelTick !== state.tick || !activeRequest(request)) continue;
    const waiting = waitingPeople(request);
    if (waiting <= 0) {
      state.events.push(
        makeEvent({
          tick: state.tick,
          type: 'cancel-rejected',
          requestId: request.id,
          people: 0,
          reason: '乘客已经全部上车；已上车请求不可取消。'
        })
      );
      continue;
    }

    if (request.carId !== null) {
      const car = state.cars[request.carId];
      if (car) {
        request.cancelled += waiting;
        reconcileRoute(car, state.requests);
      }
    } else {
      request.cancelled += waiting;
    }

    state.events.push(
      makeEvent({
        tick: state.tick,
        type: 'cancel',
        carId: request.carId ?? undefined,
        requestId: request.id,
        floor: request.originFloor,
        people: waiting,
        reason: `取消 ${waiting} 名尚未上车乘客；已上车 ${request.boarded} 人不受影响。`
      })
    );
  }
}

function processArrivals(state: InternalState): void {
  const arrivals = state.requests
    .filter((request) => request.arrivalTick === state.tick && activeRequest(request))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const request of arrivals) {
    state.events.push(
      makeEvent({
        tick: state.tick,
        type: 'request-arrival',
        requestId: request.id,
        floor: request.originFloor,
        destinationFloor: request.destinationFloor,
        people: waitingPeople(request),
        reason: `${waitingPeople(request)} 人在 ${request.originFloor} 层等待前往 ${request.destinationFloor} 层。`
      })
    );
  }
}

function dispatchWaitingRequests(state: InternalState, config: SimConfig): void {
  const pending = state.requests
    .filter(
      (request) =>
        request.carId === null &&
        activeRequest(request) &&
        request.arrivalTick <= state.tick &&
        waitingPeople(request) > 0
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  // Earlier IDs in the same tick are dispatched first. Keep their choices as
  // hypothetical commitments so later ETAs see the capacity those groups will
  // consume; real car routes are updated after each decision.
  const hypothetical = new Map<number, Map<string, PickupCommitment>>();
  const decisions: Array<{ request: RequestState; carId: number; eta: number; candidates: DispatchCandidate[] }> = [];

  for (const request of pending) {
    const candidates: DispatchCandidate[] = state.cars.map((car) => {
      const result = etaFor(car, request, state.tick, config, state.requests, hypothetical);
      return { carId: car.id, eta: result.eta, reason: result.reason };
    });
    const valid = candidates.filter((candidate): candidate is DispatchCandidate & { eta: number } =>
      Number.isFinite(candidate.eta ?? Number.NaN)
    );
    valid.sort((a, b) => a.eta - b.eta || a.carId - b.carId);
    const selected = valid[0];
    if (!selected) {
      state.warnings.push(`请求 ${request.id} 在 tick ${state.tick} 无法推算 ETA。`);
      continue;
    }

    let byCar = hypothetical.get(selected.carId);
    if (!byCar) {
      byCar = new Map<string, PickupCommitment>();
      hypothetical.set(selected.carId, byCar);
    }
    byCar.set(request.id, {
      origin: request.originFloor,
      destination: request.destinationFloor,
      people: waitingPeople(request)
    });
    decisions.push({ request, carId: selected.carId, eta: selected.eta, candidates });
  }

  for (const decision of decisions) {
    const car = state.cars[decision.carId];
    if (!car) throw new Error(`派车结果引用了不存在的电梯 ${decision.carId}`);
    decision.request.carId = car.id;
    addPickup(car, decision.request);
    state.events.push(
      makeEvent({
        tick: state.tick,
        type: 'dispatch',
        carId: car.id,
        requestId: decision.request.id,
        floor: decision.request.originFloor,
        destinationFloor: decision.request.destinationFloor,
        people: waitingPeople(decision.request),
        selectedCarId: car.id,
        candidates: decision.candidates,
        reason: `最早可接客 tick=${decision.eta}；并列时选择最小电梯 ID=${car.id}。`
      })
    );
  }
}

function eventForCar(car: CarState, type: SimEvent['type'], reason: string, extra: Partial<SimEvent> = {}): SimEvent {
  return makeEvent({
    tick: 0,
    ...extra,
    type,
    carId: car.id,
    reason
  });
}

function emit(state: InternalState, event: SimEvent): void {
  state.events.push({ ...event, tick: state.tick });
}

function startNextService(car: CarState, state: InternalState, config: SimConfig): void {
  reconcileRoute(car, state.requests);
  if (car.route.length === 0) {
    car.phase = 'idle';
    car.phaseRemaining = 0;
    car.doorOpen = false;
    return;
  }
  const next = car.route[0];
  if (!next) {
    car.phase = 'idle';
    car.phaseRemaining = 0;
    car.doorOpen = false;
    return;
  }
  if (next.floor === car.floor) {
    car.phase = 'opening';
    car.phaseRemaining = config.doorTicks;
    car.doorOpen = false;
    emit(
      state,
      eventForCar(car, 'door-opening', `电梯 ${car.id} 在 ${car.floor} 层开始开门。`)
    );
    return;
  }
  car.direction = directionTo(car.floor, next.floor);
  car.phase = 'moving';
  car.phaseRemaining = config.travelTicks;
  car.travelledFloors = 0;
  car.doorOpen = false;
  emit(
    state,
    eventForCar(
      car,
      'move-start',
      `电梯 ${car.id} 从 ${car.floor} 层向${car.direction === 'up' ? '上' : '下'}${
        onboardCount(car) === 0 ? '空驶' : '载客行驶'
      }，下一承诺停靠 ${next.floor} 层。`,
      {
        toFloor: next.floor,
        direction: car.direction,
        empty: onboardCount(car) === 0
      }
    )
  );
}

function serveOpenFloor(car: CarState, state: InternalState): void {
  reconcileRoute(car, state.requests);
  const requests = requestMap(state);

  // Assigned people may be temporarily absent from the route when the car is
  // full. Add their current-floor stop so boarding can be retried at the door.
  for (const request of state.requests) {
    if (
      request.carId === car.id &&
      request.originFloor === car.floor &&
      activeRequest(request) &&
      waitingPeople(request) > 0
    ) {
      let stop = car.route.find((item) => item.floor === car.floor);
      if (!stop) {
        stop = { floor: car.floor, pickupRequestIds: [], dropoffRequestIds: [] };
        car.route.push(stop);
      }
      if (!stop.pickupRequestIds.includes(request.id)) stop.pickupRequestIds.push(request.id);
      stop.pickupRequestIds = uniqueSorted(stop.pickupRequestIds);
    }
  }
  sortCarRoute(car);

  // Everyone destined to this floor leaves first, freeing capacity.
  const leavingLoads = car.loads.filter((load) => load.destinationFloor === car.floor);
  for (const load of leavingLoads) {
    const request = requests.get(load.requestId);
    car.loads = car.loads.filter((item) => item !== load);
    if (request) {
      request.delivered += load.people;
      request.deliveryTick = state.tick;
      emit(
        state,
        eventForCar(car, 'alight', `${load.people} 人（${request.id}）在 ${car.floor} 层下电梯。`, {
          requestId: request.id,
          floor: car.floor,
          people: load.people
        })
      );
    }
  }

  reconcileRoute(car, state.requests);
  const stop = car.route.find((item) => item.floor === car.floor);
  const pickupIds = stop ? [...stop.pickupRequestIds].sort() : [];
  for (const requestId of pickupIds) {
    const request = requests.get(requestId);
    if (!request || request.carId !== car.id || !activeRequest(request)) continue;
    if (request.originFloor !== car.floor) continue;
    const waiting = waitingPeople(request);
    if (waiting <= 0) continue;

    const used = onboardCount(car);
    const available = CAR_CAPACITY - used;
    const boarding = Math.max(0, Math.min(waiting, available));
    if (boarding > 0) {
      request.boarded += boarding;
      if (request.pickupTick === null) request.pickupTick = state.tick;
      const existing = car.loads.find((load) => load.requestId === request.id);
      if (existing) existing.people += boarding;
      else car.loads.push({ requestId: request.id, people: boarding, destinationFloor: request.destinationFloor });

      emit(
        state,
        eventForCar(car, 'board', `${boarding} 人（${request.id}）上车，容量 ${used + boarding}/${CAR_CAPACITY}。`, {
          requestId: request.id,
          floor: car.floor,
          people: boarding,
          board: boarding,
          remaining: waitingPeople(request),
          destinationFloor: request.destinationFloor,
          waited: state.tick - request.arrivalTick
        })
      );
    } else {
      emit(
        state,
        eventForCar(
          car,
          'board',
          `${request.id} 的 ${waiting} 人本 tick 未能上车：电梯满载 ${used}/${CAR_CAPACITY}；请求继续等待，不会消失。`,
          {
            requestId: request.id,
            floor: car.floor,
            people: 0,
            board: 0,
            remaining: waiting,
            destinationFloor: request.destinationFloor
          }
        )
      );
    }
  }
  reconcileRoute(car, state.requests);
}

function processCar(car: CarState, state: InternalState, config: SimConfig): void {
  switch (car.phase) {
    case 'idle': {
      reconcileRoute(car, state.requests);
      if (car.route.length > 0) startNextService(car, state, config);
      break;
    }

    case 'moving': {
      car.phaseRemaining--;
      if (car.phaseRemaining > 0) break;
      car.floor += car.direction === 'up' ? 1 : -1;
      car.travelledFloors++;
      reconcileRoute(car, state.requests);
      sortCarRoute(car);
      const hasStop = car.route.some((stop) => stop.floor === car.floor);
      emit(
        state,
        eventForCar(car, 'move', `电梯 ${car.id} 到达 ${car.floor} 层。`, {
          toFloor: car.floor,
          direction: car.direction,
          empty: onboardCount(car) === 0
        })
      );
      if (hasStop) {
        car.phase = 'opening';
        car.phaseRemaining = config.doorTicks;
        car.doorOpen = false;
        emit(state, eventForCar(car, 'door-opening', `电梯 ${car.id} 因承诺停靠开始开门。`, { floor: car.floor }));
      } else {
        car.phase = 'idle';
        car.phaseRemaining = 0;
        startNextService(car, state, config);
      }
      break;
    }

    case 'opening': {
      car.phaseRemaining--;
      if (car.phaseRemaining > 0) break;
      car.phase = 'open';
      car.phaseRemaining = 1;
      car.doorOpen = true;
      emit(state, eventForCar(car, 'door-open', `电梯 ${car.id} 门已开，开始上下客。`, { floor: car.floor }));
      serveOpenFloor(car, state);
      break;
    }

    case 'open': {
      // Requests arriving on later open ticks are served before counting dwell time.
      serveOpenFloor(car, state);
      car.phaseRemaining--;
      if (car.phaseRemaining > 0) break;
      car.phase = 'closing';
      car.phaseRemaining = config.doorTicks;
      car.doorOpen = false;
      emit(state, eventForCar(car, 'door-closing', `开门保持结束，电梯 ${car.id} 开始关门。`, { floor: car.floor }));
      break;
    }

    case 'closing': {
      car.phaseRemaining--;
      if (car.phaseRemaining > 0) break;
      car.doorOpen = false;
      emit(state, eventForCar(car, 'door-closed', `电梯 ${car.id} 关门完成。`, { floor: car.floor }));
      startNextService(car, state, config);
      break;
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export function createConfig(partial: Omit<SimConfig, 'capacity'>): SimConfig {
  return { ...partial, capacity: CAR_CAPACITY };
}
