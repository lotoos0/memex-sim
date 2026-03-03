async (page) => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (cond, message) => {
    if (!cond) throw new Error(message);
  };

  await page.goto('http://127.0.0.1:5173/');
  await page.waitForTimeout(1200);

  const result = await page.evaluate(async () => {
    const { TokenSim } = await import('/src/tokens/tokenSim.ts');
    const { generateToken } = await import('/src/tokens/generator.ts');
    const { RNG } = await import('/src/engine/rng.ts');
    const { MCAP_FLOOR_USD, SUPPLY } = await import('/src/tokens/types.ts');

    const rng = new RNG(1337);
    const meta = generateToken(rng, 0);
    const startMcapUsd = MCAP_FLOOR_USD + 25_000;
    const sim = new TokenSim(meta, startMcapUsd, 60_000);
    const testSim = sim;

    testSim.baseLambda = 0;
    testSim.attention = 0.12;
    testSim.emittedInitialDevBuy = true;
    testSim.devEventsUsed = 999;
    testSim.fateTimeoutSimMs = 0;

    testSim.lastMcapUsd = MCAP_FLOOR_USD + 1;
    testSim.lastPriceUsd = (MCAP_FLOOR_USD + 1) / SUPPLY;
    await new Promise((r) => setTimeout(r, 120));
    sim.tick(0.2, 'OFF');
    const phaseAboveFloor = sim.getRuntime().phase;

    const candlesBeforeIdle = sim.getCandles(1, 'mcap').length;
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 120));
      sim.tick(0.2, 'OFF');
    }
    const candlesAfterIdle = sim.getCandles(1, 'mcap').length;

    testSim.lastMcapUsd = MCAP_FLOOR_USD;
    testSim.lastPriceUsd = MCAP_FLOOR_USD / SUPPLY;
    await new Promise((r) => setTimeout(r, 120));
    sim.tick(0.2, 'OFF');
    const runtimeDead = sim.getRuntime();

    const tradesBeforeBuy = sim.getMarketSnapshot(10, 200).recentTrades.length;
    const submit = sim.submitUserTrade({
      side: 'BUY',
      amountIn: 0.05,
      slippageBps: 100,
      latencyMs: 80,
    });
    await new Promise((r) => setTimeout(r, 120));
    sim.tick(0.2, 'OFF');
    const executions = sim.drainUserTradeExecutions();
    const tradesAfterBuy = sim.getMarketSnapshot(10, 200).recentTrades.length;

    return {
      floor: MCAP_FLOOR_USD,
      phaseAboveFloor,
      candlesBeforeIdle,
      candlesAfterIdle,
      runtimeDead,
      submitOk: submit.ok,
      executions,
      tradesBeforeBuy,
      tradesAfterBuy,
    };
  });

  assert(result.phaseAboveFloor !== 'DEAD', `Expected phase above floor != DEAD, got ${result.phaseAboveFloor}`);
  assert(
    result.candlesAfterIdle === result.candlesBeforeIdle,
    `Expected no new candles without trades, got ${result.candlesBeforeIdle} -> ${result.candlesAfterIdle}`
  );
  assert(result.runtimeDead.phase === 'DEAD', `Expected phase DEAD at floor, got ${result.runtimeDead.phase}`);
  assert(
    Math.abs(result.runtimeDead.mcapUsd - result.floor) < 1e-6,
    `Expected mcap at floor ${result.floor}, got ${result.runtimeDead.mcapUsd}`
  );
  assert(result.submitOk === true, 'Expected BUY submit on DEAD to be accepted');

  const filledBuy = (result.executions || []).find(
    (ex) => ex && ex.status === 'FILLED' && ex.side === 'BUY'
  );
  assert(Boolean(filledBuy), 'Expected BUY execution FILLED after DEAD');
  assert(
    result.tradesAfterBuy > result.tradesBeforeBuy,
    `Expected trade tape growth after BUY, got ${result.tradesBeforeBuy} -> ${result.tradesAfterBuy}`
  );

  return {
    ok: true,
    summary: {
      floor: result.floor,
      phaseAboveFloor: result.phaseAboveFloor,
      deadPhase: result.runtimeDead.phase,
      deadMcap: result.runtimeDead.mcapUsd,
      candlesBeforeIdle: result.candlesBeforeIdle,
      candlesAfterIdle: result.candlesAfterIdle,
      tradesBeforeBuy: result.tradesBeforeBuy,
      tradesAfterBuy: result.tradesAfterBuy,
    },
  };
}
