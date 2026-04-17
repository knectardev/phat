import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Play, Pause, Rewind, Gauge, Activity, Zap, Target, TrendingUp, TrendingDown, Minus, CircleDot, Radio, Layers, Waves, Clock } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
//  VWC DYNAMIC MATRIX — Real-Time Geometric Pattern Recognizer
// ═══════════════════════════════════════════════════════════════

// ───── CONFIG ─────
const LOOKBACK = 100;            // percentile window (default; overridden per timeframe)
const VIEW_CANDLES = 32;         // how many candles visible in chart
const GRID = 10;

// ───── TIMEFRAME PROFILES ─────
// The matrix geometry is fractal but the physics are non-linear across scales.
// Each timeframe gets its own interpretive weights reflecting the underlying regime:
//   1m: Microstructure noise · OBI-dominant · heavy spread penalty · low significance
//   5m: Short-term aggression · still OBI-weighted · moderate spread · low-mid significance
//  15m: Session rhythm · balanced weighting · small spread
//   1h: Intraday trend · divergence-weighted · minimal spread · high significance
//   1d: Macroeconomic equilibrium · Fat Reversal-dominant · zero spread · regime shifts
//
// Core insight: A "10,10" on 1m is noise; on 1d it's a structural event. We model this
// via `significanceMultiplier` applied to the final reversal score, combined with
// law-specific reweighting.
const TIMEFRAME_PROFILES = {
  '1m': {
    label: '1-Minute',
    short: '1m',
    context: 'Microstructure',
    contextTag: 'noise-dominant · OBI rules',
    lookback: 200,                    // large N to filter noise
    spreadPenalty: 0.18,              // spread eats 18% of body signal
    bookHalfLife: 3,                  // OBI trust decays fast (spoofing risk)
    significanceMultiplier: 0.72,     // raw signals get discounted — they're often scouts
    inertiaFactor: 0.0,               // no inertia bonus — path is erratic
    lawWeights: {                     // weight each reversal law contribution
      Fat: 0.85,
      Vacuum: 1.15,
      Curvature: 0.75,                // curvature is noise-prone at 1m
      Divergence: 0.80,
      Liquidity: 1.40,                // OBI is the primary signal at 1m
    },
    candleIntervalMs: 700,
    accent: '#5fa8a8',                // cyan — fast, reactive
  },
  '5m': {
    label: '5-Minute',
    short: '5m',
    context: 'Tactical',
    contextTag: 'session rhythm · blended',
    lookback: 150,
    spreadPenalty: 0.09,
    bookHalfLife: 8,
    significanceMultiplier: 0.82,
    inertiaFactor: 0.08,
    lawWeights: {
      Fat: 0.95,
      Vacuum: 1.05,
      Curvature: 0.90,
      Divergence: 0.95,
      Liquidity: 1.20,
    },
    candleIntervalMs: 900,
    accent: '#8ab0c0',
  },
  '15m': {
    label: '15-Minute',
    short: '15m',
    context: 'Balanced',
    contextTag: 'equal weighting',
    lookback: 100,
    spreadPenalty: 0.04,
    bookHalfLife: 15,
    significanceMultiplier: 0.95,
    inertiaFactor: 0.15,
    lawWeights: {
      Fat: 1.0,
      Vacuum: 1.0,
      Curvature: 1.0,
      Divergence: 1.0,
      Liquidity: 1.0,
    },
    candleIntervalMs: 1100,
    accent: '#d4a84b',
  },
  '1h': {
    label: '1-Hour',
    short: '1h',
    context: 'Directional',
    contextTag: 'trend regime · divergence rules',
    lookback: 60,
    spreadPenalty: 0.015,
    bookHalfLife: 30,
    significanceMultiplier: 1.10,     // signals more trustworthy
    inertiaFactor: 0.28,
    lawWeights: {
      Fat: 1.20,
      Vacuum: 0.85,                   // vacuum rare at 1h
      Curvature: 1.25,
      Divergence: 1.30,
      Liquidity: 0.75,                // OBI less relevant — macro absorbs it
    },
    candleIntervalMs: 1300,
    accent: '#c4a676',
  },
  '1d': {
    label: '1-Day',
    short: '1d',
    context: 'Equilibrium',
    contextTag: 'regime shift · structural',
    lookback: 20,                     // small N — daily spikes are almost always real
    spreadPenalty: 0.0,               // spread negligible vs daily range
    bookHalfLife: 80,
    significanceMultiplier: 1.35,     // amplified — daily signals are armies, not scouts
    inertiaFactor: 0.45,              // heavy inertia — daily trends resist change
    lawWeights: {
      Fat: 1.50,                      // the squat is the canonical daily reversal
      Vacuum: 0.50,                   // vacuum gaps get "filled" at daily scale
      Curvature: 1.40,                // parabolic blow-offs are textbook on daily
      Divergence: 1.45,
      Liquidity: 0.45,                // live OBI means little — Volume Profile matters
    },
    candleIntervalMs: 1800,
    accent: '#b8846c',                // warm brown — slow, massive
  },
};

// ───── SCRIPTED CYCLE ─────
// Each phase biases the generator. duration = candles in this phase.
const PHASES = [
  {
    id: 'accumulation',
    name: 'Accumulation',
    tag: 'Q3 Apathy · Coiled Spring',
    duration: 18,
    volBias: [1, 3.5],       // low vol
    bodyBias: [0.5, 2.5],    // tiny bodies
    directionProb: 0.5,      // 50/50 random
    quadTarget: 3,
    bookBias: 0.25,          // quietly bid-heavy (smart money building)
  },
  {
    id: 'ignition',
    name: 'Ignition',
    tag: 'Q3 → Q2 · Coiled spring releases',
    duration: 4,
    volBias: [4, 7],
    bodyBias: [4, 7],
    directionProb: 0.82,     // strongly bullish
    quadTarget: 2,
    bookBias: 0.55,          // book leans hard bid
  },
  {
    id: 'bullrun',
    name: 'Bull Run',
    tag: 'Q2 Engine · Value Migration',
    duration: 20,
    volBias: [5, 8.5],
    bodyBias: [5.5, 9],
    directionProb: 0.80,
    quadTarget: 2,
    bookBias: 0.45,          // sustained bid dominance
  },
  {
    id: 'thinning',
    name: 'Thinning',
    tag: 'Q2 → Q1 · Momentum outpacing fuel',
    duration: 6,
    volBias: [2, 4.5],
    bodyBias: [6, 9],
    directionProb: 0.68,
    quadTarget: 1,
    bookBias: 0.05,          // book thins out under trend — neutral
  },
  {
    id: 'climax',
    name: 'Climax',
    tag: 'Q2 → Q4 · Trend meets a wall',
    duration: 5,
    volBias: [7.5, 10],
    bodyBias: [1.5, 4],
    directionProb: 0.45,      // indecision
    quadTarget: 4,
    bookBias: -0.55,          // massive ask wall absorbs price
  },
  {
    id: 'distribution',
    name: 'Distribution',
    tag: 'Q4 Wall · Smart money exiting',
    duration: 14,
    volBias: [6.5, 9.5],
    bodyBias: [2, 4.5],
    directionProb: 0.28,      // bearish-leaning
    quadTarget: 4,
    bookBias: -0.45,          // sustained ask dominance
  },
  {
    id: 'breakdown',
    name: 'Breakdown',
    tag: 'Q4 → Q2(bear) · Reversal engine',
    duration: 12,
    volBias: [6, 9],
    bodyBias: [5, 8.5],
    directionProb: 0.15,      // heavy bearish
    quadTarget: 2,
    bookBias: -0.50,
  },
  {
    id: 'exhaustion',
    name: 'Exhaustion',
    tag: 'Q4 → Q3 · Battle is over',
    duration: 10,
    volBias: [1.5, 3.5],
    bodyBias: [1, 3],
    directionProb: 0.5,
    quadTarget: 3,
    bookBias: 0.0,            // balanced / empty
  },
];

// Quadrant metadata
const QUAD_META = {
  1: { name: 'Vacuum',  tag: 'Liquidity Gap / Stop Run',    color: '#5fa8a8' },
  2: { name: 'Engine',  tag: 'Value Migration',             color: '#6ba368' },
  3: { name: 'Apathy',  tag: 'Coiled Spring',               color: '#8a8374' },
  4: { name: 'Wall',    tag: 'Absorption / Distribution',   color: '#c75c5c' },
};

// Vector naming
const VECTOR_NAMES = {
  '3-1': { name: 'Fake-out',      severity: 'warn'   },
  '1-2': { name: 'Confirmation',  severity: 'go'     },
  '2-4': { name: 'Climax',        severity: 'alert'  },
  '4-3': { name: 'Exhaustion',    severity: 'cool'   },
  '3-2': { name: 'Ignition',      severity: 'go'     },
  '2-1': { name: 'Thinning',      severity: 'warn'   },
  '3-4': { name: 'Compression',   severity: 'warn'   },
  '1-3': { name: 'Fade',          severity: 'cool'   },
  '4-2': { name: 'Rebound',       severity: 'go'     },
  '4-1': { name: 'Squeeze',       severity: 'alert'  },
  '2-3': { name: 'Cooling',       severity: 'cool'   },
  '1-4': { name: 'Inversion',     severity: 'alert'  },
};

// Cell-level taxonomy blurbs (sampled, parameterized by coordinate)
function cellTaxonomy(x, y, quad) {
  const meta = QUAD_META[quad];
  const volStr = x <= 3 ? 'anemic' : x <= 5 ? 'light' : x <= 7 ? 'elevated' : x <= 9 ? 'heavy' : 'climactic';
  const bodyStr = y <= 3 ? 'stagnant' : y <= 5 ? 'modest' : y <= 7 ? 'robust' : y <= 9 ? 'expansive' : 'maximal';
  let edge = '';
  if (quad === 1 && y >= 8 && x <= 2) edge = 'Pure void — maximum dislocation. Snap-back risk highest here.';
  if (quad === 2 && x >= 8 && y >= 8) edge = 'The purest engine. Institutional flow in perfect alignment with discovery.';
  if (quad === 3 && x <= 2 && y <= 2) edge = 'Dead center of apathy. Spring wound tight. Watch the next bar.';
  if (quad === 4 && x >= 9 && y <= 2) edge = 'The canonical squat. Massive effort fully absorbed. Reversal birthplace.';
  return {
    headline: `${meta.name} · [${x}, ${y}]`,
    body: `${volStr.charAt(0).toUpperCase() + volStr.slice(1)} volume, ${bodyStr} body. ${meta.tag}.`,
    edge,
  };
}

// ═══════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════

function quadrantOf(x, y) {
  const hiVol = x >= 6, hiBody = y >= 6;
  if (!hiVol && hiBody)  return 1;
  if (hiVol && hiBody)   return 2;
  if (!hiVol && !hiBody) return 3;
  return 4;
}

function percentileRank(arr, val) {
  if (arr.length === 0) return 0.5;
  let below = 0;
  for (const v of arr) if (v < val) below++;
  return below / arr.length;
}

function pctToBucket(p) {
  // map 0..1 → 1..10
  return Math.max(1, Math.min(10, Math.ceil(p * 10) || 1));
}

// ─── Order Book Generator ─────────────────────────────────────
// Synthetic Level 2 book: 20 levels each side of midprice, tick = 0.25 (MES-like).
// bookBias in [-1, +1] skews the resting size distribution.
// +1 = extreme bid dominance (walls below), -1 = extreme ask dominance (walls above).
// We also occasionally inject "iceberg walls" during distribution/climax phases to
// visualize absorption.
const BOOK_DEPTH = 20;        // levels per side
const TICK = 0.25;

