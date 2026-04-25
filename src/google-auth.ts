import "dotenv/config";
import { google } from "googleapis";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const TOKEN_PATH = join(__dirname, "..", "google-token.json");
const SCOPES = ["https://www.googleapis.com/auth/calendar"];

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/oauth2callback";

  if (!clientId || !clientSecret) {
    throw new Error("Faltan GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET en .env");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function getAuthenticatedClient() {
  const oauth2Client = getOAuth2Client();

  if (existsSync(TOKEN_PATH)) {
    const tokens = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
    oauth2Client.setCredentials(tokens);

    // Refresh si ha expirado
    oauth2Client.on("tokens", (newTokens) => {
      const merged = { ...tokens, ...newTokens };
      writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
    });

    return oauth2Client;
  }

  throw new Error("No hay token de Google guardado. Ejecuta primero: pnpm run google-auth");
}

/**
 * Flujo interactivo de autorización OAuth2.
 * Levanta un servidor HTTP local temporal para capturar el callback.
 */
export async function authorizeInteractive(): Promise<void> {
  const oauth2Client = getOAuth2Client();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/oauth2callback";
  const port = new URL(redirectUri).port || "3000";

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log("\n🔗 Abre esta URL en tu navegador para autorizar:\n");
  console.log(authUrl);
  console.log(`\n⏳ Esperando callback en ${redirectUri}...\n`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${port}`);
      const code = url.searchParams.get("code");
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>✅ Autorización completada. Puedes cerrar esta pestaña.</h1>");
        server.close();
        resolve(code);
      } else {
        res.writeHead(400);
        res.end("No se recibió el código de autorización");
      }
    });
    server.listen(Number(port), () => {});
    server.on("error", reject);
  });

  const { tokens } = await oauth2Client.getToken(code);
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log("✅ Token guardado en google-token.json");
}

// Si se ejecuta directamente, lanzar flujo interactivo
const isDirectRun = process.argv[1]?.endsWith("google-auth.ts") || process.argv[1]?.endsWith("google-auth.js");
if (isDirectRun) {
  authorizeInteractive().catch(console.error);
}
