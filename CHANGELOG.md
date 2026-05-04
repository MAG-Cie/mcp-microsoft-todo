# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.5] - 2026-05-04

### Fixed
- **Sub-response throttling silently leaked through `$batch`** — Microsoft Graph's `$batch` endpoint returns HTTP 200 even when individual sub-requests are throttled (status 429 inside the response body). The outer `graphFetch` retry only sees the 200 wrapper and never re-issues the throttled sub-requests, so callers like `list_all_tasks`, `summarize_today`, `search_tasks`, `list_overdue_tasks`, `list_tasks_by_category`, `bulk_update_categories`, and the `batch_*` mutators surfaced `activityLimitReached` errors per-list instead of completing the work.
- `graphBatch()` now retries throttled sub-responses (status 429 or 5xx) individually via `graphFetch`, which honors `Retry-After` and applies bounded exponential backoff. If retries are exhausted, the sub-response is replaced with a recognizable `throttled` error body so the caller still gets a coherent per-item result.

### Notes
- End-to-end smoke test against real Graph after deliberately triggering throttling: `list_all_tasks` returned 80 tasks across 8 lists with **0 errors** (vs 4/8 lists previously failing with `activityLimitReached`).
- 50/50 unit tests pass, including a new test covering the per-sub-response retry path.

## [1.1.4] - 2026-05-04

### Added
- **`list_all_tasks` MCP tool** — fetches every active task across every list in a single MCP round-trip. Internally uses Graph `$batch` (1 HTTP call) when there are >5 lists, parallel direct fetches otherwise. Replaces the previous N×(`list_task_lists` + `list_tasks`) pattern that the LLM had to orchestrate, cutting the total round-trip count from ~8 to 1 for the typical "what are all my tasks?" query.
- Optional args: `filter` (extra OData clause, AND-merged with the default `status ne 'completed'`), `top_per_list` (default 50), `include_completed` (default false), `verbose`.
- Output (compact): `{N} task(s) across {M} list(s):` followed by one block per non-empty list. Per-list errors (e.g. throttling on a single list) are surfaced inline without aborting the whole call.
- New i18n key `allTasksHeader` in en/fr/es/de bundles.
- Exported `listAllTasks()` and `ListWithTasks` interface from `src/graph.ts`.
- Exported `formatAllTasksCompact()` from `src/formatters.ts`.

### Notes
- Local smoke test: ~12s end-to-end for 8 lists with ~80 tasks total (vs ~50s observed for the LLM-orchestrated 8-call sequence).
- Tool count: 27 → 28.

## [1.1.3] - 2026-05-04

### Fixed
- **Critical: Microsoft Graph 400 (`RequestBroker--ParseUri`) on personal accounts (consumers tenant)** — Graph rejects `$select` on `/me/todo/lists`, `/me/todo/lists/{id}/tasks`, and `/me/todo/lists/{id}/tasks/{id}` for personal Microsoft accounts. Every list/task fetch was failing with HTTP 400 since v0.3.0 when `$select` was first introduced. v1.1.2 partially fixed the URL prefix (`%24` → `$`) but the `$select` parameter itself still triggered the broker error.
- Removed `$select` from `listTaskLists`, `listTasks`, `getTask`, `fetchTasksAcrossLists` ($batch path), and `bulkUpdateCategories` (GET phase). `$select` is **kept** on `checklistItems` and `linkedResources` endpoints where Graph accepts it.
- Added `encodeODataValue()` helper that preserves OData-required literal characters (`,` `/` `(` `)` `'` `:`) in `$filter` and `$orderby` values, while still percent-encoding everything else (notably spaces, `&`, `=`).

### Notes
- Trade-off: payload per task is slightly larger (no field projection), but the To Do task schema is bounded and well within reasonable token budget. Compact-format output (default) keeps the LLM context lean.
- This issue affected **all** users on personal Microsoft accounts (the most common case for this MCP). Work/school accounts (Entra ID tenants) likely also hit the same restriction; the fix applies universally.
- Diagnosed via direct Graph probe: `GET /me/todo/lists` works, `GET /me/todo/lists?$select=id,displayName` returns `RequestBroker--ParseUri` 400. Same for tasks endpoints.
- 49/49 tests pass. End-to-end smoke test against real Graph confirms `list_task_lists` returns 8 lists and `summarize_today` returns the daily summary.

## [1.1.2] - 2026-05-04

