/**
 * Microsoft auth via MSAL device code flow.
 * Token cache persisted to ~/.mcp-microsoft-todo/token-cache.json
 *
 * Standalone usage: `npm run auth` to perform the initial sign-in.
 * The MCP server then reuses the cache + silent refresh.
 */
import { PublicClientApplication, LogLevel } from "@azure/msal-node";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const CACHE_DIR = join(homedir(), ".mcp-microsoft-todo");
const CACHE_FILE = join(CACHE_DIR, "token-cache.json");

// To Do scopes — Tasks.ReadWrite.Shared also lets you read shared lists
// (delegated read-only via Graph). offline_access for silent refresh.
export const SCOPES = [
  "Tasks.ReadWrite",
  "Tasks.ReadWrite.Shared",
  "offline_access",
];

// Public client ID of the multi-tenant App Registration published by MAG&Cie.
// Public because device code flow = public client (no secret). Override via env if forking.
const DEFAULT_CLIENT_ID = "6ea8909b-95e0-4ef0-8b48-d5910f164c6a";

const CLIENT_ID = process.env.MS_CLIENT_ID || DEFAULT_CLIENT_ID;
const TENANT = process.env.MS_TENANT ?? "common"; // "common" = personal + work accounts

const beforeCacheAccess = async (cacheContext: any) => {
  try {
    const data = await readFile(CACHE_FILE, "utf-8");
    cacheContext.tokenCache.deserialize(data);
  } catch {
    // no cache yet
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
        loggerCallback: () => {}, // silent; otherwise pollutes MCP stdout
        logLevel: LogLevel.Error,
      },
    },
  });
}

/**
 * Acquire an access token. Tries silent (refresh) first, then device code.
 */
export async function getAccessToken(forceInteractive = false): Promise<string> {
  if (!CLIENT_ID || CLIENT_ID === "REPLACE_WITH_YOUR_CLIENT_ID") {
    throw new Error(
      "MS_CLIENT_ID not configured. Either the installed version has no baked-in client ID (dev fork), or you must export MS_CLIENT_ID. See README."
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
      // silent fail → fall through to device code
    }
  }

  const result = await pca.acquireTokenByDeviceCode({
    scopes: SCOPES,
    deviceCodeCallback: (response) => {
      // IMPORTANT: write to stderr so we don't break stdio MCP
      process.stderr.write("\n" + response.message + "\n\n");
    },
  });

  if (!result?.accessToken) {
    throw new Error("Failed to obtain an access token");
  }
  return result.accessToken;
}

// Standalone execution: `tsx src/auth.ts` or `node dist/auth.js`
// pathToFileURL handles Windows paths correctly (file:///C:/... vs file://C:/...)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  getAccessToken(true)
    .then(() => {
      console.log("✓ Auth successful. Token cache written to", CACHE_FILE);
      process.exit(0);
    })
    .catch((err) => {
      console.error("✗ Auth failed:", err.message);
      process.exit(1);
    });
}
