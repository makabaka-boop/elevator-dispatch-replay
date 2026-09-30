<script lang="ts">
  import type { Playback } from '../lib/playback';
  import type { PlaybackState } from '../lib/playback';

  export let player: Playback;
  export let playback: PlaybackState;
  export let speeds = [0.5, 1, 2, 4, 8];

  const speedLabels: Record<number, string> = {
    0.5: '0.5×',
    1: '1×',
    2: '2×',
    4: '4×',
    8: '8×'
  };
</script>

<div class="controls">
  <button type="button" on:click={player.play} disabled={playback.playing || playback.tick >= playback.finalTick}>播放</button>
  <button type="button" on:click={player.pause} disabled={!playback.playing}>暂停</button>
  <button type="button" on:click={() => player.step(-1)}>上一 tick</button>
  <button type="button" on:click={() => player.step(1)}>下一 tick</button>
  <button type="button" on:click={() => player.seek(0)}>|&lt;</button>
  <button type="button" on:click={() => player.seek(playback.finalTick)}>&gt;|</button>

  <label class="timeline">
    <span>tick {playback.tick} / {playback.finalTick}</span>
    <input
      type="range"
      min="0"
      max={playback.finalTick}
      step="1"
      value={playback.tick}
      on:input={(event) => player.seek(Number(event.currentTarget.value))}
    />
  </label>

  <div class="speeds" role="group" aria-label="播放速度">
    {#each speeds as speed}
      <button type="button" class:active={playback.speed === speed} on:click={() => player.setSpeed(speed)}>
        {speedLabels[speed] ?? `${speed}×`}
      </button>
    {/each}
  </div>
</div>

<style>
  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--panel);
    margin: 14px 0;
  }
  button { min-width: 72px; }
  .timeline { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 260px; font-size: 13px; }
  .timeline input { flex: 1; width: auto; }
  .speeds { display: flex; gap: 4px; }
  .speeds button { min-width: 48px; padding-inline: 8px; }
  .active { border-color: var(--accent); color: var(--accent); background: var(--panel-strong); font-weight: 700; }
</style>
