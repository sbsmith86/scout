# Scout

Scout is a private internal business development tool for **HosTechnology**. It runs on a weekly schedule and does three things:

1. **Contract Finder** — scrapes and queries sources (Idealist.org, SAM.gov, Catchafire) for active RFPs and consulting contracts.
2. **Funding Monitor** — watches foundation RSS feeds and impact-investing announcements for newly-funded nonprofits and flags them as warm outreach targets.
3. **Draft + Review** — scores every result against the HosTechnology profile, drafts a proposal or outreach message for passing items, then surfaces everything in a web dashboard for human approval before anything is sent.

Nothing is ever submitted or sent automatically. The human is always in the loop.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Local Setup](#local-setup)
- [Configuration](#configuration)
  - [Profile](#profile)
  - [Environment variables](#environment-variables)
  - [Google Cloud service account](#google-cloud-service-account)
  - [Google Sheets](#google-sheets)
- [Running Scout locally](#running-scout-locally)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Architecture overview](#architecture-overview)

---

## Prerequisites

| Requirement | Minimum version | Notes |
|---|---|---|
| Node.js | 20.x | Check with `node --version` |
| npm | 10.x (ships with Node 20) | |
| Playwright browser | Chromium | Installed separately after `npm install` |
| Google Cloud project | — | Sheets API + Docs API enabled |
| Anthropic API key | — | Claude Sonnet access required |

---

## Local Setup

```bash
# 1. Clone the repo
git clone https://github.com/sbsmith86/scout.git
cd scout

# 2. Install Node dependencies
npm install

# 3. Install the Playwright browser (Chromium — used by the Idealist source plugin)
npx playwright install chromium

# 4. Copy the env template and fill it in
cp .env.example .env

# 5. Copy the profile template and fill it in
cp config/profile.example.json config/profile.json

# 6. Copy the service account key template and fill it in
#    (or use the GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY env vars instead)
cp config/google-service-account.example.json config/google-service-account.json
```

---

## Configuration

### Profile

`config/profile.json` is the single most important file in the project. It tells the scorer and drafter who HosTechnology is, what work to pursue, and what to decline. **The system produces vague results if the profile is vague.**

Copy `config/profile.example.json` to `config/profile.json` and fill in every field:

| Field | Description |
|---|---|
| `focus_areas` | Specific automation and workflow capabilities — be concrete |
| `target_sectors` | Sectors you want to work in |
| `excluded_sectors` | Hard disqualifiers — items in these sectors are auto-filtered |
| `technical_skills` | Skills with proficiency: `expert`, `strong`, or `familiar` |
| `platforms` | Tools you work with (Airtable, Slack, Make, Zapier, etc.) |
| `past_work` | Prior engagements with measurable outcomes; set `"nda": true` if covered by NDA and provide a `public_description` |
| `rate_range` | Min/max hourly or project rate |
| `min_project_days` | Minimum engagement length in days |
| `capacity` | `available`, `limited`, or `closed` — update before each run |

The real `config/profile.json` is gitignored — it may contain NDA-protected client details in the `past_work` entries. Never commit it.

### Environment variables

Copy `.env.example` to `.env` and set the values:

```
# Required
ANTHROPIC_API_KEY=        # Claude API key (Sonnet access needed)
GOOGLE_SHEETS_ID=         # Spreadsheet ID from the Sheet URL

# Google auth — choose ONE option:
# Option 1 (local dev — key file)
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=config/google-service-account.json

# Option 2 (Codespaces / CI — individual env vars)
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=

# Resend (notification emails)
RESEND_API_KEY=
RESEND_FROM_EMAIL=        # Must be a domain verified in your Resend account
NOTIFICATION_EMAIL=       # Where to send run summaries

# Optional
DASHBOARD_URL=            # Public URL of the dashboard (defaults to http://localhost:3000)
HUNTER_API_KEY=           # Hunter.io for contact enrichment (free tier: 25/mo)
PORT=3000                 # Dashboard port (defaults to 3000)
```

The real `.env` is gitignored. Never commit it.

### Google Cloud service account

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project (or use an existing one).
2. Enable the **Google Sheets API** and **Google Docs API** for the project.
3. Create a **service account** under *IAM & Admin → Service Accounts*.
4. Download the JSON key for that service account.
5. Copy the downloaded key to `config/google-service-account.json` (gitignored).

`config/google-service-account.example.json` shows the expected shape of the file.

### Google Sheets

1. Create a new Google Spreadsheet.
2. Share it with the service account's `client_email` (Editor access).
3. Copy the spreadsheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit
   ```
4. Paste the ID into `GOOGLE_SHEETS_ID` in `.env`.
5. Create three tabs (exact names required):
   - `Opportunities`
   - `Leads`
   - `Corrections Log`

Header rows are written automatically the first time Scout runs or when you run the Sheets connection test (see [Testing](#testing)).

---

## Running Scout locally

Install the package globally from the repo root to use the `scout` CLI:

```bash
npm install -g .
```

Or run it with `node`:

```bash
node src/index.js <command>
```

### Commands

| Command | What it does |
|---|---|
| `scout run` | Full pipeline: fetch → score → write to Sheets → send notification email |
| `scout fetch` | Fetch-only: pulls from all sources and prints results; no scoring, no Sheets write |
| `scout dashboard` | Starts the review dashboard on `http://localhost:3000` (or `$PORT`) |

### npm scripts

```bash
npm start              # Equivalent to scout (shows usage)
npm run start:dashboard  # Starts the dashboard
npm run lint           # ESLint — src/**/*.js
```

---

## Testing

### Google Sheets connection test

Verifies credentials, spreadsheet access, and read/write on all three sheets. Writes a test row to each sheet, reads it back, then deletes it.

```bash
node scripts/test-sheets-connection.js
```

Expected output when everything is configured correctly:

```
── Scout × Google Sheets connection test ──

1. Checking credentials…
  ✓ getSheetsClient() returned a client
  ✓ getSpreadsheetId() → 1aBcD...

2. Verifying spreadsheet access…
  ✓ Spreadsheet reachable: "Scout"
  ✓ Tabs found: Opportunities, Leads, Corrections Log
  ...

Connection test PASSED — all sheets readable and writable.
```

### Scoring test

Runs mock opportunities and leads through the disqualifier and optionally the Claude scorer. Use this to validate signal quality and profile tuning before a real run.

```bash
# Disqualifier only — fast, no API calls
node scripts/test-scoring.js

# Full scoring — requires ANTHROPIC_API_KEY in .env
node scripts/test-scoring.js --full

# Run a single fixture by index
node scripts/test-scoring.js --id 3
```

### Source plugin tests

Run a source plugin in isolation to check scraping and normalization without triggering the full pipeline:

```bash
# Idealist source plugin (requires Playwright / Chromium)
node scripts/test-idealist-plugin.js

# Foundation RSS source plugin
node scripts/test-foundation-rss-plugin.js
```

### Linter

```bash
npm run lint
```

---

## Project structure

```
scout/
├── config/
│   ├── profile.example.json          # Profile template — copy to profile.json
│   ├── profile.json                  # Gitignored — your real profile goes here
│   ├── google-service-account.example.json
│   └── google-service-account.json   # Gitignored — your real key goes here
├── scripts/
│   ├── test-sheets-connection.js     # Sheets integration test
│   ├── test-scoring.js               # Scoring / disqualifier test harness
│   ├── test-idealist-plugin.js       # Idealist source plugin smoke test
│   └── test-foundation-rss-plugin.js # Foundation RSS source plugin smoke test
├── src/
│   ├── index.js                      # CLI entry point (scout run / fetch / dashboard)
│   ├── pipeline.js                   # Main orchestrator: fetch → score → write
│   ├── contacts/                     # Contact resolution (Hunter.io + web scraping)
│   ├── dashboard/                    # Express server + HTML template
│   ├── drafting/                     # Proposal and outreach draft generation
│   ├── notifications/                # Resend email notifications
│   ├── scoring/                      # Disqualifier + Claude scorer
│   ├── sheets/                       # Google Sheets read/write client
│   └── sources/
│       ├── index.js                  # Re-exports all source plugins
│       ├── idealist.js               # Contract Finder — Idealist.org (Playwright + Cheerio)
│       └── foundation-rss.js         # Funding Monitor — Foundation RSS feeds
├── .env.example                      # Environment variable template
├── .eslintrc.json
├── package.json
└── README.md
```

---

## Architecture overview

### Two-agent pipeline

```
scout run
  │
  ├── Contract Finder sources (type: 'contract')
  │     └── Idealist.org  (Playwright + Cheerio)
  │
  └── Funding Monitor sources (type: 'lead')
        └── Foundation RSS feeds  (rss-parser + Claude org extraction)
  │
  ▼
Deduplicate (by URL → org+title fallback)
  │
  ▼
Disqualifier  ──── fail ────► Corrections Log (Sheets) ──► Dashboard filtered section
  │
  pass
  │
  ▼
Claude scorer (relevance / fit / feasibility / quality — each 1–5, pass threshold: 12+)
  │
  ├── pass ──► Contact resolution → Application process discovery → Draft generation
  │                └─► Opportunities / Leads sheet (Sheets)
  │
  └── fail ──► Corrections Log (Sheets) ──► Dashboard filtered section
  │
  ▼
Resend notification email  (run summary + dashboard link)
```

### Source plugin contract

Every source exports `{ id, name, type, fetch }`. The `fetch(profile)` function returns an array of normalized opportunity objects — the rest of the pipeline never knows which source produced an item.

```javascript
{
  id: 'idealist',
  name: 'Idealist.org',
  type: 'scrape',
  fetch: async (profile) => [
    {
      id: string,
      source: string,
      title: string,
      org: string,
      url: string,
      deadline: string | null,  // ISO date
      budget: string | null,
      description: string,
      type: 'contract' | 'lead'
    }
  ]
}
```

To add a new source, create `src/sources/<name>.js` and re-export it from `src/sources/index.js`. Nothing else changes.

### Dashboard

The review dashboard is a single-page Express app served at `http://localhost:3000`. It reads live from Google Sheets and provides:

- **Opportunities tab** — pending Contract Finder items with approve / skip / edit controls
- **Leads tab** — pending Funding Monitor items
- **Filtered section** — items that didn't pass scoring, with thumbs-up / thumbs-down feedback buttons that write to the Corrections Log

Approving an item exports the draft to Google Docs and marks the row `approved` in Sheets.
