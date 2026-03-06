# Scout — Project Context for Claude

This file gives you full context on Scout so you can pick up the build without re-litigating decisions already made. Read it before suggesting anything architectural.

---

## Voice & Tone

Scout is an extension of the HosTechnology brand voice (defined in the workspace root `CLAUDE.md`) at **formality 8/10** — the most professional version of HosTechnology.

### Outreach & Proposal Drafts

When drafting proposals, outreach messages, or any client-facing content, Scout should:

- **Write as HosTechnology, not as Shae personally.** Use "we" and "HosTechnology," not "I" or first-person resume voice.
- **Lead with understanding of the org's mission.** Show that HosTechnology gets what they do and why it matters before pitching anything.
- **Be specific about what HosTechnology can do for them.** Not "we can help with technology" — name the concrete workflow, automation, or system and what it would change.
- **Reference the nonprofit/organizing world with genuine familiarity.** HosTechnology comes from this space. That should be felt, not stated as a credential.
- **For warm outreach (Funding Monitor leads):** Mention the specific funding received. Be congratulatory but not sycophantic. Propose one concrete thing HosTechnology could help with. Keep it short.
- **For proposals (Contract Finder):** Match the tone of the opportunity. Formal RFPs get formal responses. Smaller org postings get warmer, more direct proposals.

### What Scout Should Never Sound Like

- A mass email blast. Every outreach should feel like it was written for that specific organization.
- Desperate or salesy. HosTechnology is offering genuine value, not begging for work.
- Disconnected from the mission. If the outreach could be sent by any tech consultant, it's not right. The nonprofit fluency should come through.
- Tone-deaf about power dynamics. These are often under-resourced orgs. Don't talk down. Don't oversell. Don't promise the moon.

### Words & Phrases to Avoid in Outreach

- "Leverage," "synergy," "game-changer," "revolutionize," "paradigm shift"
- "Cutting-edge AI solutions" or any variation of hollow tech-vendor speak
- "We'd love to pick your brain" or anything that asks for free labor
- "Vibe coding" or anything implying AI-assisted work is lesser

---

## What This Is

Scout is a **private internal tool** for HosTechnology, a consulting practice that brings automation and AI workflows to under-resourced nonprofits and grassroots organizations. It is not a product. It is a dedicated business development system — a consulting rep that never sleeps.

**Name note**: If Scout ever becomes client-facing or part of an OpsReady product offering, the name becomes **Cultivate**. That's a repo rename, not a rebuild.

It runs on a weekly cron schedule and does three things:
1. Finds active consulting opportunities (RFPs, contracts) where someone is explicitly hiring
2. Monitors funding announcements and flags newly-funded nonprofits as warm outreach targets
3. Drafts proposals or outreach messages for each, then waits for human approval before anything is sent

Nothing is ever submitted or sent automatically. The human is always in the loop before action.

---

## Two-Agent Architecture

### Agent 1: Contract Finder
- **Job**: Find active RFPs and consulting contracts
- **Sources**: Idealist.org (scrape), SAM.gov (API), Catchafire.org (scrape)
- **Output**: Normalized opportunity object → scorer → proposal or structured application draft

### Agent 2: Funding Monitor
- **Job**: Watch for foundation grant announcements and impact investing news, flag newly-funded orgs as warm leads
- **Sources**: Foundation RSS feeds (Ford, Kellogg, MacArthur, Open Society), impact investing announcements (ImpactAssets, F.B. Heron), PRNewswire/BusinessWire filtered by "grant" + "nonprofit"
- **Output**: Org profile → scorer → short warm outreach message draft

### Why Two Agents
Contract Finder is **reactive** — someone posted a need, you're competing for it. Funding Monitor is **proactive** — you're reaching orgs before the RFP exists, at exactly the moment they have money to spend. The Funding Monitor is higher-value for HosTechnology's market because newly-funded small nonprofits are underserved at the moment they're about to spend on capacity.

**Note**: HosTechnology is a for-profit consulting practice. It does not apply for grants. Grant opportunities are irrelevant. The Funding Monitor watches for grants awarded *to nonprofits* as a signal to reach out to those orgs — not to apply for the grants ourselves.

---

## Tech Stack — Final Decisions

Do not suggest alternatives to these unless there is a compelling technical reason.

| Layer | Tool | Why |
|---|---|---|
| Runtime | Node.js | Familiar, Playwright already in use for IAP automation |
| Scraping | Cheerio (static) + Playwright (JS-rendered) | Already known tooling |
| APIs | Grants.gov, SAM.gov, Hunter.io | Free tiers sufficient for v1 |
| AI Layer | Anthropic Claude API (Sonnet) | Scoring, drafting, contact resolution |
| Storage | Google Sheets via Sheets API | Free, no record limits, same ecosystem as Google Docs export |
| Scheduling | Railway or Render cron job | Simple, cheap |
| Dashboard | Next.js or lightweight HTML served from Railway/Render | Primary review UI |
| Notification | Resend | Simple Node SDK, generous free tier |
| Draft Export | Google Docs API | Approved drafts export here for final review before sending |
| Contact Enrichment | Hunter.io | Free tier: 25/mo; starter $49/mo when needed |

