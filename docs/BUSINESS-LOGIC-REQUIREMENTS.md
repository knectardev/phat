# VWC Dynamic Matrix — Business Logic Requirements

**Status:** As-implemented specification (code is source of truth)  
**Primary implementation:** `vwc-dynamic-matrix-filtering.jsx` (bundled by `demo/demo-entry.jsx`)  
**Secondary reference:** `vwc-dynamic-matrix.jsx` — same core matrix and reversal laws **without** kinetic regime filtering, trend-strength detector, TF confluence law, or multi-panel extensions described in §6–§9.

---

## 1. Purpose and scope

### 1.1 Purpose

The application is a **standalone browser demo** that visualizes a **synthetic** volume–body coordinate system (“VWC Dynamic Matrix”), interprets recent path geometry with **Wyckoff-inspired reversal laws**, and (in the filtering build) adds **continuation/trend strength**, **synthetic higher-timeframe context**, and **optional kinetic smoothing**. It educates and prototypes logic; it **does not** consume live exchange feeds.

### 1.2 In scope (this document)

- Definitions of coordinates, quadrants, and candle fields.
- Scripted data generation and timeframe profiles.
- Reversal detector laws, aggregation, and significance scaling.
- Trend strength gate and laws (filtering build only).
- Regime filter (HMA coordinates, HA-based `trendMode`, asymmetric EMA on scores).
- UI affordances that reflect the above (matrix, chart, DOM strip, panels).

### 1.3 Out of scope

- Real market connectivity, historical backfill, persistence, auth, or multi-user state.
- Guarantees of predictive accuracy or fit to any specific instrument.

---

## 2. SOLID-aligned module boundaries

The codebase maps cleanly to **separate responsibilities** (Single Responsibility). Extension of behavior is largely by **configuration** (`TIMEFRAME_PROFILES`, `PHASES`, `TREND_GATE`, weights) rather than subclassing (Open/Closed at the design level).

| Concern | Responsibility | Primary locus |
|--------|----------------|---------------|
| **Data acquisition** | Produce OHLCV-like bars, spread penalty, book, HA/HMA/trend fields | `useScriptedFeed` |
| **Spatial model** | Map bar → percentile → bucket → `(x,y)` → quadrant | Percentile + `quadrantOf` |
| **Reversal semantics** | Score structural handoff / exhaustion patterns | `reversal` `useMemo` |
| **Trend semantics** | Score continuation when gated in Engine/Wall | `trendStrength` `useMemo` |
| **Presentation** | Chart, matrix, heatmap, gauges, tooltips | React subcomponents |

**Dependency direction:** UI depends on derived signals; detectors depend on candle arrays and profile config, not on DOM.

---

## 3. Glossary

| Term | Definition |
|------|------------|
| **Bar / candle** | One synthetic period: OHLC, volume, body metrics, optional `book`, `ha`, `smoothCoord`, `trendMode`. |
| **Effort (X)** | Volume axis: percentile rank of `vol` within the rolling lookback, bucketed 1–10. |
| **Result (Y)** | Body axis: percentile rank of **earned body** (`rawBody - simulatedSpread`), bucketed 1–10. |
| **Coordinate** | Pair `(x, y)` with integers in `[1, 10]`. |
| **Quadrant (Q1–Q4)** | `Q1`: low vol + high body; `Q2`: high + high; `Q3`: low + low; `Q4`: high vol + low body (see `quadrantOf`). |
| **OBI** | Order book imbalance on top 10 levels each side: \((\sum bid - \sum ask) / (\sum bid + \sum ask)\). |
| **Phase** | One segment of the **scripted market cycle** (accumulation → … → exhaustion) biasing random draws. |
| **Regime filter** | User toggle: when **on**, matrix path / most laws use **smoothed** coordinates and **persistent** trend mode; chart may show HA-smoothed OHLC. |

---

## 4. Functional requirements — data feed

### REQ-FEED-01 — Scripted cycle

The system **shall** advance through an ordered list of **phases** (`PHASES`). Each phase defines:

- Duration in bars.
- Ranges for **volume class** and **body class** (uniform random).
- **Direction probability** for bar sign.
- **Target quadrant** (semantic hint for the scenario).
- **Book bias** in `[-1, 1]` skewing bid vs ask depth.

### REQ-FEED-02 — Bar construction

For each new bar the system **shall**:

