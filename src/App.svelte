<script lang="ts">
  import { onDestroy } from 'svelte';
  import BuildingView from './components/BuildingView.svelte';
  import PlaybackControls from './components/PlaybackControls.svelte';
  import RequestEditor from './components/RequestEditor.svelte';
  import {
    CAR_CAPACITY,
    MAX_CARS,
    MAX_FLOORS,
    MIN_CARS,
    MIN_FLOORS,
    createConfig,
    runSimulation
  } from './lib/engine';
  import { createPlayback, type Playback, type PlaybackState } from './lib/playback';
  import { defaultRequests, emptyRequest } from './lib/sample';
  import type { EventType, RequestInput, SimEvent, Simulation } from './lib/types';

  let floors = 10;
  let cars = 3;
  let travelTicks = 2;
  let doorTicks = 2;
  let requests: RequestInput[] = defaultRequests.map((request) => ({ ...request }));
  let errors: string[] = [];
  let info = '点击“运行模拟”后，引擎会一次性预计算所有 tick；变速和跳转只读取同一份冻结快照。';

  let simulation: Simulation = buildSimulation();
  let player: Playback = createPlayback(simulation);
  let playback: PlaybackState = $player;
  let eventFilter: 'all' | EventType = 'all';
  let eventLimit = 120;

  function normalizedRequests(): RequestInput[] {
    return requests.map((request) => ({
      ...request,
      id: request.id?.trim() ? request.id.trim() : undefined,
      cancelTick: request.cancelTick === undefined || Number.isNaN(request.cancelTick) ? undefined : request.cancelTick
    }));
  }

  function buildSimulation(): Simulation {
    const simulation = runSimulation(
      createConfig({
        floors,
        cars,
        travelTicks,
        doorTicks,
        requests: normalizedRequests()
      })
    );
    errors = [];
    return simulation;
  }

  function rebuild(seekTick = 0): void {
    try {
      const next = buildSimulation();
      const targetTick = Math.min(seekTick, next.finalTick);
      player.destroy();
      simulation = next;
      player = createPlayback(next, { speed: playback?.speed ?? 1 });
      player.seek(targetTick);
      playback = $player;
      errors = [];
    } catch (error) {
      errors = error instanceof Error ? error.message.replace('配置无效：\n', '').split('\n') : ['未知错误。'];
    }
  }

  function runFromForm(): void {
    rebuild(0);
    info = '已离线一次性预计算全部快照；播放和跳转只读取结果。';
  }

  function addRequest(): void {
    if (requests.length >= 100) return;
    requests = [...requests, emptyRequest(requests.length + 1)];
  }

  function loadSample(): void {
    floors = 10;
    cars = 3;
    travelTicks = 2;
    doorTicks = 2;
    requests = defaultRequests.map((request) => ({ ...request }));
    rebuild(0);
  }

  function clearRequests(): void {
    requests = [];
    rebuild(0);
  }

  function cancelAtCurrentTick(requestId: string, cancelTick: number): void {
    requests = requests.map((request, index) => {
      const id = request.id?.trim() || `R${String(index + 1).padStart(3, '0')}`;
      return id === requestId && (request.cancelTick === undefined || cancelTick <= request.cancelTick)
        ? { ...request, cancelTick }
        : request;
    });
    rebuild(cancelTick);
  }

  $: if (player) {
    playback = $player;
  }

  $: currentSnapshot = simulation.snapshots[Math.min(playback?.tick ?? 0, simulation.finalTick)];
  $: visibleEvents = filterEvents(simulation.events, eventFilter);

  function filterEvents(events: SimEvent[], filter: 'all' | EventType): SimEvent[] {
    const selected = events.filter((event) => filter === 'all' || event.type === filter);
    return [...selected].reverse().slice(0, eventLimit);
  }

  const eventTypes: Array<{ value: 'all' | EventType; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'dispatch', label: '派车' },
    { value: 'door-opening', label: '开门' },
    { value: 'door-closing', label: '关门' },
    { value: 'board', label: '上客' },
    { value: 'alight', label: '下客' },
    { value: 'move', label: '行驶' },
    { value: 'cancel', label: '取消' }
  ];

  function eventDetail(event: SimEvent): string {
    const detail: Record<string, unknown> = {};
    for (const key of ['candidates', 'selectedCarId', 'board', 'remaining', 'waited', 'empty', 'toFloor'] as const) {
      if (event[key] !== undefined) detail[key] = event[key];
    }
    return Object.keys(detail).length ? JSON.stringify(detail, null, 2) : '';
  }

  function requestStatus(requestId: string): string {
    const request = currentSnapshot?.requests.find((item) => item.id === requestId);
    if (!request) return '';
    if (request.cancelled === request.people) return '已取消';
    if (request.boarded > 0) {
      const waiting = request.people - request.boarded - request.cancelled;
      if (waiting > 0) return `车上 ${request.boarded}，等待 ${waiting}`;
      if (request.delivered === request.boarded) return `已送达 ${request.delivered} 人 @${request.deliveryTick}`;
      return `车上 ${request.boarded - request.delivered}，已送达 ${request.delivered}`;
    }
    if (request.delivered === request.people) return `已送达 @${request.deliveryTick}`;
    return request.carId === null ? '未派车' : `已派电梯 ${request.carId + 1}`;
  }

  onDestroy(() => player.destroy());
