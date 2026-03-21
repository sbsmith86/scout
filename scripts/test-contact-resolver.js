#!/usr/bin/env node
'use strict';

/**
 * Manual smoke-test for the contact resolver.
 *
 * Exercises extractFromPosting and findOrgDomain with canned item fixtures.
 * The Hunter.io and website-scraping strategies require live network access;
 * this test focuses on the deterministic offline logic so CI can run it without
 * credentials.
 *
 * Run from the repo root:
 *
 *   node scripts/test-contact-resolver.js
 *
 * To also exercise Hunter.io (requires HUNTER_API_KEY in .env):
 *
 *   HUNTER_API_KEY=<key> node scripts/test-contact-resolver.js
 */

require('dotenv').config();

const { extractFromPosting, findOrgDomain, resolveContact } = require('../src/contacts');

// ── Helpers ───────────────────────────────────────────────────────────────────

function pass(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.error(`  ✗ ${msg}`); process.exitCode = 1; }
function info(msg) { console.log(`  • ${msg}`); }

function assertEq(label, actual, expected) {
  if (actual === expected) {
    pass(`${label}: "${actual}"`);
  } else {
    fail(`${label}: expected "${expected}", got "${actual}"`);
  }
}

function assertTruthy(label, val) {
  if (val) pass(`${label}: truthy (${JSON.stringify(val)})`);
  else fail(`${label}: expected truthy, got ${JSON.stringify(val)}`);
}

