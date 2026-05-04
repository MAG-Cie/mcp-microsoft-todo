# Changelog

All notable changes to this project are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
