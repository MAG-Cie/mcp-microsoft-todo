# mcp-microsoft-todo

> 🇫🇷 Version française : [README.fr.md](README.fr.md)

MCP server to drive **Microsoft To Do** from Claude Code, Claude Desktop, or any MCP-compatible client.

Works with **any Microsoft account**: personal (outlook.com, hotmail.com, live.com), Office 365 personal or business, Microsoft 365. **Zero Azure setup** required on the user side — just sign in via device code flow.

[![npm](https://img.shields.io/npm/v/@mag-cie/mcp-microsoft-todo.svg)](https://www.npmjs.com/package/@mag-cie/mcp-microsoft-todo)
[![license](https://img.shields.io/npm/l/@mag-cie/mcp-microsoft-todo.svg)](LICENSE)

---

## 🚀 End-user installation

### Prerequisites (all clients)

- **Node.js 20+** ([nodejs.org](https://nodejs.org))
- A Microsoft account (free or paid)

No Azure account required, no App Registration to create, nothing to compile.

---

### 🟦 Claude Code (CLI)

**Install (one command):**

```bash
claude mcp add --transport stdio microsoft-todo -- npx -y @mag-cie/mcp-microsoft-todo
```

If you have a **personal Microsoft account** (outlook.com, hotmail.com, live.com, msn.com, Office 365 personal), add `MS_TENANT=consumers`:

```bash
claude mcp add --transport stdio microsoft-todo --env MS_TENANT=consumers -- npx -y @mag-cie/mcp-microsoft-todo
```

**Verify it's wired up:**

```bash
claude mcp list
```

**First use — recommended: pre-auth in a terminal first** to avoid the "stuck on first MCP call" issue (where the device code is printed to MCP stderr but Claude Code doesn't surface it):

```bash
# macOS / Linux
MS_TENANT=consumers npx -y @mag-cie/mcp-microsoft-todo@latest --auth
```

```powershell
# Windows PowerShell
$env:MS_TENANT="consumers"; npx -y @mag-cie/mcp-microsoft-todo@latest --auth
```

You'll see:
```
To sign in, use a web browser to open the page https://www.microsoft.com/link and enter the code XXXXXXXXX
```

Visit the URL, enter the code, sign in. The token is cached in `~/.mcp-microsoft-todo/token-cache.json` and refreshed automatically — you'll never have to do this again. Now go to Claude Code and any prompt that calls a tool will work instantly.

> Skip the pre-auth step if you're feeling lucky — the MCP will trigger the device code flow on first call too. The code goes to the Claude Code MCP log file (look in `%USERPROFILE%\.claude\logs\` on Windows or `~/.claude/logs/` elsewhere).

**Update to the latest version:**

```bash
claude mcp remove microsoft-todo
claude mcp add --transport stdio microsoft-todo -- npx -y @mag-cie/mcp-microsoft-todo@latest
```

The `-y` flag of npx auto-accepts the download. Without `@latest`, npx may serve a stale cached version.

**Uninstall:**

```bash
claude mcp remove microsoft-todo
# Purge the token cache:
rm -rf ~/.mcp-microsoft-todo
```

---

### 🟪 Claude Desktop (app)

**1. Locate the config file:**

| OS | Path |
|---|---|
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Linux** | `~/.config/Claude/claude_desktop_config.json` |

On Windows, you can open it directly with:
```powershell
notepad $env:APPDATA\Claude\claude_desktop_config.json
```

If the file doesn't exist, create it with an empty JSON object `{}` then edit.

**2. Add the config:**

```json
{
  "mcpServers": {
    "microsoft-todo": {
      "command": "npx",
      "args": ["-y", "@mag-cie/mcp-microsoft-todo"]
    }
  }
}
```

For a personal Microsoft account, add `env`:

```json
{
  "mcpServers": {
    "microsoft-todo": {
      "command": "npx",
      "args": ["-y", "@mag-cie/mcp-microsoft-todo"],
      "env": { "MS_TENANT": "consumers" }
    }
  }
}
```

To localize the compact-format strings (optional, see [Localization](#-localization)):

```json
{
  "env": { "MS_TENANT": "consumers", "MCP_LOCALE": "fr" }
}
```

**3. Restart Claude Desktop COMPLETELY** (not just close the window):
- **Windows**: right-click systray icon → Quit, then relaunch
- **macOS**: ⌘+Q then relaunch

**4. Verify it's wired up:**

In Claude Desktop, look at the **🔌 plug** or **🔧 tools** icon at the bottom right of the input area — you should see `microsoft-todo` listed.

**5. First auth — recommended pre-auth in a terminal:**

```bash
# macOS / Linux
MS_TENANT=consumers npx -y @mag-cie/mcp-microsoft-todo@latest --auth
```

```powershell
# Windows PowerShell
$env:MS_TENANT="consumers"; npx -y @mag-cie/mcp-microsoft-todo@latest --auth
```

You'll see the device code immediately in the terminal. Visit the URL, enter the code, sign in. Token cached. Now Claude Desktop will reuse this cache — no need to fish in the logs.

Without `--auth`, the device code goes to the Claude Desktop MCP log file:
- **Windows**: `%APPDATA%\Claude\logs\mcp-server-microsoft-todo.log`
- **macOS**: `~/Library/Logs/Claude/mcp-server-microsoft-todo.log`

**Update:** edit the version in args (`@mag-cie/mcp-microsoft-todo@latest`), restart Claude Desktop. Or let npx do its thing (npx cache ~24h).

---

### 🟧 Cursor / Continue / other stdio MCP clients

Any MCP client that supports the **stdio** transport works the same way. Generic format:

```
command: npx
args: -y @mag-cie/mcp-microsoft-todo
env: MS_TENANT=consumers (if personal account)
```

Adapt to the client's config format (often JSON or TOML similar to Claude Desktop).

---

## 💡 Example prompts

Once installed, just ask Claude in natural language. Sample prompts that exercise the main tools:

| Prompt | Tool(s) |
|---|---|
| *"Show me all my To Do lists"* | `list_task_lists` |
| *"What do I have to do today?"* | `summarize_today` |
| *"Show me my overdue tasks"* | `list_overdue_tasks` |
| *"List tasks tagged 'work'"* | `list_tasks_by_category` |
| *"Find any task containing 'invoice'"* | `search_tasks` |
| *"Add a daily recurring 'Workout' task"* | `create_task` (with recurrence) |
| *"Mark these 5 tasks as done"* | `batch_complete_tasks` |
| *"Move 'Buy bread' from Personal to Shopping"* | `move_task` |
| *"Add a 'recipe' subtask to the cake task"* | `create_checklist_item` |
| *"Tag all my Magaria tasks as 'urgent'"* | `bulk_update_categories` |
| *"Export my work tasks as iCalendar"* | `export_tasks_ics` |
| *"Attach a project_id metadata to this task"* | `set_extension` |

---

## 🆘 Auth troubleshooting

| Symptom | Solution |
|---|---|
| "This page isn't right" page after sign-in | Add `MS_TENANT=consumers` (personal accounts only) |
| Browser opens with the wrong Microsoft account | Use an **InPrivate/Incognito** window for the sign-in |
| `invalid_scope` or `Tasks.ReadWrite.Shared` error | Purge the token cache and re-auth: `rm -rf ~/.mcp-microsoft-todo` |
| `Node.js not found` or `npx not found` | Install Node 20+ from [nodejs.org](https://nodejs.org). On Windows, verify it's in PATH (relaunch your terminal after install) |
| Token expired, refresh fails | Purge the cache and re-auth |
| Device code never appears | Verify the server is spawning — Claude Code: `claude mcp list`; Claude Desktop: tools icon at the bottom. If absent, check the `npx` PATH in the config |
| `MS_CLIENT_ID not configured` | You're using a dev fork — export `MS_CLIENT_ID` or use the official npm version |

---

## 🛠 Available tools (28)

Safety column legend: `read` = read-only, `write` = mutates state (non-idempotent create), `update` = idempotent mutation (safe to retry), `delete` = destructive (data loss). See [Safety annotations](#-safety-annotations) below for details.

### Lists & tasks
| Tool | Safety | Description |
|---|---|---|
| `list_task_lists` | read | All your To Do lists |
| `list_tasks` | read | Tasks of a list (OData filter, `$orderby`, `paginate`) |
| `get_task` | read | Detail of a task by ID |
| `create_task` | write | Create a task (title, body, importance, due date, categories, **recurrence, reminder**) |
| `update_task` | update | Update title, status, due date, recurrence, reminder… |
| `complete_task` | update | Mark as completed |
| `delete_task` | delete | Delete permanently |
| `move_task` | delete | Move a task from one list to another (source task is deleted) |
| `search_tasks` | read | Cross-list search by title |
| `summarize_today` | read | Summary of tasks due today + overdue |
| `list_all_tasks` | read | Every task across every list in one round-trip (uses Graph `$batch`) |

### Batch operations (saves API calls)
| Tool | Safety | Description |
|---|---|---|
| `batch_create_tasks` | write | Create up to 100 tasks in a single Graph `$batch` HTTP call |
| `batch_complete_tasks` | update | Mark up to 100 tasks as completed in one call |
| `batch_delete_tasks` | delete | Delete up to 100 tasks in one call |

### Sub-tasks (checklist items)
| Tool | Safety | Description |
|---|---|---|
| `list_checklist_items` | read | Sub-items of a task |
| `create_checklist_item` | write | Add a sub-item |
| `update_checklist_item` | update | Rename / check / uncheck |
| `delete_checklist_item` | delete | Delete a sub-item |

### Linked resources (external URLs attached to a task)
| Tool | Safety | Description |
|---|---|---|
| `list_linked_resources` | read | List the linked resources of a task |
| `create_linked_resource` | write | Attach a URL or external reference |
| `delete_linked_resource` | delete | Delete a linked resource |

### Open extensions (custom JSON metadata)
| Tool | Safety | Description |
|---|---|---|
| `list_extensions` | read | List the open extensions of a task |
| `set_extension` | update | Upsert: create or update an extension (project_id, external_ref, etc.) |
| `delete_extension` | delete | Delete an extension |

### Cross-list helpers
| Tool | Safety | Description |
|---|---|---|
| `list_overdue_tasks` | read | All overdue tasks, aggregated across all lists |
| `list_tasks_by_category` | read | All tasks with a given category, cross-lists |
| `bulk_update_categories` | update | Add/remove categories on many tasks in 2 batch phases |

### Export
| Tool | Safety | Description |
|---|---|---|
| `export_tasks_ics` | read | iCalendar export (VTODO + RRULE + VALARM) for import into Google Cal / Apple Cal / Outlook / Thunderbird |

### Output format

By default, tools return a **compact text format** (one line per item) to save LLM tokens. Legend:
- `[!]` high importance, `[?]` low (nothing if normal)
- `[v]` completed, `[>]` in progress, `[w]` waiting, `[d]` deferred (nothing if not started)
- `due:`, `rem:`, `rec:`, `cat:`, `body:` fields shown only when populated

To get the **full Graph JSON**, pass `verbose: true` to any read tool.

---

## 🔐 Safety annotations

Every tool exposed by this server carries the [MCP tool annotations](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-annotations) defined by the Model Context Protocol spec (2025-06-18):

| Annotation | Meaning |
|---|---|
| `readOnlyHint` | The tool only fetches data; running it has no side effects on Microsoft Graph |
| `destructiveHint` | The tool deletes data or otherwise causes data loss that cannot be undone |
| `idempotentHint` | Running the tool repeatedly with the same arguments yields the same end state (safe to retry) |
| `openWorldHint` | The tool talks to an external system (Microsoft Graph) — always `true` here |
| `title` | Human-readable display name for MCP clients |

These hints are **advisory** — the server itself enforces nothing — but MCP clients (Claude Code, Claude Desktop, Cursor, …) can use them to:

- Auto-approve `readOnlyHint: true` calls without prompting (faster UX for read-heavy workflows)
- Show a confirmation dialog before `destructiveHint: true` calls (e.g. `delete_task`, `batch_delete_tasks`, `move_task`)
- Retry on transient failures only when `idempotentHint: true`
- Display the friendly `title` instead of the snake_case `name`

The full mapping is in [`src/index.ts`](src/index.ts) (`ANNOTATIONS` constant). Summary by safety class (see also the per-tool **Safety** column above):

- **read** (15 tools): all `list_*`, `get_*`, `search_*`, `summarize_*`, `export_*` — `readOnlyHint: true`
- **write** (4 tools): `create_*`, `batch_create_tasks` — `destructiveHint: false, idempotentHint: false`
- **update** (5 tools): `update_*`, `complete_*`, `set_extension`, `bulk_update_categories`, `batch_complete_tasks` — `destructiveHint: false, idempotentHint: true`
- **delete** (5 tools): `delete_*`, `batch_delete_tasks`, `move_task` — `destructiveHint: true, idempotentHint: true`

`move_task` is classified as `delete` because it deletes the source task (a new task is created in the target list with a different id).

---

## 🌍 Localization

The MCP works in **any language out of the box** — Claude reads the data the server returns and replies to the user in whatever language they prompted in. Try `"List my tasks"`, `"Liste mes tâches"`, `"Zeig meine Aufgaben"`, `"我的任务"` — all work.

Optionally, you can localize the compact-format short labels returned by the server itself (`No tasks.`, `Due today:`, `Overdue:`, `Task X deleted.`, etc.) — this is a marginal improvement (saves a few tokens, slightly cleaner LLM context). Set `MCP_LOCALE` in your env:

| Locale | Code |
|---|---|
| English (default) | `en` |
| Français | `fr` |
| Español | `es` |
| Deutsch | `de` |

Resolution order: `MCP_LOCALE` → `LC_ALL` → `LANG` → fallback `en`. Only the first 2 chars are inspected (so `fr_FR.UTF-8` works). Unsupported locale → falls back to `en`.

```json
{
  "mcpServers": {
    "microsoft-todo": {
      "command": "npx",
      "args": ["-y", "@mag-cie/mcp-microsoft-todo"],
      "env": { "MCP_LOCALE": "fr" }
    }
  }
}
```

---

## 🔒 Security & privacy

- The Microsoft token is stored **only on your machine** in `~/.mcp-microsoft-todo/token-cache.json`
- No data transits through MAG&Cie servers
- Revoke access at any time at https://account.live.com/consent/Manage
- To purge the local token: `rm -rf ~/.mcp-microsoft-todo`

Graph permissions requested: `Tasks.ReadWrite`, `Tasks.ReadWrite.Shared`, `offline_access`.

---

## 🧑‍💻 Developer setup (fork / contribution)

If you fork or want to develop locally with your own Azure AD App Registration:

### 1. Azure AD App Registration (maintainer/fork side only)

1. https://portal.azure.com → **Microsoft Entra ID** → **App registrations** → **New registration**
2. Name: `mcp-microsoft-todo` (free choice)
3. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
4. Redirect URI: leave empty
5. Register
6. Note the **Application (client) ID**
7. **Authentication** tab → **Allow public client flows**: **Yes**
8. **Authentication** tab → **Add a platform** → **Mobile and desktop applications** → check `https://login.microsoftonline.com/common/oauth2/nativeclient`
9. **API permissions** tab → **Add a permission** → **Microsoft Graph** → **Delegated** → add `Tasks.ReadWrite`, `Tasks.ReadWrite.Shared`, and `offline_access`. **Grant admin consent** if on a corporate tenant.

### 2. Build and local auth

```bash
git clone https://github.com/MAG-Cie/mcp-microsoft-todo
cd mcp-microsoft-todo
npm install
npm run build
export MS_CLIENT_ID="<your-client-id>"   # PowerShell: $env:MS_CLIENT_ID="..."
export MS_TENANT="common"
npm run auth
```

The token cache will be written to `~/.mcp-microsoft-todo/token-cache.json`.

### 3. Wire up Claude Code (local build)

```powershell
# Windows PowerShell
$env:MS_CLIENT_ID="<your-client-id>"
claude mcp add --transport stdio microsoft-todo -- node "C:\path\to\mcp-microsoft-todo\dist\index.js"
```

```bash
# macOS / Linux
export MS_CLIENT_ID="<your-client-id>"
claude mcp add --transport stdio microsoft-todo -- node /path/to/mcp-microsoft-todo/dist/index.js
```

> ⚠️ Env vars must be visible at spawn time. On Windows with fnm, verify the PowerShell session that launches `claude` has `MS_CLIENT_ID` exported.

### 4. Run tests

```bash
npm test           # one-shot
npm run test:watch # watch mode
```

---

## ⬆️ Upgrading from earlier versions

| From | To | Action required |
|---|---|---|
| `0.x` | `0.4.0+` | Re-auth required: token cache lacks the new `Tasks.ReadWrite.Shared` scope. Run `rm -rf ~/.mcp-microsoft-todo` then trigger any tool to re-auth via device code. |
| `0.x` | `0.5.0+` | No breaking change — new tools added. Token compatible. |
| any | `1.0.0+` | Stable API marker. Future minor versions guarantee no breaking change to tool names, args, or return formats (compact + verbose). |

---

## 🗺 Roadmap

- [x] v0.1 — stdio + 6 CRUD tools
- [x] v0.2 — distributable npm package, baked-in client ID
- [x] v0.3 — recurrence + reminders + checklists + linkedResources + search + move + summarize_today + retry/error robustness + vitest tests + compact format (verbose opt-in)
- [x] v0.4 — auto pagination + `$batch` operations + `Tasks.ReadWrite.Shared` scope (read shared lists)
- [x] v0.5 — open extensions + cross-list helpers (overdue, by category, bulk update) + iCalendar export
- [x] v1.0 — stable milestone: GitHub Actions CI + extended tests + snapshot tests + README polish

Possible future versions:
- v1.1 — file attachments (Graph beta)
- v1.2 — auto-pagination follow-on for `summarize_today` / `search_tasks` / `list_overdue_tasks`
- v2.0 — remote HTTP/SSE transport for Claude.ai custom connectors (multi-user OAuth)

---

## 📄 License

[MIT](LICENSE) — © MAG&Cie
