# Changelog

Toutes les modifications notables de ce projet seront documentées ici.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet adhère à [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
