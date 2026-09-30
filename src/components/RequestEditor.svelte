<script lang="ts">
  import type { RequestInput } from '../lib/types';
  import { MAX_REQUESTS } from '../lib/engine';

  export let floors: number;
  export let requests: RequestInput[];

  function update<Key extends keyof RequestInput>(index: number, key: Key, value: RequestInput[Key]): void {
    const current = requests[index];
    if (!current) return;
    requests[index] = { ...current, [key]: value };
    requests = requests;
  }

  function updateNumber(
    index: number,
    key: 'arrivalTick' | 'originFloor' | 'destinationFloor' | 'people' | 'cancelTick',
    raw: string
  ): void {
    if (raw === '') {
      if (key === 'cancelTick') update(index, 'cancelTick', undefined);
      return;
    }
    const value = Number(raw);
    if (Number.isInteger(value)) {
      const current = requests[index];
      if (!current) return;
      requests[index] = { ...current, [key]: value };
      requests = requests;
    }
  }

  function remove(index: number) {
    requests = requests.filter((_unused, requestIndex) => requestIndex !== index);
  }
</script>

<div class="editor-head">
  <h2>请求列表</h2>
  <span>{requests.length}/{MAX_REQUESTS}</span>
</div>

<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>到达 tick</th>
        <th>出发层</th>
        <th>目的层</th>
        <th>人数</th>
        <th>取消 tick（可选）</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each requests as request, index (request.id ?? index)}
        <tr>
          <td><input value={request.id ?? ''} on:input={(event) => update(index, 'id', event.currentTarget.value)} /></td>
          <td><input type="number" min="0" value={request.arrivalTick} on:input={(event) => updateNumber(index, 'arrivalTick', event.currentTarget.value)} /></td>
          <td><input type="number" min="1" max={floors} value={request.originFloor} on:input={(event) => updateNumber(index, 'originFloor', event.currentTarget.value)} /></td>
          <td><input type="number" min="1" max={floors} value={request.destinationFloor} on:input={(event) => updateNumber(index, 'destinationFloor', event.currentTarget.value)} /></td>
          <td><input type="number" min="1" max="100" value={request.people} on:input={(event) => updateNumber(index, 'people', event.currentTarget.value)} /></td>
          <td>
            <input
              type="number"
              min={request.arrivalTick}
              placeholder="不取消"
              value={request.cancelTick ?? ''}
              on:input={(event) => updateNumber(index, 'cancelTick', event.currentTarget.value)}
            />
          </td>
          <td><button type="button" class="danger" on:click={() => remove(index)}>删除</button></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .editor-head { display: flex; align-items: center; justify-content: space-between; }
  .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; background: var(--panel); }
  th, td { padding: 6px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
  tr:last-child td { border-bottom: 0; }
  input { width: 118px; }
  .danger { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
</style>
