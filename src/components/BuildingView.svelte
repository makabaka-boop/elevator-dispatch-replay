<script lang="ts" context="module">
  function floorArray(floors: number): number[] {
    return Array.from({ length: floors }, (_unused, index) => floors - index);
  }

  function eventsAtTick(events: SimEvent[], tick: number): SimEvent[] {
    return events.filter((event) => event.tick === tick);
  }
</script>

<script lang="ts">
  import type { SimSnapshot, SimEvent } from '../lib/types';
  import { CAR_CAPACITY } from '../lib/engine';

  export let floors: number;
  export let snapshot: SimSnapshot;
  export let events: SimEvent[] = [];
  export let currentTick = 0;
  export let interactiveCancel = false;
  export let onCancelRequest: ((requestId: string, cancelTick: number) => void) | null = null;

  function carLoad(carId: number): number {
    const car = snapshot.cars[carId];
    return car ? car.loads.reduce((sum, load) => sum + load.people, 0) : 0;
  }

  function waitingAt(floor: number) {
    return snapshot.requests
      .filter(
        (request) =>
          request.arrivalTick <= currentTick &&
          request.originFloor === floor &&
          request.people - request.boarded - request.cancelled > 0
      )
      .map((request) => ({
        id: request.id,
        people: request.people - request.boarded - request.cancelled,
        destinationFloor: request.destinationFloor,
        assigned: request.carId !== null
      }));
  }

  function phaseLabel(phase: string): string {
    if (phase === 'moving') return '行驶';
    if (phase === 'idle') return '空闲';
    if (phase === 'opening') return '开门中';
    if (phase === 'open') return '门开';
    return '关门中';
  }

  function carRequests(carIndex: number): string {
    const car = snapshot.cars[carIndex];
    if (!car || car.route.length === 0) return '无承诺停靠';
    return car.route.map((stop) => `${stop.floor}层`).join(' → ');
  }

  function cancelWaiting(id: string) {
    onCancelRequest?.(id, currentTick);
  }
</script>

