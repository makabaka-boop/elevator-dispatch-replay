import { writable, type Writable } from 'svelte/store';
import type { Simulation } from './types';

export interface PlaybackState {
  tick: number;
  playing: boolean;
  speed: number;
  finalTick: number;
}

export interface Clock {
  now(): number;
  setInterval(callback: () => void, milliseconds: number): number;
  clearInterval(handle: number): void;
}

const browserClock: Clock = {
  now: () => performance.now(),
  setInterval: (callback, milliseconds) => globalThis.setInterval(callback, milliseconds) as unknown as number,
  clearInterval: (handle) => globalThis.clearInterval(handle)
};

export const BASE_MS_PER_TICK = 500;
const FRAME_MS = 40;

export function createPlayback(
  simulation: Simulation,
  options: { speed?: number; clock?: Clock } = {}
) {
  const clock = options.clock ?? browserClock;
  const initialSpeed = options.speed ?? 1;
  const finalTick = simulation.finalTick;
  const state: Writable<PlaybackState> = writable({
    tick: 0,
    playing: false,
    speed: initialSpeed,
    finalTick
  });

  let timer: number | null = null;
  let anchorClock = 0;
  let anchorTick = 0;
  let currentSpeed = initialSpeed;

  const snapshotTick = (tick: number): number => Math.max(0, Math.min(finalTick, Math.trunc(tick)));

  const stopTimer = () => {
    if (timer !== null) {
      clock.clearInterval(timer);
      timer = null;
    }
  };

  const setTick = (tick: number) => {
    state.update((previous) => ({ ...previous, tick: snapshotTick(tick) }));
  };

  const refreshFromClock = () => {
    const elapsedMs = Math.max(0, clock.now() - anchorClock);
    const elapsedTicks = (elapsedMs * currentSpeed) / BASE_MS_PER_TICK;
    const nextTick = snapshotTick(anchorTick + elapsedTicks);
    setTick(nextTick);
    if (nextTick >= finalTick) pause();
  };

  function play() {
    state.update((previous) => {
      if (previous.playing || previous.tick >= finalTick) return previous;
      anchorClock = clock.now();
      anchorTick = previous.tick;
      timer = clock.setInterval(refreshFromClock, FRAME_MS);
      return { ...previous, playing: true };
    });
  }

  function pause() {
    stopTimer();
    state.update((previous) => ({ ...previous, playing: false }));
  }

  const toggle = () => {
    let playing = false;
    state.subscribe((value) => {
      playing = value.playing;
    })();
    if (playing) pause();
    else play();
  };

  const seek = (tick: number) => {
    const target = snapshotTick(tick);
    stopTimer();
    anchorClock = clock.now();
    anchorTick = target;
    state.update((previous) => ({ ...previous, tick: target, playing: false }));
  };

  const setSpeed = (speed: number) => {
    if (!Number.isFinite(speed) || speed <= 0) throw new Error('播放速度必须是正数。');
    currentSpeed = speed;
    state.update((previous) => {
      if (previous.playing) {
        anchorClock = clock.now();
        anchorTick = previous.tick;
      }
      return { ...previous, speed };
    });
  };

  const step = (delta = 1) => {
    pause();
    state.update((previous) => ({ ...previous, tick: snapshotTick(previous.tick + delta) }));
  };

  const destroy = () => stopTimer();

  return {
    subscribe: state.subscribe,
    play,
    pause,
    toggle,
    seek,
    setSpeed,
    step,
    destroy,
    snapshotAt: (tick: number) => simulation.snapshots[snapshotTick(tick)]
  };
}

export type Playback = ReturnType<typeof createPlayback>;
