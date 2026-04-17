/**
 * Pure backtest engine — no feed imports (no PHASES).
 * Next-bar-open execution: decision at bar i close → fill at bar i+1 open.
 */

export const ES_TICK = 0.25;

export function avgRange(bars, end, lookback = 5) {
  const s = Math.max(0, end - lookback + 1);
  let sum = 0;
  let n = 0;
  for (let j = s; j <= end; j++) {
    if (!bars[j]) continue;
    sum += bars[j].h - bars[j].l;
    n++;
  }
  return n > 0 ? sum / n : Math.max(ES_TICK, (bars[end]?.h ?? 0) - (bars[end]?.l ?? 0));
}

/** REQ-KIN-04 attribution quad */
export function entryAttributionQuad(signal) {
  if (!signal) return null;
  if (signal.isFiltered) {
    const sq = signal.smoothQuad ?? signal.quad;
    return sq ?? null;
  }
  return signal.quad ?? null;
}

function spreadFloorPx(bar, execution) {
  if (!execution.useSpreadFloor || bar == null || bar.spread == null) return 0;
  return Math.max(0, Number(bar.spread) * 0.5);
}

function slipTicksToPx(ticks) {
  return Math.max(0, ticks) * ES_TICK;
}

export function effectiveSlippagePx(bar, execution) {
  const user = slipTicksToPx(execution.slippageTicks ?? 0);
  const floor = spreadFloorPx(bar, execution);
  return Math.max(user, floor);
}

/** Map grid target to price (causal: TR-based scale). */
export function tierRank(tier) {
  return { NONE: 0, LOW: 1, MODERATE: 2, HIGH: 3 }[tier] ?? 0;
}

export function targetToPrice(entryPrice, entryCoord, targetCoord, bars, barIdx) {
  if (!targetCoord || !entryCoord || entryCoord.x == null || entryCoord.y == null) return null;
  const tr = avgRange(bars, barIdx);
  const k = tr / 10;
  const dy = (targetCoord.y - entryCoord.y) * k;
  const dx = (targetCoord.x - entryCoord.x) * k * 0.35;
  return entryPrice + dy + dx;
}

/**
 * @param {object} params
 * @param {Array<object>} params.bars
 * @param {Array<object>} params.signals
 * @param {object} params.execution
 * @param {function} params.strategy - (ctx) => { entry?: { side }, exit?: boolean }
 */