function generateBook(midPrice, bookBias, phaseId) {
  const bids = [];  // [{ price, size }] below mid, index 0 = closest
  const asks = [];  // above mid

  // Base size per level decays with distance from mid (liquidity thins at extremes)
  // Book bias shifts weight between sides; positive → more bids.
  const baseAvg = 180;
  for (let i = 0; i < BOOK_DEPTH; i++) {
    const dist = i + 1;
    // Decay curve: closer levels have more size
    const decay = Math.exp(-dist / 8);

    // Bid side (below mid)
    const bidScale = 1 + bookBias * 0.7;
    const bidNoise = 0.6 + Math.random() * 0.8;
    let bidSize = baseAvg * decay * bidScale * bidNoise;

    // Ask side (above mid)
    const askScale = 1 - bookBias * 0.7;
    const askNoise = 0.6 + Math.random() * 0.8;
    let askSize = baseAvg * decay * askScale * askNoise;

    // Inject walls during climactic/distribution phases
    if (phaseId === 'climax' || phaseId === 'distribution') {
      // Big asks above (the wall selling into price)
      if (dist >= 2 && dist <= 6 && Math.random() < 0.35) {
        askSize *= 2.5 + Math.random() * 1.5;
      }
    }
    if (phaseId === 'accumulation' || phaseId === 'exhaustion') {
      // Hidden bids at deeper levels (absorption floor)
      if (dist >= 4 && dist <= 9 && Math.random() < 0.25) {
        bidSize *= 2.0 + Math.random() * 1.5;
      }
    }
    if (phaseId === 'breakdown') {
      // Ask wall collapses, bid wall builds below
      if (dist >= 3 && dist <= 8 && Math.random() < 0.30) {
        bidSize *= 2.2 + Math.random() * 1.3;
      }
    }

    bids.push({ price: midPrice - dist * TICK, size: Math.round(bidSize) });
    asks.push({ price: midPrice + dist * TICK, size: Math.round(askSize) });
  }

  // Order Book Imbalance: (ΣBidSize − ΣAskSize) / (ΣBidSize + ΣAskSize)
  // Only weight closest 10 levels (actionable depth).
  const closeN = 10;
  const bidTot = bids.slice(0, closeN).reduce((a, b) => a + b.size, 0);
  const askTot = asks.slice(0, closeN).reduce((a, b) => a + b.size, 0);
  const obi = (bidTot - askTot) / (bidTot + askTot || 1);

  // Spread = 1 tick by default (synthetic; real books vary)
  const spread = TICK;

  return { bids, asks, obi, bidTot, askTot, spread, mid: midPrice };
}

// ─── ES/MES-style synthetic OHLC (tick grid, gaps, vol clustering, fat tails) ───
const ES_TICK = 0.25;

function roundToTick(p, tick = ES_TICK) {
  return Math.round(p / tick) * tick;
}

function randn() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function synthesizeIndexBar(prevClose, phase, timeframe, tfBodyScale, volClass, bodyClass, state) {
  const rand = (a, b) => a + Math.random() * (b - a);

  const gapProb = {
    '1m': 0.07, '5m': 0.09, '15m': 0.11, '1h': 0.14, '1d': 0.24,
  }[timeframe] ?? 0.10;
  const gapBoost = (phase.id === 'ignition' || phase.id === 'breakdown') ? 0.1 : 0;
  const gapTickSigma = {
    '1m': 2.2, '5m': 3.0, '15m': 4.0, '1h': 6.0, '1d': 14.0,
  }[timeframe] ?? 3.5;

  let open = prevClose;
  if (Math.random() < gapProb + gapBoost) {
    const ticks = Math.round(randn() * gapTickSigma + rand(-1.2, 1.2));
    const clamped = Math.max(-32, Math.min(32, ticks));
    open = roundToTick(prevClose + clamped * ES_TICK);
  } else {
    open = roundToTick(prevClose + rand(-0.5, 0.5) * ES_TICK);
  }

  const prevTR = Math.max(ES_TICK, state.lastTrueRange);
  const normScale = tfBodyScale * 9 + 0.35;
  const rangeVolSignal = Math.sqrt(Math.min(6, prevTR / normScale));
  let vf = state.volFactor * (0.84 + 0.11 * rangeVolSignal + randn() * 0.04);
  state.volFactor = Math.max(0.32, Math.min(3.4, vf));

  let absBody = (Math.pow(bodyClass / 10, 1.2) * 12 + 0.2) * tfBodyScale * state.volFactor;

  const tail = Math.random();
  if (tail < 0.028) absBody *= 2.4 + Math.random() * 2.8;
  else if (tail < 0.09) absBody *= 1.3 + Math.random() * 0.95;

  const bias = phase.directionProb - 0.5;
  state.momentum = Math.max(-1, Math.min(1,
    state.momentum * 0.8 + bias * 0.16 + randn() * 0.09 + (Math.random() - 0.5) * 0.07));

  const st = state.streak;
  const streakFade = (st === 0 ? 0 : Math.sign(st)) * Math.min(0.24, Math.abs(st) * 0.045);
  let pUp = 0.5 + bias * 0.92 + state.momentum * 0.4 - streakFade;
  pUp = Math.max(0.05, Math.min(0.95, pUp));
  const up = Math.random() < pUp;
  const sign = up ? 1 : -1;

  const isDoji = Math.random() < 0.075 && phase.id !== 'ignition' && phase.id !== 'bullrun' && phase.id !== 'breakdown';
  const effectiveBody = isDoji ? sign * absBody * 0.11 : sign * absBody;

  let close = roundToTick(open + effectiveBody);

  const br = Math.abs(close - open) + ES_TICK * 0.25;
  const wickRoll = Math.random();
  let wu;
  let wd;
  if (wickRoll < 0.36) {
    wu = br * (0.1 + Math.random() * 0.9);
    wd = br * (0.1 + Math.random() * 0.9);
  } else if (wickRoll < 0.62) {
    wu = br * (0.42 + Math.random() * 1.55);
    wd = br * (0.05 + Math.random() * 0.42);
  } else {
    wu = br * (0.05 + Math.random() * 0.42);
    wd = br * (0.42 + Math.random() * 1.55);
  }

  let high = roundToTick(Math.max(open, close) + wu);
  let low = roundToTick(Math.min(open, close) - wd);
  if (high <= Math.max(open, close)) high = roundToTick(Math.max(open, close) + ES_TICK);
  if (low >= Math.min(open, close)) low = roundToTick(Math.min(open, close) - ES_TICK);

  const trueRange = high - low;
  state.lastTrueRange = trueRange;

  if (close > open) state.streak = st >= 0 ? st + 1 : 1;
  else if (close < open) state.streak = st <= 0 ? st - 1 : -1;
  else state.streak = 0;

  const baseVol = Math.pow(volClass / 10, 1.5) * 10000;
  const rangeNorm = trueRange / (tfBodyScale * 10 + 0.25);
  const activity = 0.52 + 0.9 * Math.tanh(rangeNorm * 1.05) + state.volFactor * 0.12;
  const absVol = Math.max(400, baseVol * activity + Math.exp(randn() * 0.11) * 220);

  return { open, high, low, close, vol: absVol, trueRange };
}

// ═══════════════════════════════════════════════════════════════
//  CANDLE GENERATOR — scripted cycle
// ═══════════════════════════════════════════════════════════════

