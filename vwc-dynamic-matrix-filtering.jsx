import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Play, Pause, Rewind, Gauge, Activity, Zap, Target, TrendingUp, TrendingDown, Minus, CircleDot, Radio, Layers, Waves, Clock, FlaskConical, X } from 'lucide-react';
import { runBacktest, ES_TICK as ENGINE_ES_TICK } from './lib/backtestEngine.js';
import { defaultStrategy, buildStrategy } from './lib/strategyPresets.js';
import { buildRecommendations } from './lib/backtestRecommendations.js';

// ═══════════════════════════════════════════════════════════════
//  VWC DYNAMIC MATRIX — Real-Time Geometric Pattern Recognizer
// ═══════════════════════════════════════════════════════════════

// ───── CONFIG ─────
const LOOKBACK = 100;            // percentile window (default; overridden per timeframe)
const VIEW_CANDLES = 32;         // how many candles visible in chart
const GRID = 10;

// ─── Styled hover tips (native `title` cannot be max-width styled) ───
function Tip({ text, children, className = '', block = false }) {
  const [open, setOpen] = useState(false);
  if (!text) return children;
  const Tag = block ? 'div' : 'span';
  const baseWrap = block ? 'relative block w-full max-w-full' : 'relative inline-flex max-w-full';
  return (
    <Tag
      className={`${baseWrap} outline-none focus-visible:ring-1 focus-visible:ring-[#d4a84b]/35 rounded-sm ${className}`.trim()}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-[500] mt-1.5 box-border w-max max-w-[min(18rem,85vw)] whitespace-normal break-words rounded-sm border border-[#2a2f37] bg-[#0e1014] px-3 py-2.5 text-left text-[10px] font-mono font-light leading-snug tracking-wide text-[#d8d4c7] shadow-[0_12px_40px_rgba(0,0,0,0.65)]"
          style={{ borderLeft: '3px solid #d4a84b' }}
        >
          {text}
        </span>
      )}
    </Tag>
  );
}

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
      TFConfluence: 0.55,             // LTF-heavy TF; thin HTF context
    },
    trendLawWeights: {
      QuadrantLock: 1.0,
      CoordinateExtension: 1.0,
      VolumeExpansion: 0.72,          // micro TF: volume is noisy vs book
      OBIPersistence: 1.15,
      HTFAlignment: 0.85,
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
      TFConfluence: 0.80,
    },
    trendLawWeights: {
      QuadrantLock: 1.0,
      CoordinateExtension: 1.0,
      VolumeExpansion: 0.88,
      OBIPersistence: 1.08,
      HTFAlignment: 0.95,
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
      TFConfluence: 1.05,
    },
    trendLawWeights: {
      QuadrantLock: 1.0,
      CoordinateExtension: 1.0,
      VolumeExpansion: 1.0,
      OBIPersistence: 1.0,
      HTFAlignment: 1.0,
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
      TFConfluence: 1.20,
    },
    trendLawWeights: {
      QuadrantLock: 1.1,
      CoordinateExtension: 1.15,
      VolumeExpansion: 1.05,
      OBIPersistence: 0.82,
      HTFAlignment: 1.12,
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
      TFConfluence: 0.60,             // no real HTF above daily in this demo
    },
    trendLawWeights: {
      QuadrantLock: 1.2,
      CoordinateExtension: 1.25,
      VolumeExpansion: 1.15,
      OBIPersistence: 0.42,           // book microstructure is weak at daily
      HTFAlignment: 0.0,              // no synthetic HTF above daily in demo
    },
    candleIntervalMs: 1800,
    accent: '#b8846c',                // warm brown — slow, massive
  },
};

// Synthetic higher-TF bar size: how many active-TF bars roll up to one HTF step (demo MTFA).
const HTF_RATIO = { '1m': 5, '5m': 3, '15m': 4, '1h': 6, '1d': null };

/** Continuation strength gate + law windows — starting points for scripted-feed tuning. */
const TREND_GATE = {
  M: 5,              // last M bars for quad activation gate
  N: 3,              // need ≥N bars in Q2∪Q4 among last M
  K: 5,              // lookback for extension, volume, OBI (aligned with M)
  TAU_VOL: 0.60,     // Volume Expansion: min(volPct) over last K must clear this floor
  OBI_MIN_MATCH: 3,  // narrative floor: ≥3 of K bars sign-match gate direction (score still matchCount/K)
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

/** Standard normal — Box–Muller. */
function randn() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * One futures bar: quarter-tick prices, occasional open gaps, volatility clustering,
 * fat-tailed bodies, range-linked volume, asymmetric wicks, directional memory vs phase.
 */
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

          // ── Kinetic Heikin Ashi ──
          // Synthetic candle that averages intent across the previous bar.
          // HA Close = (O+H+L+C)/4
          // HA Open  = (HA_Open_prev + HA_Close_prev) / 2  (uses prior HA, not raw)
          // HA bias derives from HA_Close vs HA_Open, smoothing through small pullbacks.
          const prev1 = next[next.length - 2];
          const haClose = (newCandle.o + newCandle.h + newCandle.l + newCandle.c) / 4;
          const haOpen = prev1?.ha
            ? (prev1.ha.open + prev1.ha.close) / 2
            : (newCandle.o + newCandle.c) / 2;          // bootstrap on first bar
          const haHigh = Math.max(newCandle.h, haOpen, haClose);
          const haLow  = Math.min(newCandle.l, haOpen, haClose);
          const haBody = Math.abs(haClose - haOpen);
          const haBodyRangeHL = haHigh - haLow || 1;
          const haBodyFrac = haBody / haBodyRangeHL;
          const haIsDoji = haBodyFrac < 0.18 && bodyPct < 0.18;
          const haBias = haIsDoji ? 'mixed' : (haClose > haOpen ? 'bullish' : 'bearish');
          newCandle.ha = { open: haOpen, close: haClose, high: haHigh, low: haLow, body: haBody, bias: haBias };

          // ── HMA-smoothed coordinate (period 4) ──
          // Hull Moving Average: HMA(n) = WMA(2*WMA(n/2) - WMA(n), sqrt(n))
          // For n=4: inner uses WMA(2) and WMA(4), outer uses WMA(2).
          // We smooth x and y independently. This gives near-zero lag while
          // filtering single-bar spikes.
          const wma = (arr, period) => {
            if (arr.length < period) return arr[arr.length - 1];
            const slice = arr.slice(-period);
            let num = 0, den = 0;
            slice.forEach((v, i) => { const w = i + 1; num += v * w; den += w; });
            return num / den;
          };
          const coordBuf = next.map(c => c.coord).filter(Boolean);
          if (coordBuf.length >= 2) {
            const xs = coordBuf.map(c => c.x);
            const ys = coordBuf.map(c => c.y);
            // HMA period 4: inner = 2*WMA(2) - WMA(4), outer = WMA(inner, 2)
            const n = 4, half = 2, sqrtN = 2;
            const xInnerNow = 2 * wma(xs, half) - wma(xs, n);
            const yInnerNow = 2 * wma(ys, half) - wma(ys, n);
            // Need prior innerSeries for outer WMA; approximate by building recent innerSeries
            const innerSeriesX = [], innerSeriesY = [];
            for (let i = Math.max(0, xs.length - sqrtN); i <= xs.length - 1; i++) {
              const pref = xs.slice(0, i + 1);
              const prefY = ys.slice(0, i + 1);
              innerSeriesX.push(2 * wma(pref, half) - wma(pref, n));
              innerSeriesY.push(2 * wma(prefY, half) - wma(prefY, n));
            }
            const hmaX = wma(innerSeriesX, sqrtN);
            const hmaY = wma(innerSeriesY, sqrtN);
            newCandle.smoothCoord = {
              x: Math.max(1, Math.min(10, Math.round(hmaX))),
              y: Math.max(1, Math.min(10, Math.round(hmaY))),
            };
            newCandle.smoothQuad = quadrantOf(newCandle.smoothCoord.x, newCandle.smoothCoord.y);
          } else {
            newCandle.smoothCoord = newCandle.coord;
            newCandle.smoothQuad = newCandle.quad;
          }

          // ── Trend-persistent bias (5-bar weighted sentiment) ──
          // Mode only flips when ≥3 of last 5 HA bars agree on the new direction.
          // Hysteresis prevents whipsaws during choppy microstructure.
          const prevMode = prev1?.trendMode;
          const windowHA = next.slice(-5).map(c => c?.ha?.bias).filter(Boolean);
          const bullCount = windowHA.filter(b => b === 'bullish').length;
          const bearCount = windowHA.filter(b => b === 'bearish').length;
          let trendMode;
          if (!prevMode) {
            // Bootstrap — use current HA bias
            trendMode = haBias;
          } else if (prevMode === 'bullish' && bearCount >= 3) {
            trendMode = 'bearish';
          } else if (prevMode === 'bearish' && bullCount >= 3) {
            trendMode = 'bullish';
          } else if (prevMode === 'mixed' && bullCount >= 3) {
            trendMode = 'bullish';
          } else if (prevMode === 'mixed' && bearCount >= 3) {
            trendMode = 'bearish';
          } else {
            trendMode = prevMode;   // persist
          }
          newCandle.trendMode = trendMode;

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
function CandleChart({ candles, smooth, tradeMarkers = [] }) {
  const view = candles.slice(-VIEW_CANDLES);
  if (view.length === 0) return (
    <div className="h-full flex items-center justify-center text-[var(--fg-mute)] text-xs tracking-[0.3em] uppercase">
      waiting for feed...
    </div>
  );

  const W = 800, H = 240, PAD = 16;
  const plotW = W - PAD * 2;
  const plotH = H - PAD * 2;

  // ── Field picker: HA when smooth, raw otherwise ──
  // HA candles present the same O/H/L/C vocabulary but with smoothed values.
  // When smooth is on but a bar has no HA yet (bootstrap), fall back to raw.
  const pickO = c => (smooth && c.ha) ? c.ha.open  : c.o;
  const pickH = c => (smooth && c.ha) ? c.ha.high  : c.h;
  const pickL = c => (smooth && c.ha) ? c.ha.low   : c.l;
  const pickC = c => (smooth && c.ha) ? c.ha.close : c.c;
  const pickBias = c => {
    if (!smooth) return c.bias;
    if (!c.ha) return c.bias;
    return c.ha.bias;
  };

  const minL = Math.min(...view.map(pickL));
  const maxH = Math.max(...view.map(pickH));
  const range = maxH - minL || 1;
  const scaleY = v => PAD + (maxH - v) / range * plotH;

  const maxVol = Math.max(...view.map(c => c.vol));
  // Each slot gets a fixed width; candle body width = function of volume
  const slotW = plotW / VIEW_CANDLES;
  const viewStart = candles.length - view.length;

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
        const cO = pickO(c), cH = pickH(c), cL = pickL(c), cC = pickC(c);
        const slotIdx = VIEW_CANDLES - view.length + i;
        const slotX = PAD + slotW * slotIdx + slotW / 2;
        const volW = Math.max(1.5, (c.vol / maxVol) * slotW * 0.85);
        const bodyTop = scaleY(Math.max(cO, cC));
        const bodyBot = scaleY(Math.min(cO, cC));
        const bodyH = Math.max(1, bodyBot - bodyTop);
        const isUp = cC > cO;
        const barBias = pickBias(c);
        const isDoji = barBias === 'mixed';
        const color = isDoji ? '#d4a84b' : isUp ? '#6ba368' : '#ff5a5a';
        const isLast = i === view.length - 1;

        return (
          <g key={c.id} opacity={isLast ? 1 : 0.85}>
            {/* wick */}
            <line x1={slotX} y1={scaleY(cH)} x2={slotX} y2={scaleY(cL)}
                  stroke={color} strokeWidth="0.8" opacity="0.8"/>
            {/* body */}
            <rect x={slotX - volW / 2} y={bodyTop} width={volW} height={bodyH}
                  fill={color} fillOpacity={isUp || isDoji ? 0.95 : 0.85}
                  stroke={color} strokeWidth="0.7"/>
            {isLast && (
              <circle cx={slotX} cy={scaleY(cC)} r="2.5" fill="#d4a84b">
                <animate attributeName="r" values="2;5;2" dur="1.2s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite"/>
              </circle>
            )}
          </g>
        );
      })}

      {tradeMarkers.map((m, mi) => {
        if (m.barIndex < viewStart || m.barIndex >= candles.length) return null;
        const vi = m.barIndex - viewStart;
        const slotIdx = VIEW_CANDLES - view.length + vi;
        const slotX = PAD + slotW * slotIdx + slotW / 2;
        const y = scaleY(m.price);
        const fill = m.kind === 'entry'
          ? (m.side === 'long' ? '#5fa8a8' : '#c75c5c')
          : '#d4a84b';
        const d = m.kind === 'entry'
          ? (m.side === 'long'
            ? `M ${slotX - 4} ${y + 5} L ${slotX} ${y - 4} L ${slotX + 4} ${y + 5} Z`
            : `M ${slotX - 4} ${y - 5} L ${slotX} ${y + 4} L ${slotX + 4} ${y - 5} Z`)
          : `M ${slotX} ${y - 3} L ${slotX + 3} ${y} L ${slotX} ${y + 3} L ${slotX - 3} ${y} Z`;
        return <path key={mi} d={d} fill={fill} stroke="#0a0b0d" strokeWidth="0.35" opacity="0.95"/>;
      })}
    </svg>
  );
}

