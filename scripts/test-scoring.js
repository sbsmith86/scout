#!/usr/bin/env node
'use strict';

/**
 * Manual test harness for the scoring engine.
 *
 * Runs a set of mock opportunities and leads through the disqualifier and
 * (optionally) the Claude scorer to validate signal quality.
 *
 * Usage:
 *   node scripts/test-scoring.js              # disqualifier only (fast, no API)
 *   node scripts/test-scoring.js --full       # disqualifier + Claude scorer
 *   node scripts/test-scoring.js --id 3       # run only the fixture at index 3
 *
 * Requires:
 *   ANTHROPIC_API_KEY in environment or .env when using --full
 */

try { require('dotenv').config({ path: '.env' }); } catch { /* dotenv not installed */ }

const { disqualify, score } = require('../src/scoring');

// ── Mock profile (mirrors profile.example.json structure) ────────────────────

const MOCK_PROFILE = {
  practice_name: 'HosTechnology',
  capacity: 'available',
  focus_areas: [
    'Workflow automation for orgs under 20 staff with no dedicated IT',
    'Slack-first internal tools for distributed nonprofit teams',
    'Automated reporting pipelines that pull from multiple data sources',
    'Email and communications routing automation',
    'Form-to-spreadsheet and data entry automation',
  ],
  target_sectors: ['racial justice', 'civic tech', 'LGBTQ+', 'education', 'housing justice'],
  excluded_sectors: ['military and defense', 'fossil fuel and extractive industries', 'law enforcement technology'],
  technical_skills: [
    { skill: 'automation', proficiency: 'expert' },
    { skill: 'zapier', proficiency: 'expert' },
    { skill: 'make', proficiency: 'expert' },
    { skill: 'google workspace', proficiency: 'expert' },
    { skill: 'slack', proficiency: 'expert' },
    { skill: 'airtable', proficiency: 'strong' },
    { skill: 'notion', proficiency: 'strong' },
    { skill: 'node.js', proficiency: 'strong' },
    { skill: 'javascript', proficiency: 'strong' },
  ],
  work_types: ['automation', 'workflow implementation', 'system design', 'training', 'tool selection'],
  platforms: ['Slack', 'Airtable', 'Make', 'Zapier', 'Google Workspace', 'Notion'],
  past_work: [
    {
      org: 'Community Justice Exchange',
      what_built: 'Slack-based intake automation connecting Typeform → Airtable → Slack alerts',
      outcome: 'Reduced staff response time from 48 hrs to 4 hrs; 120+ intakes/month automated',
      sector: 'racial justice',
      year: 2023,
      nda: false,
    },
    {
      org: 'Housing Rights Clinic',
      what_built: 'Google Sheets reporting pipeline pulling from three case management systems',
      outcome: 'Saved 6 hrs/week of manual data entry; funder reports now auto-generated',
      sector: 'housing justice',
      year: 2022,
      nda: false,
    },
  ],
  rate_range: { min: 5000, max: 80000 },
  min_project_days: 30,
  geographic_scope: 'remote_only',
};

// ── Test fixtures ─────────────────────────────────────────────────────────────