function useScriptedFeed(playing, speed, timeframe) {
  const [candles, setCandles] = useState([]);
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [phaseTick, setPhaseTick] = useState(0);
  const priceRef = useRef(4500);    // starting price (ES-ish)
  const tickRef = useRef(null);
  const microStateRef = useRef({
    volFactor: 1,
    momentum: 0,
    streak: 0,
    lastTrueRange: ES_TICK * 4,
  });

  const reset = useCallback(() => {
    setCandles([]);
    setPhaseIdx(0);
    setPhaseTick(0);
    priceRef.current = 4500;
    microStateRef.current = {
      volFactor: 1,
      momentum: 0,
      streak: 0,
      lastTrueRange: ES_TICK * 4,
    };
  }, []);

  // Reset when timeframe changes — different lookback means different ranking
  useEffect(() => { reset(); }, [timeframe, reset]);

  useEffect(() => {
    if (!playing) {
      if (tickRef.current) clearInterval(tickRef.current);
      return;
    }
    const profile = TIMEFRAME_PROFILES[timeframe] || TIMEFRAME_PROFILES['15m'];
    const intervalMs = profile.candleIntervalMs / speed;

    tickRef.current = setInterval(() => {
      setPhaseTick(pt => {
        const phase = PHASES[phaseIdx];
        const rand = (min, max) => min + Math.random() * (max - min);

        const volClass = rand(phase.volBias[0], phase.volBias[1]);
        const bodyClass = rand(phase.bodyBias[0], phase.bodyBias[1]);

        const tfBodyScale = { '1m': 0.6, '5m': 0.9, '15m': 1.0, '1h': 1.8, '1d': 4.5 }[timeframe] || 1.0;

        const prevClose = priceRef.current;
        const bar = synthesizeIndexBar(
          prevClose,
          phase,
          timeframe,
          tfBodyScale,
          volClass,
          bodyClass,
          microStateRef.current,
        );

        const { open, high, low, close, vol: absVol } = bar;
        priceRef.current = close;

        const rawBody = Math.abs(close - open);
        const simulatedSpread = rawBody * profile.spreadPenalty * (0.6 + Math.random() * 0.8);

        const newCandle = {
          id: Date.now() + Math.random(),
          o: open, h: high, l: low, c: close,
          vol: absVol,
          body: rawBody,
          // "Earned" body after spread penalty — what actually moved beyond friction
          earnedBody: Math.max(0.01, rawBody - simulatedSpread),
          spread: simulatedSpread,
          timeframe,
        };

        setCandles(prev => {
          // Use profile-specific lookback for the rolling buffer
          const LB = profile.lookback;
          const next = [...prev, newCandle].slice(-LB);

          // Compute percentile ranks from the rolling buffer.
          // Y-axis ranking now uses `earnedBody` so spread penalty affects the coordinate.
          const vols = next.map(c => c.vol);
          const bodies = next.map(c => c.earnedBody);
          const volPct = percentileRank(vols, newCandle.vol);
          const bodyPct = percentileRank(bodies, newCandle.earnedBody);
          const x = pctToBucket(volPct);
          const y = pctToBucket(bodyPct);
          newCandle.volPct = volPct;
          newCandle.bodyPct = bodyPct;
          newCandle.coord = { x, y };
          newCandle.quad = quadrantOf(x, y);

          // Doji detection remains percentile-based (still meaningful per-timeframe)
          const bodyRangeHL = newCandle.h - newCandle.l || 1;
          const bodyAsFracOfRange = Math.abs(newCandle.c - newCandle.o) / bodyRangeHL;
          const isRelativeDoji = bodyPct < 0.15 && bodyAsFracOfRange < 0.35;
          if (isRelativeDoji) newCandle.bias = 'mixed';
          else newCandle.bias = newCandle.c > newCandle.o ? 'bullish' : 'bearish';

          // Attach synthetic Level 2 book. Book "ghost probability" — fraction of
          // displayed depth that may be spoofed — rises sharply at short timeframes.
          // We apply a confidence multiplier to OBI on short timeframes elsewhere.
          newCandle.book = generateBook(newCandle.c, phase.bookBias ?? 0, phase.id);

          const enriched = [...next];
          enriched[enriched.length - 1] = newCandle;
          return enriched;
        });

        // Advance phase
        const nextTick = pt + 1;
        if (nextTick >= phase.duration) {
          setPhaseIdx(i => (i + 1) % PHASES.length);
          return 0;
        }
        return nextTick;
      });
    }, intervalMs);

    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [playing, speed, phaseIdx, timeframe]);

  return { candles, phase: PHASES[phaseIdx], phaseIdx, phaseTick, reset };
}

// ═══════════════════════════════════════════════════════════════
//  SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════

// ─── Candle Chart (scrolling) ───
function CandleChart({ candles }) {
  const view = candles.slice(-VIEW_CANDLES);
  if (view.length === 0) return (
    <div className="h-full flex items-center justify-center text-[var(--fg-mute)] text-xs tracking-[0.3em] uppercase">
      waiting for feed...
    </div>
  );

  const W = 800, H = 240, PAD = 16;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;

  const minL = Math.min(...view.map(c => c.l));
  const maxH = Math.max(...view.map(c => c.h));
  const range = maxH - minL || 1;
  const scaleY = v => PAD + (maxH - v) / range * plotH;

  const maxVol = Math.max(...view.map(c => c.vol));
  // Each slot gets a fixed width; candle body width = function of volume
  const slotW = plotW / VIEW_CANDLES;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="chartBg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"  stopColor="#0a0b0d" />
          <stop offset="100%" stopColor="#111316" />
        </linearGradient>
        <pattern id="chartGrid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1d2025" strokeWidth="0.5"/>
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#chartBg)"/>
      <rect width={W} height={H} fill="url(#chartGrid)" opacity="0.6"/>

      {/* price axis ticks */}
      {[0.25, 0.5, 0.75].map((t, i) => (
        <g key={i}>
          <line x1={PAD} y1={PAD + t * plotH} x2={W - PAD} y2={PAD + t * plotH}
                stroke="#1d2025" strokeDasharray="2 4" strokeWidth="0.5"/>
          <text x={W - PAD - 4} y={PAD + t * plotH - 3} fill="#3d3d39" fontSize="9"
                textAnchor="end" fontFamily="JetBrains Mono">
            {(maxH - t * range).toFixed(2)}
          </text>
        </g>
      ))}

      {view.map((c, i) => {
        const slotIdx = VIEW_CANDLES - view.length + i;
        const slotX = PAD + slotW * slotIdx + slotW / 2;
        const volW = Math.max(1.5, (c.vol / maxVol) * slotW * 0.85);
        const bodyTop = scaleY(Math.max(c.o, c.c));
        const bodyBot = scaleY(Math.min(c.o, c.c));
        const bodyH = Math.max(1, bodyBot - bodyTop);
        const isUp = c.c > c.o;
        const isDoji = c.bias === 'mixed';
        const color = isDoji ? '#d4a84b' : isUp ? '#6ba368' : '#ff5a5a';
        const isLast = i === view.length - 1;

        return (
          <g key={c.id} opacity={isLast ? 1 : 0.85}>
            {/* wick */}
            <line x1={slotX} y1={scaleY(c.h)} x2={slotX} y2={scaleY(c.l)}
                  stroke={color} strokeWidth="0.8" opacity="0.8"/>
            {/* body — bearish bodies now filled too (at slightly lower opacity) for visual parity with bullish */}
            <rect x={slotX - volW / 2} y={bodyTop} width={volW} height={bodyH}
                  fill={color} fillOpacity={isUp || isDoji ? 0.95 : 0.85}
                  stroke={color} strokeWidth="0.7"/>
            {isLast && (
              <circle cx={slotX} cy={scaleY(c.c)} r="2.5" fill="#d4a84b">
                <animate attributeName="r" values="2;5;2" dur="1.2s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite"/>
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Depth Heatmap (Level 2 book visualizer) ───
// Vertical strip showing resting liquidity at each price level.
// Asks stack above mid (top half), bids stack below (bottom half).
// Cell intensity = relative size. The current price is marked by an amber line.
//
// Layout uses CSS Grid with fixed rows for header/midprice/footer and flex 1fr
// rows for the ask/bid stacks — this guarantees label areas never collide with
// the price rows even on very short viewports.
function DepthHeatmap({ book }) {
  if (!book) {
    return (
      <div className="w-[96px] h-full bg-[#0a0b0d] border border-[var(--line)] flex items-center justify-center text-[8px] tracking-[0.2em] uppercase text-[var(--fg-mute)]">
        book loading
      </div>
    );
  }
  const { bids, asks, obi, mid, bidTot, askTot } = book;

  // Normalize sizes for color intensity
  const allSizes = [...bids, ...asks].map(l => l.size);
  const maxSize = Math.max(...allSizes) || 1;

  // OBI color
  const obiColor = obi > 0.15 ? '#6ba368' : obi < -0.15 ? '#ff5a5a' : '#8a8374';

  // Show price tick labels at 5-level intervals
  const shouldLabel = (idx) => idx === 1 || idx === 5 || idx === 10 || idx === 15 || idx === 20;

  return (
    <div
      className="w-[96px] h-full bg-[#0a0b0d] border border-[var(--line)] relative overflow-hidden select-none"
      style={{
        display: 'grid',
        gridTemplateRows: '22px minmax(0, 1fr) 20px minmax(0, 1fr) 22px',
      }}
    >
      {/* ── Header: DOM label + OBI ── */}
      <div className="border-b border-[var(--line)] px-1.5 flex items-center justify-between bg-[#0e1013]">
        <span className="text-[8px] tracking-[0.2em] uppercase text-[var(--fg-dim)] font-medium">
          DOM
        </span>
        <span className="text-[9px] font-mono font-medium tabular-nums" style={{ color: obiColor }}>
          {obi >= 0 ? '+' : ''}{(obi * 100).toFixed(0)}
        </span>
      </div>

      {/* ── Asks (top half) — rendered farthest→nearest (top→bottom) ── */}
      <div className="relative overflow-hidden">
        {[...asks].reverse().map((lvl, i) => {
          const levelIdx = BOOK_DEPTH - i;
          const intensity = Math.min(1, lvl.size / maxSize);
          const barFill = Math.pow(intensity, 0.7);
          return (
            <div
              key={`a${i}`}
              className="relative flex items-center"
              style={{ height: `${100 / BOOK_DEPTH}%`, minHeight: '4px' }}
            >
              {/* Bar */}
              <div
                className="absolute inset-y-0 right-0"
                style={{
                  width: `${barFill * 100}%`,
                  background: `rgba(255, 90, 90, ${0.2 + barFill * 0.6})`,
                  boxShadow: barFill > 0.7 ? 'inset 0 0 4px rgba(255,90,90,0.4)' : 'none',
                }}
              />
              {/* Price label */}
              {shouldLabel(levelIdx) && (
                <span className="absolute left-1 text-[8px] text-[var(--fg-mute)] font-mono z-10 tabular-nums leading-none">
                  {lvl.price.toFixed(1)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Midprice marker ── */}
      <div
        className="relative flex items-center justify-end px-1"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(212,168,75,0.15) 30%, rgba(212,168,75,0.25) 100%)',
          borderTop: '1px solid rgba(212,168,75,0.7)',
          borderBottom: '1px solid rgba(212,168,75,0.7)',
          boxShadow: '0 0 6px rgba(212,168,75,0.3)',
        }}
      >
        <span className="text-[9px] font-mono font-medium tabular-nums text-[var(--amber)] leading-none">
          {mid.toFixed(2)}
        </span>
      </div>

      {/* ── Bids (bottom half) — rendered nearest→farthest (top→bottom) ── */}
      <div className="relative overflow-hidden">
        {bids.map((lvl, i) => {
          const levelIdx = i + 1;
          const intensity = Math.min(1, lvl.size / maxSize);
          const barFill = Math.pow(intensity, 0.7);
          return (
            <div
              key={`b${i}`}
              className="relative flex items-center"
              style={{ height: `${100 / BOOK_DEPTH}%`, minHeight: '4px' }}
            >
              <div
                className="absolute inset-y-0 right-0"
                style={{
                  width: `${barFill * 100}%`,
                  background: `rgba(107, 163, 104, ${0.2 + barFill * 0.6})`,
                  boxShadow: barFill > 0.7 ? 'inset 0 0 4px rgba(107,163,104,0.4)' : 'none',
                }}
              />
              {shouldLabel(levelIdx) && (
                <span className="absolute left-1 text-[8px] text-[var(--fg-mute)] font-mono z-10 tabular-nums leading-none">
                  {lvl.price.toFixed(1)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Footer: bid / ask totals ── */}
      <div className="border-t border-[var(--line)] px-1.5 flex items-center justify-between bg-[#0e1013]">
        <span className="text-[9px] font-mono font-medium tabular-nums" style={{ color: '#6ba368' }}>
          {(bidTot / 1000).toFixed(1)}k
        </span>
        <span className="text-[9px] font-mono font-medium tabular-nums" style={{ color: '#ff5a5a' }}>
          {(askTot / 1000).toFixed(1)}k
        </span>
      </div>
    </div>
  );
}

// ─── Matrix Cell Candle Glyph ───
function CellGlyph({ x, y, bias, opacity = 1 }) {
  // Single stylized candle representing the coordinate
  const VB = 100;
  const widthPct = 0.10 + (x - 1) / 9 * 0.72;
  const heightPct = 0.10 + (y - 1) / 9 * 0.72;
  const bw = VB * widthPct;
  const bh = VB * heightPct;
  const wk = Math.max(2, (VB * 0.12) * (1 - (y - 1) / 9 * 0.5));
  const cx = VB / 2;
  const cy = VB / 2;
  const color = bias === 'bullish' ? '#6ba368' : bias === 'bearish' ? '#ff5a5a' : '#d4a84b';
  // All three bias states render as filled candles for visual weight parity
  const fillOp = bias === 'bearish' ? 0.8 : 0.9;

  return (
    <svg viewBox={`0 0 ${VB} ${VB}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet" opacity={opacity}>
      <line x1={cx} y1={cy - bh/2 - wk} x2={cx} y2={cy + bh/2 + wk}
            stroke={color} strokeWidth="0.8" opacity="0.8"/>
      <rect x={cx - bw/2} y={cy - bh/2} width={bw} height={bh}
            fill={color} fillOpacity={fillOp}
            stroke={color} strokeWidth="0.8"/>
    </svg>
  );
}

// ─── Matrix ───
function Matrix({ bias, activeCoord, trailCoords, activeQuad, pulseId, reversal, obi, onHover, onLeave }) {
  // bias-driven background tint per quadrant — stronger opacity so modes are readable.
  // Bearish mode gets deeper red saturation because straight red washes muddy easily
  // on dark backgrounds; we also slightly darken the Q2/Q4 reds to make the active
  // highlight ring stand apart from the cell background.
  const tints = {
    bullish:  { 1: 'rgba(95,168,168,0.12)',  2: 'rgba(107,163,104,0.22)', 3: 'rgba(138,131,116,0.08)', 4: 'rgba(199,92,92,0.14)' },
    bearish:  { 1: 'rgba(95,168,168,0.12)',  2: 'rgba(220,70,70,0.26)',   3: 'rgba(138,131,116,0.08)', 4: 'rgba(107,163,104,0.16)' },
    mixed:    { 1: 'rgba(212,168,75,0.14)',  2: 'rgba(212,168,75,0.20)',  3: 'rgba(212,168,75,0.08)',  4: 'rgba(212,168,75,0.14)' },
  };
  const tint = tints[bias] || tints.mixed;

  // Active-cell highlight color keyed to candle bias. Bearish uses a brighter,
  // more saturated red so the ring pops against red-tinted Q2/Q4 cells.
  const activeColors = {
    bullish: { solid: '#6ba368', glow: 'rgba(107,163,104,0.55)', innerGlow: 'rgba(107,163,104,0.18)' },
    bearish: { solid: '#ff5a5a', glow: 'rgba(255,90,90,0.70)',   innerGlow: 'rgba(255,90,90,0.28)'   },
    mixed:   { solid: '#d4a84b', glow: 'rgba(212,168,75,0.5)',   innerGlow: 'rgba(212,168,75,0.15)'  },
  };
  const ac = activeColors[bias] || activeColors.mixed;

  // High-energy quadrants get an impact flash
  const isImpact = activeQuad === 2 || activeQuad === 4;

  // Build 10 rows × 10 cols grid (row 0 = top = y=10)
  const cells = [];
  for (let r = 0; r < GRID; r++) {
    const y = GRID - r;
    for (let c = 0; c < GRID; c++) {
      const x = c + 1;
      const q = quadrantOf(x, y);
      const isActive = activeCoord && activeCoord.x === x && activeCoord.y === y;
      const trailIdx = trailCoords.findIndex(t => t && t.x === x && t.y === y);

      // Active cell box-shadow: static ring + optional impact animation
      const staticShadow = `0 0 0 1.5px ${ac.solid}, 0 0 14px ${ac.glow}, inset 0 0 20px ${ac.innerGlow}`;

      cells.push(
        <div
          key={`${x}-${y}`}
          className="relative border border-[var(--line)] transition-all duration-150 cursor-crosshair"
          style={{
            background: tint[q],
            borderRight: c === 4 ? '1px solid rgba(212,168,75,0.4)' : undefined,
            borderTop:   y === 6 ? '1px solid rgba(212,168,75,0.4)' : undefined,
            boxShadow: isActive
              ? staticShadow
              : trailIdx >= 0
                ? `inset 0 0 0 1px rgba(212,168,75,${0.6 - trailIdx * 0.25})`
                : undefined,
            zIndex: isActive ? 5 : trailIdx >= 0 ? 3 : 1,
          }}
          onMouseEnter={() => onHover(x, y, q)}
          onMouseLeave={onLeave}
        >
          <CellGlyph x={x} y={y} bias={bias}
                     opacity={isActive ? 1 : trailIdx === 0 ? 0.85 : trailIdx === 1 ? 0.55 : 0.35}/>
          {isActive && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-0.5 left-0.5 w-1.5 h-1.5" style={{ borderTop: `1px solid ${ac.solid}`, borderLeft: `1px solid ${ac.solid}` }}/>
              <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5" style={{ borderTop: `1px solid ${ac.solid}`, borderRight: `1px solid ${ac.solid}` }}/>
              <div className="absolute bottom-0.5 left-0.5 w-1.5 h-1.5" style={{ borderBottom: `1px solid ${ac.solid}`, borderLeft: `1px solid ${ac.solid}` }}/>
              <div className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5" style={{ borderBottom: `1px solid ${ac.solid}`, borderRight: `1px solid ${ac.solid}` }}/>
            </div>
          )}
          {/* Impact flash overlay — keyed by pulseId so React remounts & retriggers animation
              each time a new candle lands in Q2 Engine or Q4 Wall */}
          {isActive && isImpact && pulseId && (
            <div
              key={pulseId}
              className="impact-flash absolute inset-0 pointer-events-none"
              style={{
                '--flash-solid': ac.solid,
                '--flash-glow': ac.glow,
              }}
            />
          )}
        </div>
      );
    }
  }

  // ── TRAIL LINE OVERLAY ──
  // Build a polyline through [active, t-1, t-2] in SVG grid coordinates.
  // The grid is 10x10; each cell centers at (col+0.5, row+0.5) in grid units.
  // For SVG we use a 100x100 viewBox where each cell = 10x10 units.
  const trailPoints = [];
  if (activeCoord) trailPoints.push(activeCoord);
  for (const t of trailCoords) if (t) trailPoints.push(t);

  // Grid coords → SVG coords. x is column (1..10), y is body row (1..10, where 10 = top).
  // In SVG viewBox 100x100, x=1 → cx=5, x=10 → cx=95. Similarly for y, but visual top is y=10.
  const toSvg = ({ x, y }) => ({
    cx: (x - 0.5) * 10,
    cy: (GRID - y + 0.5) * 10,
  });

  const svgPoints = trailPoints.map(toSvg);

  return (
    <div className="relative">
      <div className="border border-[var(--line-strong)] relative" style={{
        zIndex: 1,
        aspectRatio: '1 / 1',
        display: 'grid',
        gridTemplateColumns: 'repeat(10, minmax(0, 1fr))',
        gridTemplateRows: 'repeat(10, minmax(0, 1fr))',
        gap: 0,
      }}>
        {cells}
      </div>

      {/* ── Z-axis Liquidity Overlay ──
          OBI drives a radial gradient wash centered on the active cell. Positive OBI
          (bid-heavy book) paints green/teal — the coord is being "lifted" by resting
          liquidity. Negative OBI (ask-heavy) paints red/magenta — the coord sits
          against resistance. Magnitude of OBI determines opacity. Sits above cells
          using screen blend so it additively brightens rather than darkens. */}
      {obi !== undefined && obi !== null && activeCoord && Math.abs(obi) > 0.08 && (
        <div className="absolute inset-0 pointer-events-none"
             style={{
               zIndex: 3,
               mixBlendMode: 'screen',
               background: `radial-gradient(ellipse 50% 50% at ${(activeCoord.x - 0.5) * 10}% ${(GRID - activeCoord.y + 0.5) * 10}%,
                 ${obi > 0
                   ? `rgba(80, 230, 170, ${Math.min(0.55, Math.abs(obi) * 0.75)})`
                   : `rgba(255, 100, 160, ${Math.min(0.55, Math.abs(obi) * 0.75)})`},
                 transparent 70%)`,
               transition: 'background 400ms ease',
             }}/>
      )}

      {/* Trail line overlay — absolute, non-interactive, sits above cells */}
      {svgPoints.length >= 2 && (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ zIndex: 6 }}
        >
          <defs>
            <filter id="trailGlow">
              <feGaussianBlur stdDeviation="0.4"/>
            </filter>
          </defs>
          {/* Draw connecting segments with fading opacity from newest→oldest */}
          {svgPoints.map((p, i) => {
            if (i === svgPoints.length - 1) return null;
            const next = svgPoints[i + 1];
            // i=0 is the freshest segment (active → t-1), i=1 is older (t-1 → t-2)
            const segOpacity = i === 0 ? 0.85 : 0.45;
            return (
              <line
                key={i}
                x1={p.cx} y1={p.cy}
                x2={next.cx} y2={next.cy}
                stroke={ac.solid}
                strokeWidth="0.5"
                strokeDasharray="1.2 0.8"
                opacity={segOpacity}
                filter="url(#trailGlow)"
              />
            );
          })}
          {/* Small dots at each trail waypoint */}
          {svgPoints.map((p, i) => (
            <circle
              key={`d-${i}`}
              cx={p.cx} cy={p.cy}
              r={i === 0 ? 0.9 : 0.6}
              fill={ac.solid}
              opacity={i === 0 ? 1 : 0.55 - i * 0.15}
            />
          ))}

          {/* ── Reversal target marker ──
              Draws a pulsing ring on the mean-reversion target cell when
              Vacuum Snap fires, plus a dashed arrow from active → target. */}
          {reversal?.target && activeCoord && reversal.score > 0.35 && (() => {
            const t = toSvg(reversal.target);
            const a = toSvg(activeCoord);
            const revColor = reversal.direction === 'bearish' ? '#ff5a5a'
                           : reversal.direction === 'bullish' ? '#6ba368'
                           : '#d4a84b';
            return (
              <g>
                {/* Arrow line */}
                <line x1={a.cx} y1={a.cy} x2={t.cx} y2={t.cy}
                      stroke={revColor} strokeWidth="0.4" strokeDasharray="0.8 1.2"
                      opacity="0.75"/>
                {/* Target ring (pulsing) */}
                <circle cx={t.cx} cy={t.cy} r="3.5"
                        fill="none" stroke={revColor} strokeWidth="0.6" opacity="0.85">
                  <animate attributeName="r" values="3.5;5.5;3.5" dur="1.8s" repeatCount="indefinite"/>
                  <animate attributeName="opacity" values="0.85;0.3;0.85" dur="1.8s" repeatCount="indefinite"/>
                </circle>
                {/* Inner target dot */}
                <circle cx={t.cx} cy={t.cy} r="1.2" fill={revColor} opacity="0.9"/>
                {/* Crosshair */}
                <line x1={t.cx - 2.5} y1={t.cy} x2={t.cx + 2.5} y2={t.cy}
                      stroke={revColor} strokeWidth="0.3" opacity="0.6"/>
                <line x1={t.cx} y1={t.cy - 2.5} x2={t.cx} y2={t.cy + 2.5}
                      stroke={revColor} strokeWidth="0.3" opacity="0.6"/>
              </g>
            );
          })()}
        </svg>
      )}
    </div>
  );
}

// ─── Mode Badge ───
function ModeBadge({ mode }) {
  const config = {
    bullish: { label: 'Bullish Matrix', Icon: TrendingUp, color: '#6ba368', bg: 'rgba(107,163,104,0.12)' },
    bearish: { label: 'Bearish Matrix', Icon: TrendingDown, color: '#ff5a5a', bg: 'rgba(255,90,90,0.18)' },
    mixed:   { label: 'Mixed Matrix',   Icon: Minus,        color: '#d4a84b', bg: 'rgba(212,168,75,0.12)' },
  };
  const c = config[mode] || config.mixed;
  const Icon = c.Icon;
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 border"
         style={{ borderColor: c.color, background: c.bg, color: c.color }}>
      <Icon size={13} strokeWidth={1.75}/>
      <span className="text-[10px] tracking-[0.22em] uppercase font-medium">{c.label}</span>
    </div>
  );
}

// ─── Phase Timeline ───
function PhaseTimeline({ phaseIdx, phaseTick, phase }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Waves size={12} className="text-[var(--amber)]" strokeWidth={1.5}/>
        <span className="text-[9px] tracking-[0.25em] uppercase text-[var(--fg-dim)]">Cycle Position</span>
      </div>
      <div className="flex gap-1">
        {PHASES.map((p, i) => {
          const active = i === phaseIdx;
          const done = i < phaseIdx;
          return (
            <div key={p.id} className="flex-1 group relative">
              <div className="h-1 transition-all"
                   style={{
                     background: active ? '#d4a84b' : done ? '#6b6a63' : '#2a2f37',
                     boxShadow: active ? '0 0 8px rgba(212,168,75,0.6)' : 'none',
                   }}/>
              {active && (
                <div className="absolute -top-0.5 h-2 transition-all"
                     style={{
                       left: 0,
                       width: `${(phaseTick / p.duration) * 100}%`,
                       background: '#fff',
                       opacity: 0.8,
                     }}/>
              )}
              <div className="absolute top-3 left-0 text-[8px] tracking-[0.15em] uppercase whitespace-nowrap"
                   style={{ color: active ? '#d4a84b' : '#3d3d39', transform: 'rotate(-35deg)', transformOrigin: 'top left' }}>
                {p.name}
              </div>
            </div>
          );
        })}
      </div>
      <div className="pt-8">
        <div className="font-['Fraunces'] italic text-lg text-[var(--fg)]">{phase.name}</div>
        <div className="text-[10px] text-[var(--fg-dim)] tracking-wider">{phase.tag}</div>
      </div>
    </div>
  );
}

// ─── Vector Ticker ───
function VectorTicker({ vectorHistory }) {
  // vectorHistory is array of detected named transitions with timestamps
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Radio size={12} className="text-[var(--amber)]" strokeWidth={1.5}/>
        <span className="text-[9px] tracking-[0.25em] uppercase text-[var(--fg-dim)]">Vector Stream</span>
      </div>
      <div className="space-y-1 min-h-[140px] max-h-[140px] overflow-hidden">
        {vectorHistory.length === 0 && (
          <div className="text-[10px] text-[var(--fg-mute)] italic tracking-wide">awaiting transitions...</div>
        )}
        {vectorHistory.slice(0, 6).map((v, i) => {
          const sevColor = {
            go: '#6ba368', warn: '#d4a84b', alert: '#c75c5c', cool: '#5fa8a8',
          }[v.severity] || '#8a8374';
          const opacity = 1 - i * 0.15;
          return (
            <div key={v.ts} className="flex items-center justify-between border-l-2 pl-2 py-1"
                 style={{ borderColor: sevColor, opacity }}>
              <div>
                <div className="font-['Fraunces'] italic text-sm" style={{ color: sevColor }}>{v.name}</div>
                <div className="text-[9px] text-[var(--fg-mute)] tracking-widest">Q{v.from} → Q{v.to}</div>
              </div>
              <div className="text-[9px] text-[var(--fg-mute)] font-mono">#{v.idx}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Reversal Signal Panel ───
// Visualizes the composite reversal confidence from the Wyckoff geometric detector.
// Shows: direction badge, confidence arc (0-100%), active law chips, target coord.
function ReversalSignal({ reversal, currentQuad, profile }) {
  const { score, rawScore, significance, inertiaBonus, direction, signals, target } = reversal;
  const pct = Math.round(score * 100);
  const rawPct = Math.round((rawScore || 0) * 100);

  // Color logic: bearish = red, bullish = green, reversal/pending = amber/cyan
  const dirColors = {
    bearish:  { main: '#ff5a5a', rgb: '255,90,90',   glow: 'rgba(255,90,90,0.5)',   label: 'Bearish Reversal' },
    bullish:  { main: '#6ba368', rgb: '107,163,104', glow: 'rgba(107,163,104,0.5)', label: 'Bullish Reversal' },
    reversal: { main: '#d4a84b', rgb: '212,168,75',  glow: 'rgba(212,168,75,0.5)',  label: 'Reversal Pending' },
    pending:  { main: '#5fa8a8', rgb: '95,168,168',  glow: 'rgba(95,168,168,0.5)',  label: 'Setup Forming' },
  };
  const dc = dirColors[direction] || { main: '#3d3d39', rgb: '61,61,57', glow: 'transparent', label: 'No Signal' };

  // Confidence tier label
  const tier = pct >= 80 ? 'HIGH' : pct >= 55 ? 'MODERATE' : pct >= 30 ? 'LOW' : 'WATCH';

  // SVG arc (semicircle gauge)
  const gaugeR = 42;
  const arcCirc = Math.PI * gaugeR;  // semicircle
  const arcOffset = arcCirc * (1 - score);

  return (
    <div className="bg-[var(--bg-alt)] border p-5 relative overflow-hidden transition-colors"
         style={{
           borderColor: score > 0.35 ? dc.main : 'var(--line)',
           boxShadow: score > 0.55 ? `0 0 24px rgba(${dc.rgb},0.18), inset 0 0 40px rgba(${dc.rgb},0.06)` : 'none',
         }}>
      {/* pulse ring when high confidence */}
      {score > 0.7 && (
        <div className="absolute inset-0 pointer-events-none opacity-60" style={{
          background: `radial-gradient(ellipse at top right, rgba(${dc.rgb},0.12), transparent 60%)`,
        }}/>
      )}

      <div className="flex items-center justify-between mb-3 relative">
        <div className="flex items-center gap-2">
          <Zap size={12} style={{ color: score > 0.35 ? dc.main : '#d4a84b' }} strokeWidth={1.5}/>
          <span className="text-[9px] tracking-[0.25em] uppercase text-[var(--fg-dim)]">Reversal Detector</span>
        </div>
        <span className="text-[8px] tracking-[0.22em] uppercase" style={{ color: profile?.accent || dc.main }}>
          Wyckoff · {profile?.context || 'E/R'}
        </span>
      </div>

      {/* Gauge + confidence */}
      <div className="flex items-center gap-4 mb-3 relative">
        <svg viewBox="0 0 100 56" className="w-[110px] h-[60px] shrink-0">
          <defs>
            <linearGradient id="gaugeGrad" x1="0" x2="1">
              <stop offset="0%" stopColor={dc.main} stopOpacity="0.3"/>
              <stop offset="100%" stopColor={dc.main} stopOpacity="1"/>
            </linearGradient>
          </defs>
          {/* Background arc */}
          <path d={`M ${50 - gaugeR} 50 A ${gaugeR} ${gaugeR} 0 0 1 ${50 + gaugeR} 50`}
                fill="none" stroke="#1d2025" strokeWidth="6" strokeLinecap="round"/>
          {/* Foreground arc (confidence) */}
          <path d={`M ${50 - gaugeR} 50 A ${gaugeR} ${gaugeR} 0 0 1 ${50 + gaugeR} 50`}
                fill="none" stroke="url(#gaugeGrad)" strokeWidth="6" strokeLinecap="round"
                strokeDasharray={arcCirc} strokeDashoffset={arcOffset}
                style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.3,0.8,0.3,1), stroke 250ms' }}/>
          {/* Ghost arc showing raw (pre-significance) score */}
          {rawScore > 0 && rawScore !== score && (
            <path d={`M ${50 - gaugeR} 50 A ${gaugeR} ${gaugeR} 0 0 1 ${50 + gaugeR} 50`}
                  fill="none" stroke={dc.main} strokeWidth="1.5" strokeLinecap="round"
                  strokeDasharray={`${arcCirc * rawScore} ${arcCirc}`}
                  opacity="0.3"
                  style={{ transition: 'stroke-dasharray 600ms' }}/>
          )}
          {/* Center tick marks */}
          {[0, 0.33, 0.67, 1].map((t, i) => {
            const angle = Math.PI * (1 - t);
            const r1 = gaugeR - 9, r2 = gaugeR + 2;
            const x1 = 50 + Math.cos(angle) * r1;
            const y1 = 50 - Math.sin(angle) * r1;
            const x2 = 50 + Math.cos(angle) * r2;
            const y2 = 50 - Math.sin(angle) * r2;
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3d3d39" strokeWidth="0.5"/>;
          })}
        </svg>
        <div className="flex-1">
          <div className="text-[9px] tracking-[0.22em] uppercase text-[var(--fg-mute)]">Confidence</div>
          <div className="font-['Fraunces'] italic text-[28px] leading-none tabular-nums" style={{ color: dc.main }}>
            {pct}<span className="text-[16px] text-[var(--fg-mute)]">%</span>
          </div>
          <div className="text-[9px] tracking-[0.25em] uppercase mt-1" style={{ color: dc.main }}>
            {tier} · {dc.label}
          </div>
        </div>
      </div>

      {/* ── Non-linear Adjustment Strip ──
          Shows the formula that transforms raw geometric score into the timeframe-
          adjusted confidence. Makes the non-linearity between 1m "scouts" and 1d
          "armies" visible as a live computation. */}
      {profile && rawScore > 0 && (
        <div className="mb-3 pb-3 border-b border-[var(--line)] relative">
          <div className="text-[8px] tracking-[0.22em] uppercase text-[var(--fg-mute)] mb-1.5">
            Non-linear Adjustment · {profile.short}
          </div>
          <div className="flex items-center gap-2 text-[10px] font-mono tabular-nums">
            <span className="text-[var(--fg-dim)]">raw</span>
            <span className="text-[var(--fg)] font-medium">{rawPct}%</span>
            {inertiaBonus > 0 && (
              <>
                <span className="text-[var(--fg-mute)]">+</span>
                <span style={{ color: profile.accent }}>inertia {(inertiaBonus*100).toFixed(0)}</span>
              </>
            )}
            <span className="text-[var(--fg-mute)]">×</span>
            <span style={{ color: profile.accent }}>
              sig {significance?.toFixed(2) || '1.00'}
            </span>
            <span className="text-[var(--fg-mute)]">=</span>
            <span className="ml-auto font-['Fraunces'] italic text-[13px]" style={{ color: dc.main }}>
              {pct}%
            </span>
          </div>
          <div className="text-[9px] tracking-wide text-[var(--fg-mute)] italic mt-1 font-['Fraunces']">
            {profile.contextTag}
          </div>
        </div>
      )}

      {/* Active laws */}
      <div className="space-y-1.5 relative">
        {signals.length === 0 ? (
          <div className="text-[10px] italic text-[var(--fg-mute)] tracking-wide">
            monitoring path geometry · no reversal signature detected
          </div>
        ) : (
          signals.map((s, i) => {
            const subPct = Math.round(s.score * 100);
            const rawSubPct = Math.round((s.rawScore || s.score) * 100);
            const weight = s.weight || 1.0;
            const weightIsActive = Math.abs(weight - 1.0) > 0.05;
            return (
              <div key={s.law} className="flex items-start gap-2 pb-1.5 border-b border-dashed border-[var(--line)] last:border-b-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-['Fraunces'] italic text-[13px]" style={{ color: dc.main }}>
                        {s.law}
                      </span>
                      {weightIsActive && (
                        <span className="text-[8px] tabular-nums px-1 border" style={{
                          borderColor: weight > 1 ? dc.main : 'var(--fg-mute)',
                          color: weight > 1 ? dc.main : 'var(--fg-mute)',
                          opacity: 0.8,
                        }}>
                          ×{weight.toFixed(2)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      {weightIsActive && rawSubPct !== subPct && (
                        <span className="text-[9px] tabular-nums text-[var(--fg-mute)] line-through">{rawSubPct}</span>
                      )}
                      <span className="text-[10px] tabular-nums text-[var(--fg-dim)]">{subPct}%</span>
                    </div>
                  </div>
                  <div className="text-[10px] text-[var(--fg-dim)] leading-tight">{s.detail}</div>
                  {/* Inline meter */}
                  <div className="h-0.5 bg-[var(--line)] mt-1 overflow-hidden">
                    <div className="h-full transition-[width] duration-500"
                         style={{ width: `${subPct}%`, background: dc.main, boxShadow: `0 0 4px ${dc.glow}` }}/>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Vacuum snap target */}
      {target && (
        <div className="mt-3 pt-3 border-t border-[var(--line)] flex items-center gap-2 text-[10px]">
          <Target size={10} style={{ color: dc.main }} strokeWidth={1.5}/>
          <span className="tracking-[0.15em] uppercase text-[var(--fg-dim)]">Mean-reversion target</span>
          <span className="font-['Fraunces'] italic ml-auto" style={{ color: dc.main }}>
            [{target.x}, {target.y}]
          </span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════

export default function App() {
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [timeframe, setTimeframe] = useState('15m');
  const profile = TIMEFRAME_PROFILES[timeframe];
  const { candles, phase, phaseIdx, phaseTick, reset } = useScriptedFeed(playing, speed, timeframe);
  const [hover, setHover] = useState(null);
  const [vectorHistory, setVectorHistory] = useState([]);
  const lastQuadRef = useRef(null);
  const candleCountRef = useRef(0);

  // ── Viewport tracking for JS-driven responsive layout ──
  // Tailwind arbitrary-value responsive classes (xl:grid-cols-[1fr_320px]) aren't
  // in the pre-built stylesheet Claude artifacts use, so we compute layout
  // decisions in JS and apply them via inline styles (which are guaranteed to work).
  const [vw, setVw] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1280);
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const isDesktop = vw >= 1280;     // full 3-region layout (matrix | reversal | sidebar)
  const isTablet  = vw >= 900 && vw < 1280;  // matrix+reversal side-by-side, sidebar below
  const isMobile  = vw < 900;       // full stack

  // Current candle
  const current = candles[candles.length - 1];
  const mode = current?.bias || 'mixed';

  // Trail of last 3 coordinates (most recent first)
  const trail = useMemo(() => {
    if (candles.length < 2) return [];
    return candles.slice(-3).reverse().slice(1).map(c => c.coord);
  }, [candles]);

  // Velocity: sum of Euclidean distances across the trail path (active → t-1 → t-2).
  // Max possible over 2 segments is ~2 * sqrt(81+81) ≈ 25.5 grid units.
  // We classify as Expanding / Stable / Compressing for sidebar readout.
  const velocity = useMemo(() => {
    if (!current || trail.length === 0) return { dist: 0, state: '—', tag: 'awaiting path' };
    const path = [current.coord, ...trail].filter(Boolean);
    let dist = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const dx = path[i].x - path[i+1].x;
      const dy = path[i].y - path[i+1].y;
      dist += Math.sqrt(dx*dx + dy*dy);
    }
    // Per-segment average (normalizes between 2-segment and 1-segment cases)
    const avgSegment = dist / Math.max(1, path.length - 1);
    let state, tag;
    if (avgSegment < 1.5)      { state = 'Compressing'; tag = 'High tension · coiled'; }
    else if (avgSegment < 3.5) { state = 'Stable';      tag = 'Low tension · drifting'; }
    else if (avgSegment < 6)   { state = 'Expanding';   tag = 'High velocity'; }
    else                       { state = 'Discharging'; tag = 'Extreme displacement'; }
    return { dist, avgSegment, state, tag };
  }, [current, trail]);

  // ───────────────────────────────────────────────────────────
  //  REVERSAL DETECTOR — Wyckoff Effort/Result geometric laws
  // ───────────────────────────────────────────────────────────
  // Returns a structured signal { score (0..1), direction, primaryLaw, signals[], target }
  // The detector analyzes the last 5–7 candles and runs four independent tests:
  //   1. Fat Reversal  (Q2→Q4 horizontal stretch)
  //   2. Vacuum Snap   (Q1 isolation with HVN target)
  //   3. Curvature     (parabolic / spiral / compression)
  //   4. Divergence    (price delta vs coordinate drift)
  // Each returns a 0..1 sub-confidence; the overall confidence is a weighted max.
  const reversal = useMemo(() => {
    if (candles.length < 5) {
      return { score: 0, direction: null, primaryLaw: null, signals: [], target: null };
    }
    const window = candles.slice(-7);
    const cur = current;
    const prev5 = candles.slice(-6, -1);  // 5 bars before current
    const signals = [];

    // ── Law 1: Fat Reversal (Q2 → Q4 horizontal compression) ──
    // Look for: path moving right (Δx ≥ +2) while body collapsing (Δy ≤ -2),
    // culminating in a current Q4 cell with high x (≥7).
    let fatScore = 0;
    if (cur.quad === 4 && cur.coord.x >= 7) {
      // Find the furthest-back Q2 coord in the last 5 bars
      const priorQ2 = prev5.filter(c => c.quad === 2 || (c.coord.y >= 6 && c.coord.x >= 6));
      if (priorQ2.length > 0) {
        const startC = priorQ2[0];
        const dx = cur.coord.x - startC.coord.x;   // want positive (rightward)
        const dy = cur.coord.y - startC.coord.y;   // want negative (downward)
        const horizontalStretch = Math.max(0, dx);
        const verticalCollapse = Math.max(0, -dy);
        // Normalize to 0..1
        const stretchComp = Math.min(1, horizontalStretch / 4);  // 4 cells = max credit
        const collapseComp = Math.min(1, verticalCollapse / 5);  // 5 cells = max credit
        fatScore = stretchComp * 0.5 + collapseComp * 0.5;
        // Bonus if current x is extreme (9 or 10)
        if (cur.coord.x >= 9) fatScore = Math.min(1, fatScore + 0.15);
      }
      if (fatScore > 0.35) {
        signals.push({
          law: 'Fat Reversal',
          score: fatScore,
          direction: 'bearish',  // default; adjusted by trend below
          detail: 'Q2→Q4 · effort peaking, result collapsing',
        });
      }
    }

    // ── Law 2: Vacuum Snap (Q1 isolation) ──
    // Current cell is in Q1 with low x (≤3) and high y (≥7).
    // Target = last Q2/Q4 coord (the high-volume node).
    let vacuumScore = 0;
    let vacuumTarget = null;
    if (cur.quad === 1 && cur.coord.x <= 3 && cur.coord.y >= 7) {
      const yExtremity = Math.min(1, (cur.coord.y - 6) / 4);     // y=10 → 1.0
      const xAnemia = Math.min(1, (4 - cur.coord.x) / 3);        // x=1 → 1.0
      vacuumScore = yExtremity * 0.45 + xAnemia * 0.55;
      // Find last HVN (Q2 or Q4 with x ≥ 6) in last 15 bars for target
      const hvn = candles.slice(-15).reverse().find(c =>
        (c.quad === 2 || c.quad === 4) && c.coord.x >= 6
      );
      if (hvn) vacuumTarget = hvn.coord;
      if (vacuumScore > 0.35) {
        signals.push({
          law: 'Vacuum Snap',
          score: vacuumScore,
          direction: 'reversal',
          detail: 'Hollow move · structural mean-reversion likely',
        });
      }
    }

    // ── Law 3: Vector Curvature (last 5 coords) ──
    // Parabolic: Y strictly or mostly increasing across the 5, with recent slope steepening
    // Linear compression: all 5 coords within a 2x2 bounding box in lower-left
    // Clockwise spiral: cumulative angular rotation of path vectors > 180° clockwise
    let curvatureScore = 0;
    let curvatureType = null;
    if (window.length >= 5) {
      const pts = window.slice(-5).map(c => c.coord);

      // Parabolic check: Y monotonically rising, slope accelerating
      const ysUp = pts.every((p, i) => i === 0 || p.y >= pts[i-1].y - 1);  // allow tiny noise
      const totalRise = pts[pts.length-1].y - pts[0].y;
      const secondHalfRise = pts[pts.length-1].y - pts[Math.floor(pts.length/2)].y;
      const firstHalfRise = pts[Math.floor(pts.length/2)].y - pts[0].y;
      if (ysUp && totalRise >= 3 && secondHalfRise > firstHalfRise) {
        curvatureScore = Math.min(1, totalRise / 6);
        curvatureType = 'Parabolic Top';
      }

      // Parabolic bottom (Y falling, accelerating down)
      const ysDn = pts.every((p, i) => i === 0 || p.y <= pts[i-1].y + 1);
      const totalFall = pts[0].y - pts[pts.length-1].y;
      const secondHalfFall = pts[Math.floor(pts.length/2)].y - pts[pts.length-1].y;
      const firstHalfFall = pts[0].y - pts[Math.floor(pts.length/2)].y;
      if (!curvatureType && ysDn && totalFall >= 3 && secondHalfFall > firstHalfFall) {
        curvatureScore = Math.min(1, totalFall / 6);
        curvatureType = 'Parabolic Bottom';
      }

      // Linear compression: all 5 within a 3x3 box near lower-left
      if (!curvatureType) {
        const minX = Math.min(...pts.map(p => p.x));
        const maxX = Math.max(...pts.map(p => p.x));
        const minY = Math.min(...pts.map(p => p.y));
        const maxY = Math.max(...pts.map(p => p.y));
        const xSpan = maxX - minX;
        const ySpan = maxY - minY;
        if (xSpan <= 2 && ySpan <= 2 && maxX <= 5 && maxY <= 5) {
          // Tighter compression = higher score. xSpan+ySpan=0 → 1.0; =4 → 0.0
          curvatureScore = 1 - (xSpan + ySpan) / 4;
          curvatureType = 'Linear Compression';
        }
      }

      // Clockwise spiral: cumulative signed angle from each turn
      if (!curvatureType && pts.length >= 4) {
        let cumAngle = 0;
        for (let i = 1; i < pts.length - 1; i++) {
          const v1x = pts[i].x - pts[i-1].x, v1y = pts[i].y - pts[i-1].y;
          const v2x = pts[i+1].x - pts[i].x, v2y = pts[i+1].y - pts[i].y;
          // Cross product (z) — negative = clockwise in screen coords (y down)
          const cross = v1x * v2y - v1y * v2x;
          cumAngle += cross;
        }
        // Meaningful rotation magnitude
        if (Math.abs(cumAngle) >= 8) {
          curvatureScore = Math.min(1, Math.abs(cumAngle) / 16);
          curvatureType = cumAngle < 0 ? 'Clockwise Spiral' : 'Counter-Clockwise Spiral';
        }
      }

      if (curvatureType && curvatureScore > 0.35) {
        signals.push({
          law: 'Curvature',
          score: curvatureScore,
          direction: curvatureType.includes('Top') ? 'bearish'
                   : curvatureType.includes('Bottom') ? 'bullish'
                   : curvatureType.includes('Compression') ? 'pending'
                   : 'reversal',
          detail: curvatureType + ' · ' +
            (curvatureType === 'Parabolic Top'    ? 'blow-off forming'
           : curvatureType === 'Parabolic Bottom' ? 'capitulation forming'
           : curvatureType === 'Linear Compression' ? 'market reloading'
           : 'rounding pattern forming'),
        });
      }
    }

    // ── Law 4: Divergence (price vs coordinate) ──
    // Compare price extremes in last 5 bars with matrix coord extremes.
    // Bearish: price makes higher high but matrix y drops / x rises (effort up, result down).
    // Bullish: price makes lower low but matrix lands in Q4 (selling absorbed).
    let divergenceScore = 0;
    let divergenceDir = null;
    if (window.length >= 5) {
      const priceHi = Math.max(...window.map(c => c.h));
      const priceLo = Math.min(...window.map(c => c.l));
      const currentMakesHH = cur.h === priceHi && cur.h > window[window.length - 2].h;
      const currentMakesLL = cur.l === priceLo && cur.l < window[window.length - 2].l;
      const priorBars = window.slice(0, -1);
      const priorMaxY = Math.max(...priorBars.map(c => c.coord.y));
      const priorMaxX = Math.max(...priorBars.map(c => c.coord.x));

      if (currentMakesHH && cur.coord.y < priorMaxY && cur.coord.x >= priorMaxX) {
        // Bearish divergence: higher high on price, but body collapsed and effort up
        divergenceScore = 0.65 + Math.min(0.3, (priorMaxY - cur.coord.y) / 10);
        divergenceDir = 'bearish';
      } else if (currentMakesLL && cur.quad === 4 && cur.coord.x >= 7) {
        // Bullish divergence: new low, but landed in Wall (absorption)
        divergenceScore = 0.65 + Math.min(0.3, (cur.coord.x - 6) / 10);
        divergenceDir = 'bullish';
      }
      if (divergenceScore > 0.35) {
        signals.push({
          law: 'Divergence',
          score: divergenceScore,
          direction: divergenceDir,
          detail: divergenceDir === 'bearish'
            ? 'Higher high · lower result · rising effort'
            : 'Lower low · absorption at wall',
        });
      }
    }

    // ── Law 5: Liquidity Divergence (matrix coord vs book density) ──
    // Compares what the realized candle "achieved" with what the limit order book
    // suggests is waiting. Three high-value cases:
    //   a) Bull Engine (Q2) with negative OBI: the move is eating asks without
    //      bid support refilling below → hollow uptrend, reversal primed.
    //   b) Bear Engine (Q2 in bearish mode) with positive OBI: selling is being
    //      absorbed by stacking bids → capitulation likely, bullish reversal primed.
    //   c) Wall (Q4) with OBI confirming the stall direction: the book is
    //      structurally confirming what the tape is showing.
    //
    // This law is smoothed over the last 3 bars so single-bar OBI noise doesn't
    // trigger false positives.
    let liqDivScore = 0;
    let liqDivDir = null;
    let liqDivDetail = '';
    if (cur.book && window.length >= 3) {
      const recent = window.slice(-3).filter(c => c.book);
      if (recent.length >= 2) {
        const avgObi = recent.reduce((a, c) => a + c.book.obi, 0) / recent.length;
        const curObi = cur.book.obi;

        // Case A: Bull Engine with hostile book
        if (cur.quad === 2 && cur.bias === 'bullish' && avgObi < -0.15) {
          const bookHostility = Math.min(1, Math.abs(avgObi) / 0.5);  // -0.5 OBI → 1.0
          const coordWeight = Math.min(1, (cur.coord.x + cur.coord.y - 10) / 8);
          liqDivScore = bookHostility * 0.55 + coordWeight * 0.35;
          liqDivDir = 'bearish';
          liqDivDetail = 'Bull Engine · eating asks · no bid refill';
        }
        // Case B: Bear Engine with supportive book (absorption)
        else if (cur.quad === 2 && cur.bias === 'bearish' && avgObi > 0.15) {
          const bookSupport = Math.min(1, avgObi / 0.5);
          const coordWeight = Math.min(1, (cur.coord.x + cur.coord.y - 10) / 8);
          liqDivScore = bookSupport * 0.55 + coordWeight * 0.35;
          liqDivDir = 'bullish';
          liqDivDetail = 'Bear Engine · bids stacking · absorption';
        }
        // Case C: Wall with book confirming stall direction
        else if (cur.quad === 4 && Math.abs(avgObi) > 0.25) {
          const bookConviction = Math.min(1, Math.abs(avgObi) / 0.5);
          const wallDepth = Math.min(1, (cur.coord.x - 5) / 5);
          liqDivScore = bookConviction * 0.45 + wallDepth * 0.35;
          // Book leaning against prior direction → reversal in that direction
          liqDivDir = avgObi > 0 ? 'bullish' : 'bearish';
          liqDivDetail = avgObi > 0
            ? 'Wall · bid stack confirms absorption'
            : 'Wall · ask stack confirms distribution';
        }
        // Case D: Vacuum with book leaning against the move
        else if (cur.quad === 1 && Math.sign(curObi) !== 0) {
          // If in Q1 with body-high y (stop run up), negative OBI accelerates snap-back
          const isThinUp = cur.coord.y >= 7;
          if (isThinUp && curObi < -0.2) {
            liqDivScore = 0.45 + Math.min(0.3, Math.abs(curObi) * 0.6);
            liqDivDir = 'bearish';
            liqDivDetail = 'Vacuum above · hostile book · snap-back imminent';
          } else if (isThinUp && curObi > 0.2) {
            // Thin move up but book supports → could extend (less urgent)
            liqDivScore = 0.35;
            liqDivDir = 'pending';
            liqDivDetail = 'Thin move · book still supportive';
          }
        }

        if (liqDivScore > 0.35) {
          signals.push({
            law: 'Liquidity Div.',
            score: liqDivScore,
            direction: liqDivDir,
            detail: liqDivDetail,
          });
        }
      }
    }

    // ── Apply timeframe-specific law weights ──
    // Each law's contribution is scaled by the active profile. Caps retained.
    const lawKeyMap = { 'Fat Reversal': 'Fat', 'Vacuum Snap': 'Vacuum', 'Curvature': 'Curvature', 'Divergence': 'Divergence', 'Liquidity Div.': 'Liquidity' };
    const weightedSignals = signals.map(s => {
      const wKey = lawKeyMap[s.law] || s.law;
      const w = profile.lawWeights[wKey] ?? 1.0;
      return { ...s, rawScore: s.score, weight: w, score: Math.min(1, s.score * w) };
    });

    // ── Aggregate: weighted combination ──
    // Individual laws are additive but capped; when multiple fire on the same
    // direction, confidence climbs toward 1.0 quickly. Drops anything that falls
    // below the ≥0.35 activation threshold after reweighting.
    const activeSignals = weightedSignals.filter(s => s.score >= 0.30);
    if (activeSignals.length === 0) {
      return { score: 0, direction: null, primaryLaw: null, signals: [], target: vacuumTarget, significance: profile.significanceMultiplier };
    }
    // Determine aggregate direction by vote (bearish vs bullish vs reversal-neutral)
    const bearishWeight = activeSignals.filter(s => s.direction === 'bearish').reduce((a, s) => a + s.score, 0);
    const bullishWeight = activeSignals.filter(s => s.direction === 'bullish').reduce((a, s) => a + s.score, 0);
    const neutralWeight = activeSignals.filter(s => s.direction === 'reversal' || s.direction === 'pending').reduce((a, s) => a + s.score, 0);
    let direction = 'reversal';
    if (bearishWeight > bullishWeight * 1.3) direction = 'bearish';
    else if (bullishWeight > bearishWeight * 1.3) direction = 'bullish';
    else if (neutralWeight > bearishWeight + bullishWeight) direction = 'pending';

    // Compound confidence: max single + dampened sum of others
    activeSignals.sort((a, b) => b.score - a.score);
    const top = activeSignals[0].score;
    const rest = activeSignals.slice(1).reduce((a, s) => a + s.score * 0.35, 0);
    let rawScore = Math.min(0.98, top * 0.75 + rest);

    // ── Inertia bonus (long timeframes reward trail consistency) ──
    // When the trail is compact (velocity.avgSegment low) AND the current cell has
    // stayed in one quadrant, the market has "Mass" — signals are more trustworthy.
    let inertiaBonus = 0;
    if (profile.inertiaFactor > 0 && candles.length >= 4) {
      const lastFourQuads = candles.slice(-4).map(c => c.quad);
      const quadConsistent = lastFourQuads.every(q => q === lastFourQuads[0]);
      if (quadConsistent) inertiaBonus = profile.inertiaFactor * 0.15;
    }

    // ── Apply Statistical Significance multiplier ──
    // A raw 80% signal on 1m becomes ~58% "significant" (scouts); on 1d it becomes ~99% (armies).
    const significantScore = Math.min(0.99, (rawScore + inertiaBonus) * profile.significanceMultiplier);

    return {
      score: significantScore,
      rawScore,
      significance: profile.significanceMultiplier,
      inertiaBonus,
      direction,
      primaryLaw: activeSignals[0].law,
      signals: activeSignals,
      target: vacuumTarget,
    };
  }, [candles, current, trail, profile]);

  // Detect named vector transitions
  useEffect(() => {
    if (!current) return;
    const q = current.quad;
    candleCountRef.current += 1;
    if (lastQuadRef.current !== null && lastQuadRef.current !== q) {
      const key = `${lastQuadRef.current}-${q}`;
      const def = VECTOR_NAMES[key];
      if (def) {
        setVectorHistory(prev => [
          { ts: Date.now(), name: def.name, severity: def.severity, from: lastQuadRef.current, to: q, idx: candleCountRef.current },
          ...prev,
        ].slice(0, 20));
      }
    }
    lastQuadRef.current = q;
  }, [current?.id]);

  // Hover tooltip data
  const hoverInfo = hover ? cellTaxonomy(hover.x, hover.y, hover.q) : null;

  const activeCoord = current?.coord;
  const activeQuad = current?.quad;
  const volPctDisplay = current ? (current.volPct * 100).toFixed(0) : '—';
  const bodyPctDisplay = current ? (current.bodyPct * 100).toFixed(0) : '—';

  return (
    <div className="min-h-screen w-full text-[var(--fg)] relative overflow-x-hidden"
         style={{
           background: 'var(--bg)',
           fontFamily: "'JetBrains Mono', ui-monospace, monospace",
           fontWeight: 300,
         }}>
      {/* Global font + CSS vars */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Fraunces:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap');
        :root {
          --bg: #0a0b0d;
          --bg-alt: #111316;
          --line: #1d2025;
          --line-strong: #2a2f37;
          --fg: #d8d4c7;
          --fg-dim: #6b6a63;
          --fg-mute: #3d3d39;
          --amber: #d4a84b;
          --up: #6ba368;
          --down: #ff5a5a;
          --cyan: #5fa8a8;
        }
        body { background: #0a0b0d; color: #d8d4c7; }
        button {
          color: #d8d4c7 !important;
          -webkit-text-fill-color: #d8d4c7;
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          background: transparent;
          -webkit-appearance: none;
          appearance: none;
        }
        button.btn-active {
          color: #0a0b0d !important;
          -webkit-text-fill-color: #0a0b0d;
        }
        button:hover {
          color: #d4a84b !important;
          -webkit-text-fill-color: #d4a84b;
        }
        button.btn-active:hover {
          color: #0a0b0d !important;
          -webkit-text-fill-color: #0a0b0d;
        }

        /* Impact flash: fires when active cell lands in Q2 Engine or Q4 Wall.
           Uses a keyed overlay div so React remounts and re-triggers the
           animation each bar. The flash is a radiating ring + inner light bloom. */
        @keyframes impactFlash {
          0%   { box-shadow: inset 0 0 0 0px var(--flash-solid), inset 0 0 12px var(--flash-glow); background: rgba(255,255,255,0.0); }
          18%  { box-shadow: inset 0 0 0 2px var(--flash-solid), inset 0 0 30px var(--flash-glow); background: rgba(255,255,255,0.22); }
          45%  { box-shadow: inset 0 0 0 1px var(--flash-solid), inset 0 0 20px var(--flash-glow); background: rgba(255,255,255,0.08); }
          100% { box-shadow: inset 0 0 0 0px var(--flash-solid), inset 0 0 0px  var(--flash-glow); background: rgba(255,255,255,0.0); }
        }
        .impact-flash {
          animation: impactFlash 850ms cubic-bezier(0.18, 0.9, 0.32, 1.0) 1 forwards;
        }
        .grain::before {
          content: '';
          position: fixed; inset: 0; pointer-events: none; z-index: 100;
          background-image: url("data:image/svg+xml;utf8,<svg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.035 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
          opacity: 0.5; mix-blend-mode: overlay;
        }
      `}</style>
      <div className="grain"/>

      {/* Atmospheric radial glows */}
      <div className="fixed inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 60% 40% at 15% 0%, rgba(212,168,75,0.04), transparent 50%), radial-gradient(ellipse 50% 40% at 85% 100%, rgba(95,168,168,0.03), transparent 50%)'
      }}/>

      <div className="relative mx-auto" style={{ maxWidth: 1680, padding: isMobile ? '24px 16px' : '32px' }}>
        {/* HEADER */}
        <header className="flex items-end justify-between border-b border-[var(--line-strong)] pb-5 mb-7 gap-4 flex-wrap">
          <div className="flex items-baseline gap-4 flex-wrap">
            <span className="font-['Fraunces'] italic font-light text-[32px] text-[var(--amber)] leading-none">ℓ</span>
            <div>
              <h1 className="font-['Fraunces'] text-[22px] leading-tight tracking-tight">VWC Dynamic Matrix</h1>
              <div className="text-[10px] tracking-[0.25em] uppercase text-[var(--fg-dim)] mt-0.5">
                Real-time Geometric Pattern Recognizer · Scripted Cycle
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <ModeBadge mode={mode}/>
            <div className="flex items-center gap-2 px-3 py-1.5 border transition-all"
                 style={{
                   borderColor: profile.accent,
                   background: `linear-gradient(135deg, ${profile.accent}18, transparent)`,
                 }}>
              <Clock size={12} style={{ color: profile.accent }} strokeWidth={1.75}/>
              <div className="leading-none">
                <div className="text-[10px] tracking-[0.2em] uppercase font-medium" style={{ color: profile.accent }}>
                  {profile.context}
                </div>
                <div className="text-[8px] tracking-[0.18em] uppercase text-[var(--fg-mute)] mt-0.5">
                  {profile.short} · {profile.contextTag}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase text-[var(--fg-dim)]">
              <div className="w-1.5 h-1.5 rounded-full" style={{
                background: playing ? '#6ba368' : '#3d3d39',
                boxShadow: playing ? '0 0 8px rgba(107,163,104,0.6)' : 'none',
              }}/>
              {playing ? 'Feed Live' : 'Feed Paused'}
            </div>
          </div>
        </header>

        {/* CONTROL STRIP */}
        <div className="flex flex-wrap items-center gap-4 px-5 py-3 bg-[var(--bg-alt)] border border-[var(--line)] mb-5">
          <button
            onClick={() => setPlaying(p => !p)}
            className="flex items-center gap-2 px-3 py-1.5 border border-[var(--line-strong)] text-[var(--fg)] hover:border-[var(--amber)] hover:text-[var(--amber)] transition-colors text-[11px] tracking-[0.1em] uppercase bg-transparent"
          >
            {playing ? <Pause size={12} strokeWidth={1.75}/> : <Play size={12} strokeWidth={1.75}/>}
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            onClick={() => { reset(); setVectorHistory([]); lastQuadRef.current = null; candleCountRef.current = 0; }}
            className="flex items-center gap-2 px-3 py-1.5 border border-[var(--line-strong)] text-[var(--fg)] hover:border-[var(--amber)] hover:text-[var(--amber)] transition-colors text-[11px] tracking-[0.1em] uppercase bg-transparent"
          >
            <Rewind size={12} strokeWidth={1.75}/>
            Reset
          </button>
          <div className="flex items-center gap-2">
            <Gauge size={12} className="text-[var(--fg-dim)]" strokeWidth={1.5}/>
            <span className="text-[9px] tracking-[0.22em] uppercase text-[var(--fg-dim)]">Speed</span>
            <div className="inline-flex border border-[var(--line-strong)]">
              {[0.5, 1, 2, 4].map(s => (
                <button key={s} onClick={() => setSpeed(s)}
                  className={`px-2.5 py-1 text-[10px] tracking-[0.08em] border-r border-[var(--line-strong)] last:border-r-0 transition-colors ${speed === s ? 'btn-active' : ''}`}
                  style={{
                    background: speed === s ? '#d4a84b' : 'transparent',
                    fontWeight: speed === s ? 500 : 300,
                  }}>
                  {s}×
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={12} className="text-[var(--fg-dim)]" strokeWidth={1.5}/>
            <span className="text-[9px] tracking-[0.22em] uppercase text-[var(--fg-dim)]">TF</span>
            <div className="inline-flex border border-[var(--line-strong)]">
              {Object.keys(TIMEFRAME_PROFILES).map(tf => (
                <button key={tf} onClick={() => setTimeframe(tf)}
                  className={`px-2 py-1 text-[10px] tracking-[0.08em] border-r border-[var(--line-strong)] last:border-r-0 transition-colors ${timeframe === tf ? 'btn-active' : ''}`}
                  style={{
                    background: timeframe === tf ? profile.accent : 'transparent',
                    fontWeight: timeframe === tf ? 500 : 300,
                  }}>
                  {TIMEFRAME_PROFILES[tf].short}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1"/>
          <div className="flex gap-5 text-[10px] uppercase tracking-[0.15em]">
            <div><span className="text-[var(--fg-mute)]">Bars</span> <span className="text-[var(--fg)] font-medium">{candles.length}</span></div>
            <div><span className="text-[var(--fg-mute)]">Coord</span> <span className="text-[var(--amber)] font-medium">{activeCoord ? `${activeCoord.x},${activeCoord.y}` : '—'}</span></div>
            <div><span className="text-[var(--fg-mute)]">Quad</span> <span className="text-[var(--fg)] font-medium">{activeQuad ? `Q${activeQuad} ${QUAD_META[activeQuad].name.toUpperCase()}` : '—'}</span></div>
            <div><span className="text-[var(--fg-mute)]">OBI</span> <span className="font-medium" style={{
              color: current?.book?.obi > 0.15 ? '#6ba368' : current?.book?.obi < -0.15 ? '#ff5a5a' : '#d8d4c7'
            }}>{current?.book ? (current.book.obi > 0 ? '+' : '') + (current.book.obi * 100).toFixed(0) + '%' : '—'}</span></div>
          </div>
        </div>

        {/* MAIN LAYOUT — JS-driven responsive grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isDesktop ? 'minmax(0, 1fr) 320px' : '1fr',
          gap: '24px',
        }}>

          {/* LEFT COLUMN */}
          <div className="space-y-5">

            {/* CANDLE CHART + DEPTH HEATMAP — full width, it's a time series */}
            <div className="bg-[var(--bg-alt)] border border-[var(--line)] p-5 relative">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Activity size={12} className="text-[var(--amber)]" strokeWidth={1.5}/>
                  <span className="text-[9px] tracking-[0.25em] uppercase text-[var(--fg-dim)]">Volume-Weighted Tape</span>
                  <span className="text-[8px] tracking-[0.2em] uppercase text-[var(--fg-mute)] ml-1">+ L2 Depth</span>
                </div>
                <div className="flex items-center gap-3 text-[9px] tracking-[0.15em] uppercase text-[var(--fg-mute)]">
                  <span>width = vol</span>
                  <span>height = body</span>
                </div>
              </div>
              <div className="flex gap-2" style={{ height: isMobile ? 240 : 300 }}>
                <div className="flex-1 border border-[var(--line)] min-w-0">
                  <CandleChart candles={candles}/>
                </div>
                <DepthHeatmap book={current?.book}/>
              </div>
            </div>

            {/* MATRIX + REVERSAL — side-by-side on tablet+, stacked on mobile */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) minmax(360px, 420px)',
              gap: '20px',
              alignItems: 'start',
            }}>

              {/* MATRIX PANEL */}
              <div className="bg-[var(--bg-alt)] border border-[var(--line)] p-5 relative">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Layers size={12} className="text-[var(--amber)]" strokeWidth={1.5}/>
                    <span className="text-[9px] tracking-[0.25em] uppercase text-[var(--fg-dim)]">10×10 Coordinate Matrix</span>
                  </div>
                  <div className="flex items-center gap-3 text-[9px] tracking-[0.15em] uppercase text-[var(--fg-mute)] flex-wrap">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2" style={{
                        background: mode === 'bullish' ? '#6ba368' : mode === 'bearish' ? '#ff5a5a' : '#d4a84b',
                      boxShadow: mode === 'bullish'
                        ? '0 0 6px rgba(107,163,104,0.7)'
                        : mode === 'bearish'
                          ? '0 0 6px rgba(255,90,90,0.85)'
                          : '0 0 6px rgba(212,168,75,0.7)',
                      transition: 'background 150ms, box-shadow 150ms',
                    }}/> current
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 border border-[var(--amber)]"/> trail (t-1, t-2)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <svg width="14" height="6" className="shrink-0">
                      <line x1="0" y1="3" x2="14" y2="3" stroke={mode === 'bullish' ? '#6ba368' : mode === 'bearish' ? '#ff5a5a' : '#d4a84b'} strokeWidth="1" strokeDasharray="2 1.5" opacity="0.9"/>
                    </svg>
                    path · {velocity.state?.toLowerCase() || '—'}
                  </span>
                  {current?.book && Math.abs(current.book.obi) > 0.08 && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{
                        background: current.book.obi > 0 ? 'rgba(80,230,170,0.9)' : 'rgba(255,100,160,0.9)',
                        boxShadow: `0 0 6px ${current.book.obi > 0 ? 'rgba(80,230,170,0.7)' : 'rgba(255,100,160,0.7)'}`,
                      }}/>
                      L2 · {current.book.obi > 0 ? 'supported' : 'resisted'}
                    </span>
                  )}
                </div>
              </div>

              <div className="relative pl-10 pb-10">
                {/* Y axis label */}
                <div className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 origin-center text-[9px] tracking-[0.28em] uppercase text-[var(--fg-dim)] whitespace-nowrap">
                  Body Range (Result) →
                </div>
                {/* X axis label */}
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[9px] tracking-[0.28em] uppercase text-[var(--fg-dim)]">
                  Volume (Effort) →
                </div>

                {/* Y ticks */}
                <div className="absolute left-3 top-0 h-full pb-10 flex flex-col-reverse justify-between text-[9px] text-[var(--fg-mute)]">
                  {[1,2,3,4,5,6,7,8,9,10].map(n => (
                    <span key={n} className="leading-none">{n}</span>
                  ))}
                </div>

                {/* The matrix */}
                <div className="relative">
                  <Matrix
                    bias={mode}
                    activeCoord={activeCoord}
                    activeQuad={activeQuad}
                    trailCoords={trail}
                    pulseId={current?.id}
                    reversal={reversal}
                    obi={current?.book?.obi}
                    onHover={(x, y, q) => setHover({ x, y, q })}
                    onLeave={() => setHover(null)}
                  />

                  {/* Quadrant labels (overlay, non-blocking) */}
                  <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute top-2 left-2 text-[var(--fg-mute)]">
                      <div className="text-[8px] tracking-[0.25em] uppercase">Q1 · Low / High</div>
                      <div className="font-['Fraunces'] italic text-xs text-[var(--fg-dim)]">Vacuum</div>
                    </div>
                    <div className="absolute top-2 right-2 text-right text-[var(--fg-mute)]">
                      <div className="text-[8px] tracking-[0.25em] uppercase">Q2 · High / High</div>
                      <div className="font-['Fraunces'] italic text-xs text-[var(--fg-dim)]">Engine</div>
                    </div>
                    <div className="absolute bottom-2 left-2 text-[var(--fg-mute)]">
                      <div className="text-[8px] tracking-[0.25em] uppercase">Q3 · Low / Low</div>
                      <div className="font-['Fraunces'] italic text-xs text-[var(--fg-dim)]">Apathy</div>
                    </div>
                    <div className="absolute bottom-2 right-2 text-right text-[var(--fg-mute)]">
                      <div className="text-[8px] tracking-[0.25em] uppercase">Q4 · High / Low</div>
                      <div className="font-['Fraunces'] italic text-xs text-[var(--fg-dim)]">Wall</div>
                    </div>
                  </div>
                </div>

                {/* X ticks */}
                <div className="grid grid-cols-10 mt-1 pl-0 text-[9px] text-[var(--fg-mute)] text-center">
                  {[1,2,3,4,5,6,7,8,9,10].map(n => (
                    <span key={n}>{n}</span>
                  ))}
                </div>
              </div>

              {/* Hover detail */}
              <div className="mt-4 pt-4 border-t border-[var(--line)] min-h-[70px]">
                {hoverInfo ? (
                  <div>
                    <div className="font-['Fraunces'] italic text-base text-[var(--amber)]">{hoverInfo.headline}</div>
                    <div className="text-[11px] text-[var(--fg)] mt-1">{hoverInfo.body}</div>
                    {hoverInfo.edge && (
                      <div className="text-[11px] text-[var(--fg-dim)] italic mt-1.5 font-['Fraunces']">
                        {hoverInfo.edge}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] text-[var(--fg-mute)] italic tracking-wide">
                    hover any cell for taxonomic summary · current highlighted cell is the live coordinate
                  </div>
                )}
              </div>
            </div>

            {/* REVERSAL SIGNAL — sibling of matrix panel, side-by-side on desktop */}
            <div style={{
              position: isMobile ? 'static' : 'sticky',
              top: 24,
              alignSelf: 'start',
            }}>
              <ReversalSignal reversal={reversal} currentQuad={activeQuad} profile={profile}/>
            </div>
          </div>
          </div>

          {/* RIGHT COLUMN — SIDEBAR */}
          <aside className="space-y-5">

            {/* CYCLE TIMELINE */}
            <div className="bg-[var(--bg-alt)] border border-[var(--line)] p-5">
              <PhaseTimeline phaseIdx={phaseIdx} phaseTick={phaseTick} phase={phase}/>
            </div>

            {/* LIVE STATE */}
            <div className="bg-[var(--bg-alt)] border border-[var(--line)] p-5 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Target size={12} className="text-[var(--amber)]" strokeWidth={1.5}/>
                <span className="text-[9px] tracking-[0.25em] uppercase text-[var(--fg-dim)]">Live Telemetry</span>
              </div>
              <StatRow label="Vol Percentile" value={current ? `${volPctDisplay}` : '—'} suffix="th"/>
              <StatRow label="Body Percentile" value={current ? `${bodyPctDisplay}` : '—'} suffix="th"/>
              <StatRow label="Coordinate" value={activeCoord ? `[${activeCoord.x}, ${activeCoord.y}]` : '—'} accent/>
              <StatRow label="Quadrant"
                       value={activeQuad ? QUAD_META[activeQuad].name : '—'}
                       subvalue={activeQuad ? QUAD_META[activeQuad].tag : ''}/>
              <StatRow label="Mode" value={mode.charAt(0).toUpperCase() + mode.slice(1)}
                       accentColor={mode === 'bullish' ? '#6ba368' : mode === 'bearish' ? '#ff5a5a' : '#d4a84b'}/>
              <StatRow label="Velocity"
                       value={velocity.state}
                       subvalue={velocity.tag}
                       accentColor={
                         velocity.state === 'Compressing' ? '#5fa8a8' :
                         velocity.state === 'Stable'      ? '#8a8374' :
                         velocity.state === 'Expanding'   ? '#d4a84b' :
                         velocity.state === 'Discharging' ? '#ff5a5a' :
                         '#6b6a63'
                       }/>
              <StatRow label="Path Length"
                       value={velocity.dist ? velocity.dist.toFixed(2) : '—'}
                       suffix="u"/>
              <StatRow label="Energy"
                       value={activeQuad === 2 ? 'IMPACT · Engine' : activeQuad === 4 ? 'IMPACT · Wall' : 'Quiescent'}
                       accentColor={activeQuad === 2 ? '#6ba368' : activeQuad === 4 ? '#ff5a5a' : '#6b6a63'}/>
              {current?.book && (
                <>
                  <StatRow label="OBI"
                           value={(current.book.obi > 0 ? '+' : '') + (current.book.obi * 100).toFixed(1)}
                           suffix="%"
                           subvalue={
                             current.book.obi > 0.25 ? 'Heavy bid · book supports' :
                             current.book.obi > 0.1  ? 'Bid-leaning' :
                             current.book.obi < -0.25 ? 'Heavy ask · book resists' :
                             current.book.obi < -0.1  ? 'Ask-leaning' :
                             'Balanced'
                           }
                           accentColor={
                             current.book.obi > 0.15 ? '#6ba368' :
                             current.book.obi < -0.15 ? '#ff5a5a' :
                             '#8a8374'
                           }/>
                  <StatRow label="Book Depth"
                           value={`${((current.book.bidTot + current.book.askTot)/1000).toFixed(1)}k`}
                           subvalue={`bid ${(current.book.bidTot/1000).toFixed(1)}k · ask ${(current.book.askTot/1000).toFixed(1)}k`}/>
                </>
              )}
            </div>

            {/* VECTOR STREAM */}
            <div className="bg-[var(--bg-alt)] border border-[var(--line)] p-5">
              <VectorTicker vectorHistory={vectorHistory}/>
            </div>

            {/* LEGEND */}
            <div className="bg-[var(--bg-alt)] border border-[var(--line)] p-5">
              <div className="flex items-center gap-2 mb-3">
                <CircleDot size={12} className="text-[var(--amber)]" strokeWidth={1.5}/>
                <span className="text-[9px] tracking-[0.25em] uppercase text-[var(--fg-dim)]">Quadrant Key</span>
              </div>
              <div className="space-y-2.5 text-[11px]">
                {[1,2,3,4].map(q => (
                  <div key={q} className="flex items-start gap-2.5">
                    <div className="w-2 h-2 mt-1.5 shrink-0" style={{ background: QUAD_META[q].color }}/>
                    <div>
                      <div><span className="font-['Fraunces'] italic text-[var(--fg)]">{QUAD_META[q].name}</span>
                        <span className="text-[var(--fg-mute)] text-[9px] tracking-widest ml-1.5">Q{q}</span>
                      </div>
                      <div className="text-[10px] text-[var(--fg-dim)] leading-snug">{QUAD_META[q].tag}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>

        {/* BOTTOM: TRANSITION TAXONOMY */}
        <div className="mt-8 bg-[var(--bg-alt)] border border-[var(--line)] p-6">
          <div className="flex items-center gap-2 mb-4">
            <Zap size={12} className="text-[var(--amber)]" strokeWidth={1.5}/>
            <span className="text-[9px] tracking-[0.25em] uppercase text-[var(--fg-dim)]">Named Vector Transitions · Pattern Key</span>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${isMobile ? 2 : isTablet ? 4 : 6}, minmax(0, 1fr))`,
            gap: '1px',
            background: 'var(--line)',
          }}>
            {Object.entries(VECTOR_NAMES).map(([key, def]) => {
              const [from, to] = key.split('-');
              const sevColor = { go: '#6ba368', warn: '#d4a84b', alert: '#c75c5c', cool: '#5fa8a8' }[def.severity];
              return (
                <div key={key} className="bg-[var(--bg-alt)] p-3">
                  <div className="text-[9px] tracking-[0.2em] text-[var(--fg-mute)]">Q{from} → Q{to}</div>
                  <div className="font-['Fraunces'] italic text-sm mt-0.5" style={{ color: sevColor }}>{def.name}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* FOOTER */}
        <footer className="mt-8 pt-4 border-t border-[var(--line)] text-[9px] tracking-[0.22em] uppercase text-[var(--fg-mute)] flex justify-between">
          <span>
            Percentile Rank · N={profile.lookback} ·{' '}
            Spread Penalty {(profile.spreadPenalty * 100).toFixed(1)}% ·{' '}
            Significance ×{profile.significanceMultiplier.toFixed(2)}
          </span>
          <span>Simulated feed — not market data</span>
        </footer>
      </div>
    </div>
  );
}

function StatRow({ label, value, subvalue, suffix, accent, accentColor }) {
  return (
    <div className="flex items-baseline justify-between border-b border-dashed border-[var(--line)] pb-2 last:border-b-0">
      <span className="text-[9px] tracking-[0.22em] uppercase text-[var(--fg-dim)]">{label}</span>
      <div className="text-right">
        <div className="text-[13px] font-medium tabular-nums"
             style={{ color: accentColor || (accent ? 'var(--amber)' : 'var(--fg)') }}>
          {value}{suffix && <span className="text-[10px] text-[var(--fg-mute)] ml-0.5">{suffix}</span>}
        </div>
        {subvalue && <div className="text-[9px] text-[var(--fg-mute)] tracking-wider">{subvalue}</div>}
      </div>
    </div>
  );
}
