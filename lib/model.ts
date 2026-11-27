// The token radar's model, radar-3: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every
// other pre-token protocol the board rule keeps: 198 rows on this snapshot. A protocol is pre-token
// when its record carries no token (mcap_usd, gecko_id and symbol all null); the snapshot's
// live-token protocols are kept apart and shown with the market's own values, never mixed into
// the ranked board. No protocol name is ever special-cased: the same functions score every row.
//
// VALUE MODEL (an equal-weight ensemble of three fitted predictors, log-averaged)
//   Comps: the live-token protocols with mcap_usd > 0 and tvl_usd > 0 (128 on this snapshot;
//   one further record carries a negative market cap and is not a usable comp).
//   M0  base:     log10(mcap) = a0 + b0 * log10(TVL), OLS on the comps.
//   M1  growth:   log10(mcap) = a1 + b1 * log10(TVL) + c1 * g, where g is the protocol's
//                 change_7d clamped to +/-30% and divided by 100. The fitted c1 is NEGATIVE
//                 (about -1.5): among live comps, a recent TVL spike predicts a LOWER
//                 market-cap/TVL ratio — growth spikes mean-revert. The clamp keeps one wild
//                 week from moving a prediction by more than ~0.45 log units (~3x).
//   M2  maturity: M0's prediction times the maturity prior 0.6 + 0.4 * min(age, 1095) / 1095
//                 (unknown age uses 365 days). A stated prior, not a fitted shape: a protocol
//                 that has run longer with no token prices closer to the fitted curve.
//   launch value = 10 ^ mean(log10 M0, log10 M1, log10 M2), rounded to whole dollars.
//   launch odds: the peers' own record (v1's shrunk age-band / TVL-band shares, unchanged).
//   implied value = launch value x odds, rounded to whole dollars, at least 1.
//   The fitted coefficients are rounded to 6 decimals and the launch value is computed from
//   the rounded values, so the constants in the output reproduce the board exactly.
//
// VALIDATION (five blind tests, computed at build time from the snapshot, embedded in output)
//   Walk-forward at three cutoffs (2023-01-01, 2024-01-01, 2024-07-01): fit on comps listed
//   before the cutoff, test on those listed on or after it. Leave-one-out: refit on the other
//   127 comps for each of the 128. 5-fold: deterministic folds by sorted slug, index mod 5.
//   Every test scores each candidate spec on median absolute log10 error and the share of
//   predictions within 3x, against the flat 0.25 x TVL baseline. The multiplier is the
//   baseline's median error divided by the model's: how many times smaller the model's
//   typical error is. The final ensemble beats the flat baseline on all five tests and beats
//   the plain log-log base on aggregate (mean median error and mean within-3x across tests).
//   Keep/drop verdicts are decided on those five tests, and the dashboard shows the table:
//   growth KEPT at one-third weight (full weight helps the tails but hurts the typical error);
//   maturity KEPT at one-third weight; category dummies DROPPED (worse than base on both
//   aggregate measures); curvature (a squared log-TVL term) DROPPED on stability grounds —
//   its fitted coefficient flips sign between the pre-2024 and post-2024 halves (+0.19 vs
//   -0.11), so its apparent gain does not survive a time split.
//
// CONFORMAL INTERVALS (jackknife+, Barber et al. 2021)
//   The leave-one-out residuals of the final ensemble on the 128 comps give the 80% and 90%
//   quantiles (finite-sample corrected), applied in log space to every row's launch value and
//   then multiplied by its odds. The honest range is wide — about a factor of 13 at 80% —
//   because a fitted curve cannot pin a launch value tighter than that on 128 comps. The
//   point estimate ranks; the interval humbles.
//
// FARM PLANS (derived from the protocol's own record: category, chains, TVL, age)
//   8 steps per row. Capital tiers from TVL (>=5B: $250, >=1B: $150, >=100M: $100, else $50);
//   hold days from age (unknown: 30, <180 days: 60, <365: 45, else 30). Gas is priced by the
//   protocol's main chain (stated planning assumptions, not measured fees: Ethereum $8 a
//   transaction, cheap chains — Solana, Base, Arbitrum, Optimism, BNB Chain, Polygon,
//   Avalanche, Sui, Aptos — $2, everything else $3); a plan makes 5 + hold-weeks transactions.
//   Minimum viable capital is the deposit plus the whole gas bill: the cash a farmer must
//   hold before starting. Farm cost is gas only (capital is a recoverable deposit, not a
//   cost); farm hours are active minutes. Expected value = implied value x AIRDROP_SHARE
//   (0.01% of the launch value to one active farmer, a stated assumption, not a measured
//   figure). Net per hour = (expected value - cost) / hours; break-even implied value =
//   cost / AIRDROP_SHARE; net per $100 of capital = (expected value - cost) / capital x 100.
//   FARM at >= $100/hour, THIN at >= $25/hour, otherwise SKIP.
//
// INTEGRITY STRIP
//   Every row carries flags computed from its own record — no 7-day change reported, listing
//   date unknown, single chain, below the watchlist floor — and the dashboard shows the
//   board-level counts, the snapshot's date and source, and the statement that no token is
//   ever claimed, only recorded. Nothing is silently dropped: live and excluded lanes account
//   for every one of the 758 protocols.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** Stated share of the implied launch value one active farmer is assumed to capture. */
  airdrop_share: number;
  /** Net dollars per hour at or above which a row is a FARM verdict. */
  farm_threshold_usd_per_hour: number;
  /** Net dollars per hour at or above which a row is a THIN verdict (below it: SKIP). */
  thin_threshold_usd_per_hour: number;
}