<section class="simulation-layout">
  <div class="building" style="--car-count: {snapshot.cars.length};">
    <div class="floor-row header">
      <div class="floor-cell"></div>
      <div class="waiting-cell">等待区</div>
      {#each snapshot.cars as car, carIndex (car.id)}
        <div class="car-head">电梯 {carIndex + 1}</div>
      {/each}
    </div>

    {#each floorArray(floors) as floor}
      <div class="floor-row">
        <div class="floor-cell"><strong>{floor}F</strong></div>
        <div class="waiting-cell">
          {#each waitingAt(floor) as item (item.id + floor)}
            <div class="waiting-chip" class:assigned={item.assigned} title={`${item.id} → ${item.destinationFloor}F`}>
              <span>{item.id}</span>
              <b>×{item.people}</b>
              <em>→{item.destinationFloor}F</em>
              {#if interactiveCancel}
                <button type="button" on:click={() => cancelWaiting(item.id)}>取消</button>
              {/if}
            </div>
          {/each}
        </div>
        {#each snapshot.cars as car, carIndex (car.id)}
          <div class="car-cell">
            {#if car.floor === floor}
              <div class="car" class:open={car.doorOpen} class:moving={car.phase === 'moving'} data-phase={car.phase}>
                <div class="car-top">
                  <span>{car.direction === 'up' ? '▲' : '▼'}</span>
                  <b>{carLoad(carIndex)}/{CAR_CAPACITY}</b>
                </div>
                <div class="door-state">{phaseLabel(car.phase)}</div>
                <div class="load-dots">
                  {#each Array(carLoad(carIndex)) as _unused, dotIndex}
                    <span>{dotIndex}</span>
                  {/each}
                </div>
              </div>
            {:else}
              {#if car.route.some((stop) => stop.floor === floor)}
                <div class="future-stop">承诺停靠</div>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>

  <aside class="side-panel">
    <h3>电梯路线</h3>
    {#each snapshot.cars as car, carIndex (car.id)}
      <div class="route-card">
        <header>
          <strong>电梯 {carIndex + 1}</strong>
          <span>{car.floor}F · {phaseLabel(car.phase)} · {carLoad(carIndex)}/{CAR_CAPACITY}</span>
        </header>
        <p>{carRequests(carIndex)}</p>
        {#if car.phaseRemaining > 0}
          <small>阶段剩余：{car.phaseRemaining} tick</small>
        {/if}
      </div>
    {/each}

    <h3>当前 tick 事件</h3>
    <ul class="tick-events">
      {#each eventsAtTick(events, currentTick) as event (event.seq)}
        <li data-type={event.type}>{event.reason}</li>
      {:else}
        <li class="muted">本 tick 无事件；状态仍来自预计算快照。</li>
      {/each}
    </ul>
  </aside>
</section>

<style>
  .simulation-layout {
    display: grid;
    grid-template-columns: minmax(560px, 1fr) 330px;
    gap: 16px;
    align-items: start;
  }
  .building {
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    background: var(--panel);
  }
  .floor-row {
    display: grid;
    grid-template-columns: 58px minmax(180px, 1fr) repeat(var(--car-count, 2), minmax(110px, 1fr));
    min-height: 70px;
    border-bottom: 1px solid var(--border);
  }
  .floor-row:last-child { border-bottom: 0; }
  .header { min-height: 36px; font-weight: 700; font-size: 13px; }
  .floor-cell {
    display: grid;
    place-items: center;
    background: var(--panel-strong);
    border-right: 1px solid var(--border);
    font-size: 14px;
  }
  .waiting-cell {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-content: center;
    padding: 8px;
    border-right: 1px solid var(--border);
  }
  .car-head, .car-cell {
    display: grid;
    place-items: center;
  }
  .car-head { border-right: 1px solid var(--border); }
  .car-cell {
    position: relative;
    border-right: 1px solid var(--border);
    padding: 6px;
  }
  .car-cell:last-child { border-right: 0; }
  .car {
    width: 92px;
    min-height: 54px;
    border: 2px solid var(--accent);
    border-radius: 8px;
    padding: 5px 8px;
    background: var(--car);
    box-shadow: inset 0 -8px 16px rgba(0,0,0,.12);
  }
  .car.open { border-color: #16a34a; background: #dcfce7; }
  .car.moving { border-color: #ea580c; }
  .car-top { display: flex; justify-content: space-between; font-size: 13px; }
  .door-state { font-size: 12px; color: var(--text-soft); }
  .load-dots { display: flex; gap: 2px; flex-wrap: wrap; margin-top: 2px; }
  .load-dots span { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); display: inline-block; }
  .waiting-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid var(--border);
    background: var(--panel-strong);
    border-radius: 999px;
    padding: 3px 7px;
    font-size: 12px;
  }
  .waiting-chip.assigned { border-color: var(--accent); }
  .waiting-chip em { font-style: normal; color: var(--text-soft); }
  .waiting-chip button {
    border: 0;
    background: #fee2e2;
    color: #991b1b;
    border-radius: 999px;
    padding: 1px 6px;
    cursor: pointer;
  }
  .future-stop {
    font-size: 12px;
    color: var(--accent);
    border: 1px dashed var(--accent);
    border-radius: 999px;
    padding: 2px 8px;
  }
  .side-panel {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px;
    background: var(--panel);
  }
  .side-panel h3 { margin: 4px 0 8px; font-size: 15px; }
  .route-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px;
    margin-bottom: 8px;
    background: var(--panel-strong);
  }
  .route-card header { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
  .route-card p { margin: 5px 0; font-size: 12px; word-break: break-word; }
  .route-card small { color: var(--text-soft); }
  .tick-events { padding-left: 18px; margin: 0; max-height: 280px; overflow: auto; }
  .tick-events li { font-size: 12px; margin: 4px 0; }
  .muted { color: var(--text-soft); }
  @media (max-width: 980px) {
    .simulation-layout { grid-template-columns: 1fr; }
  }
</style>
