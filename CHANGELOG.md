# Changelog

Toutes les modifications notables de ce projet seront documentées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet adhère à [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-05-04

### Added
- **Open extensions** : 3 nouveaux outils pour attacher des metadata JSON arbitraires aux tâches
  - `list_extensions` : lister les open extensions d'une tâche (paginate supporté)
  - `set_extension` : upsert (PATCH si existe, POST sinon) — permet de stocker `{project_id, external_ref, custom_flags...}` qui persistent dans Microsoft Graph
  - `delete_extension` : retirer une extension
- **Cross-list helpers** :
  - `list_overdue_tasks` : agrège toutes les tâches en retard (status ne completed et dueDateTime < today) sur l'ensemble des listes
  - `list_tasks_by_category` : filtre OData `categories/any(c: c eq 'X')` cross-listes, échappe apostrophes
  - `bulk_update_categories` : ajoute/retire des catégories à plusieurs tâches en 2 phases batch (GET courantes + PATCH set mis à jour)
- **`export_tasks_ics`** : export iCalendar (text/calendar avec VTODO) compatible Google Calendar, Apple Calendar, Outlook, Thunderbird
  - Recurrence convertie en RRULE (FREQ + INTERVAL + BYDAY pour weekly, BYMONTHDAY pour absoluteMonthly, UNTIL/COUNT pour range endDate/numbered)
  - Reminder converti en VALARM avec TRIGGER VALUE=DATE-TIME
  - Importance haute/basse → PRIORITY 1/9, status → STATUS NEEDS-ACTION/IN-PROCESS/COMPLETED
  - Échappement RFC 5545 : `\\`, `,`, `;`, `\n`
- 7 nouveaux tests vitest (26 total) : extensions upsert PATCH→POST fallback, listOverdueTasks filter, listTasksByCategory escape, bulkUpdateCategories phases, export ICS structure VCALENDAR/VTODO/RRULE/VALARM
- README utilisateur étoffé : sections détaillées Claude Code / Claude Desktop / Cursor avec install + premier auth + update + désinstall, table de troubleshooting auth

### Changed
- Bump version `0.4.0` → `0.5.0`
- Roadmap mise à jour : v0.5 cochée, prochaine étape v1.0 stable milestone

## [0.4.0] - 2026-05-04

### Added
- **Pagination automatique** : option `paginate: true` sur `list_task_lists`, `list_tasks`, `list_checklist_items`, `list_linked_resources`. Suit `@odata.nextLink` jusqu'à 50 pages max (sécurité). Défaut `false` pour préserver le comportement existant.
- **Batch operations Graph $batch** : 3 nouveaux outils
  - `batch_create_tasks` : crée jusqu'à 100 tâches en un seul appel HTTP (chunké auto par 20)
  - `batch_complete_tasks` : marque jusqu'à 100 tâches comme complétées en un appel
  - `batch_delete_tasks` : supprime jusqu'à 100 tâches en un appel
  - Erreurs par item ne font pas échouer le batch entier — chaque résultat porte son propre statut
- **Helpers exportés** : `graphBatch(requests)`, `paginateAll<T>()` pour usage programmatique
- Scope **`Tasks.ReadWrite.Shared`** ajouté à la requête d'auth — permet de lire les listes partagées avec toi (en plus de tes propres listes)
- Format compact dédié pour résultats batch : `"N ok / M err"` + détails OK et erreurs uniquement (pas tout le payload)
- 6 tests vitest supplémentaires : pagination on/off, batchCreate ordre préservé, batchComplete payload PATCH, batchDelete erreurs par item, chunking >20 items

### Changed
- Bump version `0.3.0` → `0.4.0`
- `SCOPES` inclut désormais `Tasks.ReadWrite.Shared` — au prochain `npm run auth` ou prochain refresh, l'utilisateur consentira au nouveau scope (ou besoin de purger `~/.mcp-microsoft-todo/token-cache.json` si refresh silencieux ne déclenche pas le re-consent)
- App Registration Azure : doit avoir `Tasks.ReadWrite.Shared` dans **API permissions** > **Delegated** (déjà ajouté côté maintainer pour le client ID baked-in)

### Notes
- v0.4 ne couvre PAS le **partage de listes en écriture** (créer/révoquer un share) car Microsoft Graph n'expose pas cette opération programmatiquement pour To Do — le partage reste manuel via UI Microsoft. Seule la **lecture** des listes partagées est supportée via le scope `Tasks.ReadWrite.Shared`.

## [0.3.0] - 2026-05-04

### Added
- **Recurrence** : champs `recurrence` (patternedRecurrence Microsoft Graph) sur `create_task` et `update_task` — patterns daily / weekly / absoluteMonthly / relativeMonthly / absoluteYearly / relativeYearly avec range endDate / noEnd / numbered
- **Reminders** : champs `is_reminder_on`, `reminder_date_time`, `reminder_time_zone` sur `create_task` et `update_task`
- **Checklists** (sous-tâches) : 4 nouveaux outils `list_checklist_items`, `create_checklist_item`, `update_checklist_item`, `delete_checklist_item`
- **Linked resources** : 3 nouveaux outils `list_linked_resources`, `create_linked_resource`, `delete_linked_resource` pour attacher des URLs/refs externes à une tâche
- **`get_task`** : récupère le détail d'une tâche par ID
- **`move_task`** : déplace une tâche d'une liste à une autre (recrée + supprime ; checklistItems/linkedResources non préservés, l'ID change)
- **`search_tasks`** : recherche cross-listes par titre via `$filter contains()`, exclut les complétées par défaut, échappe les apostrophes
- **`summarize_today`** : agrège les tâches dues aujourd'hui et en retard sur toutes les listes
- **Format compact texte** par défaut sur tous les outils de lecture pour économiser les tokens LLM. Marqueurs : `[!]` high, `[?]` low, `[v]` completed, `[>]` inProgress, `[w]` waiting, `[d]` deferred. Champs `due:`, `rem:`, `rec:`, `cat:`, `body:` affichés seulement si présents.
- **Param `verbose: true`** : opt-in pour récupérer le JSON Graph complet sur n'importe quel outil de lecture
- **OData `$select`** systématique sur tous les appels Graph : seuls les champs utiles transitent (économie bande passante + tokens)
- **Param `orderby`** sur `list_tasks` (ex: `dueDateTime/dateTime asc`)
- **Retry automatique sur 429** (rate limit Graph) avec respect du header `Retry-After`
- **Retry automatique sur 5xx** avec backoff exponentiel borné (3 tentatives)
- **Retry automatique sur 401** : re-acquisition forcée du token puis retry une fois
- **Parsing structuré des erreurs Graph** : extrait `error.code` et `error.message` du body JSON
- **Tests vitest** : 13 tests sur `graph.ts` (fetch + auth mockés), couvre URL builders, payloads, retry/backoff, parse erreurs, recherche cross-listes, summarize_today
- Scripts npm `test` et `test:watch`
- `prepublishOnly` lance désormais `test && build` (au lieu de juste `build`)

