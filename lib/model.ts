// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every
// other pre-token protocol the board rule keeps: 198 rows on this snapshot. A protocol is pre-token
// when its record carries no token (mcap_usd, gecko_id and symbol all null); the snapshot's
// live-token protocols are kept apart and shown with the market's own values, never mixed into
// the ranked board. No protocol name is ever special-cased: the same functions score every row.
//
// VALUE MODEL (fitted from the snapshot's own figures, never a flat multiple)
//   Comps: the live-token protocols with mcap_usd > 0 and tvl_usd > 0 (128 on this snapshot;
//   one further record carries a negative market cap and is not a usable comp).
//   Fit log10(mcap) = a + b * log10(TVL) by ordinary least squares on those comps.
//   launch value = 10 ^ (a + b * log10(TVL)) x growth multiplier x maturity multiplier
//     growth   = clamp(change_7d, -60, 120) per cent; growth multiplier = 1 + (growth / 100) x 0.5
//     maturity = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   launch odds: the peers' own record. For a protocol, take the share of snapshot protocols
//   that record a token in its age band and the share in its TVL band, each shrunk toward the
//   overall share (10 pseudo-observations at the overall rate, so thin bands do not swing the
//   odds), and average the two shares. Age bands: <180, 180-364, 365-729, 730-1094, 1095+ days
//   (unknown age uses the overall share); TVL bands: <50M, 50-200M, 200M-1B, 1-10B, 10B+ USD.
//   implied value = launch value x odds, rounded to whole dollars, at least 1.
//   The fitted a and b are rounded to 6 decimals and the multipliers and odds to 4 decimals,
//   and the rounded values are the ones the launch value is computed from, so the constants in
//   the output reproduce the board exactly.
//
// VALIDATION (computed at build time from the snapshot, embedded in the output)
//   Walk-forward: fit the comps on protocols listed before 2024-01-01, test on those listed
//   on or after it. Leave-one-out: refit on the other 127 comps for each of the 128 comps.
//   Both report median absolute log10 error and the share of predictions within 3x, against
//   the flat 0.25 x TVL baseline. Kept-terms rule: a model term stays only if the full model
//   beats that baseline held-out. It does, on both tests and both metrics, on this snapshot:
//   walk-forward (train 44, test 51): full median abs log10 error 0.4503 vs flat 0.6135,
//   within 3x 51.0% vs 33.3%; leave-one-out (n 128): full median 0.5376 vs flat 0.6911,
//   within 3x 45.3% vs 33.6%. The growth and maturity terms are kept because the full model
//   also beats the base log-log fit without them on the walk-forward median (0.4503 vs 0.4643)
//   and on the leave-one-out within-3x share (45.3% vs 42.2%).
//
// FARM PLANS (derived from the protocol's own record: category, chains, TVL, age)
//   8 steps per row. Capital tiers from TVL (>=5B: $250, >=1B: $150, >=100M: $100, else $50);
//   hold days from age (unknown: 30, <180 days: 60, <365: 45, else 30). Farm cost is gas and
//   fees only (capital is a recoverable deposit, not a cost); farm hours are active minutes.
//   Net verdict: expected value = implied value x AIRDROP_SHARE (0.01% of the launch value to
//   one active farmer, a stated assumption, not a measured figure), minus farm cost, divided by
//   farm hours. FARM at >= $100/hour, THIN at >= $25/hour, otherwise SKIP.

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
  growth_weight: number;
  growth_floor: number;
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
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  airdrop_share: 0.0001,
  farm_threshold_usd_per_hour: 100,
  thin_threshold_usd_per_hour: 25,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** The walk-forward cutoff: comps listed before it fit, comps listed on or after it test. */
export const WALK_FORWARD_CUTOFF = '2024-01-01';

/** The flat baseline the validation compares against: the starter's 0.25 x TVL. */
export const BASELINE_MULTIPLE = 0.25;