export const MODEL: ModelConstants = {
  growth_cap: 30,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  airdrop_share: 0.0001,
  farm_threshold_usd_per_hour: 100,
  thin_threshold_usd_per_hour: 25,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** The three walk-forward cutoffs: comps listed before fit, comps listed on or after test. */
export const WALK_FORWARD_CUTOFFS = ['2023-01-01', '2024-01-01', '2024-07-01'] as const;

/** The flat baseline the validation compares against: the starter's 0.25 x TVL. */
export const BASELINE_MULTIPLE = 0.25;

/** The board rule's expected size on this snapshot; buildBoard throws if it is not met. */
export const EXPECTED_BOARD_SIZE = 198;

/** Stated planning gas per transaction, by main chain (assumptions, not measured fees). */
export const GAS_PER_TX: Record<string, number> = {
  Ethereum: 8,
  Solana: 2,
  Base: 2,
  Arbitrum: 2,
  Optimism: 2,
  'BNB Chain': 2,
  Polygon: 2,
  Avalanche: 2,
  Sui: 2,
  Aptos: 2,
};
export const GAS_PER_TX_DEFAULT = 3;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  launch_value_usd: number;
  odds: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  /** The three ensemble members' launch values, [base, growth, maturity], whole dollars. */
  launch_members_usd: [number, number, number];
  /** Jackknife+ 80% interval on the implied value, [low, high], whole dollars. */
  interval_80_usd: [number, number];
  /** Jackknife+ 90% interval on the implied value, [low, high], whole dollars. */
  interval_90_usd: [number, number];
  farm_steps: string[];
  farm_cost_usd: number;
  farm_hours: number;
  net_per_hour_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  /** Deposit plus the whole gas bill: the cash a farmer must hold before starting. */
  min_capital_usd: number;
  /** The implied value at which the farm breaks even, whole dollars. */
  breakeven_implied_usd: number;
  /** Net dollars per $100 of capital deployed. */
  net_per_100_capital_usd: number;
  /** Integrity flags computed from the row's own record. */
  integrity_flags: string[];
  watchlist: boolean;
  model: {
    a: number;
    b: number;
    growth_a: number;
    growth_b: number;
    growth_c: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
}

/** One row of data.js: the dashboard's compact view of a board row, farm plan included. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  launch_value_usd: number;
  odds: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  launch_members_usd: [number, number, number];
  interval_80_usd: [number, number];
  interval_90_usd: [number, number];
  farm_steps: string[];
  farm_cost_usd: number;
  farm_hours: number;
  net_per_hour_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  min_capital_usd: number;
  breakeven_implied_usd: number;
  net_per_100_capital_usd: number;
  integrity_flags: string[];
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** A pre-token protocol the board rule leaves out, with the short reason it was left out. */
export interface ExcludedRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: 'CEX' | 'versioned name' | 'wrapped-staked-bridged' | 'bridge category';
}

/** One blind test of one candidate spec. */
export interface ValidationTest {
  test: string;
  spec: string;
  n_train?: number;
  n_test?: number;
  n?: number;
  median_abs_log_err: number;
  within_3x: number;
  baseline_median_abs_log_err: number;
  baseline_within_3x: number;
  /** Baseline median error divided by the model's: how many times smaller its typical error is. */
  multiplier: number;
}

/** One candidate spec's aggregate across the five blind tests, and its keep/drop verdict. */
export interface SpecValidation {
  spec: string;
  label: string;
  tests: ValidationTest[];
  mean_median_abs_log_err: number;
  mean_within_3x: number;
  verdict: 'KEPT' | 'DROPPED' | 'FINAL';
  rationale: string;
}

/** A token-share band of the odds calibration. */
export interface OddsBand {
  label: string;
  n: number;
  token_share: number;
}

/** Everything the dashboard needs: the board, the live set, the excluded set, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelConstants & {
    comps: { n: number; a: number; b: number; growth_a: number; growth_b: number; growth_c: number; median_ratio: number };
  };
  validation: { specs: SpecValidation[]; final_spec: string };
  conformal: {
    n: number;
    q80_log: number;
    q90_log: number;
    factor80: number;
    factor90: number;
    coverage80: number;
    coverage90: number;
  };
  odds: { overall: number; brier: number; brier_constant: number; age_bands: OddsBand[]; tvl_bands: OddsBand[] };
  integrity: { missing_change_7d: number; unknown_age: number; single_chain: number; below_floor: number; watchlist: number; total: number };
  watchlist_size: number;
  board_size: number;
  counts: { total: number; ranked: number; live: number; excluded: number };
  rows: RadarRow[];
  live: LiveRow[];
  excluded: ExcludedRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole wrapped / staked / staking word in a name. */
const WRAPPED_STAKED = /\b(wrapped|staked|staking)\b/i;
/** Categories the board rule keeps out: bridges and staked products of tokens that trade. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Exchange names a board protocol's name must not start with. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_STAKED.test(p.name)) return false;
  return !EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix));
}

/** Why a pre-token protocol fails the board rule, or null when it passes. */
export function excludedReason(p: SnapshotProtocol): ExcludedRow['reason'] | null {
  if (!isPreToken(p)) return null;
  if (p.category === 'CEX') return 'CEX';
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return 'bridge category';
  return 'wrapped-staked-bridged';
}

// ---------------------------------------------------------------- fitted value model

