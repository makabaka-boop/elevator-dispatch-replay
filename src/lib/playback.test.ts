import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { runSimulation, createConfig } from './engine';
import { BASE_MS_PER_TICK, createPlayback, type Clock } from './playback';
import type { RequestInput } from './types';

function makeClock() {
  let time = 0;
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const clock: Clock = {
    now: () => time,
    setInterval: (callback) => {
      const id = nextId++;
      timers.set(id, callback);
      return id;
    },
    clearInterval: (id) => timers.delete(id)
  };
  return {
    clock,
    advance(milliseconds: number) {
      time += milliseconds;
      for (const callback of [...timers.values()]) callback();
    }
  };
}

function makeSimulation(_ticks?: number) {
  const requests: RequestInput[] = [{ arrivalTick: 0, originFloor: 1, destinationFloor: 16, people: 1 }];
  return runSimulation(createConfig({ floors: 16, cars: 2, travelTicks: 2, doorTicks: 1, requests }));
}

describe('precomputed playback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('different speeds and jumps replay exactly the same snapshot per tick', () => {
    const simulation = makeSimulation(40);
    const slowClock = makeClock();
    const fastClock = makeClock();
    const slow = createPlayback(simulation, { speed: 1, clock: slowClock.clock });
    const fast = createPlayback(simulation, { speed: 8, clock: fastClock.clock });

    slow.play();
    fast.play();
    slowClock.advance(BASE_MS_PER_TICK * 12);
    fastClock.advance(BASE_MS_PER_TICK * 12);

    const slowTick = get(slow).tick;
    const fastTick = get(fast).tick;
    expect(fastTick).toBeGreaterThan(slowTick);
    expect(slow.snapshotAt(slowTick)).toBe(simulation.snapshots[slowTick]);
    expect(fast.snapshotAt(fastTick)).toBe(simulation.snapshots[fastTick]);

    slow.seek(20);
    fast.seek(20);
    expect(get(slow).tick).toBe(20);
    expect(get(fast).tick).toBe(20);
    expect(get(slow).playing).toBe(false);
    expect(get(fast).playing).toBe(false);
    expect(slow.snapshotAt(20)).toBe(fast.snapshotAt(20));

    slow.destroy();
    fast.destroy();
  });

  it('changing speed while playing never creates another engine state', () => {
    const simulation = makeSimulation(30);
    const fake = makeClock();
    const player = createPlayback(simulation, { speed: 1, clock: fake.clock });
    const snapshots = simulation.snapshots;

    player.play();
    fake.advance(BASE_MS_PER_TICK * 5);
    expect(get(player).tick).toBe(5);
    player.setSpeed(4);
    fake.advance(BASE_MS_PER_TICK * 5);
    expect(get(player).tick).toBe(25);
    expect(player.snapshotAt(25)).toBe(snapshots[25]);
    expect(simulation.snapshots).toBe(snapshots);

    player.destroy();
  });

  it('seeking backward and forward reads immutable precomputed ticks only', () => {
    const simulation = makeSimulation(20);
    const player = createPlayback(simulation);
    player.seek(15);
    expect(player.snapshotAt(15)).toBe(simulation.snapshots[15]);
    player.seek(3);
    expect(player.snapshotAt(3)).toBe(simulation.snapshots[3]);
    player.step(7);
    expect(get(player).tick).toBe(10);
    expect(() => Object.assign(simulation.snapshots[10]!, { tick: 999 })).toThrow();
    player.destroy();
  });
});
