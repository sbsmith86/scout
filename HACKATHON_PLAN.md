# Scout + Notion MCP — Hackathon Implementation Plan

**Hackathon:** Notion MCP Challenge (DEV.to / MLH / Notion)
**Deadline:** March 29, 2026 11:59pm PST
**Branch:** `notion-hackathon`
**Mode:** HOLD SCOPE — make the demo bulletproof, don't add features

---

## The Pitch (10-Second Test)

> AI agents scan multiple sources to find nonprofits ready to buy tech consulting,
> score and qualify them into a Notion pipeline — and the consultant reviews the
> outreach list by talking to Claude through Notion MCP.

**The story:** Solo consultant can't afford a biz-dev team. Builds AI agents that
do the prospecting. Reviews the pipeline in Notion through conversation. Notion
isn't a database — it's the cockpit for an autonomous biz-dev operation.

---

## Hackathon Plan Review

### Idea Scorecard

```
  IDEA SCORECARD:
  Originality (1-5):     4   [AI agents that autonomously prospect — not just a chatbot writing to Notion]
  Insight clarity (1-5): 4   [MCP as the human re-entry point into an autonomous pipeline]
  Demo-ability (1-5):    4   [pipeline runs, Notion populates, Claude reviews — all visible]
  Relevance (1-5):       5   [Notion MCP is literally the review interface]
  Overall:               17/20
```

### Feature Feasibility Table

```
  FEATURE                        | EST. TIME | CRITICAL? | FAKEABLE? | RISK
  -------------------------------|-----------|-----------|-----------|------
  Notion SDK client + auth       | 2h        | Y         | N         | Low
  Notion database schema design  | 2h        | Y         | N         | Low
  Notion writer (replace sheets) | 8h        | Y         | N         | Med
  Notion reader (replace sheets) | 4h        | Y         | N         | Med
  Pipeline rewire (imports)      | 2h        | Y         | N         | Low
  Notion MCP setup + config      | 2h        | Y         | N         | Med
  MCP review flow (test + tune)  | 6h        | Y         | N         | Med
  Dashboard removal/replace      | 2h        | N         | Y (skip)  | Low
  Draft export to Notion pages   | 4h        | N         | Y (later) | Low
  Fix broken sources (5)         | 0h        | N         | Y (2 work)| N/A
  Video walkthrough              | 4h        | Y         | N         | Low
  DEV.to submission post         | 3h        | Y         | N         | Low
  Buffer/rehearsal               | 4h        | Y         | N         | N/A
  -------------------------------|-----------|-----------|-----------|------
  TOTAL CRITICAL                 | ~37h      |           |           |
  TOTAL WITH NICE-TO-HAVES      | ~43h      |           |           |
```

Budget: ~60-90h available. **Fits comfortably with buffer.**

### Demo Failure Map

```
  COMPONENT                 | FAILURE MODE                    | FALLBACK?           | SEVERITY
  --------------------------|---------------------------------|---------------------|----------
  Source fetch (live)        | RSS feeds down, 0 results       | Pre-seed Notion DBs | Med
  Notion SDK writes         | Auth failure, rate limit         | Pre-seeded data     | High
  Notion MCP tools          | MCP server crash, auth mismatch | Pre-recorded video  | High ⚠️
  Claude scoring API        | Rate limit, timeout              | Pre-scored data     | Med
  Pipeline end-to-end       | Crash mid-run during video       | Split video: show   | Med
                            |                                 | pipeline + review    |
                            |                                 | separately           |
```

**CRITICAL GAP:** Notion MCP failure during live demo has no graceful in-the-moment
fallback. Mitigation: pre-record the MCP interaction as backup footage, but attempt
live in the video first. Also: rehearse the MCP flow 3+ times before recording.

### Recommended Build Order

```
  1. Notion setup: workspace, databases, API key, MCP server config     (Day 1-2)
  2. src/notion/ module: client, write, read — replace src/sheets/      (Day 3-6)
  3. Pipeline rewire: swap imports, test end-to-end with real sources    (Day 7)
  4. MCP review flow: test Claude + Notion MCP, tune the interaction    (Day 8-10)
  5. Polish: Notion views, database properties, page content formatting  (Day 11-12)
  6. Video + DEV post: script, record, write, submit                    (Day 13-15)
```

### Cut List (drop first if behind)

1. **Dashboard replacement** — skip entirely. Notion IS the dashboard now.
2. **Draft export to Notion pages** — write draft text as a property, don't create
   sub-pages. Can always add later.