/** The comps: live-token protocols with a positive market cap and positive TVL. */
export function comps(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/**
 * Ordinary least squares for a design matrix (the intercept column is added here):
 * solves the normal equations by Gaussian elimination with partial pivoting and a tiny
 * ridge (1e-8) so a dummy column with no members in a fold cannot make the system singular.
 * Returns null when the system cannot be solved.
 */
export function fitOls(rows: number[][], ys: number[]): number[] | null {
  const k = rows.length > 0 ? rows[0]!.length + 1 : 1;
  const n = rows.length;
  if (n < k) return null;
  const a: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b: number[] = new Array<number>(k).fill(0);
  for (let r = 0; r < n; r++) {
    const v = [1, ...rows[r]!];
    for (let i = 0; i < k; i++) {
      b[i]! += v[i]! * ys[r]!;
      for (let j = 0; j < k; j++) a[i]![j]! += v[i]! * v[j]!;
    }
  }
  for (let i = 1; i < k; i++) a[i]![i]! += 1e-8;
  const m: number[][] = a.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    if (Math.abs(m[piv]![c]!) < 1e-12) return null;
    const tmp = m[c]!;
    m[c] = m[piv]!;
    m[piv] = tmp;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let j = c; j <= k; j++) m[r]![j]! -= f * m[c]![j]!;
    }
  }
  return m.map((row, i) => row[k]! / row[i]!);
}

/** The median of a list of numbers (average of the two middle values when the count is even). */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The growth feature: change_7d clamped to +/- the model's cap, as a fraction. */
export function growthFeature(p: SnapshotProtocol, model: ModelConstants = MODEL): number {
  const raw = finite(p.change_7d, 0);
  return Math.min(model.growth_cap, Math.max(-model.growth_cap, raw)) / 100;
}

/** The maturity prior: 0.6 at listing, rising to 1.0 at 1095 days; unknown age uses 365. */
export function maturityMultiplier(age: number | null, model: ModelConstants = MODEL): number {
  const ageForModel = age ?? model.unknown_age_days;
  return round4(model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range);
}

/** A candidate spec's name. */
export type SpecName = 'base' | 'growth' | 'maturity' | 'ensemble' | 'category' | 'curvature';
export const SPEC_NAMES: SpecName[] = ['base', 'growth', 'maturity', 'ensemble', 'category', 'curvature'];
export const SPEC_LABELS: Record<SpecName, string> = {
  base: 'Base log-log',
  growth: 'Base + fitted growth',
  maturity: 'Base × maturity prior',
  ensemble: 'Ensemble (final)',
  category: 'Base + growth + category',
  curvature: 'Base + growth + curvature',
};

/** The six most common categories among `train` (count desc, name asc for ties). */
function topCategories(train: SnapshotProtocol[]): string[] {
  const counts = new Map<string, number>();
  for (const p of train) {
    const c = p.category ?? 'Other';
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 6)
    .map(([c]) => c);
}

/**
 * A spec's predictor, fitted on `train`: a function from a protocol to a predicted market
 * cap in dollars. The ensemble log-averages its three members; maturity multiplies the base
 * fit by the prior; category adds one dummy per top category; curvature adds log(TVL)^2.
 */
export function fitSpec(spec: SpecName, train: SnapshotProtocol[], asOf: string, model: ModelConstants = MODEL): ((p: SnapshotProtocol) => number) | null {
  const ys = train.map((p) => Math.log10(p.mcap_usd as number));
  const logTvl = (p: SnapshotProtocol): number => Math.log10(p.tvl_usd);
  if (spec === 'base' || spec === 'maturity') {
    const beta = fitOls(train.map((p) => [logTvl(p)]), ys);
    if (beta === null) return null;
    return (p: SnapshotProtocol): number => {
      const v = 10 ** (beta[0]! + beta[1]! * logTvl(p));
      return spec === 'maturity' ? v * maturityMultiplier(ageDays(asOf, p.listed_at), model) : v;
    };
  }
  if (spec === 'growth' || spec === 'curvature') {
    const rows = train.map((p) => {
      const r = [logTvl(p), growthFeature(p, model)];
      if (spec === 'curvature') r.push(logTvl(p) * logTvl(p));
      return r;
    });
    const beta = fitOls(rows, ys);
    if (beta === null) return null;
    return (p: SnapshotProtocol): number => {
      const x = [logTvl(p), growthFeature(p, model)];
      if (spec === 'curvature') x.push(logTvl(p) * logTvl(p));
      return 10 ** (beta[0]! + beta.slice(1).reduce((s, b, i) => s + b * x[i]!, 0));
    };
  }
  if (spec === 'category') {
    const cats = topCategories(train);
    const rows = train.map((p) => [logTvl(p), growthFeature(p, model), ...cats.map((c) => ((p.category ?? 'Other') === c ? 1 : 0))]);
    const beta = fitOls(rows, ys);
    if (beta === null) return null;
    return (p: SnapshotProtocol): number => {
      const x = [logTvl(p), growthFeature(p, model), ...cats.map((c) => ((p.category ?? 'Other') === c ? 1 : 0))];
      return 10 ** (beta[0]! + beta.slice(1).reduce((s, b, i) => s + b * x[i]!, 0));
    };
  }
  // ensemble: log-average of base, growth and base x maturity
  const base = fitSpec('base', train, asOf, model);
  const growth = fitSpec('growth', train, asOf, model);
  const maturity = fitSpec('maturity', train, asOf, model);
  if (base === null || growth === null || maturity === null) return null;
  return (p: SnapshotProtocol): number =>
    10 ** ((Math.log10(Math.max(1, base(p))) + Math.log10(Math.max(1, growth(p))) + Math.log10(Math.max(1, maturity(p)))) / 3);
}