function StepEquityChart({ curve }) {
  const W = 360, H = 88, PAD = 6;
  if (!curve || curve.length < 2) {
    return <div className="text-[10px] text-[var(--fg-mute)] font-mono">Insufficient samples</div>;
  }
  const eq = curve.map(p => p.equity);
  const minE = Math.min(...eq), maxE = Math.max(...eq);
  const den = maxE - minE || 1;
  const innerW = W - PAD * 2, innerH = H - PAD * 2;
  const n = curve.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = PAD + (i / Math.max(1, n - 1)) * innerW;
    const y = PAD + (maxE - curve[i].equity) / den * innerH;
    if (i === 0) d = `M ${x} ${y}`;
    else d += ` H ${x} V ${y}`;
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[360px]" preserveAspectRatio="none">
      <rect width={W} height={H} fill="#0a0b0d" stroke="#1d2025"/>
      <path d={d} fill="none" stroke="#d4a84b" strokeWidth="1.2" vectorEffect="non-scaling-stroke"/>
    </svg>
  );
}

function BacktestModal({
  open, onClose, onRun, execution, setExecution, result, recommendations, strategyName, setStrategyName,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.72)' }}>
      <div className="bg-[var(--bg-alt)] border border-[var(--line-strong)] max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <div className="text-[10px] tracking-[0.25em] uppercase text-[var(--fg-dim)]">Backtest (simulated)</div>
          <button type="button" onClick={onClose} className="p-1 text-[var(--fg-mute)] hover:text-[var(--amber)]" aria-label="Close">
            <X size={16} strokeWidth={1.5}/>
          </button>
        </div>
        <div className="p-4 space-y-4 text-[11px] font-mono">
          <Tip block text="Uses recorded signal tape (smoothed EMA + trendMode) and next-bar-open fills. Early flat equity is normal while detectors warm up (~20–30+ bars).">
            <p className="text-[10px] text-[var(--fg-dim)] leading-relaxed">
              Results mirror the causal tape — not a replay of future phase data. Warm-up segments show as flat steps until gates activate.
            </p>
          </Tip>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[9px] tracking-[0.2em] uppercase text-[var(--fg-mute)]">Slippage (ticks, {ENGINE_ES_TICK} pt)</span>
              <input type="number" min={0} step={1} value={execution.slippageTicks}
                onChange={e => setExecution(x => ({ ...x, slippageTicks: +e.target.value || 0 }))}
                className="mt-1 w-full bg-[#0a0b0d] border border-[var(--line)] px-2 py-1 text-[var(--fg)]"/>
            </label>
            <label className="block">
              <span className="text-[9px] tracking-[0.2em] uppercase text-[var(--fg-mute)]">Commission / side</span>
              <input type="number" min={0} step={0.25} value={execution.commissionPerSide}
                onChange={e => setExecution(x => ({ ...x, commissionPerSide: +e.target.value || 0 }))}
                className="mt-1 w-full bg-[#0a0b0d] border border-[var(--line)] px-2 py-1 text-[var(--fg)]"/>
            </label>
            <label className="block">
              <span className="text-[9px] tracking-[0.2em] uppercase text-[var(--fg-mute)]">Initial balance</span>
              <input type="number" min={100} step={100} value={execution.initialBalance}
                onChange={e => setExecution(x => ({ ...x, initialBalance: +e.target.value || 10000 }))}
                className="mt-1 w-full bg-[#0a0b0d] border border-[var(--line)] px-2 py-1 text-[var(--fg)]"/>
            </label>
            <label className="flex items-end gap-2 pb-1">
              <input type="checkbox" checked={execution.useSpreadFloor}
                onChange={e => setExecution(x => ({ ...x, useSpreadFloor: e.target.checked }))}/>
              <span className="text-[9px] text-[var(--fg-dim)]">Spread floor (REQ-FEED-02)</span>
            </label>
          </div>

          <div>
            <span className="text-[9px] tracking-[0.2em] uppercase text-[var(--fg-mute)]">Strategy</span>
            <select value={strategyName} onChange={e => setStrategyName(e.target.value)}
              className="mt-1 w-full bg-[#0a0b0d] border border-[var(--line)] px-2 py-1 text-[var(--fg)]">
              <option value="default">Trend-follow (continuation gates)</option>
              <option value="meanReversion">Mean reversion (high reversal · low trend)</option>
            </select>
          </div>

          <button type="button" onClick={onRun}
            className="w-full py-2 border border-[var(--amber)] text-[var(--amber)] text-[10px] tracking-[0.2em] uppercase hover:bg-[rgba(212,168,75,0.12)]">
            Run backtest
          </button>

          {result && (
            <>
              <div className="border border-[var(--line)] p-3 space-y-2">
                <div className="text-[9px] tracking-[0.22em] uppercase text-[var(--fg-mute)]">Step equity</div>
                <StepEquityChart curve={result.equityCurve}/>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div><span className="text-[var(--fg-mute)]">Return </span>{result.metrics.totalReturnPct.toFixed(2)}%</div>
                  <div><span className="text-[var(--fg-mute)]">Max DD </span>{result.metrics.maxDrawdownPct.toFixed(1)}%</div>
                  <div><span className="text-[var(--fg-mute)]">Trades </span>{result.metrics.tradeCount}</div>
                  <div><span className="text-[var(--fg-mute)]">Win rate </span>{(result.metrics.winRate * 100).toFixed(0)}%</div>
                  <div><span className="text-[var(--fg-mute)]">PF </span>{result.metrics.profitFactor.toFixed(2)}</div>
                  <div><span className="text-[var(--fg-mute)]">Balance </span>{result.metrics.finalBalance.toFixed(1)}</div>
                </div>
              </div>

              <div className="border border-[var(--line)] p-3">
                <div className="text-[9px] tracking-[0.22em] uppercase text-[var(--fg-mute)] mb-2">Quadrant attribution (entry)</div>
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-[var(--fg-mute)] text-left">
                      <th className="pb-1">Q</th>
                      <th>Trades</th>
                      <th>Wins</th>
                      <th>Losses</th>
                      <th>Win %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[1, 2, 3, 4].map(q => {
                      const row = result.quadrantStats[q];
                      const wr = row.count ? (row.wins / row.count * 100).toFixed(0) : '—';
                      return (
                        <tr key={q} className="border-t border-[var(--line)]">
                          <td className="py-1">Q{q}</td>
                          <td>{row.count}</td>
                          <td className="text-[#6ba368]">{row.wins}</td>
                          <td className="text-[#c75c5c]">{row.losses}</td>
                          <td>{wr}{row.count ? '%' : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {recommendations?.length > 0 && (
                <div className="border border-[var(--line)] p-3 space-y-2">
                  <div className="text-[9px] tracking-[0.22em] uppercase text-[var(--fg-mute)]">Suggestions</div>
                  {recommendations.map((r, i) => (
                    <div key={i} className="text-[10px] text-[var(--fg-dim)] leading-snug">
                      <span className="text-[var(--amber)]">{r.parameter}:</span> {r.reason}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
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
function Matrix({ bias, activeCoord, trailCoords, activeQuad, pulseId, reversal, obi, smooth, onHover, onLeave }) {
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
            borderTop:   y === 5 ? '1px solid rgba(212,168,75,0.4)' : undefined,
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
      <div className="border border-[var(--line-strong)] relative w-full mx-auto" style={{
        zIndex: 1,
        aspectRatio: '1 / 1',
        display: 'grid',
        gridTemplateColumns: 'repeat(10, minmax(0, 1fr))',
        gridTemplateRows: 'repeat(10, minmax(0, 1fr))',
        gap: 0,
        minWidth: 220,
        minHeight: 220,
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
          {/* Draw trail — spline when `smooth`, jagged segments otherwise */}
          {smooth && svgPoints.length >= 2 ? (
            // Cardinal spline (Catmull-Rom approximation) through the points.
            // With only 2-3 points we construct smooth bezier segments.
            (() => {
              const pts = svgPoints;
              // Duplicate endpoints so the curve passes through them
              const extended = [pts[0], ...pts, pts[pts.length - 1]];
              const tension = 0.5;  // cardinal spline tension
              const segs = [];
              for (let i = 1; i < extended.length - 2; i++) {
                const p0 = extended[i - 1];
                const p1 = extended[i];
                const p2 = extended[i + 1];
                const p3 = extended[i + 2];
                const cp1x = p1.cx + (p2.cx - p0.cx) * tension / 3;
                const cp1y = p1.cy + (p2.cy - p0.cy) * tension / 3;
                const cp2x = p2.cx - (p3.cx - p1.cx) * tension / 3;
                const cp2y = p2.cy - (p3.cy - p1.cy) * tension / 3;
                segs.push({ from: p1, cp1x, cp1y, cp2x, cp2y, to: p2, idx: i - 1 });
              }
              return segs.map((s, j) => {
                const d = `M ${s.from.cx} ${s.from.cy} C ${s.cp1x} ${s.cp1y}, ${s.cp2x} ${s.cp2y}, ${s.to.cx} ${s.to.cy}`;
                const segOpacity = j === 0 ? 0.85 : 0.45;
                return (
                  <path
                    key={`s-${j}`}
                    d={d}
                    fill="none"
                    stroke={ac.solid}
                    strokeWidth="0.6"
                    strokeLinecap="round"
                    opacity={segOpacity}
                    filter="url(#trailGlow)"
                  />
                );
              });
            })()
          ) : (
            // Jagged dashed segments (original raw-mode rendering)
            svgPoints.map((p, i) => {
              if (i === svgPoints.length - 1) return null;
              const next = svgPoints[i + 1];
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
            })
          )}
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
    <Tip text="Bias label from the current bar’s trend mode (or raw bias when the regime filter is off). It colors how matrix effort/result is read, not a trade signal by itself.">
      <div className="inline-flex items-center gap-2 px-3 py-1.5 border"
           style={{ borderColor: c.color, background: c.bg, color: c.color }}>
        <Icon size={13} strokeWidth={1.75}/>
        <span className="text-[10px] tracking-[0.22em] uppercase font-medium">{c.label}</span>
      </div>
    </Tip>
  );
}

// ─── Phase Timeline ───
function PhaseTimeline({ phaseIdx, phaseTick, phase }) {
  return (
    <Tip block className="space-y-2" text="Scripted Wyckoff-style cycle for the demo feed. Phase biases how synthetic candles and book pressure are generated; it is not live market phase detection.">
      <div className="flex items-center gap-2">
        <Waves size={12} className="text-[var(--amber)]" strokeWidth={1.5}/>
        <span className="text-[9px] tracking-[0.25em] uppercase text-[var(--fg-dim)]">Cycle Position</span>
      </div>
      <div className="flex gap-1">
        {PHASES.map((p, i) => {
          const active = i === phaseIdx;
          const done = i < phaseIdx;
          return (
            <Tip key={p.id} text={`${p.name}: ${p.tag}`} className="flex-1 min-w-0">
            <div className="flex-1 group relative min-w-0">
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
            </Tip>
          );
        })}
      </div>
      <div className="pt-8">
        <div className="font-['Fraunces'] italic text-lg text-[var(--fg)]">{phase.name}</div>
        <div className="text-[10px] text-[var(--fg-dim)] tracking-wider">{phase.tag}</div>
      </div>
    </Tip>
  );
}

// ─── Vector Ticker ───
function VectorTicker({ vectorHistory }) {
  // vectorHistory is array of detected named transitions with timestamps
  return (
    <Tip block className="space-y-2" text="Recent named quadrant transitions detected on the regime-aware quad path (see pattern key for definitions).">
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
    </Tip>
  );
}

/** Presentation-only: maps continuation strength tier × reversal tier to a one-line regime readout. */
function jointTrendReversalReadout(trendTier, reversalTier) {
  const key = `${trendTier}|${reversalTier}`;
  const phrases = {
    'NONE|NONE': 'Apathy pocket — neither continuation nor handoff is asserting.',
    'NONE|LOW': 'Quiet tape with early reversal friction — watch for ignition.',
    'NONE|MODERATE': 'Exhaustion building — reversal rising without continuation support.',
    'NONE|HIGH': 'Climax risk — high reversal pressure while continuation strength is idle.',
    'LOW|NONE': 'Drift with continuation bias — reversal dormant.',
    'LOW|LOW': 'Two-way chop — weak continuation conviction and soft reversal.',
    'LOW|MODERATE': 'Late-cycle creep — continuation fading as reversal firms.',
    'LOW|HIGH': 'Blowoff forming — reversal surging into thinning continuation.',
    'MODERATE|NONE': 'Steady continuation — geometric handoff quiet.',
    'MODERATE|LOW': 'Continuation-led grind — minor structural disagreement.',
    'MODERATE|MODERATE': 'Tug-of-war — continuation and reversal both mid-range.',
    'MODERATE|HIGH': 'High-conviction turn risk — reversal catching live continuation.',
    'HIGH|NONE': 'Clean continuation — conviction without reversal alarm.',
    'HIGH|LOW': 'Strong continuation tape — only light reversal scouts.',
    'HIGH|MODERATE': 'Continuation dominant — keep an eye on building divergence.',
    'HIGH|HIGH': 'Volatile intersection — continuation and reversal both elevated (potential climax).',
  };
  return phrases[key] || `Continuation ${trendTier} · Reversal ${reversalTier} — mixed signal space.`;
}

function reversalTierFromScore(score) {
  const pct = Math.round((score || 0) * 100);
  if (pct >= 80) return 'HIGH';
  if (pct >= 55) return 'MODERATE';
  if (pct >= 30) return 'LOW';
  return 'NONE';
}

// ─── Continuation strength panel (conviction gauge) ───
function TrendStrengthPanel({ trend, profile, regimeFilter }) {
  const { score, rawScore, direction, signals, tier, reason } = trend;
  const pct = Math.round(score * 100);
  const rawPct = Math.round((rawScore || 0) * 100);
  const accent = '#22d3ee';
  const accentRgb = '34,211,238';
  const dirLabel = direction === 'bullish' ? 'Bullish continuation' : direction === 'bearish' ? 'Bearish continuation' : 'No headline direction';
  const dirTint = direction === 'bullish' ? '#6ba368' : direction === 'bearish' ? '#ff5a5a' : '#8a8374';

  const gaugeR = 42;
  const arcCirc = Math.PI * gaugeR;
  const arcOffset = arcCirc * (1 - score);

  const tipTrend = 'Continuation strength measures conviction (quadrant lock, coordinate extension toward the dominant corner, sustained volume, OBI persistence, HTF alignment). Headline direction is derived from the activation gate (Q2 vs Q4), not from voting across laws.';
  const tipEma = regimeFilter
    ? 'Regime filter ON: headline score uses the same asymmetric EMA as reversal to reduce single-bar flicker.'
    : 'Raw continuation score (no hysteresis) while the regime filter is off.';
  const tipGate = `Activation gate: need ≥${TREND_GATE.N} of the last ${TREND_GATE.M} bars in Engine (Q2) or Wall (Q4); laws evaluate on the last ${TREND_GATE.K} bars with τ=${TREND_GATE.TAU_VOL} on volume percentiles.`;

  return (
    <div className="bg-[var(--bg-alt)] border p-5 relative overflow-hidden transition-colors flex flex-col min-h-[472px]"
         style={{
           borderColor: `rgba(${accentRgb},0.55)`,
           boxShadow: score > 0.45 ? `0 0 20px rgba(${accentRgb},0.12), inset 0 0 36px rgba(${accentRgb},0.05)` : 'none',
         }}>
      {score > 0.55 && (
        <div className="absolute inset-0 pointer-events-none opacity-50" style={{
          background: `radial-gradient(ellipse at top left, rgba(${accentRgb},0.14), transparent 55%)`,
        }}/>
      )}

      <div className="flex items-center justify-between mb-3 relative shrink-0">
        <div className="flex items-center gap-2">
          <Tip text={tipTrend}>
            <span className="inline-flex">
              <TrendingUp size={12} style={{ color: score > 0.25 ? accent : '#5b6b78' }} strokeWidth={1.5}/>
            </span>
          </Tip>
          <Tip text={tipTrend}>
            <span className="text-[9px] tracking-[0.25em] uppercase text-[var(--fg-dim)]">Continuation Detector</span>
          </Tip>
          {trend.rawSignificant !== undefined && (
            <Tip text={tipEma}>
              <span className="text-[8px] tracking-[0.2em] uppercase font-medium ml-1 px-1.5 py-0.5 border" style={{
                borderColor: accent,
                color: accent,
                background: 'rgba(34,211,238,0.06)',
              }}>EMA</span>
            </Tip>
          )}
        </div>
        <Tip text={tipGate}>
          <span className="text-[8px] tracking-[0.22em] uppercase" style={{ color: profile?.accent || accent }}>
            Gate M={TREND_GATE.M} · N={TREND_GATE.N} · K={TREND_GATE.K}
          </span>
        </Tip>
      </div>

      <div className="flex items-center gap-4 mb-3 relative shrink-0">
        <Tip text="Arc fills to composite continuation strength (0–100%). Faint inner arc (when visible) is raw score before regime EMA when the filter is on.">
          <svg viewBox="0 0 100 56" className="w-[110px] h-[60px] shrink-0">
            <defs>
              <linearGradient id="trendGaugeGrad" x1="0" x2="1">
                <stop offset="0%" stopColor={accent} stopOpacity="0.25"/>
                <stop offset="100%" stopColor={accent} stopOpacity="1"/>
              </linearGradient>
            </defs>
            <path d={`M ${50 - gaugeR} 50 A ${gaugeR} ${gaugeR} 0 0 1 ${50 + gaugeR} 50`}
                  fill="none" stroke="#1d2025" strokeWidth="6" strokeLinecap="round"/>
            <path d={`M ${50 - gaugeR} 50 A ${gaugeR} ${gaugeR} 0 0 1 ${50 + gaugeR} 50`}
                  fill="none" stroke="url(#trendGaugeGrad)" strokeWidth="6" strokeLinecap="round"
                  strokeDasharray={arcCirc} strokeDashoffset={arcOffset}
                  style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.3,0.8,0.3,1), stroke 250ms' }}/>
            {rawScore > 0 && rawScore !== score && (
              <path d={`M ${50 - gaugeR} 50 A ${gaugeR} ${gaugeR} 0 0 1 ${50 + gaugeR} 50`}
                    fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round"
                    strokeDasharray={`${arcCirc * rawScore} ${arcCirc}`}
                    opacity="0.35"
                    style={{ transition: 'stroke-dasharray 600ms' }}/>
            )}
          </svg>
        </Tip>
        <Tip text="Tier thresholds: HIGH ≥65%, MODERATE ≥40%, LOW otherwise; NONE when the gate fails or direction is unresolved." block className="flex-1 min-w-0">
          <div>
            <div className="text-[9px] tracking-[0.22em] uppercase text-[var(--fg-mute)]">Conviction</div>
            <div className="font-['Fraunces'] italic text-[28px] leading-none tabular-nums" style={{ color: accent }}>
              {pct}<span className="text-[16px] text-[var(--fg-mute)]">%</span>
            </div>
            <div className="text-[9px] tracking-[0.25em] uppercase mt-1" style={{ color: dirTint }}>
              {tier} · <span style={{ color: accent }}>{dirLabel}</span>
            </div>
          </div>
        </Tip>
      </div>

      <Tip text={reason || 'Composite from weighted continuation laws (no timeframe significance multiplier in v1).'} block className="mb-3 pb-3 border-b border-[var(--line)] relative min-h-[52px] shrink-0">
        <div className="text-[10px] text-[var(--fg-dim)] leading-snug font-['Fraunces'] italic">
          {tier === 'NONE' && reason ? reason : `Raw stack ${rawPct}% · ${profile?.contextTag || 'profile'}`}
        </div>
      </Tip>

      <div className="relative min-h-[168px] max-h-[168px] overflow-y-auto overflow-x-hidden space-y-1.5 pr-1">
        {signals.length === 0 ? (
          <Tip text="No law cleared the post-weight activation threshold, or the gate returned neutral." block>
            <div className="text-[10px] italic text-[var(--fg-mute)] tracking-wide">
              {tier === 'NONE' ? 'gate idle · continuation strength suppressed' : 'coherence below threshold · laws not stacking'}
            </div>
          </Tip>
        ) : (
          signals.map((s, i) => {
            const subPct = Math.round(s.score * 100);
            const rawSubPct = Math.round((s.rawScore || s.score) * 100);
            const weight = s.weight || 1.0;
            const weightIsActive = Math.abs(weight - 1.0) > 0.05;
            const lawTip = `${s.law}: ${s.detail}${weightIsActive ? ` · Timeframe weight ×${weight.toFixed(2)} applied before aggregation.` : ''}`;
            return (
              <Tip key={`${s.law}-${i}`} text={lawTip} block>
                <div className="flex items-start gap-2 pb-1.5 border-b border-dashed border-[var(--line)] last:border-b-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-['Fraunces'] italic text-[13px]" style={{ color: accent }}>
                          {s.law}
                        </span>
                        {weightIsActive && (
                          <span className="text-[8px] tabular-nums px-1 border" style={{
                            borderColor: accent,
                            color: accent,
                            opacity: 0.75,
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
                    <div className="h-0.5 bg-[var(--line)] mt-1 overflow-hidden">
                      <div className="h-full transition-[width] duration-500"
                           style={{ width: `${subPct}%`, background: accent, boxShadow: `0 0 4px rgba(${accentRgb},0.45)` }}/>
                    </div>
                  </div>
                </div>
              </Tip>
            );
          })
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-[var(--line)] min-h-[40px] shrink-0 text-[9px] text-[var(--fg-mute)] tracking-wide">
        OBI narrative floor: ≥{TREND_GATE.OBI_MIN_MATCH} of {TREND_GATE.K} bars sign-aligned · vol floor τ={(TREND_GATE.TAU_VOL * 100).toFixed(0)}%
      </div>
    </div>
  );
}

// ─── Reversal Signal Panel ───
// Visualizes the composite reversal confidence from the Wyckoff geometric detector.
// Shows: direction badge, confidence arc (0-100%), active law chips, target coord.
function ReversalSignal({ reversal, currentQuad, profile, regimeFilter, mtfConfluenceActive = false }) {
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

  const tipDetector = 'Composite Wyckoff-style reversal score from multiple geometric laws (Fat, Vacuum, Curvature, Divergence, Liquidity, TF Confluence). Confidence is timeframe-adjusted.';
  const tipEma = regimeFilter
    ? 'Regime filter ON: displayed confidence uses an asymmetric EMA — it rises quickly when new evidence appears and decays slowly to reduce single-bar flicker.'
    : 'Shown when a smoothed raw score is available for comparison with the headline confidence.';
  const tipWyckoff = 'Active timeframe profile: how effort vs result and book microstructure are weighted for this bar size.';
  const tipGauge = 'Arc fills to composite confidence after significance scaling. Faint inner arc (when visible) traces raw geometric score before timeframe scaling.';
  const tipConfidence = 'Headline percentage is what the gauge shows: geometric detector output × timeframe significance (and inertia bonus when applicable).';
  const tipAdjustment = 'Live breakdown: raw law stack score, optional quad-consistency inertia, multiplied by the profile significance multiplier for this timeframe.';

  return (
    <div className="bg-[var(--bg-alt)] border p-5 relative overflow-hidden transition-colors flex flex-col min-h-[472px]"
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

      <div className="flex items-center justify-between mb-3 relative shrink-0">
        <div className="flex items-center gap-2">
          <Tip text="Geometric reversal module: composite Wyckoff-style laws applied to the recent matrix path.">
            <span className="inline-flex">
              <Zap size={12} style={{ color: score > 0.35 ? dc.main : '#d4a84b' }} strokeWidth={1.5}/>
            </span>
          </Tip>
          <Tip text={tipDetector}>
            <span className="text-[9px] tracking-[0.25em] uppercase text-[var(--fg-dim)]">Reversal Detector</span>
          </Tip>
          {reversal.rawSignificant !== undefined && (
            <Tip text={tipEma}>
              <span className="text-[8px] tracking-[0.2em] uppercase font-medium ml-1 px-1.5 py-0.5 border" style={{
                borderColor: '#d4a84b',
                color: '#d4a84b',
                background: 'rgba(212,168,75,0.08)',
              }}>EMA</span>
            </Tip>
          )}
        </div>
        <Tip text={tipWyckoff}>
          <span className="text-[8px] tracking-[0.22em] uppercase" style={{ color: profile?.accent || dc.main }}>
            Wyckoff · {profile?.context || 'E/R'}
          </span>
        </Tip>
      </div>

      {/* Gauge + confidence */}
      <div className="flex items-center gap-4 mb-3 relative shrink-0">
        <Tip text={tipGauge}>
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
        </Tip>
        <Tip text={tipConfidence} block className="flex-1 min-w-0">
          <div>
            <div className="text-[9px] tracking-[0.22em] uppercase text-[var(--fg-mute)]">Confidence</div>
            <div className="font-['Fraunces'] italic text-[28px] leading-none tabular-nums" style={{ color: dc.main }}>
              {pct}<span className="text-[16px] text-[var(--fg-mute)]">%</span>
            </div>
            <div className="text-[9px] tracking-[0.25em] uppercase mt-1" style={{ color: dc.main }}>
              {tier} · {dc.label}
            </div>
          </div>
        </Tip>
      </div>

      {/* ── Non-linear Adjustment Strip (fixed height — avoids layout jump when raw score appears) ── */}
      <Tip text={tipAdjustment} block className="mb-3 pb-3 border-b border-[var(--line)] relative min-h-[76px] shrink-0">
      <div>
        {profile && rawScore > 0 ? (
          <>
            <div className="text-[8px] tracking-[0.22em] uppercase text-[var(--fg-mute)] mb-1.5">
              Non-linear Adjustment · {profile.short}
            </div>
            <div className="flex items-center gap-2 text-[10px] font-mono tabular-nums flex-wrap">
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
          </>
        ) : (
          <div className="text-[8px] tracking-[0.22em] uppercase text-[var(--fg-mute)] opacity-60 pt-1">
            Non-linear Adjustment · {profile?.short || '—'} — awaiting raw geometric score
          </div>
        )}
      </div>
      </Tip>

      {/* Active laws — fixed viewport + scroll so panel height stays stable with many laws */}
      <div className="relative min-h-[168px] max-h-[168px] overflow-y-auto overflow-x-hidden space-y-1.5 pr-1">
        {signals.length === 0 ? (
          <Tip text="No law exceeded the activation threshold after timeframe weighting." block>
            <div className="text-[10px] italic text-[var(--fg-mute)] tracking-wide">
              monitoring path geometry · no reversal signature detected
            </div>
          </Tip>
        ) : (
          signals.map((s, i) => {
            const subPct = Math.round(s.score * 100);
            const rawSubPct = Math.round((s.rawScore || s.score) * 100);
            const weight = s.weight || 1.0;
            const weightIsActive = Math.abs(weight - 1.0) > 0.05;
            const lawTip = `${s.law}: ${s.detail}${weightIsActive ? ` · Timeframe weight ×${weight.toFixed(2)} applied before aggregation.` : ''}`;
            return (
              <Tip key={`${s.law}-${i}`} text={lawTip} block>
              <div className="flex items-start gap-2 pb-1.5 border-b border-dashed border-[var(--line)] last:border-b-0">
                <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="font-['Fraunces'] italic text-[13px]" style={{ color: dc.main }}>
                        {s.law}
                      </span>
                      {s.law === 'TF Confluence' && mtfConfluenceActive && (
                        <Tip text="Law 6 TF Confluence is in the active weighted stack — synthetic HTF and raw LTF proxy align with the dominant reversal direction.">
                          <span
                            className="text-[7px] tracking-[0.18em] uppercase px-1 py-0.5 rounded border font-medium transition-colors duration-200"
                            style={{
                              borderColor: '#2563eb',
                              color: '#ffffff',
                              background: '#2563eb',
                            }}
                          >MTF</span>
                        </Tip>
                      )}
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
              </Tip>
            );
          })
        )}
      </div>

      {/* Vacuum snap target — reserved row height so footer does not collapse when absent */}
      <Tip text={target
        ? 'Coordinate region toward which a Vacuum Snap law expects price to revert when hollow structure resolves.'
        : 'No vacuum projection on this bar. When Vacuum Snap fires with a structural target, its matrix coordinate appears here.'}
        block className="mt-3 pt-3 border-t border-[var(--line)] min-h-[40px] shrink-0">
      <div className="flex items-center gap-2 text-[10px] min-h-[40px]">
        {target ? (
          <>
            <Target size={10} style={{ color: dc.main }} strokeWidth={1.5}/>
            <span className="tracking-[0.15em] uppercase text-[var(--fg-dim)]">Mean-reversion target</span>
            <span className="font-['Fraunces'] italic ml-auto" style={{ color: dc.main }}>
              [{target.x}, {target.y}]
            </span>
          </>
        ) : (
          <span className="text-[var(--fg-mute)] opacity-0 select-none text-[10px]" aria-hidden="true">placeholder</span>
        )}
      </div>
      </Tip>
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
  const [regimeFilter, setRegimeFilter] = useState(true);   // Kinetic smoothing ON by default
  const profile = TIMEFRAME_PROFILES[timeframe];
  const { candles, phase, phaseIdx, phaseTick, reset } = useScriptedFeed(playing, speed, timeframe);
  const [hover, setHover] = useState(null);
  const [vectorHistory, setVectorHistory] = useState([]);
  const lastQuadRef = useRef(null);
  const candleCountRef = useRef(0);
  const signalTapeRef = useRef([]);
  const prevCandleLenRef = useRef(0);
  const prevFirstCandleIdRef = useRef(null);

  const [backtestOpen, setBacktestOpen] = useState(false);
  const [execution, setExecution] = useState({
    slippageTicks: 2,
    commissionPerSide: 0,
    riskFractionPerTrade: 0.01,
    fillLatencyBars: 1,
    initialBalance: 10000,
    useSpreadFloor: true,
    warmupBars: 5,
  });
  const [backtestResult, setBacktestResult] = useState(null);
  const [backtestRecommendations, setBacktestRecommendations] = useState([]);
  const [strategyName, setStrategyName] = useState('default');
  const [tradeMarkers, setTradeMarkers] = useState([]);

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
  const isDesktop = vw >= 1280;     // left rail | center (tape + matrix + detectors) | right rail
  const isTablet  = vw >= 900 && vw < 1280;  // stacked rails + center; matrix band spans then 2-col detectors
  const isMobile  = vw < 900;       // full stack
  // Desktop: one row matrix | reversal | trend (detectors stay right of matrix like reference). Tablet: two-row.
  const matrixBandSingleRow = isDesktop && !isMobile;
  const matrixBandTwoRow  = !isMobile && !matrixBandSingleRow;

  // Current candle
  const current = candles[candles.length - 1];

  // ── Regime-aware derivations ──
  // When regimeFilter is ON: coord/quad come from the HMA-smoothed values and
  // mode comes from the trend-persistent bias (5-bar weighted, with hysteresis).
  // When OFF: raw per-bar values (original behavior).
  const effectiveCoord = regimeFilter && current?.smoothCoord ? current.smoothCoord : current?.coord;
  const effectiveQuad  = regimeFilter && current?.smoothQuad  ? current.smoothQuad  : current?.quad;
  const mode           = regimeFilter ? (current?.trendMode || current?.bias || 'mixed')
                                       : (current?.bias || 'mixed');

  // Trail of last 3 coordinates (most recent first) — also regime-aware
  const trail = useMemo(() => {
    if (candles.length < 2) return [];
    const pick = c => (regimeFilter && c.smoothCoord) ? c.smoothCoord : c.coord;
    return candles.slice(-3).reverse().slice(1).map(pick);
  }, [candles, regimeFilter]);

  // Lightweight synthetic HTF: group active-TF bars so reversal can gate on macro trend/quad/OBI.
  const htfContext = useMemo(() => {
    const ratio = HTF_RATIO[timeframe];
    if (!ratio || candles.length < ratio * 3) return null;

    const htfBars = [];
    for (let i = 0; i + ratio <= candles.length; i += ratio) {
      const slice = candles.slice(i, i + ratio);
      const last = slice[slice.length - 1];
      htfBars.push({
        o: slice[0].o,
        h: Math.max(...slice.map(c => c.h)),
        l: Math.min(...slice.map(c => c.l)),
        c: last.c,
        vol: slice.reduce((a, c) => a + c.vol, 0),
        quad: last.quad,
        trendMode: last.trendMode,
        bias: last.bias,
        obi: last.book?.obi ?? 0,
      });
    }

    if (htfBars.length < 3) return null;
    const recent = htfBars.slice(-3);
    const bullCount = recent.filter(b => (b.trendMode || b.bias) === 'bullish').length;
    const bearCount = recent.filter(b => (b.trendMode || b.bias) === 'bearish').length;

    return {
      trend: bullCount >= 2 ? 'bullish' : bearCount >= 2 ? 'bearish' : 'mixed',
      quad: htfBars[htfBars.length - 1].quad,
      avgObi: recent.reduce((a, b) => a + b.obi, 0) / recent.length,
      barCount: htfBars.length,
      ratio,
    };
  }, [candles, timeframe]);

  // LTF proxy: raw short-window path + OBI (no second feed in demo).
  const ltfContext = useMemo(() => {
    if (candles.length < 4) return null;
    const recent = candles.slice(-4);
    const quads = recent.map(c => c.quad);
    const withBook = recent.filter(c => c.book);
    const avgObi = withBook.length
      ? withBook.reduce((a, c) => a + c.book.obi, 0) / withBook.length
      : 0;

    const yDeltas = [];
    for (let i = 1; i < recent.length; i++) {
      const a = recent[i - 1].coord, b = recent[i].coord;
      if (!a || !b) continue;
      yDeltas.push(b.y - a.y);
    }
    if (yDeltas.length === 0) {
      return { quads, avgObi, trend: 'mixed', avgDY: 0 };
    }
    const avgDY = yDeltas.reduce((acc, d) => acc + d, 0) / yDeltas.length;
    const trend = avgDY > 0.5 ? 'bullish'
      : avgDY < -0.5 ? 'bearish'
        : 'mixed';

    return { quads, avgObi, trend, avgDY };
  }, [candles]);

  // Velocity: sum of Euclidean distances across the trail path (active → t-1 → t-2).
  // Max possible over 2 segments is ~2 * sqrt(81+81) ≈ 25.5 grid units.
  // We classify as Expanding / Stable / Compressing for sidebar readout.
  const velocity = useMemo(() => {
    if (!current || trail.length === 0) return { dist: 0, state: '—', tag: 'awaiting path' };
    const path = [effectiveCoord, ...trail].filter(Boolean);
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
  }, [current, trail, effectiveCoord]);

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

    // ── Regime-aware field pickers ──
    // When the filter is on, laws evaluate against the smoothed coord/quad and
    // the trend-persistent mode, which means hysteresis is baked into detection.
    const coordOf = c => (regimeFilter && c?.smoothCoord) ? c.smoothCoord : c?.coord;
    const quadOf  = c => (regimeFilter && c?.smoothQuad)  ? c.smoothQuad  : c?.quad;
    const biasOf  = c => (regimeFilter && c?.trendMode)   ? c.trendMode   : c?.bias;
    const curCoord = coordOf(cur);
    const curQuad  = quadOf(cur);
    const curBias  = biasOf(cur);
    if (!curCoord) {
      return { score: 0, direction: null, primaryLaw: null, signals: [], target: null };
    }

    // ── Law 1: Fat Reversal (Q2 → Q4 horizontal compression) ──
    // Look for: path moving right (Δx ≥ +2) while body collapsing (Δy ≤ -2),
    // culminating in a current Q4 cell with high x (≥7).
    let fatScore = 0;
    if (curQuad === 4 && curCoord.x >= 7) {
      // Find the furthest-back Q2 coord in the last 5 bars
      const priorQ2 = prev5.filter(c => {
        const cq = quadOf(c), cc = coordOf(c);
        return cq === 2 || (cc && cc.y >= 6 && cc.x >= 6);
      });
      if (priorQ2.length > 0) {
        const startC = priorQ2[0];
        const sCoord = coordOf(startC);
        const dx = curCoord.x - sCoord.x;   // want positive (rightward)
        const dy = curCoord.y - sCoord.y;   // want negative (downward)
        const horizontalStretch = Math.max(0, dx);
        const verticalCollapse = Math.max(0, -dy);
        // Normalize to 0..1
        const stretchComp = Math.min(1, horizontalStretch / 4);  // 4 cells = max credit
        const collapseComp = Math.min(1, verticalCollapse / 5);  // 5 cells = max credit
        fatScore = stretchComp * 0.5 + collapseComp * 0.5;
        // Bonus if current x is extreme (9 or 10)
        if (curCoord.x >= 9) fatScore = Math.min(1, fatScore + 0.15);
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
    if (curQuad === 1 && curCoord.x <= 3 && curCoord.y >= 7) {
      const yExtremity = Math.min(1, (curCoord.y - 6) / 4);     // y=10 → 1.0
      const xAnemia = Math.min(1, (4 - curCoord.x) / 3);        // x=1 → 1.0
      vacuumScore = yExtremity * 0.45 + xAnemia * 0.55;
      // Find last HVN (Q2 or Q4 with x ≥ 6) in last 15 bars for target
      const hvn = candles.slice(-15).reverse().find(c => {
        const cq = quadOf(c), cc = coordOf(c);
        return (cq === 2 || cq === 4) && cc && cc.x >= 6;
      });
      if (hvn) vacuumTarget = coordOf(hvn);
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
      // Curvature = acceleration / second derivative — always use raw coords (never coordOf).
      const pts = window.slice(-5).map(c => c.coord).filter(Boolean);
      if (pts.length < 5) { /* skip curvature — not enough points */ }
      else {

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
      const priorMaxY = Math.max(...priorBars.map(c => coordOf(c)?.y || 0));
      const priorMaxX = Math.max(...priorBars.map(c => coordOf(c)?.x || 0));

      if (currentMakesHH && curCoord.y < priorMaxY && curCoord.x >= priorMaxX) {
        // Bearish divergence: higher high on price, but body collapsed and effort up
        divergenceScore = 0.65 + Math.min(0.3, (priorMaxY - curCoord.y) / 10);
        divergenceDir = 'bearish';
      } else if (currentMakesLL && curQuad === 4 && curCoord.x >= 7) {
        // Bullish divergence: new low, but landed in Wall (absorption)
        divergenceScore = 0.65 + Math.min(0.3, (curCoord.x - 6) / 10);
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
        if (curQuad === 2 && curBias === 'bullish' && avgObi < -0.15) {
          const bookHostility = Math.min(1, Math.abs(avgObi) / 0.5);  // -0.5 OBI → 1.0
          const coordWeight = Math.min(1, (curCoord.x + curCoord.y - 10) / 8);
          liqDivScore = bookHostility * 0.55 + coordWeight * 0.35;
          liqDivDir = 'bearish';
          liqDivDetail = 'Bull Engine · eating asks · no bid refill';
        }
        // Case B: Bear Engine with supportive book (absorption)
        else if (curQuad === 2 && curBias === 'bearish' && avgObi > 0.15) {
          const bookSupport = Math.min(1, avgObi / 0.5);
          const coordWeight = Math.min(1, (curCoord.x + curCoord.y - 10) / 8);
          liqDivScore = bookSupport * 0.55 + coordWeight * 0.35;
          liqDivDir = 'bullish';
          liqDivDetail = 'Bear Engine · bids stacking · absorption';
        }
        // Case C: Wall with book confirming stall direction
        else if (curQuad === 4 && Math.abs(avgObi) > 0.25) {
          const bookConviction = Math.min(1, Math.abs(avgObi) / 0.5);
          const wallDepth = Math.min(1, (curCoord.x - 5) / 5);
          liqDivScore = bookConviction * 0.45 + wallDepth * 0.35;
          // Book leaning against prior direction → reversal in that direction
          liqDivDir = avgObi > 0 ? 'bullish' : 'bearish';
          liqDivDetail = avgObi > 0
            ? 'Wall · bid stack confirms absorption'
            : 'Wall · ask stack confirms distribution';
        }
        // Case D: Vacuum with book leaning against the move
        else if (curQuad === 1 && Math.sign(curObi) !== 0) {
          // If in Q1 with body-high y (stop run up), negative OBI accelerates snap-back
          const isThinUp = curCoord.y >= 7;
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

    // ── Law 6: TF Confluence — gates / amplifies based on synthetic HTF + raw LTF proxy ──
    let confluenceScore = 0;
    let confluenceDetail = '';
    let confluenceDir = null;
    const signalDir = (() => {
      const bW = signals.filter(s => s.direction === 'bearish').reduce((a, s) => a + s.score, 0);
      const bUW = signals.filter(s => s.direction === 'bullish').reduce((a, s) => a + s.score, 0);
      if (bW > bUW * 1.2) return 'bearish';
      if (bUW > bW * 1.2) return 'bullish';
      return 'mixed';
    })();

    if (signals.length > 0 && htfContext && signalDir !== 'mixed') {
      const htfAgrees = htfContext.trend === signalDir;
      const htfContra = htfContext.trend !== 'mixed' && htfContext.trend !== signalDir;
      const ltfAgrees = ltfContext?.trend === signalDir;
      const ltfContra = ltfContext?.trend !== 'mixed' && ltfContext?.trend !== signalDir;
      const obiAligned = htfContext.avgObi !== undefined && ltfContext
        && Math.sign(htfContext.avgObi) === Math.sign(ltfContext.avgObi)
        && Math.abs(htfContext.avgObi) > 0.12;

      if (htfAgrees && ltfAgrees) {
        confluenceScore = 0.72 + (obiAligned ? 0.12 : 0);
        confluenceDetail = 'Full cascade · HTF + LTF aligned';
      } else if (htfAgrees && !ltfContra) {
        confluenceScore = 0.52 + (obiAligned ? 0.08 : 0);
        confluenceDetail = 'HTF confirmed · LTF neutral';
      } else if (ltfAgrees && !htfContra) {
        confluenceScore = 0.38;
        confluenceDetail = 'LTF early signal · HTF unconfirmed';
      } else if (htfContra) {
        confluenceScore = -0.28;
        confluenceDetail = 'Counter-HTF · elevated reversal risk';
      }
      confluenceDir = signalDir;
    }

    if (Math.abs(confluenceScore) > 0.1) {
      if (confluenceScore > 0) {
        signals.push({
          law: 'TF Confluence',
          score: Math.min(1, confluenceScore),
          direction: confluenceDir,
          detail: confluenceDetail,
        });
      }
    }

    // ── Apply timeframe-specific law weights ──
    // Each law's contribution is scaled by the active profile. Caps retained.
    const lawKeyMap = {
      'Fat Reversal': 'Fat',
      'Vacuum Snap': 'Vacuum',
      'Curvature': 'Curvature',
      'Divergence': 'Divergence',
      'Liquidity Div.': 'Liquidity',
      'TF Confluence': 'TFConfluence',
    };
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

    // Counter-HTF: cap compound score so counter-trend calls cannot reach the highest tier
    if (confluenceScore < -0.1) {
      rawScore = Math.min(rawScore, 0.52);
    }

    // ── Inertia bonus (long timeframes reward trail consistency) ──
    // When the trail is compact (velocity.avgSegment low) AND the current cell has
    // stayed in one quadrant, the market has "Mass" — signals are more trustworthy.
    let inertiaBonus = 0;
    if (profile.inertiaFactor > 0 && candles.length >= 4) {
      const lastFourQuads = candles.slice(-4).map(c => quadOf(c));
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
  }, [candles, current, trail, profile, regimeFilter, htfContext, ltfContext]);

  // ───────────────────────────────────────────────────────────
  //  CONTINUATION STRENGTH — conviction (gate + five laws)
  // ───────────────────────────────────────────────────────────
  const trendStrength = useMemo(() => {
    const neutral = (over = {}) => ({
      score: 0,
      rawScore: 0,
      direction: null,
      tier: 'NONE',
      signals: [],
      primaryLaw: null,
      reason: 'apathy / outside engine-wall window',
      ...over,
    });

    if (!current || candles.length < TREND_GATE.M) return neutral();

    const coordOf = c => (regimeFilter && c?.smoothCoord) ? c.smoothCoord : c?.coord;
    const quadOf  = c => (regimeFilter && c?.smoothQuad)  ? c.smoothQuad  : c?.quad;
    const biasOf  = c => (regimeFilter && c?.trendMode)   ? c.trendMode   : c?.bias;
    const cur = current;

    const recentGate = candles.slice(-TREND_GATE.M);
    const engineWallCount = recentGate.filter(c => {
      const q = quadOf(c);
      return q === 2 || q === 4;
    }).length;
    if (engineWallCount < TREND_GATE.N) return neutral();

    let q2 = 0;
    let q4 = 0;
    for (const c of recentGate) {
      const q = quadOf(c);
      if (q === 2) q2++;
      else if (q === 4) q4++;
    }
    let direction = null;
    if (q2 > q4) direction = 'bullish';
    else if (q4 > q2) direction = 'bearish';
    else {
      const b = biasOf(cur);
      if (b === 'bullish' || b === 'bearish') direction = b;
    }
    if (!direction) {
      return neutral({ reason: 'mixed structural quad (Q2=Q4 tie, bias mixed)' });
    }

    const tw = profile.trendLawWeights || {};
    const defaultW = {
      QuadrantLock: 1,
      CoordinateExtension: 1,
      VolumeExpansion: 1,
      OBIPersistence: 1,
      HTFAlignment: 1,
    };
    const wFor = key => (tw[key] ?? defaultW[key] ?? 1);

    const lawKeyMap = {
      'Quadrant Lock': 'QuadrantLock',
      'Coordinate Extension': 'CoordinateExtension',
      'Volume Expansion': 'VolumeExpansion',
      'OBI Persistence': 'OBIPersistence',
      'HTF Alignment': 'HTFAlignment',
    };

    const signals = [];

    let runLength = 0;
    for (let i = candles.length - 1; i >= 0; i--) {
      const q = quadOf(candles[i]);
      if (q !== 2 && q !== 4) break;
      runLength++;
    }
    const lockRaw = runLength > 0 ? 1 - Math.exp(-runLength * 0.34) : 0;
    if (lockRaw >= 0.12) {
      signals.push({
        law: 'Quadrant Lock',
        score: lockRaw,
        direction,
        detail: `${runLength} consecutive bars in Engine/Wall corridor · soft-saturating run bonus`,
      });
    }

    const sliceK = candles.slice(-TREND_GATE.K);
    const pts = sliceK.map(coordOf).filter(Boolean);
    let extScore = 0;
    if (pts.length >= 2) {
      const anchor = direction === 'bullish' ? { x: 10, y: 10 } : { x: 10, y: 1 };
      const first = pts[0];
      const last = pts[pts.length - 1];
      const dFirst = Math.hypot(anchor.x - first.x, anchor.y - first.y);
      const dLast = Math.hypot(anchor.x - last.x, anchor.y - last.y);
      const progress = dFirst < 0.05
        ? 0.5
        : Math.max(0, Math.min(1, (dFirst - dLast) / (dFirst + 0.02)));
      let pathLen = 0;
      for (let i = 1; i < pts.length; i++) {
        pathLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      }
      const disp = Math.hypot(last.x - first.x, last.y - first.y);
      const efficiency = Math.max(0, Math.min(1, disp / (pathLen + 0.05)));
      extScore = progress * 0.58 + efficiency * 0.42;
    }
    if (extScore >= 0.12) {
      signals.push({
        law: 'Coordinate Extension',
        score: extScore,
        direction,
        detail: `Structural advance vs ${direction === 'bullish' ? 'Engine (high effort, high result)' : 'Wall (high effort, low result)'} anchor · path blend`,
      });
    }

    const vols = sliceK.map(c => c.volPct).filter(v => v != null && !Number.isNaN(v));
    let volScore = 0;
    if (vols.length > 0) {
      const minV = Math.min(...vols);
      if (minV >= TREND_GATE.TAU_VOL) volScore = 1;
      else volScore = Math.max(0, Math.min(0.85, (minV / TREND_GATE.TAU_VOL) * 0.78));
    }
    if (volScore >= 0.12) {
      signals.push({
        law: 'Volume Expansion',
        score: volScore,
        direction,
        detail: `min vol pct over last ${vols.length} bars vs τ=${(TREND_GATE.TAU_VOL * 100).toFixed(0)}th · sustained effort check`,
      });
    }

    let matchCount = 0;
    for (const c of sliceK) {
      if (!c.book || typeof c.book.obi !== 'number') continue;
      const ok = direction === 'bullish' ? c.book.obi > 0 : c.book.obi < 0;
      if (ok) matchCount++;
    }
    const obiScore = TREND_GATE.K > 0 ? Math.min(1, matchCount / TREND_GATE.K) : 0;
    if (obiScore >= 0.12 || matchCount >= 2) {
      const narrative = matchCount >= TREND_GATE.OBI_MIN_MATCH ? 'book persistence' : 'alignment building';
      signals.push({
        law: 'OBI Persistence',
        score: obiScore,
        direction,
        detail: `${matchCount}/${TREND_GATE.K} bars OBI-signed with trend · ${narrative}`,
      });
    }

    if (htfContext && wFor('HTFAlignment') > 0) {
      let htfScore = 0;
      let detail = '';
      if (htfContext.trend === direction) {
        htfScore = 0.88;
        detail = 'Synthetic HTF trend matches gate direction';
      } else if (htfContext.trend === 'mixed') {
        htfScore = 0.42;
        detail = 'HTF mixed · neutral contribution';
      } else {
        htfScore = 0.24;
        detail = 'HTF leans against gate direction · soft discount';
      }
      signals.push({
        law: 'HTF Alignment',
        score: htfScore,
        direction,
        detail,
      });
    }

    const weightedSignals = signals.map(s => {
      const key = lawKeyMap[s.law] || s.law;
      const w = wFor(key);
      return { ...s, rawScore: s.score, weight: w, score: w > 0 ? Math.min(1, s.score * w) : 0 };
    }).filter(s => s.weight > 0);

    const ACT = 0.22;
    const activeSignals = weightedSignals.filter(s => s.score >= ACT);
    if (activeSignals.length === 0) {
      return {
        score: 0,
        rawScore: 0,
        direction,
        tier: 'LOW',
        signals: [],
        primaryLaw: null,
        reason: 'coherence below threshold · laws not stacking after weighting',
      };
    }

    activeSignals.sort((a, b) => b.score - a.score);
    const top = activeSignals[0].score;
    const rest = activeSignals.slice(1).reduce((a, s) => a + s.score * 0.35, 0);
    const rawScore = Math.min(0.98, top * 0.75 + rest);

    let tier = 'LOW';
    if (rawScore >= 0.65) tier = 'HIGH';
    else if (rawScore >= 0.4) tier = 'MODERATE';

    return {
      score: rawScore,
      rawScore,
      direction,
      tier,
      signals: activeSignals,
      primaryLaw: activeSignals[0].law,
      reason: null,
    };
  }, [candles, current, profile, regimeFilter, htfContext]);

  // ── Confidence Hysteresis ──
  // When regime filter is on, smooth the reversal score with an asymmetric EMA:
  // climbs fast (alpha=0.55) so genuine reversals still alert quickly; falls
  // slow (alpha=0.15) so single-bar noise doesn't pull the gauge back down.
  // The result replaces reversal.score downstream when the filter is active.
  const smoothedScoreRef = useRef(0);
  const smoothedReversal = useMemo(() => {
    if (!regimeFilter) return reversal;
    const prior = smoothedScoreRef.current;
    const incoming = reversal.score || 0;
    const alpha = incoming > prior ? 0.55 : 0.15;
    const next = prior + alpha * (incoming - prior);
    smoothedScoreRef.current = next;
    return { ...reversal, score: next, rawSignificant: reversal.score };
  }, [reversal, regimeFilter]);

  const smoothedTrendRef = useRef(0);
  const smoothedTrendStrength = useMemo(() => {
    if (!regimeFilter) return trendStrength;
    const prior = smoothedTrendRef.current;
    const incoming = trendStrength.score || 0;
    const alpha = incoming > prior ? 0.55 : 0.15;
    const next = prior + alpha * (incoming - prior);
    smoothedTrendRef.current = next;
    return { ...trendStrength, score: next, rawSignificant: trendStrength.score };
  }, [trendStrength, regimeFilter]);

  useEffect(() => {
    if (candles.length === 0) {
      smoothedScoreRef.current = 0;
      smoothedTrendRef.current = 0;
    }
  }, [candles.length]);

  useEffect(() => {
    if (candles.length === 0) {
      signalTapeRef.current = [];
      prevCandleLenRef.current = 0;
      prevFirstCandleIdRef.current = null;
      return;
    }
    const prevLen = prevCandleLenRef.current;
    const curFirstId = candles[0]?.id;
    const rolled =
      prevLen === candles.length &&
      prevFirstCandleIdRef.current != null &&
      curFirstId !== prevFirstCandleIdRef.current;

    const snap = {
      trendTier: smoothedTrendStrength.tier,
      trendDirection: smoothedTrendStrength.direction,
      trendScore: smoothedTrendStrength.score,
      trendMode: current?.trendMode,
      reversalScore: smoothedReversal.score,
      reversalTier: reversalTierFromScore(smoothedReversal.score),
      reversalTarget: smoothedReversal.target
        ? { x: smoothedReversal.target.x, y: smoothedReversal.target.y }
        : null,
      reversalDirection: smoothedReversal.direction,
      quad: current?.quad,
      smoothQuad: current?.smoothQuad,
      isFiltered: regimeFilter,
      effectiveCoord,
      coord: current?.coord,
      smoothCoord: current?.smoothCoord,
    };

    if (candles.length > prevLen) {
      signalTapeRef.current.push(snap);
    } else if (candles.length < prevLen) {
      signalTapeRef.current = [];
    } else if (rolled) {
      signalTapeRef.current.shift();
      signalTapeRef.current.push(snap);
    } else if (signalTapeRef.current.length === candles.length) {
      signalTapeRef.current[signalTapeRef.current.length - 1] = snap;
    } else if (signalTapeRef.current.length < candles.length) {
      signalTapeRef.current.push(snap);
    }

    prevCandleLenRef.current = candles.length;
    prevFirstCandleIdRef.current = curFirstId;
  }, [candles, current, smoothedReversal, smoothedTrendStrength, regimeFilter, effectiveCoord]);

  const runBacktestHandler = useCallback(() => {
    const signals = signalTapeRef.current;
    if (!signals.length || signals.length !== candles.length) return;
    const strat = buildStrategy(strategyName);
    const res = runBacktest({
      bars: candles,
      signals,
      execution,
      strategy: strat,
    });
    setBacktestResult(res);
    setTradeMarkers(res.markers || []);
    setBacktestRecommendations(buildRecommendations(res.metrics, execution, res.trades));
  }, [candles, execution, strategyName]);

  const mtfConfluenceActive = !!(htfContext && smoothedReversal.signals?.some(s => s.law === 'TF Confluence'));

  // Detect named vector transitions
  useEffect(() => {
    if (!current) return;
    const q = effectiveQuad ?? current.quad;
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
  }, [current?.id, effectiveQuad, regimeFilter]);

  // Hover tooltip data
  const hoverInfo = hover ? cellTaxonomy(hover.x, hover.y, hover.q) : null;

  const activeCoord = effectiveCoord;
  const activeQuad = effectiveQuad;
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

      <div className="relative" style={{ padding: isMobile ? '12px 0 20px' : '20px 0 32px' }}>
        {/* HEADER */}
        <header className="flex items-end justify-between border-b border-[var(--line-strong)] pb-5 mb-5 gap-4 flex-wrap px-5">
          <div className="flex items-baseline gap-4 flex-wrap">
            <span className="font-['Fraunces'] italic font-light text-[32px] text-[var(--amber)] leading-none">ℓ</span>
            <Tip block text="Demo harness for volume–body coordinates on a 10×10 Wyckoff matrix, scripted cycle, and geometric reversal detector. Not connected to live markets.">
              <div>
                <h1 className="font-['Fraunces'] text-[22px] leading-tight tracking-tight">VWC Dynamic Matrix</h1>
                <div className="text-[10px] tracking-[0.25em] uppercase text-[var(--fg-dim)] mt-0.5">
                  Real-time Geometric Pattern Recognizer · Scripted Cycle
                </div>
              </div>
            </Tip>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <ModeBadge mode={mode}/>
            <Tip text="Active timeframe profile: bar cadence, spread penalty, book half-life, significance multiplier, and how each reversal law is weighted for this resolution.">
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
            </Tip>
            <Tip text={playing ? 'Scripted candle stream is advancing on the timer.' : 'Stream is frozen; matrix and detector hold the last bar until you resume.'}>
              <div className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase text-[var(--fg-dim)]">
                <div className="w-1.5 h-1.5 rounded-full" style={{
                  background: playing ? '#6ba368' : '#3d3d39',
                  boxShadow: playing ? '0 0 8px rgba(107,163,104,0.6)' : 'none',
                }}/>
                {playing ? 'Feed Live' : 'Feed Paused'}
              </div>
            </Tip>
          </div>
        </header>

        {/* CONTROL STRIP */}
        <div className="flex flex-wrap items-center gap-4 px-5 py-3 bg-[var(--bg-alt)] border border-[var(--line)] mb-5">
          <Tip text={playing ? 'Pause the scripted feed (stops new bars).' : 'Resume advancing the scripted candle stream.'}>
            <button
              onClick={() => setPlaying(p => !p)}
              className="flex items-center gap-2 px-3 py-1.5 border border-[var(--line-strong)] text-[var(--fg)] hover:border-[var(--amber)] hover:text-[var(--amber)] transition-colors text-[11px] tracking-[0.1em] uppercase bg-transparent"
            >
              {playing ? <Pause size={12} strokeWidth={1.75}/> : <Play size={12} strokeWidth={1.75}/>}
              {playing ? 'Pause' : 'Play'}
            </button>
          </Tip>
          <Tip text="Restart the scripted cycle from the beginning and clear named vector history.">
            <button
              onClick={() => {
                reset();
                setVectorHistory([]);
                lastQuadRef.current = null;
                candleCountRef.current = 0;
                signalTapeRef.current = [];
                prevCandleLenRef.current = 0;
                prevFirstCandleIdRef.current = null;
                setTradeMarkers([]);
                setBacktestResult(null);
              }}
              className="flex items-center gap-2 px-3 py-1.5 border border-[var(--line-strong)] text-[var(--fg)] hover:border-[var(--amber)] hover:text-[var(--amber)] transition-colors text-[11px] tracking-[0.1em] uppercase bg-transparent"
            >
              <Rewind size={12} strokeWidth={1.75}/>
              Reset
            </button>
          </Tip>
          <div className="flex items-center gap-2">
            <Gauge size={12} className="text-[var(--fg-dim)]" strokeWidth={1.5}/>
            <span className="text-[9px] tracking-[0.22em] uppercase text-[var(--fg-dim)]">Speed</span>
            <div className="inline-flex border border-[var(--line-strong)]">
              {[0.5, 1, 2, 4].map(s => (
                <Tip key={s} text={`Advance the demo clock at ${s}× real-time (faster simulation).`}>
                  <button
                    onClick={() => setSpeed(s)}
                    className={`px-2.5 py-1 text-[10px] tracking-[0.08em] border-r border-[var(--line-strong)] last:border-r-0 transition-colors ${speed === s ? 'btn-active' : ''}`}
                    style={{
                      background: speed === s ? '#d4a84b' : 'transparent',
                      fontWeight: speed === s ? 500 : 300,
                    }}>
                    {s}×
                  </button>
                </Tip>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock size={12} className="text-[var(--fg-dim)]" strokeWidth={1.5}/>
            <span className="text-[9px] tracking-[0.22em] uppercase text-[var(--fg-dim)]">TF</span>
            <div className="inline-flex border border-[var(--line-strong)]">
              {Object.keys(TIMEFRAME_PROFILES).map(tf => (
                <Tip key={tf} text={`${TIMEFRAME_PROFILES[tf].label}: ${TIMEFRAME_PROFILES[tf].contextTag}`}>
                  <button
                    onClick={() => setTimeframe(tf)}
                    className={`px-2 py-1 text-[10px] tracking-[0.08em] border-r border-[var(--line-strong)] last:border-r-0 transition-colors ${timeframe === tf ? 'btn-active' : ''}`}
                    style={{
                      background: timeframe === tf ? profile.accent : 'transparent',
                      fontWeight: timeframe === tf ? 500 : 300,
                    }}>
                    {TIMEFRAME_PROFILES[tf].short}
                  </button>
                </Tip>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Waves size={12} className="text-[var(--fg-dim)]" strokeWidth={1.5}/>
            <span className="text-[9px] tracking-[0.22em] uppercase text-[var(--fg-dim)]">Regime</span>
            <Tip text={regimeFilter ? 'Kinetic regime filter ON: HMA-smoothed coordinates/quads and trend-persistent bias feed the matrix path and most reversal laws (curvature still uses raw coords).' : 'Regime filter OFF: every bar uses raw coordinates and bias; more reactive, no hysteresis smoothing.'}>
              <button
                onClick={() => setRegimeFilter(v => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] tracking-[0.08em] border transition-colors"
                style={{
                  borderColor: regimeFilter ? '#d4a84b' : 'var(--line-strong)',
                  background: regimeFilter ? 'rgba(212,168,75,0.12)' : 'transparent',
                  color: regimeFilter ? '#d4a84b' : '#d8d4c7',
                }}>
                <span style={{
                  display: 'inline-block',
                  width: 8, height: 8, borderRadius: '50%',
                  background: regimeFilter ? '#d4a84b' : '#3d3d39',
                  boxShadow: regimeFilter ? '0 0 6px rgba(212,168,75,0.7)' : 'none',
                }}/>
                {regimeFilter ? 'FILTER ON' : 'FILTER OFF'}
              </button>
            </Tip>
          </div>
          <div className="flex-1"/>
          <div className="flex gap-5 text-[10px] uppercase tracking-[0.15em]">
            <Tip text="Number of synthetic candles accumulated in the active timeframe buffer.">
              <div>
                <span className="text-[var(--fg-mute)]">Bars</span> <span className="text-[var(--fg)] font-medium">{candles.length}</span>
              </div>
            </Tip>
            <Tip text="Displayed matrix coordinate: smoothed (kinetic) position when the regime filter is on, otherwise the raw last close.">
              <div>
                <span className="text-[var(--fg-mute)]">Coord</span> <span className="text-[var(--amber)] font-medium">{activeCoord ? `${activeCoord.x},${activeCoord.y}` : '—'}</span>
              </div>
            </Tip>
            <Tip text="Wyckoff quadrant cell for the displayed coordinate (effort vs result partition).">
              <div>
                <span className="text-[var(--fg-mute)]">Quad</span> <span className="text-[var(--fg)] font-medium">{activeQuad ? `Q${activeQuad} ${QUAD_META[activeQuad].name.toUpperCase()}` : '—'}</span>
              </div>
            </Tip>
            <Tip text="Order book imbalance on the latest bar: positive = more bid size quoted, negative = more ask size (simulated L2).">
              <div>
                <span className="text-[var(--fg-mute)]">OBI</span>{' '}
                <span className="font-medium" style={{
                  color: current?.book?.obi > 0.15 ? '#6ba368' : current?.book?.obi < -0.15 ? '#ff5a5a' : '#d8d4c7',
                }}>{current?.book ? (current.book.obi > 0 ? '+' : '') + (current.book.obi * 100).toFixed(0) + '%' : '—'}</span>
              </div>
            </Tip>
          </div>
        </div>

        {/* MAIN LAYOUT — JS-driven responsive grid (left rail | center | right rail) */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isDesktop ? 'minmax(200px, 260px) minmax(0, 1fr) minmax(300px, 390px)' : '1fr',
          gap: '16px',
        }}>

          {/* LEFT RAIL — telemetry + keys */}
          <aside className="space-y-4" style={{ order: isDesktop ? 0 : 2 }}>
            {/* LIVE STATE */}
            <div className="bg-[var(--bg-alt)] border border-[var(--line)] p-5 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Target size={12} className="text-[var(--amber)]" strokeWidth={1.5}/>
                <span className="text-[9px] tracking-[0.25em] uppercase text-[var(--fg-dim)]">Live Telemetry</span>
              </div>
              <StatRow title="Where the current bar’s traded volume sits in the rolling lookback window (0–100th percentile)." label="Vol Percentile" value={current ? `${volPctDisplay}` : '—'} suffix="th"/>
              <StatRow title="Where the bar’s body size sits in the rolling lookback window (0–100th percentile)." label="Body Percentile" value={current ? `${bodyPctDisplay}` : '—'} suffix="th"/>
              <StatRow title="Displayed matrix coordinate [x,y]: kinetic-smoothed when the regime filter is on." label="Coordinate" value={activeCoord ? `[${activeCoord.x}, ${activeCoord.y}]` : '—'} accent/>
              <StatRow title="Wyckoff quadrant label for the active cell plus its narrative tag." label="Quadrant"
                       value={activeQuad ? QUAD_META[activeQuad].name : '—'}
                       subvalue={activeQuad ? QUAD_META[activeQuad].tag : ''}/>
              <StatRow title="Trend mode under the regime filter (hysteresis-weighted), else raw bar bias." label="Mode" value={mode.charAt(0).toUpperCase() + mode.slice(1)}
                       accentColor={mode === 'bullish' ? '#6ba368' : mode === 'bearish' ? '#ff5a5a' : '#d4a84b'}/>
              <StatRow title="Classifies how fast the displayed coordinate is moving across the last segments (effective coord vs trail)." label="Velocity"
                       value={velocity.state}
                       subvalue={velocity.tag}
                       accentColor={
                         velocity.state === 'Compressing' ? '#5fa8a8' :
                         velocity.state === 'Stable'      ? '#8a8374' :
                         velocity.state === 'Expanding'   ? '#d4a84b' :
                         velocity.state === 'Discharging' ? '#ff5a5a' :
                         '#6b6a63'
                       }/>
              <StatRow title="Cumulative Euclidean path length across the velocity segments (matrix grid units)." label="Path Length"
                       value={velocity.dist ? velocity.dist.toFixed(2) : '—'}
                       suffix="u"/>
              <StatRow title="Highlights when price is in the Engine (Q2) or Wall (Q4) cells where effort/result tension is structurally high." label="Energy"
                       value={activeQuad === 2 ? 'IMPACT · Engine' : activeQuad === 4 ? 'IMPACT · Wall' : 'Quiescent'}
                       accentColor={activeQuad === 2 ? '#6ba368' : activeQuad === 4 ? '#ff5a5a' : '#6b6a63'}/>
              {current?.book && (
                <>
                  <StatRow title="Order book imbalance: bid vs ask quoted size on the latest simulated L2 snapshot." label="OBI"
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
                  <StatRow title="Total quoted bid and ask liquidity (simulated thousands of contracts)." label="Book Depth"
                           value={`${((current.book.bidTot + current.book.askTot)/1000).toFixed(1)}k`}
                           subvalue={`bid ${(current.book.bidTot/1000).toFixed(1)}k · ask ${(current.book.askTot/1000).toFixed(1)}k`}/>
                </>
              )}
              {htfContext && (
                <StatRow
                  title={`Synthetic higher timeframe: rolls ${htfContext.ratio} active-TF bars per HTF step; trend counts bullish vs bearish labels on the last 3 HTF closes.`}
                  label={`HTF (×${htfContext.ratio}) Trend`}
                  value={htfContext.trend.charAt(0).toUpperCase() + htfContext.trend.slice(1)}
                  subvalue={`Q${htfContext.quad} · ${htfContext.barCount} bars aggregated`}
                  accentColor={htfContext.trend === 'bullish' ? '#6ba368' : htfContext.trend === 'bearish' ? '#ff5a5a' : '#8a8374'}
                />
              )}
              {ltfContext && (
                <StatRow
                  title="Lower-timeframe proxy without a second feed: raw coordinate vertical drift and OBI over the last few bars for early confirmation."
                  label="LTF Raw Momentum"
                  value={ltfContext.trend.charAt(0).toUpperCase() + ltfContext.trend.slice(1)}
                  subvalue={`dy avg ${ltfContext.avgDY.toFixed(2)} · OBI ${(ltfContext.avgObi * 100).toFixed(0)}%`}
                  accentColor={ltfContext.trend === 'bullish' ? '#6ba368' : ltfContext.trend === 'bearish' ? '#ff5a5a' : '#8a8374'}
                />
              )}
            </div>

            {/* LEGEND */}
            <div className="bg-[var(--bg-alt)] border border-[var(--line)] p-5">
              <div className="flex items-center gap-2 mb-3">
                <CircleDot size={12} className="text-[var(--amber)]" strokeWidth={1.5}/>
                <Tip text="Static reference for the four Wyckoff-style quadrants used by the matrix and detector.">
                  <span className="text-[9px] tracking-[0.25em] uppercase text-[var(--fg-dim)]">Quadrant Key</span>
                </Tip>
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

            {/* Pattern / vector key */}
            <div className="bg-[var(--bg-alt)] border border-[var(--line)] p-4">
              <Tip block text="Catalog of stylized quadrant hops (Q1–Q4). The live stream logs the Wyckoff-style name when the effective quadrant changes.">
                <div className="flex items-center gap-2 mb-3">
                  <Zap size={12} className="text-[var(--amber)]" strokeWidth={1.5}/>
                  <span className="text-[9px] tracking-[0.25em] uppercase text-[var(--fg-dim)]">Named Vector Transitions · Pattern Key</span>
                </div>
              </Tip>
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))',
                gap: '1px',
                background: 'var(--line)',
              }}>
                {Object.entries(VECTOR_NAMES).map(([key, def]) => {
                  const [from, to] = key.split('-');
                  const sevColor = { go: '#6ba368', warn: '#d4a84b', alert: '#c75c5c', cool: '#5fa8a8' }[def.severity];
                  return (
                    <Tip key={key} text={`${def.name}: quadrant transition Q${from}→Q${to} · severity ${def.severity}`} block>
                      <div className="bg-[var(--bg-alt)] p-2.5">
                        <div className="text-[8px] tracking-[0.2em] text-[var(--fg-mute)]">Q{from} → Q{to}</div>
                        <div className="font-['Fraunces'] italic text-xs mt-0.5 leading-tight" style={{ color: sevColor }}>{def.name}</div>
                      </div>
                    </Tip>
                  );
                })}
              </div>
            </div>
          </aside>

          {/* CENTER — tape + matrix + detectors */}
          <div className="space-y-4" style={{ order: isDesktop ? 0 : 1 }}>

            {/* CANDLE CHART + DEPTH HEATMAP — full width, it's a time series */}
            <div className="bg-[var(--bg-alt)] border border-[var(--line)] p-5 relative">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Activity size={12} className="text-[var(--amber)]" strokeWidth={1.5}/>
                  <Tip text="Candles: width encodes relative volume, height encodes body range; optional HA tint when kinetic filter is on. Right strip: simulated depth profile.">
                    <span className="text-[9px] tracking-[0.25em] uppercase text-[var(--fg-dim)]">Volume-Weighted Tape</span>
                  </Tip>
                  <Tip text="Heat strip uses the latest simulated order book imbalance across price bins.">
                    <span className="text-[8px] tracking-[0.2em] uppercase text-[var(--fg-mute)] ml-1">+ L2 Depth</span>
                  </Tip>
                  {regimeFilter && (
                    <Tip text="Heikin-style smoothing is blended into candle bodies for display when kinetic filtering is on (visual aid, separate from matrix HMA path).">
                      <span className="text-[8px] tracking-[0.2em] uppercase font-medium ml-1 px-1.5 py-0.5 border" style={{
                        borderColor: '#d4a84b',
                        color: '#d4a84b',
                        background: 'rgba(212,168,75,0.08)',
                      }}>HA</span>
                    </Tip>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[9px] tracking-[0.15em] uppercase text-[var(--fg-mute)]">
                  <Tip text="Simulated backtest: uses recorded causal tape (smoothed gauges + trendMode), next-bar-open fills; no access to scripted phase lookahead.">
                    <button
                      type="button"
                      onClick={() => setBacktestOpen(true)}
                      className="p-1 text-[var(--fg-mute)] hover:text-[var(--amber)] border border-transparent hover:border-[var(--line)] rounded-sm transition-colors"
                      aria-label="Backtest"
                    >
                      <FlaskConical size={14} strokeWidth={1.5}/>
                    </button>
                  </Tip>
                  <span>width = vol</span>
                  <span>height = body</span>
                </div>
              </div>
              <div className="flex gap-2" style={{ height: isMobile ? 240 : 300 }}>
                <div className="flex-1 border border-[var(--line)] min-w-0">
                  <CandleChart candles={candles} smooth={regimeFilter} tradeMarkers={tradeMarkers}/>
                </div>
                <DepthHeatmap book={current?.book}/>
              </div>
            </div>

            {/* MATRIX + REVERSAL — tape spans both; inner 2-col grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(220px, 1fr)', gap: '12px', alignItems: 'start' }}>

            {/* MATRIX PANEL */}
            <div className="bg-[var(--bg-alt)] border border-[var(--line)] p-5 relative">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Layers size={12} className="text-[var(--amber)]" strokeWidth={1.5}/>
                    <Tip text="10×10 effort (volume axis) vs result (body axis) grid. Highlighted cell is the live coordinate; dashed trail shows prior path.">
                      <span className="text-[9px] tracking-[0.25em] uppercase text-[var(--fg-dim)]">10×10 Coordinate Matrix</span>
                    </Tip>
                    {regimeFilter && (
                      <Tip text="Kinetic regime path: matrix trail and most reversal laws use smoothed coordinates and trend-persistent bias while the filter is on.">
                        <span className="text-[8px] tracking-[0.2em] uppercase font-medium ml-1 px-1.5 py-0.5 border" style={{
                          borderColor: '#d4a84b',
                          color: '#d4a84b',
                          background: 'rgba(212,168,75,0.08)',
                        }}>KINETIC</span>
                      </Tip>
                    )}
                    <Tip text={!htfContext
                      ? 'Daily profile: no synthetic higher timeframe in this demo. Chip stays neutral; confluence needs HTF context on shorter profiles.'
                      : mtfConfluenceActive
                        ? 'Law 6 TF Confluence is active: synthetic HTF trend and the raw short-window (LTF) proxy align with the dominant reversal-law direction.'
                        : 'Multi-timeframe slot idle: HTF/LTF context is evaluated, but TF Confluence is not in the active weighted law stack (mixed direction or below threshold).'}>
                      <span
                        className="text-[8px] tracking-[0.2em] uppercase font-medium ml-1 px-1.5 py-0.5 border transition-colors duration-200"
                        style={{
                          borderColor: mtfConfluenceActive ? '#2563eb' : '#4b5563',
                          color: mtfConfluenceActive ? '#ffffff' : '#9ca3af',
                          background: mtfConfluenceActive ? '#2563eb' : 'rgba(55,65,81,0.35)',
                        }}
                      >MTF</span>
                    </Tip>
                    <Tip text={htfContext
                      ? `Synthetic HTF (×${htfContext.ratio}): ${htfContext.trend} · Q${htfContext.quad}. Full numeric detail lives in Live Telemetry on the left rail.`
                      : 'Daily profile: no rolled-up synthetic higher timeframe in this demo — chip stays idle grey.'}>
                      <span
                        className="text-[8px] tracking-[0.2em] uppercase font-medium ml-1 px-1.5 py-0.5 border transition-colors duration-200"
                        style={htfContext ? {
                          borderColor: '#2563eb',
                          color: '#ffffff',
                          background: '#2563eb',
                          boxShadow: '0 0 10px rgba(37,99,235,0.35)',
                        } : {
                          borderColor: '#4b5563',
                          color: '#9ca3af',
                          background: 'rgba(55,65,81,0.35)',
                        }}
                      >HTF{htfContext ? ` · ${htfContext.trend === 'mixed' ? 'mix' : htfContext.trend}` : ''}</span>
                    </Tip>
                  </div>
                  <div className="flex items-center gap-3 text-[9px] tracking-[0.15em] uppercase text-[var(--fg-mute)] flex-wrap">
                    <Tip text="Current bar’s regime-aware bias color (bullish / bearish / mixed).">
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
                    </Tip>
                  <Tip text="Prior two displayed coordinates (t-1, t-2) using the same raw vs smoothed pick as the active cell.">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 border border-[var(--amber)]"/> trail (t-1, t-2)
                    </span>
                  </Tip>
                  <Tip text="Path velocity class from Euclidean motion of effective coordinate vs trail segments.">
                    <span className="flex items-center gap-1.5">
                      <svg width="14" height="6" className="shrink-0">
                        <line x1="0" y1="3" x2="14" y2="3" stroke={mode === 'bullish' ? '#6ba368' : mode === 'bearish' ? '#ff5a5a' : '#d4a84b'} strokeWidth="1" strokeDasharray="2 1.5" opacity="0.9"/>
                      </svg>
                      path · {velocity.state?.toLowerCase() || '—'}
                    </span>
                  </Tip>
                  {current?.book && Math.abs(current.book.obi) > 0.08 && (
                    <Tip text="Quick read of simulated L2 pressure vs the current path.">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{
                        background: current.book.obi > 0 ? 'rgba(80,230,170,0.9)' : 'rgba(255,100,160,0.9)',
                        boxShadow: `0 0 6px ${current.book.obi > 0 ? 'rgba(80,230,170,0.7)' : 'rgba(255,100,160,0.7)'}`,
                      }}/>
                      L2 · {current.book.obi > 0 ? 'supported' : 'resisted'}
                    </span>
                    </Tip>
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
                    reversal={smoothedReversal}
                    obi={current?.book?.obi}
                    smooth={regimeFilter}
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

            {/* REVERSAL DETECTOR — spans same height as matrix */}
            <div style={{ position: isDesktop ? 'sticky' : 'static', top: 24, alignSelf: 'start' }}>
              <ReversalSignal
                reversal={smoothedReversal}
                currentQuad={activeQuad}
                profile={profile}
                regimeFilter={regimeFilter}
                mtfConfluenceActive={mtfConfluenceActive}
              />
            </div>

            </div>{/* end matrix+reversal grid */}

          </div>

          {/* RIGHT RAIL — cycle + vector stream + trend */}
          <aside className="space-y-4" style={{ order: isDesktop ? 0 : 3 }}>

            {/* CYCLE TIMELINE */}
            <div className="bg-[var(--bg-alt)] border border-[var(--line)] p-5">
              <PhaseTimeline phaseIdx={phaseIdx} phaseTick={phaseTick} phase={phase}/>
            </div>

            {/* VECTOR STREAM */}
            <div className="bg-[var(--bg-alt)] border border-[var(--line)] p-5">
              <VectorTicker vectorHistory={vectorHistory}/>
            </div>

            {/* CONTINUATION DETECTOR */}
            <TrendStrengthPanel trend={smoothedTrendStrength} profile={profile} regimeFilter={regimeFilter}/>

            {/* JOINT READOUT */}
            <Tip text="Joint readout maps continuation strength tier × reversal tier to a narrative phrase (presentation only; no additional scoring)." block>
              <div className="bg-[var(--bg-alt)] border border-[var(--line)] px-4 py-2.5">
                <div className="text-[8px] tracking-[0.22em] uppercase text-[var(--fg-mute)] mb-1">Joint readout · continuation × reversal</div>
                <div className="text-[11px] text-[var(--fg-dim)] font-['Fraunces'] italic leading-snug">
                  {jointTrendReversalReadout(smoothedTrendStrength.tier, reversalTierFromScore(smoothedReversal.score))}
                </div>
              </div>
            </Tip>
          </aside>
        </div>

        {/* FOOTER */}
        <footer className="mt-8 pt-4 border-t border-[var(--line)] text-[9px] tracking-[0.22em] uppercase text-[var(--fg-mute)] flex justify-between px-5">
          <span>
            Percentile Rank · N={profile.lookback} ·{' '}
            Spread Penalty {(profile.spreadPenalty * 100).toFixed(1)}% ·{' '}
            Significance ×{profile.significanceMultiplier.toFixed(2)}
          </span>
          <span>Simulated feed — not market data</span>
        </footer>

        <BacktestModal
          open={backtestOpen}
          onClose={() => setBacktestOpen(false)}
          onRun={runBacktestHandler}
          execution={execution}
          setExecution={setExecution}
          result={backtestResult}
          recommendations={backtestRecommendations}
          strategyName={strategyName}
          setStrategyName={setStrategyName}
        />
      </div>
    </div>
  );
}

function StatRow({ label, value, subvalue, suffix, accent, accentColor, title: tipTitle }) {
  const row = (
    <div className="flex items-baseline justify-between border-b border-dashed border-[var(--line)] pb-2 last:border-b-0 outline-none">
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
  if (!tipTitle) return row;
  return <Tip text={tipTitle} block>{row}</Tip>;
}