**Why not OpenClaw**: Considered and rejected. Multi-turn reliability concerns for a structured pipeline, no control over dashboard UI, feedback loop would be constrained. The Node pipeline is the right call for a private system with compounding value.

**CLI usage**: `scout run`, `scout fetch`, etc. Directory and repo named `scout`.

**Why not Airtable**: Google Sheets chosen over Airtable because it's free with no record limits, already in the Google ecosystem with Docs, and easier to share with clients later without requiring Airtable accounts.

**Why not email as primary interface**: Email was initially proposed for the digest but rejected. Approve/Skip buttons in email require webhooks and are unreliable across email clients. A web dashboard is the primary review interface. Email is notification-only — "run complete, X surfaced, Y filtered" plus a link to the dashboard.

---

## Source Plugin Architecture

Every source — whether API or scrape — is a self-contained module that normalizes output to a standard opportunity schema before handing off to the scorer. The scoring and drafting layers never know where an opportunity came from. Adding a new source is a new plugin file only — nothing else changes.

```javascript
// Standard source plugin shape
{
  id: 'idealist',
  name: 'Idealist.org',
  type: 'scrape', // or 'api'
  fetch: async (profile) => [
    {
      id: string,
      source: string,
      title: string,
      org: string,
      url: string,
      deadline: string | null,  // ISO date
      budget: string | null,    // raw text
      description: string,      // full opportunity text
      type: 'contract' | 'lead'
    }
  ]
}
```

---

## Profile Schema

The profile is a structured JSON file that anchors both the scorer and the drafter. It is seeded by running the resume through a one-time Claude extraction step, then manually completed for preference fields.

**Important**: The profile represents HosTechnology the practice, not Shae personally. Proposals are written in HosTechnology's voice ("we help nonprofits...") not first-person resume voice ("I have 15 years...").

```json
{
  "practice_name": "HosTechnology",
  "tagline": "We help nonprofits and grassroots organizations automate the rest — so your team can focus on what only humans can do.",
  "focus_areas": [],        // BE SPECIFIC. Not 'nonprofit tech' but 'Slack-first automation for orgs under 20 staff with no dedicated IT'
  "target_sectors": [],     // e.g. civic tech, racial justice, LGBTQ+, education, housing justice
  "excluded_sectors": [],   // hard disqualifiers — auto-fail in scorer
  "technical_skills": [
    { "skill": "", "proficiency": "expert|strong|familiar" }
  ],
  "work_types": [],         // automation, system design, workflow implementation, training, tool selection
  "platforms": [],          // Airtable, Slack, Make, Zapier, Google Workspace, Notion, etc.
  "past_work": [
    {
      "org": "",
      "what_built": "",
      "outcome": "",        // MUST be measurable: '85-90% QA accuracy, reduced manual review by X hrs'
      "sector": "",
      "year": 0
    }
  ],
  "rate_range": { "min": 0, "max": 0 },
  "min_project_days": 30,
  "geographic_scope": "remote_only",
  "capacity": "available"   // available | limited | closed — update manually before each run
}
```

**Profile quality is the highest-leverage variable in the whole system.** Vague profile = vague scoring = vague drafts. Do not start building until the profile is written with specificity.

---

## Scoring & Filtering

### Disqualifiers — Run Before Scoring (Short-Circuit)
If any disqualifier is hit, skip scoring entirely and return `pass: false` with a plain-English reason.

- Sector is in `excluded_sectors`
- Budget or contract value is outside `rate_range`
- Deadline is sooner than `min_project_days` from today
- Requires skills not in profile
- `capacity` is set to `"closed"`

### Scoring Dimensions

Each scored 1–5. Overall = sum (max 20). Default pass threshold: **12+**. Tune after first 2–3 runs.

| Dimension | What Claude Evaluates |
|---|---|
| Relevance | Does the work match HosTechnology's focus areas and technical skills? |
| Fit | Does the org type, sector, and mission align with stated preferences? |
| Feasibility | Does timeline, scope, and budget fall within stated constraints? |
| Quality | Is this a serious, well-scoped opportunity or vague/low-signal? |

### Scorer Output Schema

```json
{
  "pass": true,
  "scores": {
    "relevance": 4,
    "fit": 4,
    "feasibility": 3,
    "quality": 3
  },
  "overall": 14,
  "filter_reason": null,
  "surface_reason": "Mid-sized racial justice org just received $2M Ford grant, no current tech staff listed, scope matches automation capabilities exactly.",
  "confidence": "high"
}
```

`filter_reason` is plain English and populates the filtered-out section of the dashboard. It must be a human-readable sentence, not a score. Example: "Budget ($5k) is below your stated minimum of $15k."

`confidence: "low"` items that pass scoring should be visually flagged in the dashboard — they surfaced but the agent isn't sure.

---

## Contact Resolution

Runs after scoring, for every item that passes. Returns a contact object. Never hallucinates — flags as `"unknown"` if not found.