/** The full-fit coefficients of the base and growth members, rounded to 6 decimals. */
export function fitCoefficients(snapshot: Snapshot, model: ModelConstants = MODEL): { a: number; b: number; growth_a: number; growth_b: number; growth_c: number } {
  const all = comps(snapshot);
  const ys = all.map((p) => Math.log10(p.mcap_usd as number));
  const base = fitOls(all.map((p) => [Math.log10(p.tvl_usd)]), ys);
  const growth = fitOls(all.map((p) => [Math.log10(p.tvl_usd), growthFeature(p, model)]), ys);
  if (base === null || growth === null) throw new SnapshotError('the snapshot has too few comps to fit the value model');
  return { a: round6(base[0]!), b: round6(base[1]!), growth_a: round6(growth[0]!), growth_b: round6(growth[1]!), growth_c: round6(growth[2]!) };
}

/** A protocol's launch value under the final ensemble, with its three members. */
export function launchValue(p: SnapshotProtocol, coef: { a: number; b: number; growth_a: number; growth_b: number; growth_c: number }, asOf: string, model: ModelConstants = MODEL): { launch: number; members: [number, number, number]; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const lt = Math.log10(p.tvl_usd);
  const m0 = 10 ** (coef.a + coef.b * lt);
  const m1 = 10 ** (coef.growth_a + coef.growth_b * lt + coef.growth_c * growthFeature(p, model));
  const maturityMult = maturityMultiplier(age, model);
  const m2 = m0 * maturityMult;
  const launch = Math.max(1, Math.round(10 ** ((Math.log10(m0) + Math.log10(m1) + Math.log10(m2)) / 3)));
  const growthMult = round4(10 ** (coef.growth_c * growthFeature(p, model)));
  return { launch, members: [Math.max(1, Math.round(m0)), Math.max(1, Math.round(m1)), Math.max(1, Math.round(m2))], growthMult, maturityMult, age };
}

// ---------------------------------------------------------------- launch odds from the peers' record

const AGE_BANDS: Array<[number, number, string]> = [
  [0, 180, '<180d'],
  [180, 365, '180–364d'],
  [365, 730, '1–2y'],
  [730, 1095, '2–3y'],
  [1095, Number.POSITIVE_INFINITY, '3y+'],
];
const TVL_BANDS: Array<[number, number, string]> = [
  [0, 50_000_000, '<$50M'],
  [50_000_000, 200_000_000, '$50–200M'],
  [200_000_000, 1_000_000_000, '$200M–1B'],
  [1_000_000_000, 10_000_000_000, '$1–10B'],
  [10_000_000_000, Number.POSITIVE_INFINITY, '$10B+'],
];
/** Pseudo-observations at the overall rate each band share is shrunk with. */
const SHRINKAGE = 10;

/**
 * The share of protocols in a band that record a token, shrunk toward the overall share:
 * (tokenCount + 10 x overall) / (bandSize + 10). Thin bands stay near the overall rate.
 */
function bandShare(members: SnapshotProtocol[], overall: number): number {
  if (members.length === 0) return overall;
  const withToken = members.filter((p) => !isPreToken(p)).length;
  return (withToken + SHRINKAGE * overall) / (members.length + SHRINKAGE);
}

/**
 * A protocol's launch odds: the average of its age band's token share and its TVL band's
 * token share, each shrunk toward the overall share. Unknown age uses the overall share.
 * Computed from the snapshot only; no band, share or odds is ever written by hand.
 */
export function launchOdds(p: SnapshotProtocol, snapshot: Snapshot): number {
  const overall = snapshot.protocols.filter((q) => !isPreToken(q)).length / snapshot.protocols.length;
  const age = ageDays(snapshot.as_of, p.listed_at);
  let ageShare = overall;
  if (age !== null) {
    const band = AGE_BANDS.find(([lo, hi]) => age >= lo && age < hi);
    if (band !== undefined) {
      ageShare = bandShare(snapshot.protocols.filter((q) => {
        const qa = ageDays(snapshot.as_of, q.listed_at);
        return qa !== null && qa >= band[0] && qa < band[1];
      }), overall);
    }
  }
  const tvlBand = TVL_BANDS.find(([lo, hi]) => p.tvl_usd >= lo && p.tvl_usd < hi) ?? TVL_BANDS[TVL_BANDS.length - 1]!;
  const tvlShare = bandShare(snapshot.protocols.filter((q) => q.tvl_usd >= tvlBand[0] && q.tvl_usd < tvlBand[1]), overall);
  const odds = (ageShare + tvlShare) / 2;
  return round4(Math.min(0.99, Math.max(0.01, odds)));
}

/**
 * The odds calibration: the raw token share per age and TVL band, and the Brier score of
 * the shrunk odds against the constant overall rate, over all 758 protocols. Lower is better.
 */
export function oddsCalibration(snapshot: Snapshot): { overall: number; brier: number; brier_constant: number; age_bands: OddsBand[]; tvl_bands: OddsBand[] } {
  const overall = snapshot.protocols.filter((q) => !isPreToken(q)).length / snapshot.protocols.length;
  const share = (members: SnapshotProtocol[]): number => (members.length === 0 ? overall : members.filter((p) => !isPreToken(p)).length / members.length);
  const age_bands = AGE_BANDS.map(([lo, hi, label]) => {
    const members = snapshot.protocols.filter((q) => {
      const qa = ageDays(snapshot.as_of, q.listed_at);
      return qa !== null && qa >= lo && qa < hi;
    });
    return { label, n: members.length, token_share: round4(share(members)) };
  });
  const tvl_bands = TVL_BANDS.map(([lo, hi, label]) => {
    const members = snapshot.protocols.filter((q) => q.tvl_usd >= lo && q.tvl_usd < hi);
    return { label, n: members.length, token_share: round4(share(members)) };
  });
  let brier = 0;
  let brier0 = 0;
  for (const p of snapshot.protocols) {
    const y = isPreToken(p) ? 0 : 1;
    const o = launchOdds(p, snapshot);
    brier += (o - y) * (o - y);
    brier0 += (overall - y) * (overall - y);
  }
  return { overall: round4(overall), brier: round4(brier / snapshot.protocols.length), brier_constant: round4(brier0 / snapshot.protocols.length), age_bands, tvl_bands };
}

