import type { PrimaryReason } from '../../shared/review-types.ts';

export interface ScoreInput {
  review_id?: string;
  asin?: string;
  ticker?: string;
  body: string;
  title?: string | null;
  star_rating?: number | null;
}

export interface ScoreResult {
  tone_score: number; // -2, -1, 0, 1, 2
  is_product_related: boolean;
  primary_reason: PrimaryReason;
  tags: string[];
  model_used: string;
}

const RUBRIC_PROMPT = `You are a Customer Review Tone and Fundamental Quality Evaluator. Analyze the product review and return a structured JSON assessment.
Rubric:
- tone_score: -2 (severe defect / premature breakdown / stealth downgrade / double clicking switch), -1 (minor flaw / slight dissatisfaction / cheaper feel), 0 (neutral / mixed / specs), +1 (good / satisfied), +2 (outstanding / durable / high praise).
- is_product_related: true (about product hardware/design/software) or false (solely about delivery/packaging/seller).
- primary_reason: exactly one of "defect", "quality_decline", "price", "ergonomics", "software", "praise", "other".
- tags: string array of 1-4 specific tags, e.g. ["switch_failure", "double_click", "build_quality"].

Respond ONLY with valid JSON in this exact shape:
{"tone_score": 0, "is_product_related": true, "primary_reason": "...", "tags": [...]}`;

/**
 * Local deterministic heuristic scoring engine.
 * Serves as an instant, zero-cost, high-reliability baseline and fallback.
 */
export function scoreWithLocalHeuristics(input: ScoreInput): ScoreResult {
  const fullText = `${input.title ? `${input.title}. ` : ''}${input.body}`.toLowerCase();
  const star = input.star_rating != null ? Math.round(input.star_rating) : null;

  // 1. Check if the review is exclusively about shipping / seller / packaging
  const shippingKeywords = [
    'shipping was late', 'late delivery', 'package damaged', 'box was crushed',
    'wrong item sent', 'seller refused', 'seller was rude', 'delivery driver',
    'usps delayed', 'amazon delivery', 'box arrived open', 'missing from box'
  ];
  const hasShipping = shippingKeywords.some((kw) => fullText.includes(kw));
  const productHardwareWords = ['mouse', 'click', 'button', 'sensor', 'battery', 'scroll', 'plastic', 'device', 'material', 'ergonomic'];
  const mentionsHardware = productHardwareWords.some((w) => fullText.includes(w));

  if (hasShipping && !mentionsHardware && (star === 1 || star === 2)) {
    return {
      tone_score: -1,
      is_product_related: false,
      primary_reason: 'other',
      tags: ['shipping_issue', 'packaging_damage'],
      model_used: 'local-heuristic',
    };
  }

  // 2. Severe Defect & Switch Failure detection (Tone -2)
  const defectKeywords = [
    'double click', 'double-click', 'double clicking', 'clicking twice',
    'stopped working', 'died after', 'bricked', 'defective', 'defect',
    'left button died', 'right click died', 'scroll wheel broke', 'scroll wheel jumped',
    'lemon', 'garbage switch', 'switch failed', 'failed after a few months',
    'unusable', 'faulty switch', 'omron switch', 'disconnecting constantly'
  ];
  const defectMatches = defectKeywords.filter((kw) => fullText.includes(kw));

  // 3. Quality Decline / Stealth Downgrade detection
  const qualityDeclineKeywords = [
    'cheaper material', 'cheaper plastic', 'cheap plastic', 'flimsy',
    'cut corners', 'downgrade', 'used to be better', 'used to last',
    'quality decline', 'quality has gone down', 'not what it used to be',
    'cost cutting', 'cheapened', 'worse than my old', 'previous version was better',
    'planned obsolescence', 'feels cheap'
  ];
  const qualityDeclineMatches = qualityDeclineKeywords.filter((kw) => fullText.includes(kw));

  // 4. Ergonomics / Comfort
  const ergonomicsKeywords = ['hand cramps', 'wrist pain', 'uncomfortable', 'too small', 'awkward grip', 'ergonomics'];
  const hasErgonomics = ergonomicsKeywords.some((kw) => fullText.includes(kw));

  // 5. Software / Firmware
  const softwareKeywords = ['ghub', 'g hub', 'logi options', 'software bug', 'firmware update', 'driver issue'];
  const hasSoftware = softwareKeywords.some((kw) => fullText.includes(kw));

  // 6. Price / Value
  const priceKeywords = ['overpriced', 'not worth the price', 'too expensive', 'rip off', 'waste of money'];
  const hasPrice = priceKeywords.some((kw) => fullText.includes(kw));

  // 7. Praise / High Quality detection
  const praiseKeywords = [
    'best mouse', 'love it', 'flawless', 'highly recommend', 'great mouse',
    'lasts forever', 'durable', 'reliable', 'perfect', 'worth every penny',
    'super comfortable', 'excellent', 'fantastic'
  ];
  const praiseMatches = praiseKeywords.filter((kw) => fullText.includes(kw));

  // Determine Primary Reason and Tags
  const tags: string[] = [];
  let primaryReason: PrimaryReason = 'other';
  let score = 0;

  if (defectMatches.length > 0) {
    primaryReason = 'defect';
    tags.push('defect');
    if (fullText.includes('double') || fullText.includes('switch')) tags.push('switch_failure');
    if (fullText.includes('scroll')) tags.push('scroll_wheel');
  } else if (qualityDeclineMatches.length > 0) {
    primaryReason = 'quality_decline';
    tags.push('quality_decline');
    if (fullText.includes('plastic') || fullText.includes('material')) tags.push('materials');
  } else if (hasSoftware) {
    primaryReason = 'software';
    tags.push('software');
  } else if (hasErgonomics) {
    primaryReason = 'ergonomics';
    tags.push('ergonomics');
  } else if (hasPrice) {
    primaryReason = 'price';
    tags.push('pricing');
  } else if (praiseMatches.length > 0) {
    primaryReason = 'praise';
    tags.push('durability');
  }

  // Base score calculation
  if (star != null) {
    if (star === 5) score = 2;
    else if (star === 4) score = 1;
    else if (star === 3) score = 0;
    else if (star === 2) score = -1;
    else if (star === 1) score = -2;
  } else {
    // No star rating (e.g. Reddit post)
    if (defectMatches.length > 0) score = -2;
    else if (qualityDeclineMatches.length > 0) score = -1;
    else if (praiseMatches.length > 0) score = 2;
    else score = 0;
  }

  // Defect overrides: if critical defect is mentioned, tone must be -2 even if rated 2 stars
  if (defectMatches.length > 0 && score > -1) {
    score = -2;
  } else if (qualityDeclineMatches.length > 0 && score > 0) {
    score = -1;
  }

  const toneScore = Math.max(-2, Math.min(2, score));

  return {
    tone_score: toneScore,
    is_product_related: true,
    primary_reason: primaryReason,
    tags: Array.from(new Set(tags)),
    model_used: 'local-heuristic',
  };
}

