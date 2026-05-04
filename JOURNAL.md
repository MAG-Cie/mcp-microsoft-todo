## [2026-05-04 19:00] — v1.0.0: stable milestone, English-first project

### What was done

- Translated the entire project to English: tool descriptions (LLM-facing), error messages, code comments, README, CHANGELOG, JOURNAL, package.json description
- Saved the previous French README as `README.fr.md` (kept as a French shortcut, English remains canonical)
- LICENSE updated to `MIT © MAG&Cie` (was `Antoine Guittet / MAG-Cie`)
- Extracted formatters from `src/index.ts` into `src/formatters.ts` (now testable in isolation)
- Created `src/formatters.test.ts` with 23 inline snapshot tests covering all 9 compact formatters — locks the exact output strings so any future change is intentional and visible in PR diff
- Added GitHub Actions CI workflow `.github/workflows/ci.yml`: matrix on Node 20 + 22, runs npm ci → test → build → verify dist contents (shebang preserved, all .js files present) → npm pack dry-run
- README polished: added npm + license badges, "Example prompts" table covering the main use cases, "Upgrading from earlier versions" table with explicit migration notes per version
- Bumped version 0.5.0 → 1.0.0 — stable API milestone: tool names, arguments, and return formats (compact + verbose) are now covered by SemVer guarantees

### Decisions & rationale

- **English first**: aligns with the global CLAUDE.md instruction ("Code, comments, variables, commit messages: English") and is the de-facto standard for npm packages targeting an international audience. The French README is retained as `README.fr.md` (common pattern for bilingual projects).
- **MAG&Cie sole copyright** instead of personal name: matches the npm scope `@mag-cie/*` and the GitHub org `MAG-Cie`. Future commercial use or contributor licensing is cleaner if the IP holder is a single legal entity.
- **Inline snapshots over separate `.snap` files**: snapshots live next to assertions, easier to review in PR, no separate file to track. Lock the LLM-facing output strings — these are part of the public contract for the compact format.
- **Version 1.0.0 marker**: signals API stability. Future minor versions (1.x) won't rename tools or change return shapes (compact vs verbose JSON). Breaking changes would require 2.0.
- **CI on Node 20 + 22**: 20 is the minimum (engines field), 22 is current LTS. Three Node versions would be overkill.

### Issues encountered

- Translating the index.ts file (~1000 lines, lots of French tool descriptions and error messages) was the bulk of the effort. Rewrite was preferred over hundreds of small edits to ensure consistency.
- `graph.test.ts` test descriptions remain in French (low priority — internal, not LLM-facing). Could be translated in a follow-up patch if desired.

### Next steps

1. Commit + push v1.0.0
2. npm publish v1.0.0 (granular access token already configured)
3. Confirm CI workflow runs green on the first push
4. (Optional) Translate `graph.test.ts` test descriptions for full English consistency
5. Roadmap beyond v1.0: v1.1 Graph beta attachments, v1.2 auto-pagination follow-on for `summarize_today`/`search_tasks`/`list_overdue_tasks`, v2.0 remote HTTP/SSE for Claude.ai custom connectors

---

## [2026-05-04 18:30] — v0.5.0: extensions + cross-list helpers + ICS export

### What was done

- Open extensions on Graph (`/me/todo/lists/{id}/tasks/{id}/extensions`): 3 MCP tools (`list_extensions`, `set_extension`, `delete_extension`)
- `set_extension` upsert: tries PATCH; if 404, falls back to POST with `@odata.type` + `extensionName` (Graph requirement)
- Cross-list helpers:
  - `list_overdue_tasks` — aggregates `status ne completed` and `dueDateTime < today_UTC` tasks across all lists
  - `list_tasks_by_category` — OData filter `categories/any(c: c eq 'X')` cross-lists, escapes apostrophes
  - `bulk_update_categories` — 2-phase batch ($batch GET for current categories, then $batch PATCH with updated set)
- `export_tasks_ics`: generates VCALENDAR with VTODO entries, RRULE for recurrence (FREQ/INTERVAL/BYDAY/BYMONTHDAY/UNTIL/COUNT), VALARM for reminders, RFC 5545 escape (`\\`, `,`, `;`, `\n`)
- Compact formatter `formatExtensionCompact`: `id name:com.example.x foo="bar"` (skips `@odata.*` props)
- 7 additional vitest tests (26 total): extension upsert PATCH→POST fallback, overdue filter URL, by_category apostrophe escape, bulkUpdate batch phases, ICS export structure
- Expanded user README with detailed Claude Code / Claude Desktop / Cursor sections + auth troubleshooting table
- Bumped version 0.4.0 → 0.5.0

### Decisions & rationale

- **Open extensions** rather than schema extensions: Open extensions = arbitrary JSON. Schema extensions = strict typing pre-declared. For "store project_id or external_ref per task", open extensions are simple and sufficient.
- **Upsert via PATCH→POST fallback** rather than separate create/update API: simplifies LLM usage (one tool `set_extension`), avoids "exists" error on re-call.
- **`bulk_update_categories` in 2 phases** rather than diff payload: Graph PATCH on `categories` REPLACES the whole array, so we must read existing first. 2 successive batches = 2 HTTP calls instead of N×2 without batching.
- **Limited ICS RRULE patterns**: skip relativeMonthly/Yearly (require complex BYDAY+BYSETPOS). Documented via `return null`. Tasks with non-convertible recurrence simply export their plain DUE.