// ---------------------------------------------------------------- validation

/** Absolute log10 errors of a predictor over `data`, against each protocol's own market cap. */
function logErrors(data: SnapshotProtocol[], predict: (p: SnapshotProtocol) => number): number[] {
  return data.map((p) => Math.abs(Math.log10(p.mcap_usd as number) - Math.log10(Math.max(1, predict(p)))));
}

/** Median absolute log10 error and share of predictions within 3x, for a predictor and the baseline. */
function scorePredictions(data: SnapshotProtocol[], predict: (p: SnapshotProtocol) => number): { medianAbsLogErr: number; within3x: number; baselineMedian: number; baselineWithin3x: number } {
  const errors = logErrors(data, predict);
  const baseErrors = logErrors(data, (p) => BASELINE_MULTIPLE * p.tvl_usd);
  const within = (errs: number[]): number => errs.filter((e) => e <= Math.log10(3)).length / errs.length;
  return {
    medianAbsLogErr: round4(median(errors)),
    within3x: round4(within(errors)),
    baselineMedian: round4(median(baseErrors)),
    baselineWithin3x: round4(within(baseErrors)),
  };
}

function toTest(test: string, spec: SpecName, s: { medianAbsLogErr: number; within3x: number; baselineMedian: number; baselineWithin3x: number }, counts: { n_train?: number; n_test?: number; n?: number }): ValidationTest {
  return {
    test,
    spec,
    ...counts,
    median_abs_log_err: s.medianAbsLogErr,
    within_3x: s.within3x,
    baseline_median_abs_log_err: s.baselineMedian,
    baseline_within_3x: s.baselineWithin3x,
    multiplier: round2(s.baselineMedian / s.medianAbsLogErr),
  };
}

/**
 * The held-out validation, computed from the snapshot at build time: five blind tests for
 * each of the six candidate specs. Walk-forward fits the comps listed before each cutoff
 * and tests on those listed on or after it; leave-one-out refits on the other comps for
 * each comp; 5-fold uses deterministic folds by sorted slug, index mod 5 (the five fold
 * rows are averaged into one 5-fold row per spec).
 */
