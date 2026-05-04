## [2026-05-04 17:00] — v0.3.0 : 8 features (A→H) + optimisation tokens

### Ce qui a été fait

- **A** Recurrence + reminders sur create_task / update_task (mapping payload Graph)
- **B** Checklists CRUD : 4 nouveaux outils (list/create/update/delete checklist_item)
- **C** Linked resources : 3 nouveaux outils
- **D** Robustesse graphFetch : retry 429 (Retry-After), retry 5xx (backoff exponentiel), retry 401 (token re-acquired), parse erreurs Graph (error.code + error.message)
- **E** search_tasks : agrégation Promise.all sur toutes les listes, filter contains() avec échappement apostrophes
- **F** Tests vitest : 13 tests passants (fetch + auth mockés), couvre URL builders, payloads, retry, parse erreurs, search, summarize_today
- **G** move_task : getTask + createTask + completeTask (si applicable) + deleteTask
- **H** summarize_today : classification dueToday vs overdue par comparaison de dates UTC
- **Optimisation tokens** (demande explicite Antoine) :
  - `$select` systématique sur tous les appels Graph (limite champs réseau)
  - Format compact texte par défaut sur tous les outils de lecture (1 ligne / item, marqueurs ASCII)
  - Param `verbose: true` opt-in pour fallback JSON complet
  - Plus de pretty-print JSON
- Scripts npm `test`, `test:watch` ; `prepublishOnly` = `test && build`
- README : section outils complètement réécrite (16 outils groupés en 3 catégories) + légende format compact
- CHANGELOG v0.3.0 détaillé
- Bump version 0.2.0 → 0.3.0

### Décisions & raisons

- **Format compact par défaut + verbose opt-in** plutôt que tout JSON : le LLM consomme typiquement 5-10× moins de tokens sur une réponse avec 30 tâches. Mais quand il a besoin du body complet ou de tous les champs, `verbose: true` débloque le full Graph payload.
- **Marqueurs ASCII `[!]`/`[v]`/`[>]`** plutôt que des emojis : meilleure tokenisation et lisible cross-clients.
- **`$select` systématique** : économie double (réseau Graph + tokens LLM en sortie). Liste des champs DEFAULT_TASK_SELECT couvre les besoins courants ; `verbose: true` ne change PAS les champs récupérés (ils restent limités au $select default), il change seulement le format de sortie.
- **Tests vitest mockés** plutôt que tests d'intégration réels : pas de dépendance au compte MS, exécution en CI possible, rapide. Trade-off : ne couvre pas les vraies erreurs Graph (typos d'endpoint, schema drift).
- **Tests qui ne valident pas la valeur exacte de l'URL encodée** : URLSearchParams encode `$` en `%24` mais template literal le laisse brut. Tests décodent l'URL avant assertion → robustes aux deux conventions.

### Problèmes rencontrés / contournements

- 2 tests cassés au premier run sur encodage URL inconsistant entre `?$select=...` (template literal, raw `$`) et `URLSearchParams` (encode `$` en `%24`, espaces en `+`). Fix : `decodeURIComponent(url.replace(/\\+/g, " "))` côté assertion.
- tsconfig `include: ["src/**/*"]` aurait compilé `graph.test.ts` dans dist/. Ajout `exclude: ["src/**/*.test.ts"]` pour préserver le tarball npm propre.

### Prochaines étapes suggérées

