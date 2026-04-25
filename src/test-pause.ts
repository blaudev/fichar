import "dotenv/config";
import { chromium } from "playwright";

const env = {
  loginUrl: process.env.LOGIN_URL!,
  userSelector: process.env.LOGIN_USER_SELECTOR!,
  passSelector: process.env.LOGIN_PASS_SELECTOR!,
  submitSelector: process.env.LOGIN_SUBMIT_SELECTOR!,
  user: process.env.LOGIN_USER!,
  pass: process.env.LOGIN_PASS!,
  postActionWait: Number(process.env.POST_ACTION_WAIT_MS ?? 3000),
  pauseSelector: process.env.PAUSE_SELECTOR!,
  pauseConfirmSelector: process.env.PAUSE_SELECTOR_CONFIRM!,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const page = await browser.newPage();

  try {
    // Login
    console.log("🔑 Haciendo login...");
    await page.goto(env.loginUrl);
    await page.fill(env.userSelector, env.user);
    await page.fill(env.passSelector, env.pass);
    await page.click(env.submitSelector);
    await page.waitForLoadState("networkidle");
    await sleep(env.postActionWait);
    console.log("   Login completado");

    // Pause
    console.log("⏸️ Pausando...");
    await page.click(env.pauseSelector);
    await page.waitForLoadState("networkidle");
    await sleep(env.postActionWait);

    // Confirmar
    console.log("   ✔️ Confirmando...");
    await page.click(env.pauseConfirmSelector);
    await page.waitForLoadState("networkidle");
    await sleep(env.postActionWait);

    console.log("✅ Pausa completada!");

    // Dejar el navegador abierto 10s para ver el resultado
    console.log("   Navegador abierto 10s para inspección...");
    await sleep(10000);
  } catch (err) {
    console.error("❌ Error:", err);
    console.log("   Navegador abierto 30s para depurar...");
    await sleep(30000);
  } finally {
    await browser.close();
  }
}

main();
