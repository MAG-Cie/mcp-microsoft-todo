# mcp-microsoft-todo

> Version anglaise canonique : [README.md](README.md)

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
claude mcp remove microsoft-todo
claude mcp add --transport stdio microsoft-todo -- npx -y @mag-cie/mcp-microsoft-todo@latest
```

**Désinstaller :**

```bash
claude mcp remove microsoft-todo
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

**3. Redémarrer Claude Desktop COMPLÈTEMENT** (pas juste fermer la fenêtre).

**4. Première auth — astuce pré-cache :** lance dans un terminal avant Claude Desktop :

```bash
MS_TENANT=consumers npx -y @mag-cie/mcp-microsoft-todo
```

Le serveur démarre en attente stdin. Demande un outil → device code → sign-in → token cached. Ctrl+C. Claude Desktop réutilise ensuite ce cache.

---

### 🟧 Cursor / Continue / autres clients MCP stdio

Format générique :

```
command: npx
args: -y @mag-cie/mcp-microsoft-todo
env: MS_TENANT=consumers (si compte perso)
```

---

## 🆘 Troubleshooting auth

| Symptôme | Solution |
|---|---|
| Page "Cette page n'est pas la bonne" | Ajoute `MS_TENANT=consumers` (compte perso) |
| Browser ouvre sur le mauvais compte | Utilise une fenêtre **InPrivate/Incognito** |
| `invalid_scope` ou `Tasks.ReadWrite.Shared` | Purge le cache : `rm -rf ~/.mcp-microsoft-todo` |
| `Node.js not found` | Installe Node 20+ depuis [nodejs.org](https://nodejs.org) |
| Token expiré | Purge le cache et re-auth |

---

## 🛠 Outils exposés

24 outils répartis en : Listes & tâches, Batch operations, Sous-tâches (checklist items), Ressources liées, Open extensions, Cross-list helpers, Export iCalendar.

Voir la version anglaise [README.md](README.md) pour le détail complet.

### Format de sortie

Format compact texte par défaut (économie tokens). Légende : `[!]` high, `[?]` low ; `[v]` completed, `[>]` inProgress, `[w]` waiting, `[d]` deferred. Champs `due:`, `rem:`, `rec:`, `cat:`, `body:` affichés seulement si présents.

Pour le JSON Graph complet : passer `verbose: true`.

---

## 🔒 Sécurité & confidentialité

- Token stocké uniquement sur ta machine (`~/.mcp-microsoft-todo/token-cache.json`)
- Aucune donnée ne transite par les serveurs MAG&Cie
- Révocation : https://account.live.com/consent/Manage

Permissions Graph : `Tasks.ReadWrite`, `Tasks.ReadWrite.Shared`, `offline_access`.

---

## 📄 Licence

MIT — © MAG&Cie
