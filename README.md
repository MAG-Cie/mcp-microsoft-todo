# mcp-microsoft-todo

MCP server pour piloter **Microsoft To Do** depuis Claude Code, Claude Desktop, ou tout client MCP compatible.

Marche avec **n'importe quel compte Microsoft** : perso (outlook.com, hotmail.com, live.com), Office 365 perso ou pro, Microsoft 365. Aucun setup Azure côté utilisateur — juste sign-in via device code flow.

---

## 🚀 Installation utilisateur final

### Pré-requis (commun à tous les clients)

- **Node.js 20+** installé sur ta machine ([nodejs.org](https://nodejs.org))
- Un compte Microsoft (gratuit ou pro)

Pas de compte Azure requis, pas d'App Registration à créer, rien à compiler.

---

### 🟦 Claude Code (CLI)

**Install (1 commande) :**

```bash
claude mcp add --transport stdio microsoft-todo -- npx -y @mag-cie/mcp-microsoft-todo
```

Si tu as un **compte Microsoft personnel** (outlook.com, hotmail.com, live.com, msn.com, Office 365 perso), ajoute `MS_TENANT=consumers` :

```bash
claude mcp add --transport stdio microsoft-todo --env MS_TENANT=consumers -- npx -y @mag-cie/mcp-microsoft-todo
```

**Vérifier que c'est branché :**

```bash
claude mcp list
```

**Première utilisation :** lance `claude`, puis tape un prompt qui appelle un outil :

> Liste mes tâches Microsoft To Do

Au premier appel, le serveur affiche dans les logs MCP :

```
To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code XXXXXXXXX
```

Va sur l'URL, entre le code, sign-in. Le token est mis en cache dans `~/.mcp-microsoft-todo/token-cache.json` et refresh automatique ensuite — tu n'as plus jamais à faire ça.

**Mettre à jour vers la dernière version :**

```bash
# Force un re-install fresh de la dernière version npm
claude mcp remove microsoft-todo
claude mcp add --transport stdio microsoft-todo -- npx -y @mag-cie/mcp-microsoft-todo@latest
```

Le flag `-y` de npx accepte automatiquement le téléchargement. Si tu omets `@latest`, npx peut servir une version cachée plus ancienne.

**Désinstaller :**

```bash
claude mcp remove microsoft-todo
# Et purger le token cache :
rm -rf ~/.mcp-microsoft-todo
```

---

### 🟪 Claude Desktop (app)

**1. Localiser le fichier de config :**

| OS | Chemin |
|---|---|
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Linux** | `~/.config/Claude/claude_desktop_config.json` |

Sur Windows, tu peux y aller direct avec :
```powershell
notepad $env:APPDATA\Claude\claude_desktop_config.json
```

Si le fichier n'existe pas, crée-le avec un objet JSON vide `{}` puis édite.

**2. Ajouter la config :**

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

Pour un compte Microsoft personnel, ajoute `env` :

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

**3. Redémarrer Claude Desktop COMPLÈTEMENT** (pas juste fermer la fenêtre) :
- **Windows** : clic droit sur l'icône systray → Quit, puis relancer
- **macOS** : ⌘+Q puis relancer

**4. Vérifier que c'est branché :**

Dans Claude Desktop, regarde l'icône **🔌 prise** ou **🔧 outils** en bas à droite de la zone de saisie — tu dois voir `microsoft-todo` listé.

**5. Première auth :**

⚠️ Claude Desktop n'expose pas les logs MCP de façon évidente. Le device code apparaît dans :
- **Windows** : `%APPDATA%\Claude\logs\mcp-server-microsoft-todo.log`
- **macOS** : `~/Library/Logs/Claude/mcp-server-microsoft-todo.log`

**Astuce plus simple — pré-générer le token cache :**

Avant de configurer Claude Desktop, lance dans un terminal :

```bash
# macOS / Linux
MS_TENANT=consumers npx -y @mag-cie/mcp-microsoft-todo
```

```powershell
# Windows PowerShell
$env:MS_TENANT="consumers"; npx -y @mag-cie/mcp-microsoft-todo
```

Le serveur démarre en attente stdin. Demande un outil → device code → sign-in → token cached. Ctrl+C pour fermer.

Maintenant Claude Desktop réutilise ce cache `~/.mcp-microsoft-todo/token-cache.json` directement, pas besoin de chercher dans les logs.

**Mettre à jour :** modifie la version dans args (`@mag-cie/mcp-microsoft-todo@latest`), redémarre Claude Desktop. Ou laisse npx faire le boulot (cache npx ~24h).

---

### 🟧 Cursor / Continue / autres clients MCP stdio

Tout client MCP qui supporte le transport **stdio** marche pareil. Format générique :

```
command: npx
args: -y @mag-cie/mcp-microsoft-todo
env: MS_TENANT=consumers (si compte perso)
```

Adapte au format de config du client (souvent JSON ou TOML similaire à Claude Desktop).

---

## 🆘 Troubleshooting auth

| Symptôme | Solution |
|---|---|
| Page "Cette page n'est pas la bonne" après sign-in | Ajoute `MS_TENANT=consumers` (compte perso uniquement) |
| Browser ouvre sur le mauvais compte Microsoft | Utilise une fenêtre **InPrivate/Incognito** pour le sign-in |
| Erreur `invalid_scope` ou `Tasks.ReadWrite.Shared` | Purge le token cache et re-auth : `rm -rf ~/.mcp-microsoft-todo` |
| `Node.js not found` ou `npx not found` | Installe Node.js 20+ depuis [nodejs.org](https://nodejs.org). Sur Windows, vérifie qu'il est dans le PATH (relance ton terminal après install) |
| Token expiré, refresh ne marche pas | Purge le cache et re-auth |
| Le device code n'apparaît jamais | Vérifie que le serveur est bien spawn — Claude Code : `claude mcp list` ; Claude Desktop : icône outils en bas. Si absent, vérifie le PATH de `npx` dans la config |
| `MS_CLIENT_ID non configuré` | Tu utilises un fork dev — exporte `MS_CLIENT_ID` ou utilise la version officielle npm |

---

## 🛠 Outils exposés

### Listes & tâches
| Outil | Description |
|---|---|
| `list_task_lists` | Toutes tes listes To Do |
| `list_tasks` | Tâches d'une liste (filtre OData, $orderby) |
| `get_task` | Détail d'une tâche par ID |
| `create_task` | Créer une tâche (title, body, importance, due date, categories, **récurrence, rappel**) |
| `update_task` | Modifier titre, statut, due date, récurrence, rappel… |
| `complete_task` | Marquer comme complétée |
| `delete_task` | Supprimer définitivement |
| `move_task` | Déplacer une tâche d'une liste à une autre |
| `search_tasks` | Recherche cross-listes par titre |
| `summarize_today` | Résumé tâches dues aujourd'hui + en retard |

### Batch operations (économise les appels)
| Outil | Description |
|---|---|
| `batch_create_tasks` | Crée jusqu'à 100 tâches en un seul appel HTTP Graph $batch |
| `batch_complete_tasks` | Marque jusqu'à 100 tâches comme complétées en un appel |
| `batch_delete_tasks` | Supprime jusqu'à 100 tâches en un appel |

### Sous-tâches (checklist items)
| Outil | Description |
|---|---|
| `list_checklist_items` | Sous-éléments d'une tâche |
| `create_checklist_item` | Ajouter un sous-élément |
| `update_checklist_item` | Renommer / cocher / décocher |
| `delete_checklist_item` | Supprimer un sous-élément |

### Ressources liées (URLs externes attachées à une tâche)
| Outil | Description |
|---|---|
| `list_linked_resources` | Liste les ressources liées d'une tâche |
| `create_linked_resource` | Attacher une URL ou ref externe |
| `delete_linked_resource` | Supprimer une ressource liée |

### Open extensions (metadata JSON custom)
| Outil | Description |
|---|---|
| `list_extensions` | Liste les open extensions d'une tâche |
| `set_extension` | Upsert : crée ou met à jour une extension (project_id, external_ref, etc.) |
| `delete_extension` | Supprimer une extension |

### Cross-list helpers
| Outil | Description |
|---|---|
| `list_overdue_tasks` | Toutes les tâches en retard, agrégées sur toutes les listes |
| `list_tasks_by_category` | Toutes les tâches avec une catégorie donnée, cross-listes |
| `bulk_update_categories` | Ajoute/retire des catégories à plusieurs tâches en 2 phases batch |

### Export
| Outil | Description |
|---|---|
| `export_tasks_ics` | Export iCalendar (VTODO + RRULE + VALARM) pour import Google Cal / Apple Cal / Outlook / Thunderbird |

### Format de sortie

Par défaut, les outils retournent un **format compact texte** (1 ligne / item) pour économiser les tokens du LLM. Légende :
- `[!]` importance haute, `[?]` basse (rien si normale)
- `[v]` complétée, `[>]` en cours, `[w]` en attente, `[d]` différée (rien si non commencée)
- `due:`, `rem:`, `rec:`, `cat:`, `body:` champs présents uniquement si renseignés

Pour obtenir le **JSON Graph complet**, passer `verbose: true` à n'importe quel outil de lecture.

---

## 🔒 Sécurité & confidentialité

- Le token Microsoft est stocké **uniquement sur ta machine** dans `~/.mcp-microsoft-todo/token-cache.json`
- Aucune donnée ne transite par les serveurs MAG-Cie
- Tu peux révoquer l'accès à tout moment depuis https://account.live.com/consent/Manage
- Pour purger le token local : `rm -rf ~/.mcp-microsoft-todo`

Permissions Graph demandées : `Tasks.ReadWrite` + `offline_access`.

---

## 🧑‍💻 Setup développeur (fork / contribution)

Si tu forkes ou veux développer en local avec ta propre App Registration Azure AD :

### 1. Azure AD App Registration (côté maintainer/fork uniquement)

1. https://portal.azure.com → **Microsoft Entra ID** → **App registrations** → **New registration**
2. Name : `mcp-microsoft-todo` (libre)
3. Supported account types : **Accounts in any organizational directory and personal Microsoft accounts**
4. Redirect URI : laisser vide
5. Register
6. Note le **Application (client) ID**
7. Onglet **Authentication** → **Allow public client flows** : **Yes**
8. Onglet **API permissions** → **Add a permission** → **Microsoft Graph** → **Delegated** → ajouter `Tasks.ReadWrite` et `offline_access`. **Grant admin consent** si tenant pro.

### 2. Build et auth locale

```bash
git clone https://github.com/mag-cie/mcp-microsoft-todo
cd mcp-microsoft-todo
npm install
npm run build
export MS_CLIENT_ID="<ton-client-id>"   # PowerShell : $env:MS_CLIENT_ID="..."
export MS_TENANT="common"
npm run auth
```

Le token cache sera écrit dans `~/.mcp-microsoft-todo/token-cache.json`.

### 3. Branchement Claude Code (build local)

```powershell
# Windows PowerShell
$env:MS_CLIENT_ID="<ton-client-id>"
claude mcp add --transport stdio microsoft-todo -- node "C:\path\to\mcp-microsoft-todo\dist\index.js"
```

```bash
# macOS / Linux
export MS_CLIENT_ID="<ton-client-id>"
claude mcp add --transport stdio microsoft-todo -- node /path/to/mcp-microsoft-todo/dist/index.js
```

> ⚠️ Variables d'env doivent être visibles au moment du spawn. Sur Windows avec fnm, vérifier que la session PowerShell qui lance `claude` a bien `MS_CLIENT_ID` exportée.

---

## 🗺 Roadmap

- [x] v0.1 — stdio + 6 outils CRUD
- [x] v0.2 — npm package distribuable, client ID baked-in
- [x] v0.3 — recurrence + reminders + checklists + linkedResources + search + move + summarize_today + retry/error robustness + tests vitest + format compact (verbose opt-in)
- [x] v0.4 — pagination auto + batch operations $batch + scope Tasks.ReadWrite.Shared (lecture listes partagées)
- [x] v0.5 — open extensions + cross-list helpers (overdue, by category, bulk update) + export iCalendar
- [ ] v1.0 — milestone stable : CI GitHub Actions + tests étendus + snapshots + README polish

---

## 📄 Licence

MIT
