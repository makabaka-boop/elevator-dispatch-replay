import type { RequestInput } from './types';

export const defaultRequests: RequestInput[] = [
  { arrivalTick: 0, originFloor: 1, destinationFloor: 8, people: 4 },
  { arrivalTick: 0, originFloor: 1, destinationFloor: 5, people: 3 },
  { arrivalTick: 1, originFloor: 1, destinationFloor: 10, people: 6 },
  { arrivalTick: 3, originFloor: 6, destinationFloor: 1, people: 2 },
  { arrivalTick: 5, originFloor: 9, destinationFloor: 2, people: 6, cancelTick: 20 },
  { arrivalTick: 8, originFloor: 3, destinationFloor: 12, people: 2 }
];

export function emptyRequest(nextId: number): RequestInput {
  return {
    id: `R${String(nextId).padStart(3, '0')}`,
    arrivalTick: 0,
    originFloor: 1,
    destinationFloor: 2,
    people: 1
  };
}

export function requestLabel(request: RequestInput): string {
  return request.id ?? '未命名请求';
}