1. Draw vol/body classes from the active phase and map them to **absolute** `vol` and raw body magnitude (body scale **depends on selected timeframe**).
2. Apply optional **doji** texture (small body) except in excluded phases.
3. Set `open` from previous close, compute `close`, derive `high`/`low` with random wicks.
4. Compute `rawBody = |close - open|` and **simulated spread** = `rawBody * spreadPenalty * randomScalar` (from active **timeframe profile**).
5. Set `earnedBody = max(0.01, rawBody - simulatedSpread)` for percentile ranking on Y.

### REQ-FEED-03 — Rolling window and ranking

The system **shall** maintain a candle buffer of length **L = `profile.lookback`**. For the newest bar it **shall** compute:

- `volPct = percentileRank(vols, vol)` and `bodyPct` likewise on `earnedBody`.
- `x = pctToBucket(volPct)`, `y = pctToBucket(bodyPct)` (ceil to 1–10).
- `quad = quadrantOf(x, y)`.

### REQ-FEED-04 — Bar bias (candle color semantics)

The system **shall** set `bias` to:

- `mixed` if **relative doji** conditions hold (`bodyPct` small and body small vs full range); else  
- `bullish` if `close > open`, else `bearish`.

### REQ-FEED-05 — Synthetic Level 2 book

The implementation **shall** use a single constant `BOOK_DEPTH` for **both** book generation and the depth heatmap row count. **As implemented:** `BOOK_DEPTH = 20` (20 bid levels and 20 ask levels, each side of mid).

**OBI / depth totals (narrower window):** `generateBook` **shall** compute **OBI** and the **bidTot / askTot** figures used in the UI from only the **closest 10 levels** per side (`closeN = 10`), not from all `BOOK_DEPTH` rows. Implementers should not conflate “levels drawn in the strip” (20) with “levels included in the imbalance numerator” (10).

### REQ-FEED-06 — Playback controls

The UI **shall** allow **play/pause**, **speed** scaling of the interval, **timeframe** selection, and **reset** (clear candles, phase index, price ref, vector history as implemented).

---

## 5. Functional requirements — timeframe profiles

Each selectable timeframe **shall** define at minimum:

| Field | Role |
|-------|------|
| `lookback` | Rolling N for percentiles |
| `spreadPenalty` | Effort/result friction (microstructure vs macro) |
| `significanceMultiplier` | Scales **final** reversal confidence (short TF discount, long TF amplification) |
| `inertiaFactor` | Max contribution to inertia bonus when quadrant unchanged |
| `lawWeights` | Per-law multipliers for **reversal** sub-scores (`Fat`, `Vacuum`, `Curvature`, `Divergence`, `Liquidity`, `TFConfluence`) |
| `candleIntervalMs` | Base tick duration (divided by speed) |
| `accent` | Theming |

**Filtering build only:** `trendLawWeights` **shall** scale **trend** sub-laws (`QuadrantLock`, `CoordinateExtension`, `VolumeExpansion`, `OBIPersistence`, `HTFAlignment`).

---

## 6. Functional requirements — kinetic regime layer (filtering build)

### REQ-KIN-01 — Heikin-Ashi auxiliary series

Each bar **shall** store `ha` (`open`, `high`, `low`, `close`, `bias`) computed from raw OHLC with standard HA recursion (bootstrap on first bar). Used for **display smoothing** when regime filter is on and for **`trendMode`** hysteresis.

### REQ-KIN-02 — Hull-smoothed grid position

When at least two coordinates exist, the system **shall** compute **HMA(4)**-style smoothed `x`/`y` independently, clamp and round to integers 1–10, and set `smoothQuad` from `quadrantOf`.

### REQ-KIN-03 — Trend mode persistence

`trendMode` **shall** default-bootstrap from current HA bias; thereafter it **shall** flip only when **≥3 of the last 5** HA biases agree on the new direction; otherwise it **shall** persist the previous mode.

### REQ-KIN-04 — Effective fields for UI and detection

When **regime filter is ON**:

- Matrix active cell, trail, velocity, and **most reversal laws** **shall** use `smoothCoord` / `smoothQuad` / `trendMode` where implemented.
- **Curvature law** **shall** still use **raw** `coord` path (explicit exception: acceleration geometry).

When **OFF**, raw `coord` / `quad` / `bias` **shall** be used throughout.

### REQ-KIN-05 — Confidence hysteresis

