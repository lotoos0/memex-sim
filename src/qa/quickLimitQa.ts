import { useTokenStore } from '../store/tokenStore';
import { useTradingStore } from '../store/tradingStore';
import { useWalletStore } from '../store/walletStore';
import { registry } from '../tokens/registry';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const BUY_TEST_AMOUNT_SOL = 0.1;
const SELL_TEST_AMOUNT_SOL = 0.03;
const TEST_SLIPPAGE_PCT = 5;
const TEST_SLIPPAGE_BPS = TEST_SLIPPAGE_PCT * 100;
const TEST_PRIORITY_SOL = 0.001;

async function waitFor<T>(predicate: () => T | null | false, timeoutMs: number, label: string): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export async function runQuickLimitQa() {
  const tokenId = await waitFor(() => {
    const tokenState = useTokenStore.getState();
    const rows = Object.values(tokenState.tokensById);
    const ranked = rows
      .filter((row) => Number.isFinite(row.lastPriceUsd) && row.lastPriceUsd > 0)
      .filter((row) => Number.isFinite(row.mcapUsd) && row.mcapUsd >= 20_000)
      .filter((row) => Number.isFinite(row.liquidityUsd) && row.liquidityUsd >= 3_000)
      .filter((row) => Number.isFinite(row.vol5mUsd) && row.vol5mUsd >= 1_000)
      .filter((row) => row.phase !== 'DEAD' && row.phase !== 'RUGGED')
      .filter((row) => {
        const market = tokenState.marketByTokenId[row.id];
        const flow = tokenState.tradeFlowByTokenId[row.id];
        return Boolean(
          market &&
          Number.isFinite(market.updatedAtMs) &&
          market.updatedAtMs > 0 &&
          flow &&
          flow.tx60s >= 4
        );
      })
      .filter((row) => registry.quoteTrade(row.id, 'BUY', BUY_TEST_AMOUNT_SOL, TEST_SLIPPAGE_BPS).ok)
      .sort((a, b) => {
        const phaseScore = (phase: typeof a.phase) => {
          if (phase === 'MIGRATED') return 3;
          if (phase === 'FINAL') return 2;
          if (phase === 'NEW') return 1;
          return 0;
        };
        return (
          phaseScore(b.phase) - phaseScore(a.phase) ||
          b.liquidityUsd - a.liquidityUsd ||
          b.vol5mUsd - a.vol5mUsd ||
          b.mcapUsd - a.mcapUsd
        );
      });
    const token = ranked[0];
    return token?.id ?? null;
  }, 8000, 'token runtime');

  const getLastPriceUsd = () => useTokenStore.getState().tokensById[tokenId]?.lastPriceUsd ?? 0;
  const getWalletSol = () => useWalletStore.getState().solBalance;
  const getLimitOrders = () => Object.values(useTradingStore.getState().quickLimitOrdersById).filter((row) => row.tokenId === tokenId);
  const getExecutions = () => useTradingStore.getState().quickExecutionHistoryByTokenId[tokenId] ?? [];
  const getPosition = () => useTradingStore.getState().quickPositionsByTokenId[tokenId] ?? null;

  await waitFor(() => Number.isFinite(getLastPriceUsd()) && getLastPriceUsd() > 0 ? true : null, 4000, 'token price');
  const initialMarketUpdatedAtMs = useTokenStore.getState().marketByTokenId[tokenId]?.updatedAtMs ?? 0;
  await waitFor(() => {
    const market = useTokenStore.getState().marketByTokenId[tokenId];
    return market && market.updatedAtMs > initialMarketUpdatedAtMs ? true : null;
  }, 4000, 'fresh token market snapshot');

  const walletBeforeCancel = getWalletSol();
  const farBelowPrice = getLastPriceUsd() * 0.2;
  const cancelPlace = useTradingStore.getState().placeQuickLimitOrder(tokenId, 'buy', 0.05, farBelowPrice, {
    slippagePct: TEST_SLIPPAGE_PCT,
    prioritySol: TEST_PRIORITY_SOL,
    bribeSol: 0,
  });
  if (!cancelPlace.ok || !cancelPlace.orderId) {
    throw new Error(`Expected cancellable BUY limit placement to succeed, got ${JSON.stringify(cancelPlace)}`);
  }
  const cancelOrderId = cancelPlace.orderId;

  const walletAfterPlace = getWalletSol();
  const cancelOrderOpen = await waitFor(
    () => useTradingStore.getState().quickLimitOrdersById[cancelOrderId] ?? null,
    2000,
    'open cancel-order'
  );
  const cancelled = useTradingStore.getState().cancelQuickLimitOrder(cancelOrderId);
  if (!cancelled) throw new Error('Expected cancelQuickLimitOrder to return true');
  await waitFor(
    () => !useTradingStore.getState().quickLimitOrdersById[cancelOrderId] ? true : null,
    2000,
    'cancel order removal'
  );
  const walletAfterCancel = getWalletSol();
  const executionsAfterCancel = getExecutions().length;
  await sleep(1800);
  const executionsAfterCancelWait = getExecutions().length;

  const buyExecCountBefore = getExecutions().length;
  const triggerBuyPrice = getLastPriceUsd() * 1.2;
  const buyLimit = useTradingStore.getState().placeQuickLimitOrder(tokenId, 'buy', BUY_TEST_AMOUNT_SOL, triggerBuyPrice, {
    slippagePct: TEST_SLIPPAGE_PCT,
    prioritySol: TEST_PRIORITY_SOL,
    bribeSol: 0,
  });
  if (!buyLimit.ok || !buyLimit.orderId) {
    throw new Error(`Expected BUY trigger limit placement to succeed, got ${JSON.stringify(buyLimit)}`);
  }
  const buyLimitOrderId = buyLimit.orderId;

  const buyFilled = await waitFor(() => {
    const history = getExecutions();
    if (history.length <= buyExecCountBefore) return null;
    const nextRows = history.slice(buyExecCountBefore);
    const failed = nextRows.find((row) => row.side === 'buy' && row.status === 'failed');
    if (failed) {
      throw new Error(`BUY limit execution failed: ${failed.reason ?? 'unknown reason'}`);
    }
    return nextRows.find((row) => row.side === 'buy' && row.status === 'filled') ?? null;
  }, 8000, 'buy limit fill');
  await waitFor(
    () => !useTradingStore.getState().quickLimitOrdersById[buyLimitOrderId] ? true : null,
    2000,
    'buy limit removal after trigger'
  );
  const buyPosition = await waitFor(() => {
    const pos = getPosition();
    return pos && pos.qty > 0 ? pos : null;
  }, 3000, 'position after buy fill');
  const buyExecCountAfter = getExecutions().length;
  const buyExecCountStable = getExecutions().length;
  const postBuyState = await waitFor(() => {
    const price = getLastPriceUsd();
    const pos = getPosition();
    return Number.isFinite(price) && price > 0 && pos && pos.qty > 0
      ? { priceUsd: price, qty: pos.qty }
      : null;
  }, 3000, 'post-buy state stabilization');

  const sellExecCountBefore = getExecutions().length;
  const qtyBeforeSell = postBuyState.qty;
  const triggerSellPrice = postBuyState.priceUsd * 0.5;
  const sellLimit = useTradingStore.getState().placeQuickLimitOrder(tokenId, 'sell', SELL_TEST_AMOUNT_SOL, triggerSellPrice, {
    slippagePct: TEST_SLIPPAGE_PCT,
    prioritySol: TEST_PRIORITY_SOL,
    bribeSol: 0,
  });
  if (!sellLimit.ok || !sellLimit.orderId) {
    throw new Error(`Expected SELL trigger limit placement to succeed, got ${JSON.stringify(sellLimit)}`);
  }
  const sellLimitOrderId = sellLimit.orderId;

  const sellFilled = await waitFor(() => {
    const history = getExecutions();
    if (history.length <= sellExecCountBefore) return null;
    const nextRows = history.slice(sellExecCountBefore);
    const failed = nextRows.find((row) => row.side === 'sell' && row.status === 'failed');
    if (failed) {
      throw new Error(`SELL limit execution failed: ${failed.reason ?? 'unknown reason'}`);
    }
    return nextRows.find((row) => row.side === 'sell' && row.status === 'filled') ?? null;
  }, 8000, 'sell limit fill');
  await waitFor(
    () => !useTradingStore.getState().quickLimitOrdersById[sellLimitOrderId] ? true : null,
    2000,
    'sell limit removal after trigger'
  );
  const qtyAfterSell = await waitFor(() => {
    const pos = getPosition();
    if (!pos) return 0;
    return pos.qty < qtyBeforeSell ? pos.qty : null;
  }, 3000, 'position decrease after sell fill');
  const sellExecCountAfter = getExecutions().length;
  await sleep(1500);
  const sellExecCountStable = getExecutions().length;

  return {
    tokenId,
    cancel: {
      orderId: cancelOrderId,
      reservedSol: cancelOrderOpen.reservedSol,
      txCostSol: cancelOrderOpen.txCostSol,
      walletBeforeCancel,
      walletAfterPlace,
      walletAfterCancel,
      executionsAfterCancel,
      executionsAfterCancelWait,
    },
    buy: {
      orderId: buyLimitOrderId,
      execution: buyFilled,
      positionQty: buyPosition.qty,
      execCountBefore: buyExecCountBefore,
      execCountAfter: buyExecCountAfter,
      execCountStable: buyExecCountStable,
    },
    sell: {
      orderId: sellLimitOrderId,
      execution: sellFilled,
      qtyBeforeSell,
      qtyAfterSell,
      execCountBefore: sellExecCountBefore,
      execCountAfter: sellExecCountAfter,
      execCountStable: sellExecCountStable,
    },
    openLimitCount: getLimitOrders().length,
  };
}
