import { get, set } from 'idb-keyval';
import type { Order, Trade } from '../store/tradingStore';
import type { PositionHistory } from '../store/tradingStore';

const K_ORDERS = 'orders';
const K_TRADES = 'trades';
const K_POSHIS = 'positionHistory';

export async function persistOrder(o: Order) {
  const arr: Order[] = (await get(K_ORDERS)) ?? [];
  arr.push(o);
  await set(K_ORDERS, arr.slice(-2000));
}
export async function persistTrade(t: Trade) {
  const arr: Trade[] = (await get(K_TRADES)) ?? [];
  arr.push(t);
  await set(K_TRADES, arr.slice(-2000));
}

export async function saveOrdersSnapshot(arr: Order[]) {
  await set(K_ORDERS, arr.slice(-2000));
}
export async function saveTradesSnapshot(arr: Trade[]) {
  await set(K_TRADES, arr.slice(-2000));
}
export async function savePositionHistorySnapshot(arr: PositionHistory[]) {
  await set(K_POSHIS, arr.slice(-2000));
}

export async function loadSnapshots(): Promise<{
  orders: Order[]; trades: Trade[]; positionHistory: PositionHistory[];
}> {
  const [orders, trades, positionHistory] = await Promise.all([
    get(K_ORDERS), get(K_TRADES), get(K_POSHIS)
  ]);
  return {
    orders: (orders ?? []) as Order[],
    trades: (trades ?? []) as Trade[],
    positionHistory: (positionHistory ?? []) as PositionHistory[],
  };
}
export async function clearAllSnapshots() {
  await Promise.all([set(K_ORDERS, []), set(K_TRADES, []), set(K_POSHIS, [])]);
}
