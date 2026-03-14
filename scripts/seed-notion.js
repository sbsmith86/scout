#!/usr/bin/env node
'use strict';

/**
 * Seed Notion databases with test data or fetch real opportunities.
 *
 * Modes:
 *   node scripts/seed-notion.js           # seed static test records (default)
 *   node scripts/seed-notion.js --live    # fetch + score real items via the full pipeline
 *   node scripts/seed-notion.js --dry-run # show what would be seeded, no writes
 *
 * Static mode inserts 4 opportunities and 4 leads drawn from real nonprofits.
 * Records have deterministic IDs (seed-opp-NNN / seed-lead-NNN) so the script
 * is idempotent — running it twice will log "Skipping duplicate" and exit
 * cleanly without creating extra pages.
 *
 * Live mode runs the complete Scout pipeline — the same path as `scout run` —
 * so it proves that the sources, scorer, and Notion writes all work end-to-end
 * with real data from the configured source plugins.
 *
 * Required env vars:
 *   NOTION_API_KEY
 *   NOTION_OPPORTUNITIES_DB_ID
 *   NOTION_LEADS_DB_ID
 *   NOTION_CORRECTIONS_DB_ID
 *   ANTHROPIC_API_KEY  (required for --live scoring; not needed for static seed)
 */

require('dotenv').config();

const args = process.argv.slice(2);
const isLive = args.includes('--live');
const isDryRun = args.includes('--dry-run');

// ── Static test data ──────────────────────────────────────────────────────────
// Based on real nonprofits; data is plausible but URLs are illustrative only.
// IDs are deterministic so the script can be re-run safely.

const TODAY = new Date().toISOString().slice(0, 10);
const daysFromNow = (n) =>
  new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const daysAgo = (n) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const SEED_OPPORTUNITIES = [
  {
    id: 'seed-opp-001',
    source: 'idealist',
    title: 'Automation & AI Workflow Consultant',
    org: 'Code for America',
    url: 'https://www.idealist.org/en/consultant-org-job/code-for-america-automation-consultant',
    deadline: daysFromNow(45),
    budget: '$25,000–$40,000',
    score: 18,
    confidence: 'high',
    surface_reason:
      'Civic-tech org with 25-person team seeking Slack-first automation — direct overlap with HosTechnology focus areas and budget.',
    description:
      'Code for America is seeking an experienced automation and AI workflow consultant to streamline internal operations. The ideal candidate has experience with Slack-first automation, Google Workspace, and no-code/low-code tools like Make or Zapier. This is a 3-month remote engagement focused on reducing manual work for a team of 25.',
    status: 'pending',
    date_surfaced: daysAgo(7),
    draft_text:
      "Dear Code for America team,\n\nHosTechnology has spent years building exactly the kind of automation infrastructure you're describing — Slack-first workflows, Google Workspace integrations, and no-code tooling that lets small teams do more without adding headcount.\n\nWe'd love to talk about your current pain points and share what we've built for similar orgs.",
  },
  {
    id: 'seed-opp-002',
    source: 'pnd-rfps',
    title: 'CRM Implementation & Training Consultant',
    org: 'GLAD Legal (LGBTQ+ Legal Advocates & Defenders)',
    url: 'https://philanthropynewsdigest.org/rfps/glad-crm-consultant',
    deadline: daysFromNow(60),
    budget: '$18,000–$28,000',
    score: 15,
    confidence: 'high',
    surface_reason:
      'LGBTQ+ legal org migrating from spreadsheets to CRM — target sector, budget in range, strong platform skill match.',
    description:
      'GLAD Legal seeks a consultant to lead CRM selection, data migration, and staff training for a 15-person org currently managing constituent relationships in spreadsheets. Preferred platforms: Salesforce Nonprofit Success Pack or Airtable. Remote-friendly, 60-day engagement.',
    status: 'approved',
    date_surfaced: daysAgo(7),
    draft_text:
      "Dear GLAD Legal team,\n\nMoving constituent data out of spreadsheets and into a real CRM is one of the highest-leverage things a small legal org can do — and it's work we've done many times.\n\nHosTechnology specializes in exactly this transition for nonprofits under 20 staff. We'd love to walk you through our process.",
  },
  {
    id: 'seed-opp-003',
    source: 'rfpdb',
    title: 'Digital Operations & Workflow Automation Specialist',
    org: 'National Immigration Law Center',
    url: 'https://rfpdb.com/rfp/nilc-digital-operations',
    deadline: daysFromNow(35),
    budget: '$20,000–$35,000',
    score: 13,
    confidence: 'high',
    surface_reason:
      'Immigration law org of 30 staff spending significant time on manual data entry — clear automation opportunity, scope slightly broad.',
    description:
      'NILC is looking for a consultant to assess current digital tools and workflows, identify bottlenecks, and implement automation solutions. We use Google Workspace, Slack, Asana, and Salesforce. Our team of 30 spends significant time on manual data entry and reporting.',
    status: 'pending',
    date_surfaced: daysAgo(7),
    draft_text: '',
  },
  {
    id: 'seed-opp-004',
    source: 'idealist',
    title: 'Technology Needs Assessment Consultant',
    org: 'Local Housing Justice Coalition',
    url: 'https://www.idealist.org/en/consultant-org-job/housing-justice-tech-assessment',
    deadline: daysFromNow(20),
    budget: '$5,000–$8,000',
    score: 8,
    confidence: 'low',
    surface_reason:
      'Budget below HosTechnology minimum and scope is vague; short deadline reduces feasibility further.',
    description:
      'Small housing justice org (5 staff) seeks consultant for a technology needs assessment. Budget is limited. Scope is open — may include data management, communications, or fundraising tools. No specific platform requirements listed.',
    status: 'pending',
    date_surfaced: TODAY,
    draft_text: '',
  },
];