const FIXTURES = [
  // 0. Perfect match — housing justice org, automation work
  {
    label: 'Housing justice org — Slack automation RFP',
    opportunity: {
      id: 'test-1',
      source: 'idealist',
      type: 'contract',
      title: 'Consultant: Slack Automation & Internal Communications Systems',
      org: 'Bay Area Housing Coalition',
      description:
        'We are seeking a consultant to help us implement Slack automation to streamline our intake process and internal communications. We have a 12-person team with no dedicated IT staff. The work involves connecting our JotForm intake forms to Airtable and triggering Slack notifications for the team. Budget: $12,000. Timeline: 3 months.',
      budget: '$12,000',
      deadline: new Date(Date.now() + 75 * 86400000).toISOString().slice(0, 10),
    },
    expected_pass: true,
  },

  // 1. Excluded sector — law enforcement technology
  {
    label: 'Law enforcement tech — DISQUALIFIED (excluded sector)',
    opportunity: {
      id: 'test-2',
      source: 'sam.gov',
      type: 'contract',
      title: 'Automation Consultant — Law Enforcement Data Pipeline',
      org: 'City Police Department',
      description: 'Seeking consultant to automate law enforcement records management and case tracking. Law enforcement technology modernization project.',
      budget: '$25,000',
      deadline: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
    },
    expected_pass: false,
    expected_reason_contains: 'excluded sector',
  },

  // 2. Budget too low
  {
    label: 'Budget too low — DISQUALIFIED ($800)',
    opportunity: {
      id: 'test-3',
      source: 'catchafire',
      type: 'contract',
      title: 'Help us set up Zapier automations',
      org: 'Small Neighborhood Org',
      description: 'Looking for a volunteer to help set up some basic Zapier automations for our email list.',
      budget: '$800 stipend',
      deadline: new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10),
    },
    expected_pass: false,
    expected_reason_contains: 'minimum project value',
  },

  // 3. Deadline too soon
  {
    label: 'Deadline in 5 days — DISQUALIFIED',
    opportunity: {
      id: 'test-4',
      source: 'idealist',
      type: 'contract',
      title: 'Emergency Zapier Setup',
      org: 'Civic Action Network',
      description: 'Urgent: need Zapier setup within the week.',
      budget: '$10,000',
      deadline: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    },
    expected_pass: false,
    expected_reason_contains: 'day(s) away',
  },

  // 4. Capacity closed
  {
    label: 'Capacity closed — DISQUALIFIED',
    opportunity: {
      id: 'test-5',
      source: 'idealist',
      type: 'contract',
      title: 'Nonprofit Automation Consultant',
      org: 'Good Org',
      description: 'Great automation opportunity.',
      budget: '$15,000',
      deadline: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
    },
    profile_override: { capacity: 'closed' },
    expected_pass: false,
    expected_reason_contains: 'capacity is closed',
  },

  // 5. Required skill not in profile
  {
    label: 'Required skill missing (Salesforce) — DISQUALIFIED',
    opportunity: {
      id: 'test-6',
      source: 'idealist',
      type: 'contract',
      title: 'Salesforce CRM Automation Specialist',
      org: 'Education Nonprofit',
      description: 'We need help automating our Salesforce CRM workflows.',
      required_skills: ['salesforce'],
      budget: '$20,000',
      deadline: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
    },
    expected_pass: false,
    expected_reason_contains: 'salesforce',
  },

  // 6. Funding Monitor lead — racial justice org, large grant
  {
    label: 'Racial justice org — $1.5M Ford grant (lead)',
    opportunity: {
      id: 'test-7',
      source: 'ford-foundation',
      type: 'lead',
      org: 'Movement for Black Lives',
      funder: 'Ford Foundation',
      funding_amount: '$1,500,000',
      funding_date: new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10),
      mission_summary:
        'A coalition of racial justice organizations working to defund policing and invest in community infrastructure. Small staff, distributed team.',
      description: 'Ford Foundation awarded $1.5M to Movement for Black Lives for organizational capacity building.',
      budget: null,
      deadline: null,
    },
    expected_pass: true,
  },

  // 7. Low-signal vague opportunity
  {
    label: 'Vague "tech help" posting — low quality, marginal pass',
    opportunity: {
      id: 'test-8',
      source: 'idealist',
      type: 'contract',
      title: 'Tech Help Needed',
      org: 'Community Org',
      description: 'We need help with technology. Any experience welcome. We have some systems that need improvement.',
      budget: '$8,000',
      deadline: new Date(Date.now() + 50 * 86400000).toISOString().slice(0, 10),
    },
    expected_pass: null, // uncertain — depends on Claude scoring
  },

  // 8. LGBTQ+ org, Google Workspace automation
  {
    label: 'LGBTQ+ org — Google Workspace automation',
    opportunity: {
      id: 'test-9',
      source: 'idealist',
      type: 'contract',
      title: 'Operations Automation Consultant',
      org: 'Transgender Law Center',
      description:
        'We are seeking a consultant to automate our operations workflows using Google Workspace. We need help connecting Google Forms, Sheets, and Docs to reduce manual data entry. Our team of 15 processes roughly 200 client requests per month. Looking for 2-3 months of consulting support at $75-125/hr.',
      budget: '$75-125/hr',
      deadline: new Date(Date.now() + 55 * 86400000).toISOString().slice(0, 10),
    },
    expected_pass: true,
  },

  // 9. Education sector, not automation-focused
  {
    label: 'Education org — curriculum writing (not automation)',
    opportunity: {
      id: 'test-10',
      source: 'idealist',
      type: 'contract',
      title: 'Curriculum Development Consultant',
      org: 'Youth Education Fund',
      description:
        'We are seeking a curriculum development consultant to create project-based learning materials for high school students. Experience with education technology a plus but not required.',
      budget: '$18,000',
      deadline: new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10),
    },
    expected_pass: null, // uncertain — low relevance but may still score above threshold
  },
];

