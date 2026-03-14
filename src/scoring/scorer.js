'use strict';

/**
 * Claude-powered scoring layer.
 *
 * Evaluates each opportunity or lead that passed the disqualifier layer on
 * four dimensions, each scored 1–5 (max 20).  The default pass threshold is
 * 12; callers can override it.
 *
 * Dimensions:
 *  - Relevance  — work matches focus areas and technical skills
 *  - Fit        — org type, sector, and mission align with preferences
 *  - Feasibility — timeline, scope, and budget within constraints
 *  - Quality    — serious, well-scoped opportunity vs vague/low-signal
 *
 * Output schema:
 * {
 *   pass: boolean,
 *   scores: { relevance: number, fit: number, feasibility: number, quality: number },
 *   overall: number,
 *   filter_reason: string|null,
 *   surface_reason: string,
 *   confidence: "high"|"low"
 * }
 */

const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_PASS_THRESHOLD = 12;
const MODEL = 'claude-sonnet-4-5';

/**
 * Score a single opportunity or lead against the HosTechnology profile.
 *
 * @param {object} opportunity  Normalised opportunity or lead object.
 * @param {object} profile      HosTechnology profile JSON.
 * @param {object} [options]
 * @param {number} [options.threshold]  Pass threshold (default 12).
 * @returns {Promise<object>}  Scoring result matching the output schema.
 */
async function score(opportunity, profile, options = {}) {
  const threshold = typeof options.threshold === 'number'
    ? options.threshold
    : DEFAULT_PASS_THRESHOLD;

  const client = new Anthropic({
    baseURL: 'https://api.anthropic.com',
  });

  const prompt = buildPrompt(opportunity, profile);

  let raw;
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    raw = message.content[0]?.text || '';
  } catch (err) {
    throw new Error(`Claude API error during scoring: ${err.message}`);
  }

  return parseResponse(raw, threshold);
}

// ── Prompt construction ───────────────────────────────────────────────────────

/**
 * Build the scoring prompt sent to Claude.
 *
 * @param {object} opportunity
 * @param {object} profile
 * @returns {string}
 */
function buildPrompt(opportunity, profile) {
  // Build a compact profile summary — include only scoring-relevant fields to
  // keep the prompt focused and avoid leaking NDA-protected detail.
  const profileSummary = {
    practice_name: profile.practice_name,
    focus_areas: profile.focus_areas,
    target_sectors: profile.target_sectors,
    excluded_sectors: profile.excluded_sectors,
    technical_skills: profile.technical_skills,
    work_types: profile.work_types,
    platforms: profile.platforms,
    rate_range: profile.rate_range,
    min_project_days: profile.min_project_days,
    geographic_scope: profile.geographic_scope,
    // The scorer uses FULL past_work details (including org name and what_built)
    // for accurate fit evaluation.  Only the drafter restricts to public_description
    // for NDA-protected entries.
    past_work: profile.past_work,
  };

  // Build a compact opportunity summary.
  const opportunitySummary = {
    title: opportunity.title,
    org: opportunity.org,
    type: opportunity.type,
    source: opportunity.source,
    description: opportunity.description
      ? opportunity.description.slice(0, 2000) // cap to keep prompt manageable
      : '',
    deadline: opportunity.deadline,
    budget: opportunity.budget,
    // Lead-specific fields
    funder: opportunity.funder,
    funding_amount: opportunity.funding_amount,
    funding_date: opportunity.funding_date,
    mission_summary: opportunity.mission_summary,
  };

  return `You are scoring a consulting opportunity or funding lead for ${profile.practice_name || 'HosTechnology'}, a consulting practice that helps nonprofits and grassroots organizations with automation and AI workflows.

## HosTechnology Profile
${JSON.stringify(profileSummary, null, 2)}

## Opportunity / Lead to Score
${JSON.stringify(opportunitySummary, null, 2)}

## Your Task
Score this opportunity on EXACTLY four dimensions. Each dimension is scored 1–5 (integer only).

| Dimension   | What to evaluate |
|-------------|------------------|
| relevance   | Does the work match HosTechnology's focus areas and technical skills? |
| fit         | Does the org type, sector, and mission align with stated preferences? |
| feasibility | Does the timeline, scope, and budget fall within stated constraints? |
| quality     | Is this a serious, well-scoped opportunity or vague/low-signal? |

Scoring guide:
- 5 = Exceptional match / no concerns
- 4 = Strong match / minor concerns
- 3 = Moderate match / some concerns
- 2 = Weak match / significant concerns
- 1 = Poor match / major red flags

Also provide:
- surface_reason: One sentence (max 25 words) explaining why this item is worth a look. Be specific — mention the org, funding, or scope detail that stands out. Required even if overall score is low.
- confidence: "high" if you have enough information to score reliably, "low" if key details are missing or ambiguous.

Respond with ONLY valid JSON in this exact format (no markdown, no extra text):
{
  "scores": {
    "relevance": <1-5>,
    "fit": <1-5>,
    "feasibility": <1-5>,
    "quality": <1-5>
  },
  "surface_reason": "<one sentence>",
  "confidence": "high" or "low"
}`;
}

// ── Response parsing ──────────────────────────────────────────────────────────

/**
 * Parse Claude's JSON response and build the full scoring result object.
 *
 * @param {string} raw         Raw text from Claude.
 * @param {number} threshold   Pass threshold.
 * @returns {object}           Full scoring result.
 */
function parseResponse(raw, threshold) {
  let parsed;

  try {
    // Strip any accidental markdown fences Claude might include.
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse Claude scoring response as JSON.\nRaw response:\n${raw}`);
  }

  const scores = parsed.scores || {};
  const relevance = toInt(scores.relevance);
  const fit = toInt(scores.fit);
  const feasibility = toInt(scores.feasibility);
  const quality = toInt(scores.quality);

  // Validate all four dimensions are present and in range.
  for (const [dim, val] of [['relevance', relevance], ['fit', fit], ['feasibility', feasibility], ['quality', quality]]) {
    if (val < 1 || val > 5) {
      throw new Error(`Invalid score for "${dim}": ${val}. Expected integer 1–5.`);
    }
  }

  const overall = relevance + fit + feasibility + quality;
  const pass = overall >= threshold;

  const confidence = parsed.confidence === 'low' ? 'low' : 'high';
  const surfaceReason = String(parsed.surface_reason || '').trim();

  return {
    pass,
    scores: { relevance, fit, feasibility, quality },
    overall,
    filter_reason: pass
      ? null
      : `Overall score ${overall}/20 — ${surfaceReason || 'no specific reason provided by scorer.'}`,
    surface_reason: surfaceReason,
    confidence,
  };
}

/**
 * Coerce a value to an integer, clamped to 1–5.
 *
 * @param {*} val
 * @returns {number}
 */
function toInt(val) {
  const n = parseInt(val, 10);
  return isNaN(n) ? 0 : Math.max(1, Math.min(5, n));
}

module.exports = { score, DEFAULT_PASS_THRESHOLD };
