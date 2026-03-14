# Checkpoint: Trust But Verify — Catching Schema Drift Between Copilot and Notion

**Date:** 2026-03-14

**Commit:** `50a7614` — Fix Notion property name mappings and downgrade SDK to v4

**Context:** Hackathon sprint, issues 2/12 and 3/12 (Notion MCP setup + client module)

---

## What Happened

GitHub Copilot had been running through the first batch of hackathon PRs — setting up the Notion storage layer, building read/write modules, even writing a connection test script. Solid work on paper. Merged it all into main.

Then I pulled it down to actually test.

The test script Copilot wrote — `scripts/test-notion-connection.js` — was genuinely well-designed. Five stages: connectivity check, database access verification, write test pages, read them back, clean up. That script is a keeper. I didn't ask for it — Copilot decided to write it on its own. That's worth noting. The instinct to build a verification tool alongside the code it's verifying is exactly the kind of thing you want from an AI collaborator.

But it failed. Every write, every read. Two different problems hiding behind the wall of red.

**Problem 1: Property name mismatch.** The code used snake_case property names (`id`, `org`, `source`, `confidence`) but the actual Notion databases — created manually in an earlier step — used Title Case (`Name`, `Organization`, `Source`, `Confidence`). Copilot wrote the code assuming a schema that didn't exist. It built a technically clean abstraction layer on top of an assumption nobody checked.

**Problem 2: SDK version break.** The `@notionhq/client` package was at v5.12.0, which removed `databases.query()` entirely — moved it to a new `dataSources` abstraction that's incompatible with the database setup. Copilot picked the latest version without realizing v5 was a breaking change for the query pattern it was using.

Both problems were invisible until someone ran the test against the real Notion workspace.

---

## What I Did

Pulled in Claude Code to diagnose and fix. The process:

1. Ran the test script, read the errors
2. Verified the Notion API token worked via direct curl calls (it did — the API layer was fine, the code was wrong)
3. Mapped the actual Notion database schemas — property names and types — against what the code expected
4. Downgraded the SDK from v5 to v4 to restore `databases.query()`
5. Rewrote property mappings in `write.js`, `read.js`, and the test script to match the real Notion schemas
6. Fixed select option values (`Pending` not `pending`, `High` not `high`)
7. Ran the test script again — all 12 checks green

---

## What Worked

- **Copilot's test script design was excellent.** Five-stage verification with cleanup — better test discipline than I might have written myself. The script caught the problem. That's the whole point.
- **Claude Code's diagnostic flow was fast.** Direct API calls to confirm the token worked, then SDK inspection to find the missing `databases.query`, then schema comparison. Went from "everything is broken" to "here are exactly two problems" in minutes.
- **The fix was clean.** Six files changed, net negative lines. The code got simpler, not more complex.

## What Didn't Work

- **Copilot built against an imagined schema.** It wrote a complete, internally consistent module — but it never verified the actual Notion database structure. The snake_case names were plausible but wrong. This is the classic AI coding failure mode: confident, coherent, incorrect.
- **Nobody caught the SDK version issue upstream.** v5 was a breaking change and Copilot defaulted to latest. In a human team, a senior would have pinned the version or caught it in review. With AI agents, version pinning needs to be explicit in the instructions.

## What I'm Learning

The multi-agent workflow — Copilot for the initial build, Claude Code for verification and fixes — is starting to feel like a real process. Copilot is fast at scaffolding and surprisingly good at test design. But it builds in a vacuum. It doesn't check its assumptions against the real world.

The real skill right now is diligence and discipline. Testing at intervals for correctness. Not letting PRs stack up unchecked. Not assuming that "it looks right" means it works. The AI tools are fast — fast enough to outrun your ability to verify if you let them. The value I'm adding isn't code. It's the discipline to stop, pull, run, and confirm before the next thing gets built on top of the last thing.

This would have compounded into a much worse problem if I'd kept merging PRs on top of a broken storage layer. The test script Copilot wrote is what made this fixable in 20 minutes instead of an hour of debugging. The irony is that the AI wrote the tool that caught the AI's mistake — but someone still had to run it.

---

## Process Scorecard

How well did the workflow hold up on this cycle?

| Step | Verdict | Note |
|------|---------|------|
| Delegation (Copilot PRs) | Worked | Clear issue specs produced usable code fast |
| Handoff (merge to main) | Gap | Merged without testing — schema mismatch went unnoticed |
| Verification (pull + test) | Caught it | Running the test script surfaced both problems immediately |
| Diagnosis (Claude Code) | Clean | Root cause identified in minutes, not hours |
| Fix + re-test | Solid | Six files, net negative lines, all checks green |
| **Process gap to close** | | **Add a "run tests against real infra" step before merging AI-generated PRs** |