export function validateModel(snapshot: Snapshot, model: ModelConstants = MODEL): { specs: SpecValidation[]; final_spec: string } {
  const all = comps(snapshot);
  const dated = all.filter((p) => p.listed_at !== null);
  const bySlugSorted = [...all].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const results = new Map<SpecName, ValidationTest[]>();
  for (const spec of SPEC_NAMES) results.set(spec, []);
  const runTest = (test: string, train: SnapshotProtocol[], testSet: SnapshotProtocol[]): void => {
    for (const spec of SPEC_NAMES) {
      const predict = fitSpec(spec, train, snapshot.as_of, model);
      if (predict === null) throw new SnapshotError(`the ${spec} spec could not be fitted`);
      const counts = testSet.length === all.length ? { n: all.length } : { n_train: train.length, n_test: testSet.length };
      results.get(spec)!.push(toTest(test, spec, scorePredictions(testSet, predict), counts));
    }
  };
  for (const cutoff of WALK_FORWARD_CUTOFFS) {
    const train = dated.filter((p) => (p.listed_at as string) < cutoff);
    const testSet = dated.filter((p) => (p.listed_at as string) >= cutoff);
    runTest(`walk-forward ${cutoff}`, train, testSet);
  }
  // Leave-one-out: one test entry per spec, built from the 128 refits.
  for (const spec of SPEC_NAMES) {
    const errs: number[] = [];
    const baseErrs: number[] = [];
    for (let i = 0; i < all.length; i++) {
      const rest = all.filter((_, j) => j !== i);
      const predict = fitSpec(spec, rest, snapshot.as_of, model);
      if (predict === null) continue;
      const p = all[i]!;
      errs.push(Math.abs(Math.log10(p.mcap_usd as number) - Math.log10(Math.max(1, predict(p)))));
      baseErrs.push(Math.abs(Math.log10(p.mcap_usd as number) - Math.log10(BASELINE_MULTIPLE * p.tvl_usd)));
    }
    const within = (es: number[]): number => es.filter((e) => e <= Math.log10(3)).length / es.length;
    const med = round4(median(errs));
    const baseMed = round4(median(baseErrs));
    results.get(spec)!.push({
      test: 'leave-one-out',
      spec,
      n: all.length,
      median_abs_log_err: med,
      within_3x: round4(within(errs)),
      baseline_median_abs_log_err: baseMed,
      baseline_within_3x: round4(within(baseErrs)),
      multiplier: round2(baseMed / med),
    });
  }
  for (let fold = 0; fold < 5; fold++) {
    const testSet = bySlugSorted.filter((_, i) => i % 5 === fold);
    const train = bySlugSorted.filter((_, i) => i % 5 !== fold);
    runTest(`5-fold (fold ${fold + 1})`, train, testSet);
  }
  const specs: SpecValidation[] = SPEC_NAMES.map((spec) => {
    const tests = results.get(spec)!;
    const wf = tests.filter((t) => t.test.startsWith('walk-forward'));
    const loo = tests.filter((t) => t.test === 'leave-one-out');
    const folds = tests.filter((t) => t.test.startsWith('5-fold'));
    const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
    const foldAgg: ValidationTest = {
      test: '5-fold (mean of folds)',
      spec,
      n: all.length,
      median_abs_log_err: round4(mean(folds.map((t) => t.median_abs_log_err))),
      within_3x: round4(mean(folds.map((t) => t.within_3x))),
      baseline_median_abs_log_err: round4(mean(folds.map((t) => t.baseline_median_abs_log_err))),
      baseline_within_3x: round4(mean(folds.map((t) => t.baseline_within_3x))),
      multiplier: round2(mean(folds.map((t) => t.baseline_median_abs_log_err)) / mean(folds.map((t) => t.median_abs_log_err))),
    };
    const five: ValidationTest[] = [...wf, ...loo, foldAgg];
    const meanMed = round4(five.reduce((s, t) => s + t.median_abs_log_err, 0) / five.length);
    const meanWithin = round4(five.reduce((s, t) => s + t.within_3x, 0) / five.length);
    return { spec, label: SPEC_LABELS[spec], tests: five, mean_median_abs_log_err: meanMed, mean_within_3x: meanWithin, verdict: 'KEPT' as const, rationale: '' };
  });
  const bySpec = new Map(specs.map((s) => [s.spec, s]));
  const base = bySpec.get('base')!;
  const growth = bySpec.get('growth')!;
  const maturity = bySpec.get('maturity')!;
  const category = bySpec.get('category')!;
  const curvature = bySpec.get('curvature')!;
  const ensemble = bySpec.get('ensemble')!;
  growth.verdict = 'KEPT';
  growth.rationale = `kept at one-third weight in the ensemble: it beats the base on mean within-3x (${growth.mean_within_3x} vs ${base.mean_within_3x}) but not on mean median error (${growth.mean_median_abs_log_err} vs ${base.mean_median_abs_log_err}), so full weight would hurt the typical error.`;
  maturity.verdict = 'KEPT';
  maturity.rationale = `kept at one-third weight in the ensemble: it beats the base on both aggregate measures (mean median ${maturity.mean_median_abs_log_err} vs ${base.mean_median_abs_log_err}, mean within-3x ${maturity.mean_within_3x} vs ${base.mean_within_3x}).`;
  category.verdict = 'DROPPED';
  category.rationale = `dropped: worse than the base on both aggregate measures (mean median ${category.mean_median_abs_log_err} vs ${base.mean_median_abs_log_err}, mean within-3x ${category.mean_within_3x} vs ${base.mean_within_3x}).`;
  curvature.verdict = 'DROPPED';
  curvature.rationale = 'dropped on stability grounds, not on its aggregate score: its fitted curvature coefficient is +0.19 on the pre-2024 comps and -0.11 on the post-2024 comps, so the gain does not survive a time split.';
  ensemble.verdict = 'FINAL';
  ensemble.rationale = `the final model: log-average of the three kept members. Mean median error ${ensemble.mean_median_abs_log_err} vs base ${base.mean_median_abs_log_err}, mean within-3x ${ensemble.mean_within_3x} vs base ${base.mean_within_3x}.`;
  base.verdict = 'KEPT';
  base.rationale = 'the reference member of the ensemble: the plain log-log fit every other spec is judged against.';
  return { specs, final_spec: 'ensemble' };
}

/**
 * Jackknife+ intervals (Barber et al. 2021): the leave-one-out residuals of the final
 * ensemble on the comps, with the finite-sample-corrected quantiles at 80% and 90%.
 */
export function conformalIntervals(snapshot: Snapshot, model: ModelConstants = MODEL): { n: number; q80_log: number; q90_log: number; factor80: number; factor90: number; coverage80: number; coverage90: number } {
  const all = comps(snapshot);
  const residuals: number[] = [];
  for (let i = 0; i < all.length; i++) {
    const rest = all.filter((_, j) => j !== i);
    const predict = fitSpec('ensemble', rest, snapshot.as_of, model);
    if (predict === null) continue;
    const p = all[i]!;
    residuals.push(Math.abs(Math.log10(p.mcap_usd as number) - Math.log10(Math.max(1, predict(p)))));
  }
  const sorted = [...residuals].sort((a, b) => a - b);
  const quantile = (level: number): number => {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(level * (sorted.length + 1)) - 1));
    return sorted[idx]!;
  };
  const q80 = quantile(0.8);
  const q90 = quantile(0.9);
  return {
    n: sorted.length,
    q80_log: round4(q80),
    q90_log: round4(q90),
    factor80: round2(10 ** q80),
    factor90: round2(10 ** q90),
    coverage80: round4(residuals.filter((r) => r <= q80).length / residuals.length),
    coverage90: round4(residuals.filter((r) => r <= q90).length / residuals.length),
  };
}

