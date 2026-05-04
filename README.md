# mcp-microsoft-todo

MCP server pour piloter **Microsoft To Do** depuis Claude Code, Claude Desktop, ou tout client MCP compatible.

Marche avec **n'importe quel compte Microsoft** : perso (outlook.com, hotmail.com, live.com), Office 365 perso ou pro, Microsoft 365. Aucun setup Azure côté utilisateur — juste sign-in via device code flow.

---

## 🚀 Installation utilisateur final (30 sec)

### Claude Code

```bash
claude mcp add --transport stdio microsoft-todo -- npx -y @mag-cie/mcp-microsoft-todo
```

Au premier appel d'un outil, le serveur affiche dans les logs un code à entrer sur https://microsoft.com/devicelogin avec ton compte Microsoft. Une fois fait, le token est mis en cache et refresh automatique ensuite.

### Claude Desktop (config JSON)

Dans `claude_desktop_config.json` :

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

Redémarre Claude Desktop. Premier appel → message device code dans les logs MCP.

### Pré-requis

- **Node.js 20+** installé sur ta machine
- Un compte Microsoft (gratuit ou pro)

C'est tout. Pas de compte Azure, pas d'App Registration, rien.

### Troubleshooting auth

Si tu utilises un compte Microsoft **personnel** (outlook.com, hotmail.com, live.com, msn.com, Office 365 perso) et que l'auth échoue avec une page "Cette page n'est pas la bonne" après le sign-in, ajoute la variable `MS_TENANT=consumers` :

```jsonc
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

Le défaut `common` couvre comptes pro + perso, mais l'endpoint `consumers` est plus fiable pour les comptes purement personnels (évite les conflits de session navigateur entre plusieurs comptes Microsoft).

Astuce : utilise une fenêtre **InPrivate/Incognito** pour le sign-in initial, ça évite que ton browser sélectionne automatiquement le mauvais compte si tu en as plusieurs.

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
- [ ] v0.4 — partage de listes (Graph beta `permissions`)
- [ ] v0.5 — pagination automatique sur listTasks (suit `@odata.nextLink`)
- [ ] v1.0 — version remote HTTP/SSE pour Claude.ai custom connector (multi-user OAuth proper)

---

## 📄 Licence

MIT
