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
};
function sleep(ms) {
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
        // Listar todos los botones visibles
        const buttons = await page.$$eval("button:visible, input[type='button']:visible, input[type='submit']:visible", (els) => els.map((el) => ({ tag: el.tagName, id: el.id, text: el.textContent?.trim(), value: el.value || "" })));
        console.log("🔍 Botones visibles tras login:");
        buttons.forEach((b) => console.log(`   ${b.tag} id="${b.id}" text="${b.text}" value="${b.value}"`));
        // Comprobar botones concretos
        const knownIds = [
            "ContentPlaceHolder1_ucUsuariosFichaje_User1_btnIniciar",
            "ContentPlaceHolder1_ucUsuariosFichaje_User1_btnParar",
            "ContentPlaceHolder1_ucUsuariosFichaje_User1_btnReanudar",
            "ContentPlaceHolder1_ucUsuariosFichaje_User1_btnFinalizar",
            "ContentPlaceHolder1_ucUsuariosFichaje_User1_btnReabrir",
        ];
        console.log("\n📋 Estado de botones conocidos:");
        for (const id of knownIds) {
            const el = await page.$(`#${id}`);
            const visible = el ? await el.isVisible() : false;
            const name = id.split("_").pop();
            console.log(`   ${name}: ${el ? (visible ? "✅ VISIBLE" : "⚠️ existe pero oculto") : "❌ no encontrado"}`);
        }
        console.log("\n   Navegador abierto 15s para inspección...");
        await sleep(15000);
    }
    catch (err) {
        console.error("❌ Error:", err);
        await sleep(30000);
    }
    finally {
        await browser.close();
    }
}
main();