// ── Test runner ───────────────────────────────────────────────────────────────

async function run() {
  const args = process.argv.slice(2);
  const runFull = args.includes('--full');
  const idxFilter = (() => {
    const idIdx = args.indexOf('--id');
    if (idIdx >= 0) return parseInt(args[idIdx + 1], 10);
    return null;
  })();

  const fixtures =
    idxFilter !== null ? FIXTURES.filter((_, i) => i === idxFilter) : FIXTURES;

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Scout Scoring Engine — Manual Test Harness');
  console.log(`  Mode: ${runFull ? 'disqualifier + Claude scorer' : 'disqualifier only (use --full for scorer)'}`);
  console.log(`  Fixtures: ${fixtures.length}`);
  console.log('═══════════════════════════════════════════════════════════════');

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < fixtures.length; i++) {
    const { label, opportunity, profile_override, expected_pass, expected_reason_contains } =
      fixtures[i];
    const profile = profile_override ? { ...MOCK_PROFILE, ...profile_override } : MOCK_PROFILE;

    console.log('');
    console.log(`[${i}] ${label}`);
    console.log(`     Type: ${opportunity.type} | Org: ${opportunity.org}`);

    // ── Disqualifier ──────────────────────────────────────────────────────
    const dq = disqualify(opportunity, profile);

    if (!dq.pass) {
      console.log(`     ✗ DISQUALIFIED: ${dq.filter_reason}`);

      if (expected_pass === false) {
        if (
          !expected_reason_contains ||
          dq.filter_reason.toLowerCase().includes(expected_reason_contains.toLowerCase())
        ) {
          console.log('     ✓ Expected: correctly filtered');
          passed++;
        } else {
          console.log(
            `     ✗ FAIL: expected reason to contain "${expected_reason_contains}"`
          );
          failed++;
        }
      } else if (expected_pass === true) {
        console.log('     ✗ FAIL: should NOT have been disqualified');
        failed++;
      } else {
        console.log('     ~ (no expectation set for this fixture)');
      }
      continue;
    }

    console.log('     ✓ Passed disqualifier');

    if (expected_pass === false) {
      console.log('     ✗ FAIL: should have been disqualified');
      failed++;
      continue;
    }

    // ── Claude scorer (optional) ──────────────────────────────────────────
    if (!runFull) {
      console.log('     ~ Skipping scorer (run with --full to include)');
      if (expected_pass === true) {
        console.log('     ✓ Expected: disqualifier correctly allowed through');
        passed++;
      }
      continue;
    }

    try {
      console.log('     → Calling Claude scorer...');
      const result = await score(opportunity, profile);

      const dim = result.scores;
      console.log(
        `     Score: ${result.overall}/20 (R=${dim.relevance} F=${dim.fit} Fs=${dim.feasibility} Q=${dim.quality}) | confidence=${result.confidence}`
      );
      console.log(`     ${result.pass ? '✓ SURFACED' : '✗ FILTERED'}: ${result.surface_reason}`);
      if (!result.pass) console.log(`     Filter reason: ${result.filter_reason}`);

      if (expected_pass === true && !result.pass) {
        console.log('     ✗ FAIL: expected to pass but was filtered by scorer');
        failed++;
      } else if (expected_pass === false && result.pass) {
        console.log('     ✗ FAIL: expected to be filtered but passed scorer');
        failed++;
      } else {
        console.log('     ✓ Result matches expectation');
        passed++;
      }
    } catch (err) {
      console.error(`     ✗ ERROR: ${err.message}`);
      failed++;
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  const total = passed + failed;
  console.log(
    `  Results: ${passed}/${total} passed${failed > 0 ? ` — ${failed} FAILED` : ' ✓'}`
  );
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
