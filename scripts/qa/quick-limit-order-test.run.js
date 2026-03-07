async (page) => {
  const assert = (cond, message) => {
    if (!cond) throw new Error(message);
  };

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    const { runQuickLimitQa } = await import('/src/qa/quickLimitQa.ts');
    return await runQuickLimitQa();
  });

  const approxEqual = (a, b, epsilon = 1e-9) => Math.abs(a - b) <= epsilon;

  assert(
    result.cancel.walletAfterPlace < result.cancel.walletBeforeCancel,
    `Expected wallet balance to decrease on open limit placement, got ${result.cancel.walletBeforeCancel} -> ${result.cancel.walletAfterPlace}`
  );
  assert(
    approxEqual(result.cancel.walletAfterCancel, result.cancel.walletBeforeCancel, 1e-6),
    `Expected cancel refund to restore wallet balance, got ${result.cancel.walletBeforeCancel} vs ${result.cancel.walletAfterCancel}`
  );
  assert(
    result.cancel.executionsAfterCancelWait === result.cancel.executionsAfterCancel,
    `Cancelled order should never trigger later, got execution count ${result.cancel.executionsAfterCancel} -> ${result.cancel.executionsAfterCancelWait}`
  );

  assert(result.buy.execution?.status === 'filled', `Expected BUY limit execution filled, got ${result.buy.execution?.status}`);
  assert(result.buy.execution?.side === 'buy', `Expected BUY limit execution side buy, got ${result.buy.execution?.side}`);
  assert(result.buy.positionQty > 0, `Expected open position after BUY fill, got qty ${result.buy.positionQty}`);
  assert(
    result.buy.execCountAfter === result.buy.execCountBefore + 1,
    `Expected exactly one BUY execution, got ${result.buy.execCountBefore} -> ${result.buy.execCountAfter}`
  );
  assert(
    result.buy.execCountStable === result.buy.execCountAfter,
    `BUY limit should not fill twice, got ${result.buy.execCountAfter} -> ${result.buy.execCountStable}`
  );

  assert(result.sell.execution?.status === 'filled', `Expected SELL limit execution filled, got ${result.sell.execution?.status}`);
  assert(result.sell.execution?.side === 'sell', `Expected SELL limit execution side sell, got ${result.sell.execution?.side}`);
  assert(
    result.sell.qtyAfterSell < result.sell.qtyBeforeSell,
    `Expected position qty to decrease after SELL fill, got ${result.sell.qtyBeforeSell} -> ${result.sell.qtyAfterSell}`
  );
  assert(
    result.sell.execCountAfter === result.sell.execCountBefore + 1,
    `Expected exactly one SELL execution, got ${result.sell.execCountBefore} -> ${result.sell.execCountAfter}`
  );
  assert(
    result.sell.execCountStable === result.sell.execCountAfter,
    `SELL limit should not fill twice, got ${result.sell.execCountAfter} -> ${result.sell.execCountStable}`
  );

  assert(result.openLimitCount === 0, `Expected no leftover open limit orders, got ${result.openLimitCount}`);

  return {
    ok: true,
    summary: {
      tokenId: result.tokenId,
      cancelRefundRestored: result.cancel.walletAfterCancel,
      buyExecCountAfter: result.buy.execCountAfter,
      sellExecCountAfter: result.sell.execCountAfter,
      finalOpenLimitCount: result.openLimitCount,
    },
  };
}
