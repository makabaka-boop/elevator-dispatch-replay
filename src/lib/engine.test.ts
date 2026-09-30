import { describe, expect, it } from 'vitest';
import { CAR_CAPACITY, createConfig, runSimulation } from './engine';
import type { RequestInput, SimConfig } from './types';

function config(requests: RequestInput[], partial: Partial<Omit<SimConfig, 'requests' | 'capacity'>> = {}): SimConfig {
  return createConfig({
    floors: partial.floors ?? 10,
    cars: partial.cars ?? 2,
    travelTicks: partial.travelTicks ?? 1,
    doorTicks: partial.doorTicks ?? 1,
    requests
  });
}

function eventsOf(simulation: ReturnType<typeof runSimulation>, type: string) {
  return simulation.events.filter((event) => event.type === type);
}

describe('deterministic elevator engine', () => {
  it('breaks parallel dispatch ties by earliest committed ETA and then smallest car ID', () => {
    const simulation = runSimulation(
      config([
        { id: 'A', arrivalTick: 0, originFloor: 1, destinationFloor: 8, people: 1 },
        { id: 'B', arrivalTick: 0, originFloor: 1, destinationFloor: 6, people: 1 }
      ])
    );

    const dispatches = eventsOf(simulation, 'dispatch');
    expect(dispatches.map((event) => event.requestId)).toEqual(['A', 'B']);
    expect(dispatches[0]?.carId).toBe(0);
    // Both groups originate on 1F. Committing B to car 0 uses the same door
    // cycle and is earlier than sending car 1 separately; requests are
    // dispatched in ID order once capacity remains available.
    expect(dispatches[1]?.carId).toBe(0);
    expect(dispatches[0]?.candidates?.map((candidate) => candidate.carId)).toEqual([0, 1]);
    expect(dispatches[0]?.candidates?.map((candidate) => candidate.eta)).toEqual([1, 1]);
    expect(dispatches[0]?.reason).toContain('tick=1');
    expect(dispatches[0]?.reason).toContain('最小电梯 ID=0');

    const tieSimulation = runSimulation(
      config([{ id: 'TIE', arrivalTick: 0, originFloor: 5, destinationFloor: 9, people: 1 }])
    );
    const tieDispatch = eventsOf(tieSimulation, 'dispatch')[0];
    expect(tieDispatch?.candidates?.map((candidate) => candidate.eta)).toEqual([5, 5]);
    expect(tieDispatch?.carId).toBe(0);
  });

  it('boards only available capacity and keeps the remainder waiting without deleting it', () => {
    const simulation = runSimulation(
      config([{ id: 'BIG', arrivalTick: 0, originFloor: 1, destinationFloor: 8, people: 10 }])
    );

    const boardEvents = eventsOf(simulation, 'board');
    const firstBoarding = boardEvents.find((event) => event.people === 6);
    expect(firstBoarding).toMatchObject({ requestId: 'BIG', board: 6, remaining: 4 });
    expect(firstBoarding?.reason).toContain('容量 6/6');

    const split = runSimulation(
      config(
        [
          { id: 'FULL_FAR', arrivalTick: 0, originFloor: 1, destinationFloor: 16, people: 6 },
          { id: 'FULL_NEAR', arrivalTick: 0, originFloor: 1, destinationFloor: 8, people: 6 },
          { id: 'WAIT2', arrivalTick: 0, originFloor: 1, destinationFloor: 9, people: 2 }
        ],
        { floors: 16 }
      )
    );
    const denied = eventsOf(split, 'board').find((event) => event.requestId === 'WAIT2' && event.people === 0);
    expect(denied?.reason).toContain('继续等待');
    expect(split.snapshots.at(-1)?.requests.find((request) => request.id === 'WAIT2')).toMatchObject({
      people: 2,
      delivered: 2,
      cancelled: 0
    });

    for (const snapshot of simulation.snapshots) {
      for (const car of snapshot.cars) {
        const load = car.loads.reduce((sum, item) => sum + item.people, 0);
        expect(load).toBeLessThanOrEqual(CAR_CAPACITY);
      }
    }

    const finalRequest = simulation.snapshots.at(-1)?.requests[0];
    expect(finalRequest).toMatchObject({
      people: 10,
      boarded: 10,
      delivered: 10,
      cancelled: 0,
      carId: 0
    });
  });

  it('cancels only people not aboard and rejects cancellation after boarding', () => {
    const cancelBeforeBoard = runSimulation(
      config([{ id: 'EARLY_CANCEL', arrivalTick: 5, originFloor: 1, destinationFloor: 8, people: 1, cancelTick: 6 }])
    );
    expect(eventsOf(cancelBeforeBoard, 'cancel')).toHaveLength(1);
    expect(eventsOf(cancelBeforeBoard, 'alight')).toHaveLength(0);
    expect(cancelBeforeBoard.snapshots.at(-1)?.requests[0]).toMatchObject({
      people: 1,
      cancelled: 1,
      delivered: 0
    });

    const rejectAfterBoard = runSimulation(
      config([{ id: 'ABOARD', arrivalTick: 0, originFloor: 1, destinationFloor: 8, people: 1, cancelTick: 3 }])
    );
    expect(eventsOf(rejectAfterBoard, 'cancel-rejected')).toHaveLength(1);
    expect(rejectAfterBoard.snapshots.at(-1)?.requests[0]).toMatchObject({
      people: 1,
      cancelled: 0,
      delivered: 1
    });

    const partial = runSimulation(
      config([{ id: 'PARTIAL', arrivalTick: 0, originFloor: 1, destinationFloor: 8, people: 10, cancelTick: 2 }])
    );
    const cancelEvent = eventsOf(partial, 'cancel')[0];
    expect(cancelEvent).toMatchObject({ requestId: 'PARTIAL', people: 4 });
    expect(partial.snapshots.at(-1)?.requests[0]).toMatchObject({
      people: 10,
      boarded: 6,
      delivered: 6,
      cancelled: 4
    });
  });

  it('keeps doors blocking movement for the complete fixed integer door cycle', () => {
    const simulation = runSimulation(
      config([{ id: 'MOVE', arrivalTick: 0, originFloor: 1, destinationFloor: 5, people: 1 }], { doorTicks: 2, travelTicks: 3 })
    );

    expect(simulation.snapshots[0]?.cars[0]?.phase).toBe('idle');
    expect(simulation.snapshots[1]?.cars[0]).toMatchObject({ phase: 'opening', floor: 1, doorOpen: false });
    expect(simulation.snapshots[2]?.cars[0]).toMatchObject({ phase: 'opening', floor: 1, doorOpen: false });
    expect(simulation.snapshots[3]?.cars[0]).toMatchObject({ phase: 'open', floor: 1, doorOpen: true });
    expect(simulation.snapshots[4]?.cars[0]).toMatchObject({ phase: 'closing', floor: 1, doorOpen: false });
    expect(simulation.snapshots[5]?.cars[0]).toMatchObject({ phase: 'closing', floor: 1, doorOpen: false });
    expect(simulation.snapshots[6]?.cars[0]).toMatchObject({ phase: 'moving', floor: 1 });
    expect(simulation.snapshots[9]?.cars[0]).toMatchObject({ phase: 'moving', floor: 2 });
  });

  it('reproduces a hand-computed full-capacity split timeline tick by tick', () => {
    const simulation = runSimulation(
      config(
        [
          { id: 'A', arrivalTick: 0, originFloor: 1, destinationFloor: 3, people: 6 },
          { id: 'B', arrivalTick: 0, originFloor: 1, destinationFloor: 2, people: 6 }
        ],
        { floors: 3, cars: 2, travelTicks: 1, doorTicks: 1 }
      )
    );

    const timeline = simulation.snapshots.map((snapshot) =>
      snapshot.cars.map((car) => ({
        phase: car.phase,
        floor: car.floor,
        load: car.loads.reduce((sum, load) => sum + load.people, 0)
      }))
    );
    const dispatches = eventsOf(simulation, 'dispatch');
    expect(timeline).toEqual([
      [
        { phase: 'idle', floor: 1, load: 0 },
        { phase: 'idle', floor: 1, load: 0 }
      ],
      [
        { phase: 'opening', floor: 1, load: 0 },
        { phase: 'opening', floor: 1, load: 0 }
      ],
      [
        { phase: 'open', floor: 1, load: 6 },
        { phase: 'open', floor: 1, load: 6 }
      ],
      [
        { phase: 'closing', floor: 1, load: 6 },
        { phase: 'closing', floor: 1, load: 6 }
      ],
      [
        { phase: 'moving', floor: 1, load: 6 },
        { phase: 'moving', floor: 1, load: 6 }
      ],
      [
        { phase: 'moving', floor: 2, load: 6 },
        { phase: 'opening', floor: 2, load: 6 }
      ],
      [
        { phase: 'opening', floor: 3, load: 6 },
        { phase: 'open', floor: 2, load: 0 }
      ],
      [
        { phase: 'open', floor: 3, load: 0 },
        { phase: 'closing', floor: 2, load: 0 }
      ]
    ]);

    expect(dispatches.map((event) => [event.requestId, event.carId])).toEqual([
      ['A', 0],
      ['B', 1]
    ]);
    expect(simulation.finalTick).toBe(7);
  });

  it('partially boards and leaves the remaining people waiting for another car cycle', () => {
    const simulation = runSimulation(
      config(
        [
          { id: 'A', arrivalTick: 0, originFloor: 1, destinationFloor: 3, people: 4 },
          { id: 'B', arrivalTick: 0, originFloor: 1, destinationFloor: 2, people: 3 }
        ],
        { floors: 3, cars: 2, travelTicks: 1, doorTicks: 1 }
      )
    );

    expect(eventsOf(simulation, 'dispatch').map((event) => [event.requestId, event.carId])).toEqual([
      ['A', 0],
      ['B', 0]
    ]);
    const firstB = eventsOf(simulation, 'board').find((event) => event.requestId === 'B');
    expect(firstB).toMatchObject({ people: 2, remaining: 1 });
    expect(simulation.snapshots.at(-1)?.requests.find((request) => request.id === 'B')).toMatchObject({
      people: 3,
      boarded: 3,
      delivered: 3,
      cancelled: 0
    });
  });

  it('preserves all people across every immutable reference snapshot', () => {
    const simulation = runSimulation(
      config([
        { id: 'A', arrivalTick: 0, originFloor: 1, destinationFloor: 10, people: 6 },
        { id: 'B', arrivalTick: 0, originFloor: 1, destinationFloor: 9, people: 7 },
        { id: 'C', arrivalTick: 3, originFloor: 6, destinationFloor: 1, people: 4, cancelTick: 30 },
        { id: 'D', arrivalTick: 7, originFloor: 3, destinationFloor: 2, people: 2 }
      ], { cars: 3 })
    );

    for (const snapshot of simulation.snapshots) {
      for (const request of snapshot.requests) {
        const onboard = snapshot.cars.reduce(
          (sum, car) => sum + car.loads.filter((load) => load.requestId === request.id).reduce((x, load) => x + load.people, 0),
          0
        );
        const waiting = request.people - request.boarded - request.cancelled;
        const alreadyDelivered = request.delivered;
        expect(onboard).toBe(request.boarded - request.delivered);
        expect(waiting + onboard + alreadyDelivered + request.cancelled).toBe(request.people);
      }
      expect(Object.isFrozen(snapshot)).toBe(true);
    }
    expect(Object.isFrozen(simulation.events)).toBe(true);
  });
});