3. **Corrections Log database** — nice for feedback loop, not visible in demo. Skip.
4. **Email notifications** — keep them if they still work, but don't debug if they break.

### The Load-Bearing Moment

The judge watches the pipeline run in a terminal — sources fetching, items scored,
results written. Then the video cuts to Notion: a clean database view with scored
prospects, status columns, all the metadata. Then the presenter opens Claude and
says "What's pending in Scout?" Claude queries Notion via MCP and summarizes the
prospects. The presenter says "Approve Code for America, skip the others." Claude
updates the Notion pages. The judge sees the status change in Notion in real time.
That's the moment — AI did the work, Notion holds the state, and a conversation
is the interface. No clicking through forms, no manual review. Just talking.

---

## Architecture

### Current Flow (Google Sheets)

```
Sources → Pipeline → Scorer → Google Sheets → Dashboard (Express) → Google Docs
```

### New Flow (Notion)

```
Sources → Pipeline → Scorer → Notion Databases (via SDK)
                                    ↓
                        Claude + Notion MCP (human review)
                                    ↓
                        Status updates, draft text in Notion
```

The dashboard and Google Docs export go away. Notion replaces both — it's the
storage layer, the review UI, and the approval workflow in one.

---

## Implementation Details

### Phase 1: Notion Setup (Day 1-2)

#### 1A. Create Notion Workspace + Integration

- Create a Notion integration at https://www.notion.so/my-integrations
- Get the API key (starts with `ntn_`)
- Create a top-level page called "Scout Pipeline" and share it with the integration

#### 1B. Create Three Databases

**Opportunities Database** (Contract Finder results)
| Property | Type | Notes |
|---|---|---|
| Name | Title | `{id}` — dedupe key |
| Source | Select | idealist, pnd-rfps, rfpdb |
| Title | Rich text | Opportunity title |
| Organization | Rich text | Org name |
| URL | URL | Link to original listing |
| Deadline | Date | ISO date or null |
| Budget | Rich text | Raw budget string |
| Score | Number | 0-20 |
| Confidence | Select | high, low |
| Surface Reason | Rich text | Why Scout surfaced this |
| Description | Rich text | Full opportunity description |
| Status | Select | pending, approved, skipped, sent |
| Date Surfaced | Date | Pipeline run date |
| Draft Text | Rich text | Outreach draft |

**Leads Database** (Funding Monitor results)
| Property | Type | Notes |
|---|---|---|
| Name | Title | `{id}` — dedupe key |
| Organization | Rich text | Org name |
| Funder | Rich text | Funding source |
| Funding Amount | Rich text | Dollar amount string |
| Funding Date | Date | When funding was announced/filed |
| Mission Summary | Rich text | Org mission |
| Score | Number | 0-20 |
| Confidence | Select | high, low |
| Surface Reason | Rich text | Why Scout surfaced this |
| Status | Select | pending, approved, skipped, sent |
| Date Surfaced | Date | Pipeline run date |
| Draft Text | Rich text | Outreach draft |

**Corrections Log Database** (filtered items — build only if time permits)
| Property | Type | Notes |
|---|---|---|
| Name | Title | `{correction_id}` |
| Item ID | Rich text | Original item ID |
| Item Type | Select | opportunity, lead |
| Title | Rich text | Original title |
| Organization | Rich text | Org name |
| Source | Select | Source plugin ID |
| Filter Reason | Rich text | Why it was filtered |
| Feedback | Select | good_filter, bad_filter, (empty) |
| Date | Date | When filtered |

#### 1C. Set Up Notion MCP

- Install and configure the Notion MCP server for Claude Code / Claude Desktop
- Test basic operations: search, read page, create page, update properties
- Document the MCP server config for the submission

#### 1D. Environment Variables

Add to `.env`:
```
NOTION_API_KEY=ntn_...
NOTION_OPPORTUNITIES_DB_ID=...
NOTION_LEADS_DB_ID=...
NOTION_CORRECTIONS_DB_ID=...
```

### Phase 2: Notion Module (Day 3-6)

Replace `src/sheets/` with `src/notion/`:

```
src/notion/
  client.js    — Notion SDK client initialization
  index.js     — Module exports (same interface as sheets)
  write.js     — appendOpportunity, appendLead, appendCorrection, updateStatus, etc.
  read.js      — readOpportunities, readLeads, readCorrections, readPendingForDashboard
```

**Key design decision:** Keep the same function signatures as `src/sheets/`. The
pipeline and dashboard import from the storage module — swapping the module should
require minimal changes to pipeline.js.