### Issues encountered

- Microsoft Graph open extensions require `@odata.type: microsoft.graph.openTypeExtension` on creation (POST), not on update (PATCH). The upsert helper handles both cases.
- ICS DUE field must be in UTC (`Z` suffix). The formatter forces conversion assuming Graph dateTime values without explicit timezone are UTC. Tasks with non-UTC timeZone would show shifted hours when imported into a calendar app — accepted trade-off for v0.5.

---

## [2026-05-04 17:30] — v0.4.0: pagination + batch + Tasks.ReadWrite.Shared scope

### What was done

- Auto pagination via `paginateAll<T>()` helper — `paginate: true` option on all `list_*` tools (follows `@odata.nextLink`, capped at 50 pages)
- Graph `$batch` operations: low-level helper `graphBatch()` + 3 MCP tools (`batch_create_tasks`, `batch_complete_tasks`, `batch_delete_tasks`). Auto-chunked by 20 (Graph limit). Per-item errors, no global fail.
- `Tasks.ReadWrite.Shared` scope added to `auth.ts` SCOPES (allows reading lists shared with the user)
- Compact formatter `formatBatchCompact`: `"N ok / M err"` + OK details and errors only (token saving)
- 6 additional vitest tests (19 total): pagination on/off, batch order, batch chunking, batch partial errors
- Bumped version 0.3.0 → 0.4.0

### Decisions & rationale

- **Pagination opt-in rather than default**: most MCP usage (LLM showing on-screen) fits in one page (Graph default top = 100). Pagination = explicit fallback when LLM knows there are many items. Avoids hidden costs.
- **50-page cap in `paginateAll`**: safety against runaway. At 100 items/page = 5000 max. Beyond that, requires better design (filter, search).
- **Batch chunked by 20**: Graph $batch v1.0 limit. The helper accepts 100 items API-side, chunks internally. The user doesn't need to worry about this detail.
- **Per-item errors in batch**: no global fail. Lets the LLM see which ones failed and correct only those (vs. retry everything).
- **No share/unshare list**: Microsoft Graph doesn't expose these operations for To Do (verified in docs). Limitation documented in CHANGELOG. Only reading shared lists is supported via the new scope.

### Issues encountered

- Azure App Reg: must manually add `Tasks.ReadWrite.Shared` under **API permissions > Microsoft Graph > Delegated** on the maintainer side, then **Grant admin consent** if on a corporate tenant.
- Existing token cache may not include the new scope on the first silent refresh. If a call fails with `InsufficientPrivileges` or missing `Tasks.ReadWrite.Shared`, the user must `rm -rf ~/.mcp-microsoft-todo` and re-`auth`.

---

## [2026-05-04 17:00] — v0.3.0: 8 features (A→H) + token optimization

### What was done