**Resolution priority:**
1. Check opportunity posting for named contact or submission email
2. Search org website (About, Team, Staff, Leadership pages)
3. Target by role: small org (< 20 staff) → ED or COO; mid org → Director of Technology or Operations; contract posting → named hiring manager
4. Run name + org through Hunter.io API for email verification
5. Return LinkedIn URL as fallback if email not found

```json
{
  "name": "Jane Smith",
  "title": "Executive Director",
  "email": "jane@org.org",
  "linkedin_url": "https://linkedin.com/in/...",
  "confidence": "high"
}
```

---

## Application Process Discovery

Runs alongside contact resolution for Contract Finder items. Appended to dashboard card and exported Google Doc so the user knows what they're walking into before approving.

**What it looks for:**
- Formal portal (Submittable, ZoomGrants, JotForm, etc.)
- Email-only submission
- Specific application questions to answer
- Required attachments (budget template, work samples, org docs)
- LOI step before full application
- Submission deadline and any stage deadlines

**Draft output varies by application type:**
- Email submission → full proposal (positioning, fit, past work, approach, timeline, rate)
- Structured application with questions → each question extracted and answered individually — exported doc is a complete structured application draft
- LOI required → shorter LOI draft; full proposal reserved for after LOI accepted
- Funding Monitor lead → short warm outreach message, mentions specific funding received, proposes one concrete thing HosTechnology could help with

---

## Google Sheets Data Schema

Three sheets. Append-only. Status column drives dashboard state. Nothing is deleted, only status is updated.

### Sheet 1: Opportunities (Contract Finder)
```
id | source | title | org | url | deadline | budget | score | confidence
   | contact_name | contact_title | contact_email | contact_linkedin
   | application_type | application_notes | status | date_surfaced | draft_doc_link

status: pending | approved | skipped | sent
```

### Sheet 2: Leads (Funding Monitor)
```
id | org | funder | funding_amount | funding_date | mission_summary | score | confidence
   | contact_name | contact_title | contact_email | contact_linkedin
   | status | date_surfaced | draft_doc_link

status: pending | approved | skipped | sent
```

### Sheet 3: Corrections Log
```
id | item_id | item_type | filter_reason | feedback | date

feedback: good_filter | bad_filter
```

`bad_filter` = thumbs down on a filtered item = "should have surfaced this." Reviewed periodically to tighten scoring prompt or profile constraints.

---

## Dashboard

Single page, two tabs: **Opportunities** and **Leads**.

**Each card shows:**
- Org, source/funder, deadline or funding date
- Score + confidence badge (low confidence visually flagged)
- One-line surface reason
- Contact block: name, title, email or LinkedIn
- Application process summary (Contract Finder only)
- Draft preview (expandable)
- Approve / Skip / Edit buttons

**Filtered section** (bottom of each tab, collapsed by default):
- Every filtered item from this run
- Plain-English filter reason
- Thumbs up / Thumbs down per item
- Thumbs down writes to Corrections Log

**Approved queue** (top of page):
- Link to exported Google Doc per approved item
- Status manually updated to "sent" after submission

---

## Build Phases

### Phase 1 — Skeleton (DO THIS FIRST)
- One source per agent: **Idealist** (contracts) + **one foundation RSS feed** (leads)
- Scoring prompt + Google Sheets write
- Notification email (Resend) with run summary + dashboard link
- Basic dashboard: cards display only, no action buttons yet
- Goal: validate signal quality before building approval plumbing
- Do not build Phase 2 until Phase 1 is running and producing real results

### Phase 2 — Approval Loop
- Approve / Skip buttons write status back to Sheets
- Filtered section with thumbs feedback + Corrections Log write
- Google Docs export on approval
- Contact resolution integrated
- Application process discovery integrated

### Phase 3 — More Sources
- Add SAM.gov, Catchafire
- Add more foundation RSS feeds + impact investing sources
- Each = new source plugin file only

### Phase 4 — Client Version
- Parameterize profiles for multiple nonprofit clients
- Funding Monitor repurposed as market intelligence for clients
- Each client gets own dashboard URL
- This becomes an OpsReady module

---

## Decisions Already Made — Do Not Re-Litigate

- **Node.js**, not Python
- **Google Sheets**, not Airtable
- **Web dashboard**, not email as primary review interface
- **Email is notification only** — run summary + link
- **No automated submission** in any phase — human always approves first
- **Source plugin pattern** — every source normalizes to the same schema
- **HosTechnology voice** in all drafts — not first-person resume voice
- **Profile quality first** — do not start the build until the profile JSON is written with real specificity
- **Phase 1 before Phase 2** — validate signal before building approval plumbing

---

## What To Build Next

Start here, in order:

1. Write `profile.json` with real data — focus areas, past work with measurable outcomes, hard constraints
2. Set up Google Sheets with the three-sheet schema above and confirm Sheets API credentials
3. Build the Idealist source plugin (scrape, normalize to opportunity schema)
4. Build one foundation RSS feed source plugin (parse, normalize to lead schema)
5. Wire scoring prompt against profile — test manually against 5–10 real opportunities before integrating
6. Build the run pipeline: fetch → score → write to Sheets
7. Build minimal dashboard: read from Sheets, render cards
8. Add Resend notification email

Do not skip step 1. The profile is the foundation. Everything else is plumbing.