### Fixed
- **Critical: Microsoft Graph 400 on `list_tasks` and cross-list helpers** — the OData query string was built with `URLSearchParams`, which percent-encodes the `$` prefix as `%24`. While the OData spec allows this, recent Microsoft Graph behavior rejects `%24filter`, `%24top`, `%24orderby`, `%24select` with HTTP 400 on the `/me/todo/lists/{id}/tasks` endpoint.
- Replaced `URLSearchParams` with a manual `buildOData()` helper that emits literal `$` prefix (and uses `encodeURIComponent` only on the values, where it's actually needed). All callers updated: `listTasks`, `fetchTasksAcrossLists` (used by `summarize_today`, `search_tasks`, `list_overdue_tasks`, `list_tasks_by_category`).
- Test assertion updated to match literal-$ form (no semantic test-coverage change).

### Notes
- This was a regression from v0.4.0 when `paginate` and `orderby` parameters were added via `URLSearchParams`. Older v0.3 code path used a different builder and was unaffected. Apologies for the disruption — please upgrade to **v1.1.2** ASAP.

## [1.1.1] - 2026-05-04

### Added
- **`--auth` CLI flag** for standalone device-code auth: `npx -y @mag-cie/mcp-microsoft-todo --auth`. Use this BEFORE wiring the MCP into Claude Code/Desktop to pre-populate the token cache. Solves the "stuck on first call" UX where the device code is printed to MCP stderr but the MCP client (Claude Code, Claude Desktop) doesn't surface it to the user.

### Notes
- No source-of-truth change to runtime behavior. The MCP still uses MSAL silent refresh + automatic device-code fallback when called as a regular MCP server. The `--auth` flag is just a convenience to make the first sign-in interactive in a normal terminal.

## [1.1.0] - 2026-05-04

### Added
- **i18n for compact-format strings** — server-side localization of the short labels returned by the compact format (`No tasks.`, `Due today:`, `Overdue:`, `OK:`, `Errors:`, `Task X deleted.`, `Error: …`, etc.). 4 locales bundled: **en** (default), **fr**, **es**, **de**.
- New file `src/i18n.ts` with locale resolution: `MCP_LOCALE` env → `LC_ALL` → `LANG` → fallback `en`. Only the first 2 chars are inspected; unsupported locale → `en`.
- Configure via `env` in your MCP client config:
  ```json
  { "env": { "MCP_LOCALE": "fr" } }
  ```
- **Note**: This is a marginal improvement — Claude already translates the English compact strings transparently when the user prompts in another language. Use `MCP_LOCALE` only if you want the raw MCP output to read natively in a given language (saves a few tokens, slightly cleaner LLM context).

### Changed
- Bump version `1.0.1` → `1.1.0`
- All user-facing short strings in `src/formatters.ts` and `src/index.ts` now route through `t.*` (the locale bundle)
- The `t` identifier is reserved for the i18n table — internal handler variables previously named `t` (task results) renamed to `task`/`moved` to avoid shadowing

## [1.0.1] - 2026-05-04

### Security
- **Bumped `@azure/msal-node` from `^2.16.0` to `^5.1.5`** to fix the moderate-severity transitive `uuid<14` vulnerability (CVE GHSA-w5hq-g745-h8pq, missing buffer bounds check, CWE-787). `npm audit` now reports zero vulnerabilities.
- **Defense in depth**: every Graph URL now wraps user-provided IDs (`listId`, `taskId`, `itemId`, `resourceId`, `extensionName`) with `encodeURIComponent` to prevent any path injection even with malformed inputs.
- **Token cache hardening**: `~/.mcp-microsoft-todo/token-cache.json` is now `chmod 0600` after every write (no-op on Windows, best-effort elsewhere) — token = bearer credential, owner-read/write only.
- **Zod strict mode** on every MCP tool schema — unknown/extra arguments are now rejected with a clear validation error instead of silently stripped, blocking LLM-hallucinated args from reaching the Graph API.
- **`extension_name` regex** restricted to `^[A-Za-z0-9._-]+$` (max 120 chars) — even though URLs are now encoded, this rejects garbage at the validation layer rather than relying solely on Graph API rejection.

### Performance
- **Cross-list helpers now use Graph `$batch` when more than 5 lists** (`summarize_today`, `search_tasks`, `list_overdue_tasks`, `list_tasks_by_category`). One HTTP call instead of N parallel — significantly reduces connection overhead and rate-limit risk on accounts with many lists. Per-list errors still don't fail the global aggregate.
- **`MAX_PAGES` reduced from 50 to 20** in `paginateAll` (≈2000 items max instead of 5000) — tighter guardrail against LLM context exhaustion when `paginate: true` is used carelessly.

### Changed
- Bump version `1.0.0` → `1.0.1`
- `paginate` parameter description updated with explicit warning: "Use sparingly — large result sets may exhaust the LLM context window."

## [1.0.0] - 2026-05-04

### Added
- Stable API milestone — public tool names, arguments, and return formats (compact + verbose) are now covered by SemVer guarantees
- Project translated to English (LLM-facing tool descriptions, error messages, code comments, README, CHANGELOG, JOURNAL)
- French README preserved as `README.fr.md`
- LICENSE updated to MIT © MAG&Cie
- `src/formatters.ts` — formatter functions extracted from `src/index.ts` for testability
- `src/formatters.test.ts` — snapshot/unit tests for all 9 compact formatters (locks the exact output strings)
- GitHub Actions CI workflow (`.github/workflows/ci.yml`): runs on push/PR — install + test + build on Node 20 and 22
- README polished with badges, example prompts table, upgrade-from-earlier-versions table

### Changed
- Bump version `0.5.0` → `1.0.0`
- Tool descriptions, error messages, and source-code comments translated to English
- README is now the canonical English version; French version moved to `README.fr.md`

## [0.5.0] - 2026-05-04

### Added
- **Open extensions** — 3 new tools to attach arbitrary JSON metadata to tasks
  - `list_extensions` — list a task's open extensions (`paginate` supported)
  - `set_extension` — upsert (PATCH if exists, POST otherwise). Lets you store `{project_id, external_ref, custom_flags...}` persisted in Microsoft Graph
  - `delete_extension` — remove an extension
- **Cross-list helpers**
  - `list_overdue_tasks` — aggregates all overdue tasks (`status ne completed and dueDateTime < today`) across every list
  - `list_tasks_by_category` — OData filter `categories/any(c: c eq 'X')` cross-lists, escapes apostrophes
  - `bulk_update_categories` — adds/removes categories on many tasks in 2 batch phases (GET current + PATCH updated set)
- **`export_tasks_ics`** — iCalendar (text/calendar VTODO) export, compatible with Google Calendar, Apple Calendar, Outlook, Thunderbird
  - Recurrence converted to RRULE (FREQ + INTERVAL + BYDAY for weekly, BYMONTHDAY for absoluteMonthly, UNTIL/COUNT for endDate/numbered)
  - Reminder converted to VALARM with `TRIGGER VALUE=DATE-TIME`
  - High/low importance → PRIORITY 1/9, status → STATUS NEEDS-ACTION/IN-PROCESS/COMPLETED
  - RFC 5545 escaping: `\\`, `,`, `;`, `\n`
- 7 additional vitest tests (26 total): extension upsert PATCH→POST fallback, overdue filter URL, by_category escape, bulkUpdateCategories phases, export ICS structure (VCALENDAR/VTODO/RRULE/VALARM)
- Expanded user README with detailed Claude Code / Claude Desktop / Cursor sections

### Changed
- Bump version `0.4.0` → `0.5.0`

## [0.4.0] - 2026-05-04

### Added
- **Automatic pagination** — `paginate: true` option on `list_task_lists`, `list_tasks`, `list_checklist_items`, `list_linked_resources`. Follows `@odata.nextLink` up to 50 pages max (safety cap). Defaults to `false` to preserve existing behavior.
- **Graph `$batch` operations** — 3 new tools
  - `batch_create_tasks` — create up to 100 tasks in one HTTP call (auto-chunked by 20)
  - `batch_complete_tasks` — mark up to 100 tasks completed in one call
  - `batch_delete_tasks` — delete up to 100 tasks in one call
  - Per-item errors don't fail the whole batch — each result carries its own status
- Exported helpers: `graphBatch(requests)`, `paginateAll<T>()` for programmatic use
- Scope **`Tasks.ReadWrite.Shared`** added to the auth request — lets you read lists shared with you (in addition to your own lists)
- Dedicated compact format for batch results: `"N ok / M err"` + OK details and errors only (not the full payload)
- 6 additional vitest tests: pagination on/off, batch order preservation, PATCH payload, per-item errors, chunking >20 items

### Changed
- Bump version `0.3.0` → `0.4.0`
- `SCOPES` now includes `Tasks.ReadWrite.Shared` — on next `npm run auth` or refresh, the user consents to the new scope (or needs to purge `~/.mcp-microsoft-todo/token-cache.json` if silent refresh doesn't trigger re-consent)
- Azure App Registration: must include `Tasks.ReadWrite.Shared` under **API permissions** > **Delegated** (already added on the maintainer side for the baked-in client ID)

### Notes
- v0.4 does **not** cover **list sharing in write mode** (creating/revoking a share) because Microsoft Graph doesn't expose this operation programmatically for To Do — sharing remains manual via the Microsoft UI. Only **reading** shared lists is supported via the `Tasks.ReadWrite.Shared` scope.

## [0.3.0] - 2026-05-04

### Added
- **Recurrence** — `recurrence` field (Microsoft Graph `patternedRecurrence`) on `create_task` and `update_task` — daily / weekly / absoluteMonthly / relativeMonthly / absoluteYearly / relativeYearly patterns with endDate / noEnd / numbered ranges
- **Reminders** — `is_reminder_on`, `reminder_date_time`, `reminder_time_zone` fields on `create_task` and `update_task`
- **Checklists** (sub-tasks) — 4 new tools: `list_checklist_items`, `create_checklist_item`, `update_checklist_item`, `delete_checklist_item`
- **Linked resources** — 3 new tools: `list_linked_resources`, `create_linked_resource`, `delete_linked_resource` for attaching external URLs/refs to a task
- **`get_task`** — fetch task detail by ID
- **`move_task`** — move a task from one list to another (recreate + delete; checklistItems/linkedResources not preserved, ID changes)
- **`search_tasks`** — cross-list title search via `$filter contains()`, excludes completed by default, escapes apostrophes
- **`summarize_today`** — aggregates tasks due today and overdue across all lists
- **Compact text format** by default on all read tools to save LLM tokens. Markers: `[!]` high, `[?]` low, `[v]` completed, `[>]` inProgress, `[w]` waiting, `[d]` deferred. Fields `due:`, `rem:`, `rec:`, `cat:`, `body:` displayed only when present.
- **`verbose: true`** opt-in to retrieve the full Graph JSON on any read tool
- **Systematic OData `$select`** on every Graph call: only useful fields transit (network + token savings)
- **`orderby`** parameter on `list_tasks` (e.g. `dueDateTime/dateTime asc`)
- **Automatic retry on 429** (Graph rate limit) honoring `Retry-After` header
- **Automatic retry on 5xx** with bounded exponential backoff (3 attempts)
- **Automatic retry on 401** — forced token re-acquire then retry once
- **Structured Graph error parsing** — extracts `error.code` and `error.message` from JSON body
- **vitest tests** — 13 tests on `graph.ts` (mocked fetch + auth) covering URL builders, payloads, retry/backoff, error parsing, cross-list search, summarize_today
- npm scripts `test` and `test:watch`
- `prepublishOnly` now runs `test && build` (instead of just `build`)

### Changed
- Bump version `0.2.0` → `0.3.0`

## [0.2.0] - 2026-05-04

### Added
- npm publish prep: `files`, `keywords`, `repository`, `bugs`, `homepage`, `author`, `publishConfig` fields
- `prepublishOnly` script that builds before publish
- Baked-in `MS_CLIENT_ID`: default value in code (MAG&Cie multi-tenant + MSA App Registration), overridable via env for dev forks
- MIT LICENSE at the root
- "30-second user install" section at the top of the README with `npx -y @mag-cie/mcp-microsoft-todo` example
- "Security & privacy" section explaining local token storage and the Microsoft revocation link
- "Auth troubleshooting" section: `MS_TENANT=consumers` fallback for personal accounts that fail on `common`, InPrivate browser tip
- `.npmignore` excluding `dist/**/*.md` (prevents `CLAUDE.md` from being published)
- CHANGELOG.md (this file)

### Changed
- Distribution model clarified: stdio npm package installed locally by each user, **not** a shared multi-user host
- README restructured: end-user info on top, dev/contribution at the bottom
- Bump version `0.1.0` → `0.2.0`

### Fixed
- Removed the 5 duplicate config files inside `src/` (initial scaffold unzip leftover)
- Standalone-execution detection in `auth.ts` was broken on Windows (now uses `pathToFileURL` from `node:url` instead of `file://${process.argv[1]}` template literal which produces a different URL than `import.meta.url` due to drive-letter slash count)

## [0.1.0] - 2026-05-04

### Added
- Initial scaffold of the Microsoft To Do MCP server
- stdio transport (compatible with Claude Code and Claude Desktop)
- MSAL device code flow auth, token cache persisted in `~/.mcp-microsoft-todo/token-cache.json`
- 6 CRUD tools: `list_task_lists`, `list_tasks`, `create_task`, `update_task`, `complete_task`, `delete_task`
- Runtime Zod validation on all arguments
- README with Azure AD setup + Claude Code/Desktop wiring
- Strict ESM TypeScript build to `dist/`