const SEED_LEADS = [
  {
    id: 'seed-lead-001',
    org: 'Community Justice Exchange',
    funder: 'Borealis Philanthropy',
    funding_amount: '$1,200,000',
    funding_date: daysAgo(14),
    mission_summary:
      'Community Justice Exchange runs the National Bail Fund Network and supports ~100 local bail and bond funds across the US — a national network largely without dedicated tech staff.',
    score: 17,
    confidence: 'high',
    surface_reason:
      'Borealis grant to a national network coordinating 100+ local funds — strong automation and data-sharing needs across orgs without tech staff.',
    status: 'pending',
    date_surfaced: daysAgo(7),
    draft_text:
      "Dear Community Justice Exchange,\n\nCongratulations on receiving support from Borealis Philanthropy — it's well-deserved recognition of the critical coordination work you do across the National Bail Fund Network.\n\nCoordinating 100+ local organizations is exactly the kind of challenge where automation can make a real difference. HosTechnology has helped similar network-level orgs build lightweight data-sharing and reporting infrastructure so national staff aren't bottlenecked by manual follow-up.",
  },
  {
    id: 'seed-lead-002',
    org: 'Transgender Law Center',
    funder: 'Astraea Foundation for Justice',
    funding_amount: '$800,000',
    funding_date: daysAgo(10),
    mission_summary:
      'Transgender Law Center is the largest national trans-led organization advocating for a world free from discrimination. Staff of ~50 with significant case management and intake needs.',
    score: 15,
    confidence: 'high',
    surface_reason:
      'Astraea grant to TLC — trans-led legal org of 50 staff with case intake and management workflows that scale well with automation.',
    status: 'approved',
    date_surfaced: daysAgo(7),
    draft_text:
      "Dear Transgender Law Center team,\n\nCongratulations on your recent funding from Astraea — TLC's work is essential and we're glad to see it supported.\n\nHosTechnology works with legal advocacy orgs to streamline the intake and case management workflows that consume attorney and staff time. We'd love to share what we've built for similar organizations.",
  },
  {
    id: 'seed-lead-003',
    org: 'Alliance for Safety and Justice',
    funder: 'MacArthur Foundation',
    funding_amount: '$2,000,000',
    funding_date: daysAgo(21),
    mission_summary:
      'ASJ works to replace expensive, ineffective incarceration with proven public safety alternatives. Operates across 10 states with a distributed team of 80+.',
    score: 12,
    confidence: 'high',
    surface_reason:
      'MacArthur grant to a multi-state criminal justice org — distributed team of 80+ suggests coordination and reporting automation needs.',
    status: 'pending',
    date_surfaced: daysAgo(7),
    draft_text: '',
  },
  {
    id: 'seed-lead-004',
    org: 'United We Dream',
    funder: 'Open Society Foundations',
    funding_amount: '$500,000',
    funding_date: daysAgo(5),
    mission_summary:
      'United We Dream is the largest immigrant-led network in the US, with 400,000+ members. Grassroots base with significant organizing data and member communication needs.',
    score: 9,
    confidence: 'low',
    surface_reason:
      "OSF grant to a large immigrant rights org — but budget and engagement scope unclear; needs more research before outreach.",
    status: 'pending',
    date_surfaced: TODAY,
    draft_text: '',
  },
];

