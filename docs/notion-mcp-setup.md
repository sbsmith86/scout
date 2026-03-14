# Notion MCP Server — Setup & Configuration

## Server Package

**Package:** `@notionhq/notion-mcp-server` (official, by Notion/makenotion)
**Transport:** stdio (default)
**Protocol:** MCP 2024-11-05

## Configuration

File: `/hostechnology/.mcp.json`

```json
{
  "mcpServers": {
    "notionApi": {
      "command": "npx",
      "args": ["-y", "@notionhq/notion-mcp-server"],
      "env": {
        "NOTION_TOKEN": "<your-notion-internal-integration-token>"
      }
    }
  }
}
```

The token is a Notion internal integration token (starts with `ntn_`). Created at https://www.notion.so/profile/integrations.

## Pages Must Be Shared

The integration only has access to pages explicitly shared with it. For each page or database you want Claude to access:
1. Open the page in Notion
2. Click the `•••` menu → "Add connections"
3. Select your integration

Without this step, API calls return "object not found" even with a valid token.

## Verified Operations

All tested 2026-03-14 via the Notion API (v2022-06-28):

| Operation | Endpoint | Result |
|-----------|----------|--------|
| Search databases | `POST /v1/search` with `filter.value=database` | Found 3 databases (Opportunities, Leads, Corrections Log) |
| Query database pages | `POST /v1/databases/{id}/query` | Returns page list (empty on fresh DB) |
| Create page | `POST /v1/pages` with parent database_id + properties | Created test page with title, status, score, source |
| Update page properties | `PATCH /v1/pages/{id}` with properties | Updated Status and Score fields |
| Delete (trash) page | `PATCH /v1/pages/{id}` with `{"in_trash": true}` | Page moved to trash |

## Databases in Workspace

| Database | ID | Key Properties |
|----------|----|----------------|
| Opportunities | `323f0bf4-e2a8-8066-9a01-da53fdf6ec6d` | Name, Title, Status, Score, Source, Confidence, Organization, Deadline, Budget, URL, Description, Surface Reason, Draft Text, Date Surfaced |
| Leads | `323f0bf4-e2a8-8046-90ee-d9a68b00b1af` | Name, Organization, Status, Score, Confidence, Funder, Funding Amount, Funding Date, Mission Summary, Surface Reason, Draft Text, Date Surfaced |
| Corrections Log | `323f0bf4-e2a8-80c3-8f2f-f37e0289dc69` | Name, Title, Item Type, Item ID, Source, Organization, Feedback, Filter Reason, Date |

All databases live under the "Scout Pipeline" parent page (`323f0bf4-e2a8-8059-8b7e-e8e47ac2d05d`).

## Quirks & Notes

1. **npx cache corruption:** The initial MCP server connection failed because the npx cache (`~/.npm/_npx/`) had a corrupted bundle. Fix: delete the cached directory and let npx re-download.

2. **Notion API "delete" is actually "trash":** There's no hard-delete endpoint. Setting `in_trash: true` moves a page to trash. It can be restored from there.

3. **Two MCP options exist:** Notion offers both the npm stdio-based server (used here) and a hosted SSE server at `https://mcp.notion.com/sse` that uses OAuth. The npm package with an internal integration token is simpler for server-side/CLI use.

4. **Rich text fields:** Most text properties in Notion are `rich_text` type, which requires array-of-objects format even for plain strings: `[{"text": {"content": "value"}}]`.

5. **Node version:** Tested on Node v20.19.5 (macOS ARM64). Works after fresh npx install.