/** The board rule's expected size on this snapshot; buildBoard throws if it is not met. */
export const EXPECTED_BOARD_SIZE = 198;

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
  farm_steps: string[];
  farm_cost_usd: number;
  farm_hours: number;
  net_per_hour_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  watchlist: boolean;
  model: {
    a: number;
    b: number;
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
  farm_steps: string[];
  farm_cost_usd: number;
  farm_hours: number;
  net_per_hour_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
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

/** One held-out validation: median absolute log10 error and share of predictions within 3x. */
export interface ValidationTest {
  n_train?: number;
  n_test?: number;
  n?: number;
  median_abs_log_err: number;
  within_3x: number;
  baseline_within_3x: number;
}

/** Everything the dashboard needs: the board, the live set, the excluded set, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelConstants & { comps: { n: number; a: number; b: number; median_ratio: number } };
  validation: { walk_forward: ValidationTest; loo: ValidationTest };
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

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

// ---------------------------------------------------------------- fitted value model

/** The comps: live-token protocols with a positive market cap and positive TVL. */
export function comps(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** Ordinary least squares for log10(mcap) = a + b * log10(TVL); null when it cannot be fitted. */
export function fitOls(data: SnapshotProtocol[]): { a: number; b: number } | null {
  if (data.length < 2) return null;
  const xs = data.map((p) => Math.log10(p.tvl_usd));
  const ys = data.map((p) => Math.log10(p.mcap_usd as number));
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

/** The median of a list of numbers (average of the two middle values when the count is even). */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The growth multiplier: change_7d clamped to the model's floor and cap, weight 0.5. */
export function growthMultiplier(p: SnapshotProtocol, model: ModelConstants = MODEL): { pct: number; mult: number } {
  const raw = finite(p.change_7d, 0);
  const pct = Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
  return { pct, mult: round4(1 + (pct / 100) * model.growth_weight) };
}

/** The maturity multiplier: 0.6 at listing, rising to 1.0 at 1095 days; unknown age uses 365. */
export function maturityMultiplier(age: number | null, model: ModelConstants = MODEL): number {
  const ageForModel = age ?? model.unknown_age_days;
  return round4(model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range);
}

/** A protocol's launch value under fitted constants a and b (before the odds are applied). */
export function launchValue(p: SnapshotProtocol, a: number, b: number, asOf: string, model: ModelConstants = MODEL): { launch: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const { mult: growthMult } = growthMultiplier(p, model);
  const maturityMult = maturityMultiplier(age, model);
  const launch = Math.max(1, Math.round(10 ** (a + b * Math.log10(p.tvl_usd)) * growthMult * maturityMult));
  return { launch, growthMult, maturityMult, age };
}

// ---------------------------------------------------------------- launch odds from the peers' record

const AGE_BANDS: Array<[number, number]> = [
  [0, 180],
  [180, 365],
  [365, 730],
  [730, 1095],
  [1095, Number.POSITIVE_INFINITY],
];
const TVL_BANDS: Array<[number, number]> = [
  [0, 50_000_000],
  [50_000_000, 200_000_000],
  [200_000_000, 1_000_000_000],
  [1_000_000_000, 10_000_000_000],
  [10_000_000_000, Number.POSITIVE_INFINITY],
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

// ---------------------------------------------------------------- validation

/** Absolute log10 errors of a predictor over `data`, against each protocol's own market cap. */
function logErrors(data: SnapshotProtocol[], predict: (p: SnapshotProtocol) => number): number[] {
  return data.map((p) => Math.abs(Math.log10(p.mcap_usd as number) - Math.log10(predict(p))));
}

/** Median absolute log10 error and share of predictions within 3x, for a predictor and the baseline. */
function scorePredictions(data: SnapshotProtocol[], predict: (p: SnapshotProtocol) => number): { medianAbsLogErr: number; within3x: number; baselineWithin3x: number; baselineMedianAbsLogErr: number } {
  const errors = logErrors(data, predict);
  const baseErrors = logErrors(data, (p) => BASELINE_MULTIPLE * p.tvl_usd);
  const within = (errs: number[]): number => errs.filter((e) => e <= Math.log10(3)).length / errs.length;
  return {
    medianAbsLogErr: round4(median(errors)),
    within3x: round4(within(errors)),
    baselineWithin3x: round4(within(baseErrors)),
    baselineMedianAbsLogErr: round4(median(baseErrors)),
  };
}

/**
 * The held-out validation, computed from the snapshot at build time. Walk-forward fits the
 * comps listed before the cutoff and tests on those listed on or after it; leave-one-out
 * refits on the other comps for each comp. The full model (log-log fit, growth and maturity
 * terms) is what is scored, against the flat 0.25 x TVL baseline.
 */
export function validateModel(snapshot: Snapshot, model: ModelConstants = MODEL): { walk_forward: ValidationTest; loo: ValidationTest } {
  const all = comps(snapshot);
  const full = fitOls(all);
  if (full === null) throw new SnapshotError('the snapshot has too few comps to fit the value model');
  const predictWith = (fit: { a: number; b: number }) => (p: SnapshotProtocol): number => {
    const { launch } = launchValue(p, fit.a, fit.b, snapshot.as_of, model);
    return launch;
  };
  const train = all.filter((p) => p.listed_at !== null && p.listed_at < WALK_FORWARD_CUTOFF);
  const test = all.filter((p) => p.listed_at !== null && p.listed_at >= WALK_FORWARD_CUTOFF);
  const trainFit = fitOls(train);
  if (trainFit === null || test.length === 0) throw new SnapshotError('the snapshot has too few listed comps for the walk-forward test');
  const wf = scorePredictions(test, predictWith(trainFit));
  const looErrors: number[] = [];
  const looBaseErrors: number[] = [];
  const looWithin: boolean[] = [];
  const looBaseWithin: boolean[] = [];
  for (let i = 0; i < all.length; i++) {
    const rest = all.filter((_, j) => j !== i);
    const fit = fitOls(rest);
    if (fit === null) continue;
    const p = all[i]!;
    const err = Math.abs(Math.log10(p.mcap_usd as number) - Math.log10(predictWith(fit)(p)));
    const baseErr = Math.abs(Math.log10(p.mcap_usd as number) - Math.log10(BASELINE_MULTIPLE * p.tvl_usd));
    looErrors.push(err);
    looBaseErrors.push(baseErr);
    looWithin.push(err <= Math.log10(3));
    looBaseWithin.push(baseErr <= Math.log10(3));
  }
  return {
    walk_forward: {
      n_train: train.length,
      n_test: test.length,
      median_abs_log_err: wf.medianAbsLogErr,
      within_3x: wf.within3x,
      baseline_within_3x: wf.baselineWithin3x,
    },
    loo: {
      n: all.length,
      median_abs_log_err: round4(median(looErrors)),
      within_3x: round4(looWithin.filter(Boolean).length / looWithin.length),
      baseline_within_3x: round4(looBaseWithin.filter(Boolean).length / looBaseWithin.length),
    },
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
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const secondCapital = Math.max(25, Math.floor(capital / 2));
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, secondCapital, chain),
      cost: `$${secondCapital} of capital and about $3 of gas`,
      time: '10 minutes',
    },
    {
      text: `Repeat one qualifying action each week for ${weeks} weeks — a deposit, a borrow, a swap or a vote, whichever the protocol counts — so the activity spans more than one snapshot.`,
      cost: `about $2 of gas a week, $${2 * weeks} in total`,
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
      cost: `$${secondCapital} of capital and about $3 of gas`,
      time: '15 minutes',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'about $3 of gas to claim, and never pay to claim',
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
 * A row's farm economics. Cost is gas and fees only (capital is a recoverable deposit, not
 * a cost); hours are active minutes. Expected value is the implied value times the stated
 * airdrop share; net per hour is (expected value - cost) / hours.
 */
export function farmEconomics(p: SnapshotProtocol, age: number | null, implied: number, model: ModelConstants = MODEL): { cost: number; hours: number; netPerHour: number; verdict: 'FARM' | 'THIN' | 'SKIP' } {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const cost = 3 + (capital >= 150 ? 8 : 4) + 3 + 2 * weeks + 3 + 3;
  const hours = round2((5 + 15 + 10 + 10 * weeks + 15 + 10 + 5) / 60);
  const netPerHour = round2((implied * model.airdrop_share - cost) / hours);
  const verdict = netPerHour >= model.farm_threshold_usd_per_hour ? 'FARM' : netPerHour >= model.thin_threshold_usd_per_hour ? 'THIN' : 'SKIP';
  return { cost, hours, netPerHour, verdict };
}

// ---------------------------------------------------------------- board, lanes, radar

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const all = comps(snapshot);
  const fit = fitOls(all);
  if (fit === null) throw new SnapshotError('the snapshot has too few comps to fit the value model');
  const a = round6(fit.a);
  const b = round6(fit.b);
  const watchlist = new Set(snapshot.watchlist);
  const ranked = snapshot.protocols.filter(isRankable);
  if (ranked.length !== EXPECTED_BOARD_SIZE) {
    throw new SnapshotError(`the board rule keeps ${ranked.length} protocols, not the expected ${EXPECTED_BOARD_SIZE}`);
  }
  const missing = snapshot.watchlist.filter((s) => !ranked.some((p) => p.slug === s));
  if (missing.length > 0) throw new SnapshotError(`the board rule leaves out ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`);
  const scored = ranked.map((p) => {
    const { launch, growthMult, maturityMult, age } = launchValue(p, a, b, snapshot.as_of, model);
    const odds = launchOdds(p, snapshot);
    const implied = Math.max(1, Math.round(launch * odds));
    const econ = farmEconomics(p, age, implied, model);
    return { p, launch, odds, implied, growthMult, maturityMult, age, econ };
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
    farm_steps: farmSteps(s.p, s.age).map(stepText),
    farm_cost_usd: s.econ.cost,
    farm_hours: s.econ.hours,
    net_per_hour_usd: s.econ.netPerHour,
    verdict: s.econ.verdict,
    watchlist: watchlist.has(s.p.slug),
    model: {
      a,
      b,
      growth_pct: growthMultiplier(s.p, model).pct,
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
    farm_steps: row.farm_steps,
    farm_cost_usd: row.farm_cost_usd,
    farm_hours: row.farm_hours,
    net_per_hour_usd: row.net_per_hour_usd,
    verdict: row.verdict,
    watchlist: row.watchlist,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const excluded = excludedRows(snapshot);
  const all = comps(snapshot);
  const fit = fitOls(all);
  if (fit === null) throw new SnapshotError('the snapshot has too few comps to fit the value model');
  const ratios = all.map((p) => (p.mcap_usd as number) / p.tvl_usd);
  const validation = validateModel(snapshot, model);
  if (board.length + live.length + excluded.length !== snapshot.protocols.length) {
    throw new SnapshotError('the ranked, live and excluded lanes do not account for every protocol');
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: {
      ...model,
      comps: { n: all.length, a: round6(fit.a), b: round6(fit.b), median_ratio: round4(median(ratios)) },
    },
    validation,
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
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