When regime filter is **ON**, displayed **reversal** and **trend strength** headline scores **shall** follow an **asymmetric EMA**: faster rise (α = 0.55 when incoming > prior), slower decay (α = 0.15 when incoming ≤ prior). When **OFF**, raw computed scores **shall** display unchanged.

---

## 7. Functional requirements — reversal detector

**Inputs:** Recent candle window (typically last 7), `current` bar, timeframe `lawWeights`, `significanceMultiplier`, `inertiaFactor`, optional `htfContext` / `ltfContext`, regime pickers (`coordOf` / `quadOf` / `biasOf`).

### REQ-REV-01 — Law: Fat Reversal

**Shall** activate when smoothed-or-raw quadrant is **Q4**, `x ≥ 7`, and a prior bar in the lookback window shows **Engine-like** structure; score from **horizontal stretch** (Δx) and **vertical collapse** (Δy) vs thresholds; emit **bearish-leaning** law with narrative “Q2→Q4”.

### REQ-REV-02 — Law: Vacuum Snap

**Shall** activate in **Q1** with `x ≤ 3`, `y ≥ 7`; score from **y extremity** and **x anemia**; **shall** set mean-reversion **target** coordinate to the most recent **HVN** (Q2 or Q4 with `x ≥ 6`) in last 15 bars.

### REQ-REV-03 — Law: Curvature

On the last **5 raw** coordinates, the system **shall** classify (mutually exclusive priority in implementation): **Parabolic Top/Bottom**, **Linear Compression**, or **Spiral** (signed cumulative cross product threshold); assign direction labels per pattern type.

### REQ-REV-04 — Law: Divergence

**Shall** evaluate price extremes vs coordinate extremes over the window:

- **Bearish:** current makes **higher high** but coordinate **y** below prior max **y** while **x** at least prior max **x**.
- **Bullish:** current makes **lower low**, quadrant **Q4**, `x ≥ 7`.

### REQ-REV-05 — Law: Liquidity divergence

Using last **up to 3** bars with books, **shall** detect:

- Bullish engine + sufficiently negative average OBI → bearish-leaning hollow trend.
- Bearish engine + sufficiently positive average OBI → bullish-leaning absorption.
- **Q4** wall + strong |OBI| → directional confirmation text by sign.
- **Q1** thin-up + OBI extremes → bearish snap vs pending supportive case.

### REQ-REV-06 — Law: TF Confluence (filtering build)

After other laws populate a preliminary list, the system **shall** infer a **dominant direction** from bearish vs bullish weighted scores (1.2× margin). If `htfContext` exists and direction is not mixed, it **shall** compute a **confluence score** from HTF/LTF agreement, optional OBI sign alignment, and **counter-HTF** penalty branch.

- **Shall** add a **positive** `TF Confluence` law signal only when `|confluenceScore| > 0.1` and score > 0 (negative confluence does not add a chip but see REQ-REV-08).

### REQ-REV-07 — Weighting and activation (two-stage rule)

**Stage A — law emission (candidate signals):**

- **Laws 1–5** (Fat Reversal, Vacuum Snap, Curvature, Divergence, Liquidity Div.): a candidate signal **shall** be pushed onto the working list **only if** that law’s **raw** score satisfies **`rawScore > 0.35`** (strictly greater than 0.35 in code for each branch).
- **Law 6** (TF Confluence): **does not** use the 0.35 raw gate. A candidate **shall** be pushed when the confluence branch yields a **positive** `confluenceScore` with **`|confluenceScore| > 0.1`** (negative scores affect REQ-REV-08 cap only; they do not create a law row).

**Stage B — timeframe weights and aggregation membership:**

- Each **emitted** candidate **shall** be multiplied by its profile `lawWeights[…]` entry and capped at **1.0** → this yields the law’s **weighted** score.
- The reversal aggregate **shall** consider only laws whose **weighted** score satisfies **`weightedScore >= 0.30`**. Laws that cleared Stage A but fall below 0.30 after weighting **shall** be dropped before direction voting and `rawScore` compounding.

There is **one** post-weight threshold (0.30). The **0.35** value is exclusively the **pre-weight** emission threshold for laws 1–5.

### REQ-REV-08 — Aggregate direction and score

The system **shall**:

