/**
 * Heuristic parameter hints from backtest results (rule-based, not ML).
 */

export function buildRecommendations(metrics, execution, trades) {
  const out = [];

  if (metrics.tradeCount === 0) {
    out.push({
      parameter: 'warmup / feed length',
      currentValue: '—',
      suggestedRange: 'Let the feed run longer (detectors need ~20–30+ bars) or lower entry strictness in strategy.',
      reason: 'No completed trades — often warm-up or gates never satisfied.',
    });
    return out;
  }

  const avg = metrics.avgTradePnl ?? 0;
  const comm = (execution.commissionPerSide ?? 0) * 2;

  if (avg > 0 && avg < comm * 0.5) {
    out.push({
      parameter: 'commissionPerSide',
      currentValue: execution.commissionPerSide,
      suggestedRange: `Try < ${(avg / 2).toFixed(2)} per side if you model micro commissions.`,
      reason: 'Average win is smaller than round-trip commission — results are fee-dominated.',
    });
  }

  if (metrics.totalReturnPct > 0 && metrics.maxDrawdownPct > 35) {
    out.push({
      parameter: 'riskFractionPerTrade',
      currentValue: execution.riskFractionPerTrade,
      suggestedRange: 'Reduce size of line risk (when position sizing is wired) or tighten stops.',
      reason: 'High max drawdown relative to return — path risk is large.',
    });
  }

  if (execution.slippageTicks < 1 && metrics.winRate > 0.55 && metrics.totalReturnPct < 0) {
    out.push({
      parameter: 'slippageTicks',
      currentValue: execution.slippageTicks,
      suggestedRange: '1–3 ticks',
      reason: 'High win rate but negative return — friction model may be too optimistic.',
    });
  }

  if (execution.useSpreadFloor === false) {
    out.push({
      parameter: 'useSpreadFloor',
      currentValue: false,
      suggestedRange: 'true',
      reason: 'REQ-FEED-02 spread is part of the feed; enabling the floor aligns fills with microstructure.',
    });
  }

  return out;
}
