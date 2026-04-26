/**
 * Script de depuración paso a paso para CLOCK_OUT
 * - Pausa de 5 segundos entre cada paso
 * - Dump de elementos visibles en cada pausa
 * - CLOCK_OUT_SELECTOR_CONFIRM se pulsa DOS veces
 * - Timeout global de 3 minutos
 */
import "dotenv/config";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
const SCREENSHOTS_DIR = join(__dirname, "..", "screenshots");
const TIMEOUT_MS = 3 * 60 * 1000; // 3 minutos
const PAUSE_MS = 5_000; // 5 segundos
const env = {
    loginUrl: process.env.LOGIN_URL,
    userSelector: process.env.LOGIN_USER_SELECTOR,
    passSelector: process.env.LOGIN_PASS_SELECTOR,
    submitSelector: process.env.LOGIN_SUBMIT_SELECTOR,
    user: process.env.LOGIN_USER,
    pass: process.env.LOGIN_PASS,
    clockOutSelector: process.env.CLOCK_OUT_SELECTOR,
    clockOutConfirmSelector: process.env.CLOCK_OUT_SELECTOR_CONFIRM,
    reopenSelector: process.env.REOPEN_SELECTOR,
};
// ─── helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function pause(label) {
    console.log(`\n⏸  [PAUSA 5s] ${label}`);
    await sleep(PAUSE_MS);
}
async function screenshot(page, name) {
    if (!existsSync(SCREENSHOTS_DIR))
        mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = join(SCREENSHOTS_DIR, `step-clockout-${name}-${ts}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    console.log(`   📸 ${filePath}`);
}
async function dumpPage(page) {
    const url = page.url();
    const title = await page.title().catch(() => "(error)");
    console.log(`   🌐 URL   : ${url}`);
    console.log(`   📄 Título: ${title}`);
    const btns = await page.evaluate(() => {
        return [...document.querySelectorAll("a[id], button[id], input[type='submit'][id], input[type='button'][id]")]
            .map((el) => {
            const s = getComputedStyle(el);
            const visible = s.display !== "none" && s.visibility !== "hidden" && el.offsetWidth > 0;
            return {
                id: el.id,
                tag: el.tagName,
                text: (el.textContent || el.value || "").trim().substring(0, 60),
                visible,
                disabled: el.disabled ?? false,
            };
        })
            .filter((el) => el.id);
    });
    console.log(`   Botones con ID (${btns.length}):`);
    for (const b of btns) {
        const vis = b.visible ? "✅ visible" : "🚫 oculto";
        const dis = b.disabled ? " [disabled]" : "";
        console.log(`      <${b.tag}> #${b.id}  ${vis}${dis}  "${b.text}"`);
    }
}
async function infoSelector(page, selector) {
    const info = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el)
            return null;
        const s = getComputedStyle(el);
        return {
            tag: el.tagName,
            id: el.id,
            text: (el.textContent || el.value || "").trim().substring(0, 80),
            visible: s.display !== "none" && s.visibility !== "hidden" && el.offsetWidth > 0,
            disabled: el.disabled ?? false,
            outerHTML: el.outerHTML.substring(0, 300),
        };
    }, selector);
    if (!info) {
        console.log(`   ❌ No encontrado: ${selector}`);
    }
    else {
        const vis = info.visible ? "✅ visible" : "🚫 oculto";
        const dis = info.disabled ? " [DISABLED]" : "";
        console.log(`   🔍 ${selector}`);
        console.log(`      <${info.tag}> #${info.id}  ${vis}${dis}  "${info.text}"`);
        console.log(`      HTML: ${info.outerHTML}`);
    }
}
async function clickAndReport(page, selector, label) {
    console.log(`\n🖱  Haciendo click en [${label}]  →  ${selector}`);
    try {
        await page.click(selector, { timeout: 8000 });
        console.log(`   ✅ page.click() OK`);
        return;
    }
    catch (e1) {
        console.log(`   ⚠️  page.click() falló: ${e1}`);
    }
    // Fallback: JS click directo
    const found = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el)
            return false;
        el.click();
        return true;
    }, selector);
    if (found) {
        console.log(`   ✅ JS .click() OK`);
    }
    else {
        console.log(`   ❌ Elemento no encontrado en DOM: ${selector}`);
    }
}
// ─── pasos ───────────────────────────────────────────────────────────────────
async function run() {
    const browser = await chromium.launch({ headless: false, slowMo: 100 });
    const page = await browser.newPage();
    // ── PASO 0: Login ──────────────────────────────────────────────────────────
    console.log("\n══════════════════════════════════════════");
    console.log("PASO 0: Login");
    console.log("══════════════════════════════════════════");
    await page.goto(env.loginUrl, { waitUntil: "domcontentloaded" });
    await page.fill(env.userSelector, env.user);
    await page.fill(env.passSelector, env.pass);
    await page.click(env.submitSelector);
    await page.waitForLoadState("networkidle");
    console.log("   ✅ Login enviado");
    await screenshot(page, "00-login");
    await pause("Verifica que estés en la página principal");
    await dumpPage(page);
    // ── PASO 1: Estado inicial ─────────────────────────────────────────────────
    console.log("\n══════════════════════════════════════════");
    console.log("PASO 1: Estado inicial de botones");
    console.log("══════════════════════════════════════════");
    await infoSelector(page, env.clockOutSelector);
    await infoSelector(page, env.clockOutConfirmSelector);
    await infoSelector(page, env.reopenSelector);
    await screenshot(page, "01-estado-inicial");
    await pause("Observa qué botones están visibles antes de nada");
    // ── PASO 2: Click en Finalizar ─────────────────────────────────────────────
    console.log("\n══════════════════════════════════════════");
    console.log("PASO 2: Click en CLOCK_OUT (Finalizar)");
    console.log("══════════════════════════════════════════");
    await clickAndReport(page, env.clockOutSelector, "CLOCK_OUT");
    await page.waitForLoadState("networkidle").catch(() => { });
    await screenshot(page, "02-tras-finalizar");
    await pause("¿Aparece algún diálogo o botón de confirmación?");
    await dumpPage(page);
    // ── PASO 3: Inspección antes de 1ª confirmación ────────────────────────────
    console.log("\n══════════════════════════════════════════");
    console.log("PASO 3: Inspeccionar CLOCK_OUT_SELECTOR_CONFIRM (1ª vez)");
    console.log("══════════════════════════════════════════");
    await infoSelector(page, env.clockOutConfirmSelector);
    await screenshot(page, "03-antes-confirm1");
    await pause("Verifica si el selector CONFIRM está en el DOM y visible");
    // ── PASO 4: 1ª Confirmación (la página recarga tras este click) ───────────
    console.log("\n══════════════════════════════════════════");
    console.log("PASO 4: Click en CLOCK_OUT_SELECTOR_CONFIRM (1ª vez)");
    console.log("══════════════════════════════════════════");
    // Lanzamos navegación y click en paralelo para no perder el evento de recarga
    console.log("   ⏳ Esperando navegación/recarga tras el click...");
    await Promise.all([
        page
            .waitForNavigation({ waitUntil: "networkidle", timeout: 30_000 })
            .catch((e) => console.log(`   ℹ️  waitForNavigation: ${e instanceof Error ? e.message : e}`)),
        clickAndReport(page, env.clockOutConfirmSelector, "CONFIRM #1"),
    ]);
    // Por si acaso la recarga no disparó waitForNavigation (p.ej. AJAX pesado)
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => { });
    console.log("   ✅ Página estabilizada tras 1ª confirmación");
    await screenshot(page, "04-tras-confirm1");
    await pause("¿Cambió algo en la página tras la 1ª confirmación? (la página debería haber recargado)");
    await dumpPage(page);
    // ── PASO 5: Esperar que reaparezca CONFIRM en el nuevo DOM ─────────────────
    console.log("\n══════════════════════════════════════════");
    console.log("PASO 5: Esperar que CLOCK_OUT_SELECTOR_CONFIRM reaparezca (2ª vez)");
    console.log("══════════════════════════════════════════");
    console.log(`   ⏳ Esperando selector: ${env.clockOutConfirmSelector}`);
    try {
        await page.waitForSelector(env.clockOutConfirmSelector, { state: "visible", timeout: 20_000 });
        console.log("   ✅ Selector CONFIRM visible en nuevo DOM");
    }
    catch {
        console.log("   ❌ Selector CONFIRM NO apareció en 20s tras recarga — inspeccionando DOM...");
        await dumpPage(page);
    }
    await infoSelector(page, env.clockOutConfirmSelector);
    await screenshot(page, "05-antes-confirm2");
    await pause("¿Está disponible CONFIRM para la 2ª pulsación en la página recargada?");
    // ── PASO 6: 2ª Confirmación ────────────────────────────────────────────────
    console.log("\n══════════════════════════════════════════");
    console.log("PASO 6: Click en CLOCK_OUT_SELECTOR_CONFIRM (2ª vez)");
    console.log("══════════════════════════════════════════");
    await Promise.all([
        page
            .waitForNavigation({ waitUntil: "networkidle", timeout: 30_000 })
            .catch((e) => console.log(`   ℹ️  waitForNavigation: ${e instanceof Error ? e.message : e}`)),
        clickAndReport(page, env.clockOutConfirmSelector, "CONFIRM #2"),
    ]);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => { });
    console.log("   ✅ Página estabilizada tras 2ª confirmación");
    await screenshot(page, "06-tras-confirm2");
    await pause("¿La jornada quedó cerrada?");
    await dumpPage(page);
    // ── PASO 7: Verificación final ─────────────────────────────────────────────
    console.log("\n══════════════════════════════════════════");
    console.log("PASO 7: Verificación final");
    console.log("══════════════════════════════════════════");
    await infoSelector(page, env.reopenSelector);
    await infoSelector(page, env.clockOutSelector);
    await infoSelector(page, env.clockOutConfirmSelector);
    await screenshot(page, "07-verificacion-final");
    await pause("¿Está visible el botón Reabrir? Eso indica éxito");
    const reopenVisible = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el)
            return false;
        const s = getComputedStyle(el);
        return s.display !== "none" && s.visibility !== "hidden" && el.offsetWidth > 0;
    }, env.reopenSelector);
    if (reopenVisible) {
        console.log("\n🎉 ÉXITO: Botón Reabrir visible. Jornada cerrada correctamente.");
    }
    else {
        console.log("\n⚠️  POSIBLE FALLO: Botón Reabrir NO visible al final.");
    }
    console.log("\n   Navegador abierto 30s para inspección manual...");
    await sleep(30_000);
    await browser.close();
    console.log("\n🏁 Script finalizado.");
}
// ─── punto de entrada con timeout global ──────────────────────────────────────
const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`⏰ Timeout global (${TIMEOUT_MS / 1000}s) alcanzado`)), TIMEOUT_MS));
Promise.race([run(), timeout]).catch(async (err) => {
    console.error("\n❌ Error:", err instanceof Error ? err.message : err);
    process.exit(1);
});