/**
 * One provider in the scoring chain.
 *
 * The chain is data, so the order, the environment keys each provider needs, and what the status
 * endpoint reports are all the same fact. Previously three of the four call paths were unreachable
 * dead code behind a single promise: `scoreReview` tried TypeSafe and fell straight to the local
 * heuristic, while `/status` advertised Gemini and Claude as available engines.
 */
export interface ScorerAdapter {
  /** Recorded in `model_used` and reported by /status. */
  name: string;
  /** Environment keys, tried in order; the first one set is used. Empty for adapters needing no key. */
  envKeys: string[];
  /** Whether this adapter needs a credential before it can be attempted at all. */
  requiresKey: boolean;
  /** `timeoutMs` is what is left of the chain budget, capped at one provider's own timeout. */
  call: (input: ScoreInput, key: string, fetchImpl: typeof fetch, timeoutMs: number) => Promise<ScoreResult>;
}

export interface ScorerDeps {
  /** Where credentials are read from. Defaults to process.env; tests pass a map instead. */
  env?: Record<string, string | undefined>;
  /** Transport, so a test can answer instead of dialling out. */
  fetchImpl?: typeof fetch;
  /** Total wall-clock budget for the whole chain before the deterministic adapter answers. */
  budgetMs?: number;
  /** Clock, so the budget is testable. */
  now?: () => number;
}

/**
 * One documented latency bound for a scoring round, replacing three implicit sequential 5 s
 * timeouts. Every provider call is given only the budget that remains, so a caller scoring a batch
 * knows the worst case from this number alone.
 */
export const DEFAULT_CHAIN_BUDGET_MS = 12_000;
const PROVIDER_TIMEOUT_MS = 5_000;

const clampTone = (v: unknown) => Math.max(-2, Math.min(2, Math.round(typeof v === 'number' && Number.isFinite(v) ? v : 0)));

const promptFor = (input: ScoreInput) => `${RUBRIC_PROMPT}

Review Title: ${input.title || 'N/A'}
Review Star Rating: ${input.star_rating != null ? input.star_rating : 'N/A'}
Review Body:
"${input.body}"`;