1. Sum weights by direction category with **1.3× margin** rule for bearish vs bullish; neutral/pending from reversal-type laws.
2. Compute `rawScore = min(0.98, 0.75 * topLaw + 0.35 * sum(others))`.
3. If **counter-HTF** confluence (`confluenceScore < -0.1`), **shall** cap `rawScore` at **0.52**.
4. Add **inertia bonus** if `inertiaFactor > 0` and last **4** quads (via `quadOf`) identical: `bonus = inertiaFactor * 0.15`.
5. Final `score = min(0.99, (rawScore + bonus) * significanceMultiplier)` (before optional display EMA per REQ-KIN-05).

### REQ-REV-09 — Vacuum target visualization

When reversal target is set and score > threshold, the matrix overlay **shall** draw target marker and link from active coordinate (as implemented in `Matrix`).

---

## 8. Functional requirements — trend strength (filtering build)

### REQ-TREND-01 — Activation gate

If fewer than `TREND_GATE.M` bars exist, or fewer than `TREND_GATE.N` of the last `M` bars lie in **Q2 ∪ Q4**, the trend system **shall** return **NONE** tier with apathy reason.

### REQ-TREND-02 — Gate direction

Among last `M` Engine/Wall bars, the system **shall** compare **Q2 count vs Q4 count** to choose **bullish vs bearish**; on ties it **shall** fall back to current `biasOf(cur)`.

### REQ-TREND-03 — Trend laws (post-gate)

With direction fixed, the system **shall** evaluate up to five components, each weighted by `trendLawWeights`:

1. **Quadrant Lock** — run length of consecutive Q2/Q4 from the tip; soft-saturating score.  
2. **Coordinate Extension** — progress toward a corner anchor `(10,10)` bullish or `(10,1)` bearish blended with path efficiency.  
3. **Volume Expansion** — minimum `volPct` over last `K` vs floor `TAU_VOL`.  
4. **OBI Persistence** — count of last `K` bars whose OBI sign matches direction; narrative floor references `OBI_MIN_MATCH`.  
5. **HTF Alignment** — compares **synthetic HTF** trend string to gate direction (or mixed / against).

### REQ-TREND-04 — Trend aggregation and tier

Weighted law scores **shall** use activation cutoff **ACT = 0.22**, combine top + 0.35 × rest like reversal, and map tier: **HIGH ≥ 0.65**, **MODERATE ≥ 0.4**, else **LOW** (unless gate failed → **NONE**).

### REQ-TREND-05 — Joint readout (`trendTier` × `reversalTier`)

The UI **shall** derive a single narrative line from `jointTrendReversalReadout(trendTier, reversalTier)` (**presentation-only**; values are **not** fed back into detectors).

**Inputs (as wired in code):**

- **`trendTier`** — `smoothedTrendStrength.tier` when the regime filter is on (else the unsmoothed trend tier): **`NONE`**, **`LOW`**, **`MODERATE`**, or **`HIGH`** per REQ-TREND-04.
- **`reversalTier`** — from `reversalTierFromScore(smoothedReversal.score)` (or unsmoothed reversal score when the filter is off), using percentile of the **displayed** reversal confidence: **`HIGH`** if ≥ 80%, **`MODERATE`** if ≥ 55%, **`LOW`** if ≥ 30%, else **`NONE`**.

**Phrase matrix** (key = `` `${trendTier}|${reversalTier}` ``; fallback if key missing: `` `Trend ${trendTier} · Reversal ${reversalTier} — mixed signal space.` ``):

| trend \\ reversal | **NONE** | **LOW** | **MODERATE** | **HIGH** |
|-------------------|----------|---------|--------------|----------|
| **NONE** | Apathy pocket — neither continuation nor handoff is asserting. | Quiet tape with early reversal friction — watch for ignition. | Exhaustion building — reversal rising without trend sponsorship. | Climax risk — high reversal pressure while trend strength is idle. |
| **LOW** | Drift with continuation bias — reversal dormant. | Two-way chop — weak trend conviction and soft reversal. | Late-cycle creep — continuation fading as reversal firms. | Blowoff forming — reversal surging into a thinning trend. |
| **MODERATE** | Steady continuation — geometric handoff quiet. | Trend-led grind — minor structural disagreement. | Tug-of-war — trend and reversal both mid-range. | High-conviction turn risk — reversal catching a live trend. |
| **HIGH** | Clean continuation — conviction without reversal alarm. | Strong trend tape — only light reversal scouts. | Trend dominant — keep an eye on building divergence. | Volatile intersection — trend and reversal both elevated (potential climax). |

---