</script>

<main class="page">
  <header class="hero">
    <div>
      <h1>离线电梯群控模拟器</h1>
      <p>确定性离散事件引擎 · 容量 {CAR_CAPACITY} 人 · 一次计算，多速度/跳转回放同一状态。</p>
    </div>
    <button type="button" on:click={runFromForm} class="primary big">运行模拟</button>
  </header>

  <section class="card config-grid">
    <label>楼层数
      <input type="number" bind:value={floors} min={MIN_FLOORS} max={MAX_FLOORS} />
    </label>
    <label>电梯数
      <input type="number" bind:value={cars} min={MIN_CARS} max={MAX_CARS} />
    </label>
    <label>行驶一层 tick
      <input type="number" bind:value={travelTicks} min="1" />
    </label>
    <label>开/关门各 tick
      <input type="number" bind:value={doorTicks} min="1" />
    </label>
    <label>容量
      <input value={CAR_CAPACITY} disabled />
    </label>
    <div class="actions">
      <button type="button" on:click={addRequest} disabled={requests.length >= 100}>新增请求</button>
      <button type="button" on:click={loadSample}>示例</button>
      <button type="button" on:click={clearRequests}>清空</button>
    </div>
  </section>

  {#if errors.length}
    <section class="card errors">
      <h2>配置错误</h2>
      <ul>{#each errors as error}<li>{error}</li>{/each}</ul>
    </section>
  {/if}

  <section class="card">
    <RequestEditor bind:requests {floors} />
  </section>

  {#if info}
    <div class="info">{info}</div>
  {/if}

  {#if currentSnapshot}
    <PlaybackControls {player} {playback} />

    <BuildingView
      {floors}
      snapshot={currentSnapshot}
      events={simulation.events}
      currentTick={playback.tick}
      interactiveCancel={true}
      onCancelRequest={cancelAtCurrentTick}
    />

    <section class="grid-panels">
      <div class="card">
        <h2>请求状态（当前 tick）</h2>
        <div class="request-status-list">
          {#each currentSnapshot.requests as request (request.id)}
            <div>
              <strong>{request.id}</strong>
              <span>{request.originFloor}F → {request.destinationFloor}F × {request.people}</span>
              <em>{requestStatus(request.id)}</em>
            </div>
          {/each}
        </div>
      </div>

      <div class="card">
        <div class="log-head">
          <h2>事件依据</h2>
          <select bind:value={eventFilter}>
            {#each eventTypes as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
          <label class="limit">显示
            <input type="number" bind:value={eventLimit} min="10" max="500" step="10" />
          </label>
        </div>
        <ul class="event-log">
          {#each visibleEvents as event (event.seq)}
            <li data-type={event.type}>
              <div>
                <time>t={event.tick}</time>
                <span class="type">{eventTypes.find((item) => item.value === event.type)?.label ?? event.type}</span>
                {#if event.carId !== undefined}<span class="car">E{event.carId + 1}</span>{/if}
                <span>{event.reason}</span>
              </div>
              {#if eventDetail(event)}
                <pre>{eventDetail(event)}</pre>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    </section>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f3f5f9;
    color: #172033;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  :global(*) { box-sizing: border-box; }
  :global(button) {
    border: 1px solid #cbd5e1;
    background: white;
    color: #172033;
    border-radius: 8px;
    padding: 7px 12px;
    cursor: pointer;
    font-weight: 600;
  }
  :global(button:hover) { border-color: #2563eb; color: #2563eb; }
  :global(button:disabled) { opacity: .45; cursor: not-allowed; }
  :global(input), :global(select) {
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 7px 9px;
    font: inherit;
    background: white;
  }
  :global(:root) {
    --border: #d7deea;
    --panel: #ffffff;
    --panel-strong: #f8fafc;
    --accent: #2563eb;
    --text-soft: #64748b;
    --car: #dbeafe;
  }
  .page { max-width: 1440px; margin: 0 auto; padding: 24px; }
  .hero { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 18px; }
  h1 { margin: 0 0 6px; font-size: 28px; }
  h2 { font-size: 17px; margin: 0 0 12px; }
  p { margin: 0; color: var(--text-soft); }
  .primary { background: #2563eb; color: white; border-color: #2563eb; }
  .primary:hover { color: white; background: #1d4ed8; }
  .big { padding: 11px 20px; }
  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .config-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(120px, 1fr)) 2fr;
    gap: 12px;
    align-items: end;
  }
  label { display: grid; gap: 5px; font-size: 13px; font-weight: 600; color: #334155; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .errors { border-color: #fca5a5; background: #fef2f2; }
  .errors ul { margin: 0; padding-left: 20px; color: #991b1b; }
  .info { background: #ecfdf5; border: 1px solid #6ee7b7; color: #065f46; padding: 10px 14px; border-radius: 10px; margin-bottom: 14px; }
  .grid-panels { display: grid; grid-template-columns: 360px 1fr; gap: 16px; margin-top: 16px; }
  .request-status-list { display: grid; gap: 8px; max-height: 560px; overflow: auto; }
  .request-status-list div {
    display: grid;
    grid-template-columns: 70px 1fr;
    gap: 2px 8px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel-strong);
    font-size: 13px;
  }
  .request-status-list em { grid-column: 2; color: var(--text-soft); font-style: normal; }
  .log-head { display: flex; align-items: center; gap: 10px; }
  .log-head h2 { margin: 0; }
  .log-head select { margin-left: auto; }
  .limit { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .limit input { width: 82px; }
  .event-log { list-style: none; padding: 0; margin: 12px 0 0; max-height: 560px; overflow: auto; }
  .event-log li { border-bottom: 1px solid var(--border); padding: 8px 0; font-size: 13px; }
  .event-log li > div { display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; }
  time { font-weight: 800; color: #2563eb; }
  .type { font-weight: 700; min-width: 42px; }
  .car { color: #9a3412; font-weight: 700; }
  pre {
    margin: 6px 0 0 38px;
    padding: 8px;
    border-radius: 8px;
    background: #0f172a;
    color: #dbeafe;
    font-size: 11px;
    overflow-x: auto;
  }
  @media (max-width: 1100px) {
    .config-grid { grid-template-columns: repeat(2, 1fr); }
    .grid-panels { grid-template-columns: 1fr; }
  }
</style>