const asScore = (parsed: Record<string, unknown> | null, model: string): ScoreResult => ({
  tone_score: clampTone(parsed?.tone_score),
  is_product_related: Boolean(parsed?.is_product_related ?? true),
  primary_reason: (parsed?.primary_reason ?? 'other') as ScoreResult['primary_reason'],
  tags: Array.isArray(parsed?.tags) ? (parsed.tags as string[]) : [],
  model_used: model,
});

/** The three provider calls differ only in URL, auth header, body and where the JSON sits. */
async function postJson(url: string, body: unknown, headers: Record<string, string>, fetchImpl: typeof fetch, timeoutMs: number): Promise<any> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

export const SCORER_CHAIN: ScorerAdapter[] = [
  {
    name: 'typesafe-jev',
    envKeys: ['TYPESAFE_API_KEY', 'JEV_API_KEY'],
    requiresKey: true,
    call: async (input, key, fetchImpl, timeoutMs) => {
      const json = await postJson('https://api.typesafe.ai/v1/chat/completions', {
        model: 'typesafe-jev-mini',
        messages: [{ role: 'user', content: promptFor(input) }],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }, { authorization: `Bearer ${key}` }, fetchImpl, timeoutMs);
      const content = json?.choices?.[0]?.message?.content;
      if (!content) throw new Error('empty response');
      return asScore(JSON.parse(content), 'typesafe-jev');
    },
  },
  {
    name: 'gemini-2.5-flash',
    envKeys: ['GEMINI_API_KEY'],
    requiresKey: true,
    call: async (input, key, fetchImpl, timeoutMs) => {
      const json = await postJson(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
        { contents: [{ role: 'user', parts: [{ text: promptFor(input) }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.1 } },
        {},
        fetchImpl,
        timeoutMs,
      );
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('empty response');
      return asScore(JSON.parse(text), 'gemini-2.5-flash');
    },
  },
  {
    name: 'claude-3-5-haiku',
    envKeys: ['ANTHROPIC_API_KEY'],
    requiresKey: true,
    call: async (input, key, fetchImpl, timeoutMs) => {
      const json = await postJson('https://api.anthropic.com/v1/messages', {
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 300,
        messages: [{ role: 'user', content: promptFor(input) }],
      }, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, fetchImpl, timeoutMs);
      const text = json?.content?.[0]?.text;
      if (!text) throw new Error('empty response');
      const match = String(text).match(/\{[\s\S]*\}/);
      if (!match) throw new Error('no JSON object in response');
      return asScore(JSON.parse(match[0]), 'claude-3-5-haiku');
    },
  },
  {
    // Deterministic, offline, and always last: the chain always has an answer.
    name: 'local-heuristic',
    envKeys: [],
    requiresKey: false,
    call: async (input) => scoreWithLocalHeuristics(input),
  },
];

const keyFor = (adapter: ScorerAdapter, env: Record<string, string | undefined>): string =>
  adapter.requiresKey ? adapter.envKeys.map((k) => env[k]).find((v) => v) ?? '' : '';

/** Which adapters can run right now, in the order they are tried. Derived, never hand-listed. */
export function scorerReachability(env: Record<string, string | undefined> = process.env): { name: string; ready: boolean }[] {
  return SCORER_CHAIN.map((a) => ({ name: a.name, ready: !a.requiresKey || keyFor(a, env) !== '' }));
}

/**
 * Scores one review through the chain: the first configured provider that answers wins, and a
 * provider that fails, times out, or has no credential is skipped. `budgetMs` bounds the whole
 * round; once it is spent the remaining providers are not attempted and the deterministic adapter
 * answers instead of the caller waiting indefinitely.
 */
export async function scoreReview(input: ScoreInput, deps: ScorerDeps = {}): Promise<ScoreResult> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const budget = deps.budgetMs ?? DEFAULT_CHAIN_BUDGET_MS;
  const started = now();

  for (const adapter of SCORER_CHAIN) {
    const key = keyFor(adapter, env);
    if (adapter.requiresKey && !key) continue; // not configured: never attempted, and reported as such
    // Each provider gets only what is left of the budget, so the bound holds for the whole chain
    // rather than being checked between calls and overrun by the last one.
    const remaining = budget - (now() - started);
    if (adapter.requiresKey && remaining <= 0) {
      console.warn(`[reviews] scoring budget of ${budget} ms spent before ${adapter.name}; using the deterministic scorer`);
      continue;
    }
    try {
      return await adapter.call(input, key, fetchImpl, Math.min(PROVIDER_TIMEOUT_MS, remaining));
    } catch (e) {
      console.warn(`[reviews] ${adapter.name} failed, falling back: ${(e as Error).message}`);
    }
  }

  // Unreachable while the chain ends with the deterministic adapter; kept so a future chain
  // edit cannot make this function return nothing.
  return scoreWithLocalHeuristics(input);
}
