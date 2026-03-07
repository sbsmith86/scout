'use strict';

/**
 * Disqualifier layer — runs before the Claude scoring API call.
 *
 * If any disqualifier condition is met the function returns immediately with
 * `pass: false` and a plain-English `filter_reason`.  No API call is made.
 *
 * Rules (in evaluation order):
 *  1. `capacity` is "closed"
 *  2. Sector is in `excluded_sectors`
 *  3. Budget/contract value is outside `rate_range`
 *  4. Deadline is sooner than `min_project_days` from today
 *  5. Opportunity requires a skill not present in the profile
 *
 * @param {object} opportunity  Normalised opportunity or lead object.
 * @param {object} profile      HosTechnology profile JSON.
 * @returns {{ pass: boolean, filter_reason: string|null }}
 */
function disqualify(opportunity, profile) {
  // ── 1. Capacity check ────────────────────────────────────────────────────
  if (profile.capacity === 'closed') {
    return {
      pass: false,
      filter_reason: 'HosTechnology is not currently taking on new work (capacity is closed).',
    };
  }

  // ── 2. Excluded sectors ───────────────────────────────────────────────────
  const excludedSectors = Array.isArray(profile.excluded_sectors)
    ? profile.excluded_sectors.map((s) => s.toLowerCase().trim())
    : [];

  if (excludedSectors.length > 0) {
    // Fields that may carry sector or category information on the opportunity.
    const sectorFields = [
      opportunity.sector,
      opportunity.org_sector,
      opportunity.mission_summary,
      opportunity.description,
      opportunity.title,
    ]
      .filter(Boolean)
      .map((v) => v.toLowerCase())
      .join(' ');

    for (const excluded of excludedSectors) {
      // Build a list of meaningful keyword tokens from the excluded sector
      // label (drop short connector words).  Check each token independently
      // so that "fossil fuel and extractive industries" matches text that
      // contains just "fossil fuel" or just "extractive industries".
      const tokens = excluded
        .split(/\s+/)
        .filter((w) => w.length > 3 && !['and', 'the', 'for', 'with'].includes(w));

      // Require at least two consecutive tokens to match (bigrams) to avoid
      // false positives on common single words like "defense" or "military".
      const bigrams = [];
      for (let i = 0; i < tokens.length - 1; i++) {
        bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
      }

      // Fall back to the full phrase when there is only one meaningful token.
      const patterns = bigrams.length > 0 ? bigrams : [excluded];

      for (const pattern of patterns) {
        if (sectorFields.includes(pattern)) {
          return {
            pass: false,
            filter_reason: `Organization or opportunity appears to be in an excluded sector ("${excluded}").`,
          };
        }
      }
    }
  }

  // ── 3. Budget / rate range ────────────────────────────────────────────────
  const rateRange = profile.rate_range || {};
  const rateMin = typeof rateRange.min === 'number' ? rateRange.min : 0;
  const rateMax = typeof rateRange.max === 'number' ? rateRange.max : Infinity;

  // Only evaluate if the profile has a non-zero rate floor set.
  if (rateMin > 0 && opportunity.budget) {
    const budgetStr = String(opportunity.budget);

    // Skip budget disqualification for hourly/daily rates — we cannot compare
    // them to a project-total minimum without knowing the full scope.
    const isHourlyOrDaily = /\/\s*(?:hr|hour|day|wk|week)|per\s+(?:hour|day|week)|hourly/i.test(budgetStr);

    if (!isHourlyOrDaily) {
      const budgetNumbers = extractNumbers(budgetStr);
      if (budgetNumbers.length > 0) {
        // Use the highest number found — most likely to represent the contract
        // ceiling rather than an hourly floor.
        const maxBudgetValue = Math.max(...budgetNumbers);

        if (maxBudgetValue < rateMin) {
          return {
            pass: false,
            filter_reason: `Budget (${opportunity.budget}) appears to be below the minimum project value of $${rateMin.toLocaleString()}.`,
          };
        }

        if (rateMax > 0 && rateMax < Infinity && maxBudgetValue > rateMax) {
          return {
            pass: false,
            filter_reason: `Budget (${opportunity.budget}) appears to exceed the maximum project value of $${rateMax.toLocaleString()}.`,
          };
        }
      }
    }
  }

  // ── 4. Deadline too soon ──────────────────────────────────────────────────
  const minProjectDays =
    typeof profile.min_project_days === 'number' ? profile.min_project_days : 0;

  if (minProjectDays > 0 && opportunity.deadline) {
    const deadlineDate = new Date(opportunity.deadline);
    if (!isNaN(deadlineDate.getTime())) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const daysUntilDeadline = Math.floor(
        (deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysUntilDeadline < minProjectDays) {
        return {
          pass: false,
          filter_reason: `Deadline (${opportunity.deadline}) is only ${daysUntilDeadline} day(s) away — less than the minimum project window of ${minProjectDays} days.`,
        };
      }
    }
  }

  // ── 5. Required skills not in profile ────────────────────────────────────
  const profileSkills = Array.isArray(profile.technical_skills)
    ? profile.technical_skills
        .filter((s) => s && s.skill)
        .map((s) => s.skill.toLowerCase().trim())
    : [];

  if (profileSkills.length > 0) {
    const requiredSkills = extractRequiredSkills(opportunity);
    for (const required of requiredSkills) {
      // Check for an exact match or substring match against known skills.
      const matched = profileSkills.some(
        (known) => known.includes(required) || required.includes(known)
      );
      if (!matched) {
        return {
          pass: false,
          filter_reason: `Opportunity requires "${required}" — a skill not listed in the HosTechnology profile.`,
        };
      }
    }
  }

  // ── All checks passed ─────────────────────────────────────────────────────
  return { pass: true, filter_reason: null };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Extract all numeric values (including thousands-separated) from a string.
 * "$15,000 – $25,000/year" → [15000, 25000]
 *
 * @param {string} text
 * @returns {number[]}
 */
function extractNumbers(text) {
  const matches = text.match(/\$?\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+/g) || [];
  return matches
    .map((m) => parseFloat(m.replace(/[,$]/g, '')))
    .filter((n) => !isNaN(n) && n > 0);
}

/**
 * Attempt to pull an explicit list of *required* technologies or skills from
 * the opportunity's `required_skills` field (if provided by a source plugin)
 * or a short "Required:" / "Requirements:" section in the description.
 *
 * This is intentionally conservative — it only flags hard requirements, not
 * preferences.  Ambiguous cases are left to Claude's scoring step.
 *
 * @param {object} opportunity
 * @returns {string[]}  Lower-cased skill tokens
 */
function extractRequiredSkills(opportunity) {
  // Source plugins may attach a structured skills list.
  if (Array.isArray(opportunity.required_skills) && opportunity.required_skills.length > 0) {
    return opportunity.required_skills
      .filter(Boolean)
      .map((s) => s.toLowerCase().trim());
  }

  // Fall back to scanning the description for an explicit "Required:" section.
  const description = String(opportunity.description || '');
  const requiredSection = description.match(
    /(?:required|requirements|must have|must-have)[:\s]+([^\n]+)/i
  );
  if (!requiredSection) return [];

  // Split on commas, semicolons, and "and"/"or" connectors.
  const tokens = requiredSection[1]
    .split(/[,;]|\band\b|\bor\b/i)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 2 && t.length < 60);

  return tokens;
}

module.exports = { disqualify };
