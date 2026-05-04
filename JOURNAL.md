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