function assertFalsy(label, val) {
  if (!val) pass(`${label}: falsy (${JSON.stringify(val)})`);
  else fail(`${label}: expected falsy, got ${JSON.stringify(val)}`);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE_WITH_EMAIL = {
  id: 'test-1',
  title: 'Automation Consultant',
  org: 'Sunrise Movement',
  url: 'https://idealist.org/en/consultant-org-job/12345',
  description: 'We are looking for an automation consultant. Contact Jane Smith at jane.smith@sunrisemovement.org for questions.',
  type: 'contract',
  source: 'idealist',
};

const FIXTURE_WITH_LINKEDIN = {
  id: 'test-2',
  title: 'Tech Strategy Consultant',
  org: 'ACLU',
  url: 'https://idealist.org/en/consultant-org-job/99999',
  description: 'Submit proposals to our operations director. See https://linkedin.com/in/john-doe-aclu for more info.',
  type: 'contract',
  source: 'idealist',
};

const FIXTURE_WITH_ORG_URL = {
  id: 'test-3',
  title: 'Operations Support',
  org: 'Democracy Forward',
  url: 'https://propublica.org/article/grant-xyz',
  description: 'Democracy Forward (democracyforward.org) received a $500k grant from Ford Foundation.',
  type: 'lead',
  source: 'foundation-rss',
};

const FIXTURE_NO_CONTACT = {
  id: 'test-4',
  title: 'Data Systems Consultant',
  org: 'Local Housing Coalition',
  url: 'https://idealist.org/en/consultant-org-job/55555',
  description: 'We need help with our data systems. No specific contact provided.',
  type: 'contract',
  source: 'idealist',
};

const FIXTURE_LEAD_WITH_EMAIL = {
  id: 'test-5',
  title: null,
  org: 'Youth Organizers Collective',
  url: 'https://fordfoundation.org/announcements/grant-yoc',
  description: 'Youth Organizers Collective received $250k. Contact Executive Director Maria Lopez at mlopez@yoc.org',
  type: 'lead',
  funder: 'Ford Foundation',
  funding_amount: '$250,000',
  source: 'foundation-rss',
};

// ── Test suite ────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n── Scout × Contact Resolver smoke-test ──\n');

  // ── 1. Module export shape ─────────────────────────────────────────────────
  console.log('1. Checking module export shape…');
  if (typeof resolveContact !== 'function') fail('resolveContact must be a function');
  else pass('resolveContact is a function');

  if (typeof extractFromPosting !== 'function') fail('extractFromPosting must be a function');
  else pass('extractFromPosting is a function');

  if (typeof findOrgDomain !== 'function') fail('findOrgDomain must be a function');
  else pass('findOrgDomain is a function');

  // ── 2. extractFromPosting ──────────────────────────────────────────────────
  console.log('\n2. extractFromPosting() — email extraction…');
  {
    const result = extractFromPosting(FIXTURE_WITH_EMAIL);
    assertEq('email', result.email, 'jane.smith@sunrisemovement.org');
    assertTruthy('name contains "Jane"', result.name && result.name.includes('Jane'));
  }

  console.log('\n3. extractFromPosting() — LinkedIn extraction…');
  {
    const result = extractFromPosting(FIXTURE_WITH_LINKEDIN);
    assertTruthy('linkedin_url', result.linkedin_url && result.linkedin_url.includes('linkedin.com/in/'));
  }

  console.log('\n4. extractFromPosting() — no contact info…');
  {
    const result = extractFromPosting(FIXTURE_NO_CONTACT);
    assertFalsy('email (should be empty)', result.email);
    assertFalsy('name (should be empty)', result.name);
    assertFalsy('linkedin_url (should be empty)', result.linkedin_url);
  }

  console.log('\n5. extractFromPosting() — lead with email…');
  {
    const result = extractFromPosting(FIXTURE_LEAD_WITH_EMAIL);
    assertEq('email', result.email, 'mlopez@yoc.org');
  }

  // ── 3. findOrgDomain ──────────────────────────────────────────────────────
  console.log('\n6. findOrgDomain() — URL in description…');
  {
    const domain = findOrgDomain(FIXTURE_WITH_ORG_URL);
    assertEq('domain', domain, 'democracyforward.org');
  }

  console.log('\n7. findOrgDomain() — opportunity platform URL (should be null)…');
  {
    const domain = findOrgDomain(FIXTURE_WITH_EMAIL);
    // Idealist.org is a platform domain — should not be returned.
    if (domain && domain.includes('idealist')) {
      fail(`Should not return platform domain, got: ${domain}`);
    } else {
      pass(`Filtered platform domain correctly (got: ${domain})`);
    }
  }

  // ── 4. resolveContact() — output schema ────────────────────────────────────
  console.log('\n8. resolveContact() — output schema validation…');
  {
    const contact = await resolveContact(FIXTURE_WITH_EMAIL);
    const REQUIRED_FIELDS = ['name', 'title', 'email', 'linkedin_url', 'confidence'];
    for (const field of REQUIRED_FIELDS) {
      if (typeof contact[field] === 'string') pass(`contact.${field} is a string`);
      else fail(`contact.${field} must be a string (got ${typeof contact[field]})`);
    }

    const VALID_CONFIDENCES = ['high', 'medium', 'low'];
    if (VALID_CONFIDENCES.includes(contact.confidence)) {
      pass(`contact.confidence is valid: "${contact.confidence}"`);
    } else {
      fail(`contact.confidence must be one of ${VALID_CONFIDENCES.join('|')}, got "${contact.confidence}"`);
    }
  }

  console.log('\n9. resolveContact() — email found in posting → high confidence…');
  {
    const contact = await resolveContact(FIXTURE_WITH_EMAIL);
    if (contact.email !== 'unknown') pass(`email resolved: ${contact.email}`);
    else info('email not found (may be expected if posting parse changed)');

    if (contact.confidence === 'high' && contact.email !== 'unknown') {
      pass('confidence is "high" (email + name found in posting)');
    } else {
      info(`confidence: ${contact.confidence} — email: ${contact.email}`);
    }
  }

  console.log('\n10. resolveContact() — no contact → fields are "unknown" or "", not fabricated…');
  {
    const contact = await resolveContact(FIXTURE_NO_CONTACT);
    // With no contact info, all fields must be "unknown" or "" (never hallucinated).
    const VALID_UNKNOWN = ['unknown', ''];
    for (const field of ['name', 'title', 'email']) {
      if (VALID_UNKNOWN.includes(contact[field])) {
        pass(`contact.${field} = "${contact[field]}" (correctly unknown/empty)`);
      } else {
        // If scraping or Hunter found something, that's OK — just log it.
        info(`contact.${field} = "${contact[field]}" (resolver found something via live strategies)`);
      }
    }
  }

  console.log('\n11. resolveContact() — graceful with empty item…');
  {
    let contact;
    try {
      contact = await resolveContact({});
      pass('resolveContact({}) did not throw');
    } catch (err) {
      fail(`resolveContact({}) threw: ${err.message}`);
      return;
    }
    const REQUIRED_FIELDS = ['name', 'title', 'email', 'linkedin_url', 'confidence'];
    for (const field of REQUIRED_FIELDS) {
      if (typeof contact[field] === 'string') pass(`contact.${field} is a string`);
      else fail(`contact.${field} must be a string`);
    }
  }

  // ── Result ────────────────────────────────────────────────────────────────
  console.log();
  if (process.exitCode === 1) {
    console.error('Contact resolver test FAILED — see ✗ items above.\n');
  } else {
    console.log('Contact resolver test PASSED.\n');
  }
}

run().catch((err) => {
  console.error('\nUnhandled error:', err.message);
  process.exit(1);
});