// ── Dry-run output ────────────────────────────────────────────────────────────

function printDryRun() {
  console.log('\n── Scout × Notion seed (dry-run) ──\n');
  console.log('Opportunities to seed:\n');
  for (const opp of SEED_OPPORTUNITIES) {
    console.log(
      `  ${opp.id}  score:${opp.score}  status:${opp.status}  confidence:${opp.confidence}`
    );
    console.log(`    "${opp.title}" — ${opp.org}`);
    console.log(`    ${opp.surface_reason}\n`);
  }

  console.log('Leads to seed:\n');
  for (const lead of SEED_LEADS) {
    console.log(
      `  ${lead.id}  score:${lead.score}  status:${lead.status}  confidence:${lead.confidence}`
    );
    console.log(`    ${lead.org} ← ${lead.funder} (${lead.funding_amount})`);
    console.log(`    ${lead.surface_reason}\n`);
  }

  console.log('No records written (dry-run mode).\n');
}

// ── Static seed ───────────────────────────────────────────────────────────────

async function seedStatic() {
  const { appendOpportunity, appendLead } = require('../src/notion/write');

  console.log('\n── Scout × Notion seed (static mode) ──\n');
  console.log(
    `Seeding ${SEED_OPPORTUNITIES.length} opportunities and ${SEED_LEADS.length} leads...\n`
  );
  console.log('Existing records with matching IDs will be skipped automatically.\n');

  for (const opp of SEED_OPPORTUNITIES) {
    try {
      await appendOpportunity(opp);
      // appendOpportunity logs "[notion] Skipping duplicate …" for existing records.
    } catch (err) {
      console.error(`  ✗ Failed to write ${opp.id}: ${err.message}`);
    }
  }

  for (const lead of SEED_LEADS) {
    try {
      await appendLead(lead);
    } catch (err) {
      console.error(`  ✗ Failed to write ${lead.id}: ${err.message}`);
    }
  }

  console.log('\nSeed complete. Check Notion to review the records.\n');
  console.log('Tip: re-running this script is safe — duplicates are skipped automatically.');
}

// ── Live fetch ────────────────────────────────────────────────────────────────

async function seedLive() {
  console.log('\n── Scout × Notion seed (live mode) ──\n');
  console.log(
    'Running the full Scout pipeline to fetch and score real opportunities.\n' +
    'This is the same path as `scout run` — it writes passing items to Notion.\n'
  );

  const { runPipeline } = require('../src/pipeline');
  const summary = await runPipeline({ healthCheck: false });

  console.log('\nLive fetch complete.');
  if (summary.surfaced !== undefined) {
    console.log(`  Surfaced  : ${summary.surfaced}`);
  }
  if (summary.notionWritten !== undefined) {
    console.log(`  Written   : ${summary.notionWritten}`);
  }
  if (summary.filtered !== undefined) {
    console.log(`  Filtered  : ${summary.filtered}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (isDryRun && !isLive) {
    printDryRun();
    return;
  }

  if (isDryRun && isLive) {
    console.log('\n── Scout × Notion seed (live dry-run) ──\n');
    console.log('Would run: runPipeline({ healthCheck: false })');
    console.log(
      'This fetches from all configured sources, scores each item via Claude,\n' +
      'and writes passing items to Notion (Opportunities or Leads databases).\n'
    );
    return;
  }

  if (isLive) {
    await seedLive();
  } else {
    await seedStatic();
  }
}

main().catch((err) => {
  console.error('\nUnhandled error:', err.message);
  process.exit(1);
});