- **A** Recurrence + reminders on `create_task` / `update_task` (Graph payload mapping)
- **B** Checklists CRUD: 4 new tools (list/create/update/delete checklist_item)
- **C** Linked resources: 3 new tools
- **D** `graphFetch` resilience: retry 429 (Retry-After), retry 5xx (exponential backoff), retry 401 (token re-acquired), parse Graph errors (error.code + error.message)
- **E** `search_tasks`: Promise.all aggregation across all lists, `contains()` filter with apostrophe escape
- **F** vitest tests: 13 passing tests (mocked fetch + auth), covers URL builders, payloads, retry, error parsing, search, summarize_today
- **G** `move_task`: getTask + createTask + completeTask (if applicable) + deleteTask
- **H** `summarize_today`: classifies dueToday vs overdue by UTC date comparison
- **Token optimization** (per Antoine's request):
  - `$select` systematic on every Graph call (limits network fields)
  - Compact text format default on every read tool (1 line per item, ASCII markers)
  - `verbose: true` opt-in for full JSON fallback
  - Dropped pretty-print JSON
- npm scripts `test`, `test:watch`; `prepublishOnly = test && build`
- README: tool section completely rewritten (16 tools grouped in 3 categories) + compact format legend
- CHANGELOG v0.3.0 detailed
- Bumped version 0.2.0 → 0.3.0

### Decisions & rationale

- **Compact format default + verbose opt-in** rather than JSON everywhere: the LLM typically consumes 5–10× fewer tokens for a 30-task response. When it needs full body or all fields, `verbose: true` unlocks the full Graph payload.
- **ASCII markers `[!]`/`[v]`/`[>]`** rather than emoji: better tokenization and readable across clients.
- **Systematic `$select`**: double saving (Graph network + LLM output tokens). The DEFAULT_TASK_SELECT field list covers common needs; `verbose: true` does NOT change which fields are fetched (still limited by default `$select`), it only changes the output format.
- **Mocked vitest tests** rather than real integration tests: no MS account dependency, runnable in CI, fast. Trade-off: doesn't catch real Graph errors (endpoint typos, schema drift).

### Issues encountered

- 2 tests broke on the first run due to inconsistent URL encoding between `?$select=...` (template literal, raw `$`) and `URLSearchParams` (encodes `$` as `%24`, spaces as `+`). Fix: `decodeURIComponent(url.replace(/\\+/g, " "))` on the assertion side.
- tsconfig `include: ["src/**/*"]` would have compiled `graph.test.ts` to dist/. Added `exclude: ["src/**/*.test.ts"]` to keep the npm tarball clean.

---

## [2026-05-04 16:30] — Auth validated + E2E smoke test OK

### What was done

- Azure App Reg created with client ID `6ea8909b-95e0-4ef0-8b48-d5910f164c6a` (multi-tenant + MSA), baked into `src/auth.ts`
- Windows bug fix in `src/auth.ts`: `import.meta.url === \`file://${process.argv[1]}\`` never matched on Windows (drive-letter URL has 3 slashes vs 2). Replaced with `pathToFileURL(process.argv[1]).href`
- Created `.npmignore` to exclude `dist/**/*.md` (auto-generated CLAUDE.md must not be published)
- 3 device code flow attempts to resolve Azure bugs:
  1. App Reg "Allow public client flows" = Yes (already OK)
  2. Added **Mobile and desktop applications** platform with URI `https://login.microsoftonline.com/common/oauth2/nativeclient` (missing initially)
  3. `MS_TENANT=consumers` instead of `common` to unblock the personal MS account
- Token cache written to `~/.mcp-microsoft-todo/token-cache.json`
- Smoke test `listTaskLists()` → 8 To Do lists returned (Tasks, ASBR, Groceries, MAG & MAGARIA, Personal, Quartz Insight, Wellap, Flagged Emails)
- "Auth troubleshooting" section added to README documenting the `MS_TENANT=consumers` fallback + InPrivate tip

### Decisions & rationale

- **Keep `common` as default** rather than switching to `consumers`: `consumers` breaks work/M365 accounts. `common` covers both account types theoretically, and the fallback is documented.
- **Don't keep `smoke-test.ts` in repo**: created then deleted, throwaway. If we ever want a real E2E test, add vitest in Step 4.

### Issues encountered

- "wrongplace" page after MSA sign-in with `tenant=common`: not exactly reproducible, related either to the browser (other active MS accounts) or `common` ambiguity. Bypass = `consumers` + InPrivate.
- MSAL emits the URL `https://login.microsoft.com/device` instead of the canonical `https://microsoft.com/devicelogin`: not blocking but surprising. With `consumers`, MSAL emits `https://www.microsoft.com/link` (clearer).

---

## [2026-05-04 15:30] — Phase 2 pivot: npm distribution instead of HTTP/SSE

### What was done

- Cleaned up the 5 duplicate config files in `src/` (README, .gitignore, package.json, package-lock.json, tsconfig.json) — initial scaffold unzip leftover
- `npm install` + `npm run build` validated (dist/ generated cleanly)
- Phase 2 plan pivot: dropped the hosted multi-user HTTP/SSE option in favor of a stdio **npm package** distribution that each user installs locally
- Refactored `src/auth.ts` to expose a baked-in `DEFAULT_CLIENT_ID` (placeholder) with `MS_CLIENT_ID` env override for dev forks
- `package.json` enriched for public npm publish: `files`, `keywords`, `repository`, `bugs`, `homepage`, `author`, `publishConfig.access`, `prepublishOnly`
- Bumped version 0.1.0 → 0.2.0
- README restructured: "30-second user install" section at the top (`npx -y @mag-cie/mcp-microsoft-todo`), dev/contribution section moved to the bottom
- Created LICENSE (MIT), CHANGELOG.md (Keep a Changelog), JOURNAL.md

### Decisions & rationale

- **stdio npm package rather than hosted HTTP/SSE**: Antoine wants every user to install and run the MCP locally. Pros: zero infra, zero storage of other users' tokens (RGPD-trivial), 30-sec user setup, works offline. Trade-off: cannot be used from Claude.ai web (HTTP-only).
- **Public client ID baked-in**: a public client app's (device code flow) client ID is NOT a secret. Distributing it in code lets end users install with zero Azure setup on their side. Overridable via env for dev forks.
- **Multi-tenant + personal accounts**: the App Registration will be configured with "Accounts in any organizational directory and personal Microsoft accounts" to cover free MS accounts, Office personal, M365 work. Antoine creates it once (M365 Dev Program or existing work tenant), all his users benefit.

### Issues encountered

- Antoine's personal Microsoft account doesn't (currently) allow creating an Entra ID App Registration, even with Azure free tier activated. Workaround: create a tenant properly (M365 Dev Program or work tenant) — Antoine handled.
- `MS_CLIENT_ID` stays at `REPLACE_WITH_YOUR_CLIENT_ID` in `auth.ts` until Antoine has his App Registration — to substitute before `npm publish`.
