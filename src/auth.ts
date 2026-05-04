/**
 * Auth Microsoft via MSAL device code flow.
 * Token cache persisté dans ~/.mcp-microsoft-todo/token-cache.json
 *
 * Usage standalone : `npm run auth` pour faire l'auth initiale.
 * Le serveur MCP réutilise ensuite le cache + refresh silencieux.
 */
import { PublicClientApplication, LogLevel } from "@azure/msal-node";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const CACHE_DIR = join(homedir(), ".mcp-microsoft-todo");
const CACHE_FILE = join(CACHE_DIR, "token-cache.json");

// Scopes To Do — Tasks.ReadWrite.Shared permet aussi de lire les listes partagées avec toi
// (lecture seule via Graph côté delegated). offline_access pour refresh silencieux.
export const SCOPES = [
  "Tasks.ReadWrite",
  "Tasks.ReadWrite.Shared",
  "offline_access",
];

// Client ID public de l'App Registration multi-tenant publiée par MAG-Cie.
// Public car device code flow = public client (aucun secret). Override via env si fork.
const DEFAULT_CLIENT_ID = "6ea8909b-95e0-4ef0-8b48-d5910f164c6a";

const CLIENT_ID = process.env.MS_CLIENT_ID || DEFAULT_CLIENT_ID;
const TENANT = process.env.MS_TENANT ?? "common"; // "common" = comptes perso + pro

const beforeCacheAccess = async (cacheContext: any) => {
  try {
    const data = await readFile(CACHE_FILE, "utf-8");
    cacheContext.tokenCache.deserialize(data);
  } catch {
    // pas de cache encore
  }
};

const afterCacheAccess = async (cacheContext: any) => {
  if (cacheContext.cacheHasChanged) {
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, cacheContext.tokenCache.serialize(), "utf-8");
  }
};

export function buildClient(): PublicClientApplication {
  return new PublicClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT}`,
    },
    cache: {
      cachePlugin: { beforeCacheAccess, afterCacheAccess },
    },
    system: {
      loggerOptions: {
        loggerCallback: () => {}, // silencieux ; sinon ça pollue stdout MCP
        logLevel: LogLevel.Error,
      },
    },
  });
}

/**
 * Récupère un access token. Tente d'abord silent (refresh), sinon device code.
 */
export async function getAccessToken(forceInteractive = false): Promise<string> {
  if (!CLIENT_ID || CLIENT_ID === "REPLACE_WITH_YOUR_CLIENT_ID") {
    throw new Error(
      "MS_CLIENT_ID non configuré. Soit la version installée n'a pas de client ID baked-in (fork dev), soit tu dois exporter MS_CLIENT_ID. Voir README."
    );
  }

  const pca = buildClient();
  const accounts = await pca.getTokenCache().getAllAccounts();

  if (!forceInteractive && accounts.length > 0) {
    try {
      const result = await pca.acquireTokenSilent({
        account: accounts[0],
        scopes: SCOPES,
      });
      if (result?.accessToken) return result.accessToken;
    } catch {
      // silent fail → on tombe sur device code
    }
  }

  const result = await pca.acquireTokenByDeviceCode({
    scopes: SCOPES,
    deviceCodeCallback: (response) => {
      // IMPORTANT : on écrit sur stderr pour ne pas casser stdio MCP
      process.stderr.write("\n" + response.message + "\n\n");
    },
  });

  if (!result?.accessToken) {
    throw new Error("Impossible d'obtenir un access token");
  }
  return result.accessToken;
}

// Exécution standalone : `tsx src/auth.ts` ou `node dist/auth.js`
// pathToFileURL gère correctement les chemins Windows (file:///C:/... vs file://C:/...)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  getAccessToken(true)
    .then(() => {
      console.log("✓ Auth réussie. Token cache écrit dans", CACHE_FILE);
      process.exit(0);
    })
    .catch((err) => {
      console.error("✗ Auth échouée:", err.message);
      process.exit(1);
    });
}