export function runBacktest({ bars, signals, execution, strategy }) {
  const n = Math.min(bars.length, signals.length);
  const initial = execution.initialBalance ?? 10000;
  let balance = initial;
  /** @type {{ barIndex: number, equity: number }[]} */
  const equityCurve = [];
  const trades = [];
  const markers = [];
  const quadrantStats = {};
  for (let q = 1; q <= 4; q++) {
    quadrantStats[q] = { wins: 0, losses: 0, count: 0 };
  }

  let position = null;
  /** @type {{ side: string, decisionSignal: object, decisionIndex: number } | null} */
  let pendingEntry = null;
  let pendingExit = false;

  const warmup = Math.max(5, execution.warmupBars ?? 5);

  const pushEquity = (barIdx, equity) => {
    equityCurve.push({ barIndex: barIdx, equity });
  };

  const closePositionAtOpen = (barIdx) => {
    const bar = bars[barIdx];
    if (!position || !bar) return;
    const slip = effectiveSlippagePx(bar, execution);
    const px =
      position.side === 'long' ? bar.o - slip : bar.o + slip;
    const gross =
      position.side === 'long' ? px - position.entryPrice : position.entryPrice - px;
    const comm = (execution.commissionPerSide ?? 0) * 2;
    const pnl = gross - comm;
    balance += pnl;
    trades.push({
      side: position.side,
      entryIndex: position.entryIndex,
      exitIndex: barIdx,
      entryPrice: position.entryPrice,
      exitPrice: px,
      pnl,
      entryQuad: position.entryQuad,
    });
    const eq = entryAttributionQuad(signals[position.decisionIndex]);
    if (eq >= 1 && eq <= 4) {
      const row = quadrantStats[eq];
      row.count++;
      if (pnl > 0) row.wins++;
      else if (pnl < 0) row.losses++;
    }
    markers.push({ barIndex: barIdx, kind: 'exit', side: position.side, price: px });
    position = null;
  };

  const openPositionAtOpen = (barIdx) => {
    const bar = bars[barIdx];
    if (!pendingEntry || !bar || position) return;
    const slip = effectiveSlippagePx(bar, execution);
    const px =
      pendingEntry.side === 'long' ? bar.o + slip : bar.o - slip;
    balance -= execution.commissionPerSide ?? 0;
    const sig = pendingEntry.decisionSignal;
    const ec =
      sig?.effectiveCoord ||
      (sig?.isFiltered ? sig?.smoothCoord : sig?.coord) ||
      sig?.coord;
    const tp =
      sig?.reversalTarget && ec
        ? targetToPrice(px, ec, sig.reversalTarget, bars, barIdx)
        : null;
    const atr = avgRange(bars, barIdx);
    const sl =
      pendingEntry.side === 'long' ? px - atr * 1.25 : px + atr * 1.25;
    const entryQuad = entryAttributionQuad(sig);
    position = {
      side: pendingEntry.side,
      entryPrice: px,
      entryIndex: barIdx,
      decisionIndex: pendingEntry.decisionIndex,
      tpPrice: tp,
      slPrice: sl,
      entryQuad,
    };
    markers.push({ barIndex: barIdx, kind: 'entry', side: pendingEntry.side, price: px });
    pendingEntry = null;
  };

  for (let i = 0; i < n; i++) {
    const bar = bars[i];

    if (pendingExit && position) {
      closePositionAtOpen(i);
      pendingExit = false;
    }

    if (pendingEntry && !position) {
      openPositionAtOpen(i);
    }

    let mtm = balance;
    if (position) {
      const c = bar.c;
      const unreal =
        position.side === 'long'
          ? c - position.entryPrice
          : position.entryPrice - c;
      mtm = balance + unreal;
    }
    pushEquity(i, mtm);

    if (i < n - 1 && i >= warmup - 1) {
      const ctx = {
        i,
        bar,
        signal: signals[i],
        position,
        bars,
        signals,
        execution,
      };
      const decision = strategy(ctx);

      if (position) {
        const c = bar.c;
        let tpSl = false;
        if (position.side === 'long') {
          if (position.tpPrice != null && c >= position.tpPrice) tpSl = true;
          if (position.slPrice != null && c <= position.slPrice) tpSl = true;
        } else {
          if (position.tpPrice != null && c <= position.tpPrice) tpSl = true;
          if (position.slPrice != null && c >= position.slPrice) tpSl = true;
        }
        if (tpSl || decision.exit) {
          pendingExit = true;
        }
      } else if (decision.entry && !pendingEntry) {
        pendingEntry = {
          side: decision.entry.side,
          decisionSignal: { ...signals[i] },
          decisionIndex: i,
        };
      }
    }
  }

  if (position && n > 0) {
    const last = bars[n - 1];
    const slip = effectiveSlippagePx(last, execution);
    const px = position.side === 'long' ? last.c - slip : last.c + slip;
    const gross =
      position.side === 'long' ? px - position.entryPrice : position.entryPrice - px;
    const comm = (execution.commissionPerSide ?? 0) * 2;
    const pnl = gross - comm;
    balance += pnl;
    trades.push({
      side: position.side,
      entryIndex: position.entryIndex,
      exitIndex: n - 1,
      entryPrice: position.entryPrice,
      exitPrice: px,
      pnl,
      entryQuad: position.entryQuad,
    });
    const eq = entryAttributionQuad(signals[position.decisionIndex]);
    if (eq >= 1 && eq <= 4) {
      const row = quadrantStats[eq];
      row.count++;
      if (pnl > 0) row.wins++;
      else if (pnl < 0) row.losses++;
    }
    markers.push({ barIndex: n - 1, kind: 'exit', side: position.side, price: px });
  }

  const totalReturn = initial > 0 ? ((balance - initial) / initial) * 100 : 0;
  let peak = initial;
  let maxDd = 0;
  for (const pt of equityCurve) {
    if (pt.equity > peak) peak = pt.equity;
    const dd = peak > 0 ? ((peak - pt.equity) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }
  const wins = trades.filter(t => t.pnl > 0).length;
  const grossProfit = trades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  return {
    trades,
    equityCurve,
    markers,
    quadrantStats,
    metrics: {
      finalBalance: balance,
      totalReturnPct: totalReturn,
      maxDrawdownPct: maxDd,
      tradeCount: trades.length,
      winRate: trades.length ? wins / trades.length : 0,
      profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
      avgTradePnl: trades.length ? trades.reduce((a, t) => a + t.pnl, 0) / trades.length : 0,
    },
  };
}
