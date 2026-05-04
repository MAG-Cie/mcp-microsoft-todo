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

## 🛠 Available tools (24)

### Lists & tasks
| Tool | Description |
|---|---|
| `list_task_lists` | All your To Do lists |
| `list_tasks` | Tasks of a list (OData filter, `$orderby`, `paginate`) |
| `get_task` | Detail of a task by ID |
| `create_task` | Create a task (title, body, importance, due date, categories, **recurrence, reminder**) |
| `update_task` | Update title, status, due date, recurrence, reminder… |
| `complete_task` | Mark as completed |
| `delete_task` | Delete permanently |
| `move_task` | Move a task from one list to another |
| `search_tasks` | Cross-list search by title |
| `summarize_today` | Summary of tasks due today + overdue |

### Batch operations (saves API calls)
| Tool | Description |
|---|---|
| `batch_create_tasks` | Create up to 100 tasks in a single Graph `$batch` HTTP call |
| `batch_complete_tasks` | Mark up to 100 tasks as completed in one call |
| `batch_delete_tasks` | Delete up to 100 tasks in one call |

### Sub-tasks (checklist items)
| Tool | Description |
|---|---|
| `list_checklist_items` | Sub-items of a task |
| `create_checklist_item` | Add a sub-item |
| `update_checklist_item` | Rename / check / uncheck |
| `delete_checklist_item` | Delete a sub-item |

### Linked resources (external URLs attached to a task)
| Tool | Description |
|---|---|
| `list_linked_resources` | List the linked resources of a task |
| `create_linked_resource` | Attach a URL or external reference |
| `delete_linked_resource` | Delete a linked resource |

### Open extensions (custom JSON metadata)
| Tool | Description |
|---|---|
| `list_extensions` | List the open extensions of a task |
| `set_extension` | Upsert: create or update an extension (project_id, external_ref, etc.) |
| `delete_extension` | Delete an extension |

### Cross-list helpers
| Tool | Description |
|---|---|
| `list_overdue_tasks` | All overdue tasks, aggregated across all lists |
| `list_tasks_by_category` | All tasks with a given category, cross-lists |
| `bulk_update_categories` | Add/remove categories on many tasks in 2 batch phases |

### Export
| Tool | Description |
|---|---|
| `export_tasks_ics` | iCalendar export (VTODO + RRULE + VALARM) for import into Google Cal / Apple Cal / Outlook / Thunderbird |

### Output format

By default, tools return a **compact text format** (one line per item) to save LLM tokens. Legend:
- `[!]` high importance, `[?]` low (nothing if normal)
- `[v]` completed, `[>]` in progress, `[w]` waiting, `[d]` deferred (nothing if not started)
- `due:`, `rem:`, `rec:`, `cat:`, `body:` fields shown only when populated

To get the **full Graph JSON**, pass `verbose: true` to any read tool.

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
