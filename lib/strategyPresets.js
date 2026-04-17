/**
 * Strategy rules — uses tape fields only (REQ-KIN-04 effective fields via snapshot).
 */

import { tierRank } from './backtestEngine.js';

export function effectiveQuadFromSignal(s) {
  if (!s) return null;
  return s.isFiltered ? (s.smoothQuad ?? s.quad) : s.quad;
}

/**
 * Default: trend-follow with reversal-tier exit; entries gated by continuation × reversal.
 */
export function defaultStrategy(ctx) {
  const { signal, position } = ctx;
  if (!signal) return {};

  const rev = signal.reversalTier ?? 'NONE';
  const trendT = signal.trendTier ?? 'NONE';
  const tDir = signal.trendDirection;
  const tMode = signal.trendMode;

  if (position) {
    const r = tierRank(rev);
    if (r >= 2) return { exit: true };
    return {};
  }

  if (trendT !== 'HIGH') return {};
  if (!['NONE', 'LOW'].includes(rev)) return {};

  const eq = effectiveQuadFromSignal(signal);
  if (eq !== 2 && eq !== 4) return {};

  if (tDir === 'bullish' || tMode === 'bullish') {
    return { entry: { side: 'long' } };
  }
  if (tDir === 'bearish' || tMode === 'bearish') {
    return { entry: { side: 'short' } };
  }

  return {};
}

/**
 * Mean reversion sketch: high reversal, low trend — optional second preset.
 */
export function meanReversionStrategy(ctx) {
  const { signal, position } = ctx;
  if (!signal) return {};

  const rev = signal.reversalTier ?? 'NONE';
  const trendT = signal.trendTier ?? 'NONE';

  if (position) {
    if (tierRank(rev) < 2 && trendT === 'HIGH') return { exit: true };
    return {};
  }

  if (trendT !== 'LOW' && trendT !== 'NONE') return {};
  if (rev !== 'HIGH') return {};

  const dir = signal.reversalDirection;
  if (dir === 'bearish') return { entry: { side: 'short' } };
  if (dir === 'bullish') return { entry: { side: 'long' } };
  return {};
}

export function buildStrategy(name) {
  if (name === 'meanReversion') return meanReversionStrategy;
  return defaultStrategy;
}