### Changed
- Bump version `0.2.0` → `0.3.0`
- README enrichi : nouvelle section "Outils exposés" complète avec sections Listes/Sous-tâches/Ressources liées, légende du format compact, doc du param `verbose`
- Roadmap mise à jour : v0.3 cochée, prochaines étapes v0.4 (partage de listes Graph beta) et v0.5 (pagination auto)

## [0.2.0] - 2026-05-04

### Added
- Préparation publication npm : champs `files`, `keywords`, `repository`, `bugs`, `homepage`, `author`, `publishConfig`
- Script `prepublishOnly` qui build avant publish
- `MS_CLIENT_ID` baked-in : valeur par défaut dans le code (App Registration MAG-Cie multi-tenant + MSA), surchargeable via env pour les forks dev
- LICENSE MIT à la racine
- Section "Installation utilisateur final 30 sec" en tête du README avec exemple `npx -y @mag-cie/mcp-microsoft-todo`
- Section "Sécurité & confidentialité" expliquant le stockage local du token et le lien de révocation Microsoft
- Section "Troubleshooting auth" : doc fallback `MS_TENANT=consumers` pour comptes personnels qui échouent sur `common`, conseil InPrivate
- `.npmignore` excluant `dist/**/*.md` (évite que CLAUDE.md soit publié)
- CHANGELOG.md (ce fichier)

### Changed
- Modèle de distribution clarifié : npm package stdio installé localement par chaque utilisateur, **pas** d'hébergement multi-user partagé
- README restructuré : user final en haut, dev/contribution en bas
- Bump version `0.1.0` → `0.2.0`

### Fixed
- Suppression des 5 fichiers config dupliqués dans `src/` (résidu d'unzip du scaffold initial)
- Détection d'exécution standalone dans `auth.ts` cassée sur Windows (utilise désormais `pathToFileURL` de `node:url` au lieu d'une concaténation `file://${process.argv[1]}` qui produit une URL différente de `import.meta.url` à cause du nombre de slashes pour les chemins avec lettre de drive)

## [0.1.0] - 2026-05-04

### Added
- Scaffold initial du serveur MCP Microsoft To Do
- Transport stdio (compatible Claude Code et Claude Desktop)
- Auth MSAL via device code flow, token cache persisté dans `~/.mcp-microsoft-todo/token-cache.json`
- 6 outils CRUD : `list_task_lists`, `list_tasks`, `create_task`, `update_task`, `complete_task`, `delete_task`
- Validation runtime Zod sur tous les arguments
- README setup Azure AD + branchement Claude Code/Desktop
- Build TypeScript ESM strict vers `dist/`