1. `git add . && git commit && git push` v0.3.0
2. `npm publish --access public` (avec le granular access token déjà configuré)
3. Test E2E réel : `npx -y @mag-cie/mcp-microsoft-todo@0.3.0` depuis fresh clone, valider les nouveaux outils via Claude
4. v0.4 : partage de listes via Graph beta `permissions` endpoint (nécessite scope `Tasks.ReadWrite.Shared` à ajouter sur l'App Reg)
5. v0.5 : pagination auto sur listTasks (suit `@odata.nextLink` quand top n'est pas spécifié)

---

## [2026-05-04 16:30] — Auth validée + smoke test E2E OK

### Ce qui a été fait

- App Reg Azure créée avec client ID `6ea8909b-95e0-4ef0-8b48-d5910f164c6a` (multi-tenant + MSA), baked dans `src/auth.ts`
- Fix bug Windows dans `src/auth.ts` : `import.meta.url === \`file://${process.argv[1]}\`` ne matchait jamais sur Windows (URL drive letter a 3 slashes vs 2). Remplacé par `pathToFileURL(process.argv[1]).href`
- Création `.npmignore` pour exclure `dist/**/*.md` (CLAUDE.md auto-généré ne doit pas être publié)
- 3 tentatives device code flow pour résoudre les bugs Azure :
  1. App Reg "Allow public client flows" = Yes (déjà OK)
  2. Ajout plateforme **Mobile and desktop applications** avec URI `https://login.microsoftonline.com/common/oauth2/nativeclient` (manquante au départ)
  3. `MS_TENANT=consumers` au lieu de `common` pour débloquer le compte MS perso
- Token cache écrit dans `~/.mcp-microsoft-todo/token-cache.json`
- Smoke test `listTaskLists()` → 8 listes To Do retournées (Tâches, ASBR, Courses, MAG & MAGARIA, Perso, Quartz Insight, Wellap, Flagged Emails)
- Section "Troubleshooting auth" ajoutée au README documentant le fallback `MS_TENANT=consumers` + conseil InPrivate

### Décisions & raisons

- **Garder `common` par défaut** plutôt que basculer sur `consumers` : `consumers` casse les comptes pro/M365. `common` couvre les deux types théoriquement, et le fallback est documenté.
- **Conserver le smoke-test.ts hors du repo** : créé puis supprimé, c'était jetable. Si on veut un vrai test E2E un jour, ajouter vitest dans Step 4.

### Problèmes rencontrés / contournements

- **"wrongplace" page** après sign-in MSA avec `tenant=common` : non reproductible précisément, lié soit au navigateur (autres comptes MS actifs), soit à l'ambiguïté `common`. Bypass = `consumers` + InPrivate.
- **MSAL emet l'URL `https://login.microsoft.com/device`** au lieu de l'URL canonique `https://microsoft.com/devicelogin` : pas bloquant mais surprenant. Avec `consumers` MSAL emet `https://www.microsoft.com/link` (plus clair).

### Prochaines étapes suggérées

1. `git init` + premier commit + remote add origin → `https://github.com/MAG-Cie/mcp-microsoft-todo.git` + push (à valider avec Antoine avant push, repo public)
2. `npm login` (org @mag-cie) + `npm publish --access public`
3. Test installation cliente : `npx -y @mag-cie/mcp-microsoft-todo` depuis une autre machine ou un fresh clone
4. Step 4 améliorations : recurrence/reminders, checklists, partage de listes, retry 429, search_tasks cross-listes, tests vitest

---

## [2026-05-04 15:30] — Pivot Phase 2 : npm distribution au lieu de HTTP/SSE

### Ce qui a été fait

- Nettoyage des 5 fichiers config dupliqués dans `src/` (README, .gitignore, package.json, package-lock.json, tsconfig.json) — résidu d'unzip du scaffold
- `npm install` + `npm run build` validés (dist/ généré clean)
- Pivot du plan Phase 2 : abandon de l'option HTTP/SSE multi-user hébergée au profit d'une distribution **npm package stdio** installée localement par chaque utilisateur
- Refactor `src/auth.ts` pour exposer un `DEFAULT_CLIENT_ID` baked-in (placeholder) avec override via `MS_CLIENT_ID` env pour les forks dev
- `package.json` enrichi pour publish npm public : `files`, `keywords`, `repository`, `bugs`, `homepage`, `author`, `publishConfig.access`, `prepublishOnly`
- Bump version `0.1.0` → `0.2.0`
- README restructuré : section "Installation utilisateur final 30 sec" en tête (`npx -y @mag-cie/mcp-microsoft-todo`), section dev/contribution déplacée en bas
- Création LICENSE (MIT), CHANGELOG.md (Keep a Changelog), JOURNAL.md

### Décisions & raisons

- **npm package stdio plutôt que HTTP/SSE hébergé** : Antoine veut que chaque utilisateur installe et fasse tourner le MCP localement. Avantages : zéro infra, zéro stockage de tokens d'autres users (RGPD trivial), setup user 30 sec, Marche offline. Trade-off : impossible à utiliser depuis Claude.ai web (qui veut du HTTP).
- **Client ID public baked-in** : le client ID d'une public client app (device code flow) n'est PAS un secret. Le distribuer dans le code permet aux utilisateurs finaux d'installer sans aucun setup Azure de leur côté. Surchargeable via env pour les forks dev.
- **Multi-tenant + comptes personnels** : l'App Registration sera configurée avec "Accounts in any organizational directory and personal Microsoft accounts" pour couvrir comptes MS gratuits, Office perso, M365 pro. Antoine doit la créer une fois (M365 Dev Program ou tenant pro existant), et tous ses utilisateurs en bénéficient.

### Problèmes rencontrés / contournements

- Compte Microsoft personnel d'Antoine ne permet pas (en l'état) de créer une App Registration Entra ID, même avec Azure free tier activé. Workaround : créer un tenant proprement (M365 Dev Program ou tenant pro) — Antoine s'en occupe.
- `MS_CLIENT_ID` reste à `REPLACE_WITH_YOUR_CLIENT_ID` dans `auth.ts` jusqu'à ce qu'Antoine ait son App Registration — à substituer avant `npm publish`.

### Prochaines étapes suggérées

1. Antoine crée tenant + App Registration multi-tenant + MSA, récupère client ID
2. Substituer `REPLACE_WITH_YOUR_CLIENT_ID` dans `src/auth.ts` par le vrai client ID
3. `npm run auth` pour valider le flow device code avec compte To Do d'Antoine
4. `git init` + premier commit + push sur `mag-cie/mcp-microsoft-todo` GitHub
5. `npm publish` (org `@mag-cie` doit exister sur npm, sinon créer ou changer scope)
6. Étape 4 (améliorations) : recurrence, reminders, checklists, partage de listes
