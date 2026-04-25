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
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const page = await browser.newPage();

  try {
    console.log("🔑 Haciendo login...");
    await page.goto(env.loginUrl);
    await page.fill(env.userSelector, env.user);
    await page.fill(env.passSelector, env.pass);
    await page.click(env.submitSelector);
    await page.waitForLoadState("networkidle");
    await sleep(env.postActionWait);
    console.log("   Login completado");

    console.log("🔄 Ejecutando DoFichaje('REABRIR')...");
    await page.evaluate(() => (window as any).DoFichaje("REABRIR"));
    await sleep(env.postActionWait);

    // Buscar qué hay en la página tras la llamada
    const html = await page.content();
    const visibleButtons = await page.$$eval(
      "button:visible, input[type='button']:visible, input[type='submit']:visible, a.btn:visible",
      (els) => els.map((el) => ({ tag: el.tagName, id: el.id, text: el.textContent?.trim(), className: el.className })),
    );
    console.log("🔍 Botones visibles tras DoFichaje:");
    visibleButtons.forEach((b) => console.log(`   ${b.tag} id="${b.id}" class="${b.className}" text="${b.text}"`));

    // Buscar diálogos/modales visibles
    const modals = await page.$$eval(
      "[class*='modal']:visible, [class*='dialog']:visible, [class*='popup']:visible, [class*='alert']:visible",
      (els) =>
        els.map((el) => ({ id: el.id, className: el.className, text: el.textContent?.trim().substring(0, 200) })),
    );
    console.log("🔍 Modales/diálogos visibles:");
    modals.forEach((m) => console.log(`   id="${m.id}" class="${m.className}" text="${m.text}"`));

    console.log("✅ Inspección completada!");

    console.log("   Navegador abierto 30s para inspección manual...");
    await sleep(30000);
  } catch (err) {
    console.error("❌ Error:", err);
    console.log("   Navegador abierto 30s para depurar...");
    await sleep(30000);
  } finally {
    await browser.close();
  }
}

main();