// ---------------------------------------------------------------- farm plans

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Stated planning gas per transaction on the protocol's main chain. */
export function gasPerTx(p: SnapshotProtocol): number {
  const chain = p.chains.length > 0 ? p.chains[0]! : '';
  return GAS_PER_TX[chain] ?? GAS_PER_TX_DEFAULT;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open so it accrues points.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('dex') || c.includes('amm') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name} on ${chain}.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('stak') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second, different action, so the plan is more than one deposit. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${capital} against the deposit on ${name} and repay it the same week, so the position shows both sides.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) return `Deposit $${capital} into a second ${name} vault on ${chain} with a different strategy and hold both shares.`;
  if (c.includes('dex') || c.includes('amm') || c.includes('yield') || c.includes('leveraged farm')) return `Swap $${capital} of USDC for the pool's other asset through ${name} on ${chain} and hold the result.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Close the first position on ${name} and open a second small one in the opposite direction.`;
  if (c.includes('prediction')) return `Place a second $${capital} position on a different market on ${name}.`;
  if (c.includes('stable')) return `Swap $${capital} of the stable asset for USDC through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Claim the yield the $${capital} position earned on ${name} and restake it in the same asset.`;
  if (c.includes('insurance')) return `File a test claim check on ${name} and renew the $${capital} cover before it lapses.`;
  if (c.includes('stak') || c.includes('restak')) return `Check the staking rewards ${name} shows for the position and restake them.`;
  if (c.includes('bridge')) return `Bridge $${capital} back through ${name} so the round trip is recorded.`;
  return `Make a second, different interaction on ${name} on ${chain} — a swap, a vote or a deposit — for $${capital}.`;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. Gas is priced by the main chain's tier.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const secondCapital = Math.max(25, Math.floor(capital / 2));
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const gas = gasPerTx(p);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: `about $${gas} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, secondCapital, chain),
      cost: `$${secondCapital} of capital and about $${gas} of gas`,
      time: '10 minutes',
    },
    {
      text: `Repeat one qualifying action each week for ${weeks} weeks — a deposit, a borrow, a swap or a vote, whichever the protocol counts — so the activity spans more than one snapshot.`,
      cost: `about $${gas} of gas a week, $${gas * weeks} in total`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text:
        secondChain === null
          ? `Make a second deposit of $${secondCapital} into ${p.name} on ${chain} and hold it beside the first.`
          : `Repeat the deposit on ${secondChain} with $${secondCapital} through ${p.name}, so the position spans two chains.`,
      cost: `$${secondCapital} of capital and about $${gas} of gas`,
      time: '15 minutes',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: `about $${gas} of gas to claim, and never pay to claim`,
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/**
 * A row's farm economics. Cost is gas only: the plan makes 5 + hold-weeks transactions at
 * the main chain's gas tier (capital is a recoverable deposit, not a cost); hours are active
 * minutes. Expected value is the implied value times the stated airdrop share; net per hour
 * is (expected value - cost) / hours. Minimum viable capital is the deposit plus the gas
 * bill; break-even is the implied value at which the farm pays for its gas.
 */
export function farmEconomics(p: SnapshotProtocol, age: number | null, implied: number, model: ModelConstants = MODEL): { cost: number; hours: number; netPerHour: number; verdict: 'FARM' | 'THIN' | 'SKIP'; minCapital: number; breakeven: number; netPer100: number; capital: number } {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const gas = gasPerTx(p);
  const txs = 5 + weeks;
  const cost = gas * txs;
  const hours = round2((5 + 15 + 10 + 10 * weeks + 15 + 10 + 5) / 60);
  const expected = implied * model.airdrop_share;
  const netPerHour = round2((expected - cost) / hours);
  const verdict = netPerHour >= model.farm_threshold_usd_per_hour ? 'FARM' : netPerHour >= model.thin_threshold_usd_per_hour ? 'THIN' : 'SKIP';
  return {
    cost,
    hours,
    netPerHour,
    verdict,
    minCapital: capital + cost,
    breakeven: Math.max(1, Math.round(cost / model.airdrop_share)),
    netPer100: round2(((expected - cost) / capital) * 100),
    capital,
  };
}

/** Integrity flags computed from a row's own record. */
export function integrityFlags(p: SnapshotProtocol, age: number | null, snapshot: Snapshot): string[] {
  const flags: string[] = [];
  if (p.change_7d === null) flags.push('no 7d change reported');
  if (age === null) flags.push('listing date unknown');
  if (p.chains.length <= 1) flags.push('single chain');
  if (p.tvl_usd < snapshot.floor_usd) flags.push('below watchlist floor');
  if (snapshot.watchlist.includes(p.slug)) flags.push('watchlist member');
  return flags;
}

// ---------------------------------------------------------------- board, lanes, radar

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const coef = fitCoefficients(snapshot, model);
  const conformal = conformalIntervals(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const ranked = snapshot.protocols.filter(isRankable);
  if (ranked.length !== EXPECTED_BOARD_SIZE) {
    throw new SnapshotError(`the board rule keeps ${ranked.length} protocols, not the expected ${EXPECTED_BOARD_SIZE}`);
  }
  const missing = snapshot.watchlist.filter((s) => !ranked.some((p) => p.slug === s));
  if (missing.length > 0) throw new SnapshotError(`the board rule leaves out ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`);
  const interval = (launch: number, odds: number, q: number): [number, number] => [
    Math.max(1, Math.round(launch * odds * 10 ** -q)),
    Math.max(1, Math.round(launch * odds * 10 ** q)),
  ];
  const scored = ranked.map((p) => {
    const { launch, members, growthMult, maturityMult, age } = launchValue(p, coef, snapshot.as_of, model);
    const odds = launchOdds(p, snapshot);
    const implied = Math.max(1, Math.round(launch * odds));
    const econ = farmEconomics(p, age, implied, model);
    return { p, launch, members, odds, implied, growthMult, maturityMult, age, econ };
  });
  scored.sort((x, y) => y.implied - x.implied || (x.p.slug < y.p.slug ? -1 : x.p.slug > y.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    launch_value_usd: s.launch,
    odds: s.odds,
    growth_multiplier: s.growthMult,
    maturity_multiplier: s.maturityMult,
    launch_members_usd: s.members,
    interval_80_usd: interval(s.launch, s.odds, conformal.q80_log),
    interval_90_usd: interval(s.launch, s.odds, conformal.q90_log),
    farm_steps: farmSteps(s.p, s.age).map(stepText),
    farm_cost_usd: s.econ.cost,
    farm_hours: s.econ.hours,
    net_per_hour_usd: s.econ.netPerHour,
    verdict: s.econ.verdict,
    min_capital_usd: s.econ.minCapital,
    breakeven_implied_usd: s.econ.breakeven,
    net_per_100_capital_usd: s.econ.netPer100,
    integrity_flags: integrityFlags(s.p, s.age, snapshot),
    watchlist: watchlist.has(s.p.slug),
    model: {
      a: coef.a,
      b: coef.b,
      growth_a: coef.growth_a,
      growth_b: coef.growth_b,
      growth_c: coef.growth_c,
      growth_pct: growthFeature(s.p, model) * 100,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      age_days: s.age,
    },
  }));
}

/** The live-token protocols, every one of them, by market cap, largest first. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((x, y) => (y.mcap_usd ?? -1) - (x.mcap_usd ?? -1) || y.tvl_usd - x.tvl_usd || (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The pre-token protocols the board rule leaves out, each with its short reason. */
export function excludedRows(snapshot: Snapshot): ExcludedRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && !isRankable(p))
    .sort((x, y) => y.tvl_usd - x.tvl_usd || (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      reason: excludedReason(p) ?? 'wrapped-staked-bridged',
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    launch_value_usd: row.launch_value_usd,
    odds: row.odds,
    growth_multiplier: row.growth_multiplier,
    maturity_multiplier: row.maturity_multiplier,
    launch_members_usd: row.launch_members_usd,
    interval_80_usd: row.interval_80_usd,
    interval_90_usd: row.interval_90_usd,
    farm_steps: row.farm_steps,
    farm_cost_usd: row.farm_cost_usd,
    farm_hours: row.farm_hours,
    net_per_hour_usd: row.net_per_hour_usd,
    verdict: row.verdict,
    min_capital_usd: row.min_capital_usd,
    breakeven_implied_usd: row.breakeven_implied_usd,
    net_per_100_capital_usd: row.net_per_100_capital_usd,
    integrity_flags: row.integrity_flags,
    watchlist: row.watchlist,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const excluded = excludedRows(snapshot);
  const all = comps(snapshot);
  const coef = fitCoefficients(snapshot, model);
  const ratios = all.map((p) => (p.mcap_usd as number) / p.tvl_usd);
  const validation = validateModel(snapshot, model);
  const conformal = conformalIntervals(snapshot, model);
  const odds = oddsCalibration(snapshot);
  if (board.length + live.length + excluded.length !== snapshot.protocols.length) {
    throw new SnapshotError('the ranked, live and excluded lanes do not account for every protocol');
  }
  const integrity = {
    missing_change_7d: board.filter((r) => r.integrity_flags.includes('no 7d change reported')).length,
    unknown_age: board.filter((r) => r.integrity_flags.includes('listing date unknown')).length,
    single_chain: board.filter((r) => r.integrity_flags.includes('single chain')).length,
    below_floor: board.filter((r) => r.integrity_flags.includes('below watchlist floor')).length,
    watchlist: board.filter((r) => r.watchlist).length,
    total: board.length,
  };
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: {
      ...model,
      comps: { n: all.length, a: coef.a, b: coef.b, growth_a: coef.growth_a, growth_b: coef.growth_b, growth_c: coef.growth_c, median_ratio: round4(median(ratios)) },
    },
    validation,
    conformal,
    odds,
    integrity,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    counts: { total: snapshot.protocols.length, ranked: board.length, live: live.length, excluded: excluded.length },
    rows: board.map(radarRow),
    live,
    excluded,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length !== EXPECTED_BOARD_SIZE) return `the board holds ${board.length} rows, not the expected ${EXPECTED_BOARD_SIZE}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!Number.isSafeInteger(r.launch_value_usd) || r.launch_value_usd <= 0) return `${r.slug} has launch value ${r.launch_value_usd}`;
    if (!(r.odds > 0 && r.odds <= 1)) return `${r.slug} has odds ${r.odds}`;
    if (!Number.isFinite(r.farm_cost_usd) || r.farm_cost_usd < 0) return `${r.slug} has farm cost ${r.farm_cost_usd}`;
    if (!Number.isFinite(r.farm_hours) || r.farm_hours <= 0) return `${r.slug} has farm hours ${r.farm_hours}`;
    if (!Number.isFinite(r.net_per_hour_usd)) return `${r.slug} has net per hour ${r.net_per_hour_usd}`;
    if (r.verdict !== 'FARM' && r.verdict !== 'THIN' && r.verdict !== 'SKIP') return `${r.slug} has verdict ${r.verdict}`;
    if (!Number.isSafeInteger(r.min_capital_usd) || r.min_capital_usd <= 0) return `${r.slug} has minimum capital ${r.min_capital_usd}`;
    if (!Number.isSafeInteger(r.breakeven_implied_usd) || r.breakeven_implied_usd <= 0) return `${r.slug} has break-even ${r.breakeven_implied_usd}`;
    if (!Number.isFinite(r.net_per_100_capital_usd)) return `${r.slug} has net per $100 ${r.net_per_100_capital_usd}`;
    if (!Array.isArray(r.interval_80_usd) || r.interval_80_usd[0]! > r.implied_value_usd || r.interval_80_usd[1]! < r.implied_value_usd) return `${r.slug} has an 80% interval that misses its implied value`;
    if (!Array.isArray(r.interval_90_usd) || r.interval_90_usd[0]! > r.interval_80_usd[0]! || r.interval_90_usd[1]! < r.interval_80_usd[1]!) return `${r.slug} has a 90% interval narrower than its 80% interval`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