#### Write Operations (src/notion/write.js)

- `appendOpportunity(record)` → `notion.pages.create()` in Opportunities DB
- `appendLead(record)` → `notion.pages.create()` in Leads DB
- `appendCorrection(record)` → `notion.pages.create()` in Corrections DB
- `updateStatus(dbType, id, status)` → find page by Name property, update Status
- `updateDraftText(dbType, id, text)` → find page by Name property, update Draft Text
- `initializeAllHeaders()` → no-op or verify databases exist

**Dedupe strategy:** Before appending, query the database for a page with the same
Name (which contains the item ID). If it exists, skip. This prevents duplicate
entries across pipeline runs.

#### Read Operations (src/notion/read.js)

- `readOpportunities(status)` → query with filter on Status property
- `readLeads(status)` → query with filter on Status property
- `readCorrections(feedback)` → query with filter on Feedback property

### Phase 3: Pipeline Rewire (Day 7)

- Update `src/pipeline.js` imports: `require('./sheets')` → `require('./notion')`
- Update `src/dashboard/index.js` imports (if keeping dashboard)
- Run full pipeline end-to-end: `scout run`
- Verify items appear in Notion databases with correct properties
- Test deduplication: run pipeline twice, confirm no duplicates

### Phase 4: MCP Review Flow (Day 8-10)

This is the demo-critical phase. Test and refine the conversational review:

**Core interactions to nail:**
1. "What's pending in Scout?" → Claude queries Opportunities + Leads DBs, summarizes
2. "Tell me more about [org name]" → Claude fetches the specific page, shows details
3. "Approve [org], skip [org]" → Claude updates Status properties
4. "Draft an outreach email for [org]" → Claude writes draft text to the page

**Tuning:**
- Test with real data from working sources (Borealis + Knight RSS)
- If sources return 0 results, pre-seed databases with realistic test data
- Make sure Claude's MCP tool calls are reliable and fast
- Practice the flow until it feels natural, not mechanical

### Phase 5: Polish (Day 11-12)

- Create useful Notion views: "Pending Review", "Approved", "By Source", "High Score"
- Add Notion page icons and cover images for visual polish in the video
- Clean up any rough edges in the pipeline output (formatting, missing fields)
- Remove or gate Google Sheets code (don't delete — gate behind env var or remove imports)

### Phase 6: Submission (Day 13-15)

#### Video Walkthrough

Script the video. Don't improvise. Suggested structure (~3-4 minutes):

1. **Problem** (30s): "I'm a solo tech consultant serving nonprofits. I can't afford
   a biz-dev team, but I need a steady pipeline of qualified prospects."
2. **Solution overview** (30s): "Scout is a two-agent AI pipeline. Agent 1 finds
   contracts and RFPs. Agent 2 monitors funding signals. Both write to Notion."
3. **Pipeline demo** (60s): Terminal — run the pipeline, show sources fetching,
   scoring, writing to Notion. Cut to Notion — show the databases populated.
4. **MCP review demo** (60s): Open Claude. "What's pending?" Review prospects.
   Approve one. Show the status change in Notion. Draft an outreach message.
5. **Closing** (30s): "Right now Scout finds prospects and qualifies them. Next,
   it'll surface events where those prospects gather and suggest content that
   positions me in front of them. The pipeline grows — Notion stays the cockpit."

#### DEV.to Post

Follow the required template:
- Project description (the pitch + architecture diagram)
- Video walkthrough (embed)
- Code repository link (Scout repo, notion-hackathon branch)
- Explanation of Notion MCP integration (SDK for writes, MCP for review)

---

## What's Out of Scope (for the hackathon)

- Fixing the 5 broken sources (tracked in Priority 3b on main branch)
- Events source / content suggestion features (future roadmap)
- Multi-client profiles
- Contact resolution (Hunter.io)
- Railway/Render deployment
- Google Docs export (Notion pages replace this)

---

## Dependencies

- `@notionhq/client` — Notion SDK for Node.js
- Notion MCP server — for Claude integration
- Existing: `anthropic` SDK, source plugins, scorer

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Notion API rate limits during pipeline | Low | High | Batch writes, add delays between creates |
| MCP server instability during recording | Med | High | Pre-record backup, rehearse 3x first |
| Working sources return 0 during demo | Med | Med | Pre-seed databases with real data |
| Notion SDK breaking change | Low | Med | Pin version in package.json |
| Running out of time | Low | High | Cut list defined, corrections log goes first |