## 9. Functional requirements — synthetic multi-timeframe context

### REQ-MTF-01 — HTF aggregation and `HTF_RATIO`

Constant **`HTF_RATIO`** **shall** map the **active chart timeframe** to how many consecutive **active-TF** candles roll up into one synthetic higher-timeframe step:

| Active TF | `HTF_RATIO` (bars per synthetic HTF step) |
|-----------|---------------------------------------------|
| `1m` | **5** |
| `5m` | **3** |
| `15m` | **4** |
| `1h` | **6** |
| `1d` | **`null`** (no synthetic HTF rollup in this demo) |

For any TF where `HTF_RATIO[tf] = r` is a positive integer, the system **shall** fold every **`r`** consecutive candles into one **synthetic HTF bar** (OHLC aggregate, last quad/mode/bias, OBI from last bar of the slice). When the ratio is **`null`**, the implementation **shall** omit HTF bar construction for that TF (and downstream logic that requires `htfContext` behaves accordingly).

### REQ-MTF-02 — HTF trend label

From the last **3** synthetic HTF bars, trend **shall** be `bullish` if ≥2 bullish, `bearish` if ≥2 bearish, else `mixed`.

### REQ-MTF-03 — LTF proxy

From the last **4** raw bars, the system **shall** estimate a short-horizon trend from average Δy between consecutive coordinates and average OBI.

---

## 10. Functional requirements — path, vectors, and telemetry

### REQ-PATH-01 — Trail

The UI **shall** show a **3-bar** conceptual trail (active + two priors) using effective coordinates under regime rules.

### REQ-PATH-02 — Velocity classification

**Shall** sum Euclidean grid distances along active → t-1 → t-2 and normalize per segment; **shall** label **Compressing / Stable / Expanding / Discharging** from average segment length thresholds.

### REQ-PATH-03 — Named vectors

On each **quadrant change** of the effective quad, if `(prev,next)` matches an entry in `VECTOR_NAMES`, the system **shall** push a record into **Vector Stream** history (capped length).

### REQ-PATH-04 — Matrix presentation

The matrix **shall** render 10×10 cells with quadrant tints, active highlight, trail inset, optional OBI radial wash, optional impact flash on **Q2/Q4** landing, and hover taxonomy text from `cellTaxonomy`.

---

## 11. Non-functional requirements

| ID | Requirement |
|----|-------------|
| REQ-NF-01 | **Determinism:** Bar stream is **pseudo-random** (not seeded for replay in browser unless changed). |
| REQ-NF-02 | **Performance:** Single React tree; detectors in `useMemo` keyed on candles/profile/context. |
| REQ-NF-03 | **Accessibility:** Custom `Tip` tooltips **shall** support keyboard focus where wired; chart/matrix are visual-first. |
| REQ-NF-04 | **Honesty:** Footer **shall** state simulated feed, not market data. |

---

## 12. Build and deployment surface

### REQ-BUILD-01

The project **shall** provide `npm run build:demo` to compile Tailwind input → `demo/vwc-matrix-demo.css` and bundle `demo/demo-entry.jsx` → `demo/vwc-matrix-demo.bundle.js`.

### REQ-BUILD-02

`npm run build` **shall** alias to `build:demo` for CI/host defaults.

### REQ-DEPLOY-01

Root `index.html` **may** be used for static hosts so `/` loads the same shell as `demo/vwc-matrix-demo.html` with `<base href="/demo/">` for asset resolution.

---

## 13. Traceability matrix (summary)

| Business concept | Code anchor (filtering build) |
|------------------|-------------------------------|
| Phases / generator | `PHASES`, `useScriptedFeed` |
| Profiles | `TIMEFRAME_PROFILES` |
| Quadrants | `quadrantOf`, `QUAD_META` |
| Reversal laws | `reversal` `useMemo` |
| Trend laws | `trendStrength` `useMemo`, `TREND_GATE` |
| HTF/LTF | `HTF_RATIO`, `htfContext`, `ltfContext` `useMemo` |
| Joint readout | `jointTrendReversalReadout`, `reversalTierFromScore` |
| Smoothing | HMA block + `trendMode` in `useScriptedFeed`; `smoothedReversal` / `smoothedTrendStrength` |
| UI entry | `export default function App` |

---

## 14. Change control

Any behavioral change **shall** update this document when product owners need spec parity, or the document **shall** be regenerated from code with an explicit “as of commit …” stamp.
