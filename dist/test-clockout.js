import "dotenv/config";
import { chromium } from "playwright";
const env = {
    loginUrl: process.env.LOGIN_URL,
    userSelector: process.env.LOGIN_USER_SELECTOR,
    passSelector: process.env.LOGIN_PASS_SELECTOR,
    submitSelector: process.env.LOGIN_SUBMIT_SELECTOR,
    user: process.env.LOGIN_USER,
    pass: process.env.LOGIN_PASS,
    postActionWait: Number(process.env.POST_ACTION_WAIT_MS ?? 3000),
    clockOutSelector: process.env.CLOCK_OUT_SELECTOR,
    clockOutConfirmSelector: process.env.CLOCK_OUT_SELECTOR_CONFIRM,
};
function sleep(ms) {
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
        // Clock Out
        console.log("🔴 Fichando salida...");
        await page.click(env.clockOutSelector);
        await page.waitForLoadState("networkidle");
        await sleep(env.postActionWait);
        // Confirmar
        console.log("   ✔️ Confirmando...");
        await page.click(env.clockOutConfirmSelector);
        await page.waitForLoadState("networkidle");
        await sleep(env.postActionWait);
        // Segunda confirmación
        console.log("   ✔️ Segunda confirmación...");
        await page.click(env.clockOutConfirmSelector);
        await page.waitForLoadState("networkidle");
        await sleep(env.postActionWait);
        console.log("✅ Clock out completado!");
        // Dejar el navegador abierto 10s para ver el resultado
        console.log("   Navegador abierto 10s para inspección...");
        await sleep(10000);
    }
    catch (err) {
        console.error("❌ Error:", err);
        // Dejar abierto para depurar
        console.log("   Navegador abierto 30s para depurar...");
        await sleep(30000);
    }
    finally {
        await browser.close();
    }
}
main();
