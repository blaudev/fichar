import "dotenv/config";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
const SCREENSHOTS_DIR = join(__dirname, "..", "screenshots");
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
    reopenSelector: process.env.REOPEN_SELECTOR,
};
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function screenshot(page, name) {
    if (!existsSync(SCREENSHOTS_DIR))
        mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const path = join(SCREENSHOTS_DIR, `clockout-${name}-${ts}.png`);
    await page.screenshot({ path, fullPage: true });
    console.log(`   📸 Screenshot: ${path}`);
}
async function dumpButtons(page) {
    const elements = await page.evaluate(() => {
        const els = [...document.querySelectorAll("a, button, input[type='submit'], input[type='button']")];
        return els.map((e) => {
            const s = getComputedStyle(e);
            return {
                tag: e.tagName,
                id: e.id || "(sin id)",
                text: (e.textContent || "").trim().substring(0, 80),
                href: e.href ? e.href.substring(0, 120) : null,
                visible: s.display !== "none" && s.visibility !== "hidden",
                outerHTML: e.outerHTML.substring(0, 200),
            };
        });
    });
    console.log("\n📋 Todos los elementos interactivos:");
    elements.forEach((e, i) => console.log(`   ${i + 1}. [${e.visible ? "VISIBLE" : "OCULTO"}] <${e.tag}> id="${e.id}" text="${e.text}"\n      HTML: ${e.outerHTML}`));
    return elements;
}
async function tryClick(page, selector, label) {
    // Strategy 1: page.click with force
    try {
        console.log(`   Estrategia 1 (page.click force): ${label}...`);
        await page.click(selector, { force: true, timeout: 5000 });
        console.log(`   ✅ Click exitoso`);
        return true;
    }
    catch (e) {
        console.log(`   ❌ Falló: ${e}`);
    }
    // Strategy 2: evaluate click
    try {
        console.log(`   Estrategia 2 (JS click): ${label}...`);
        const clicked = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) {
                el.click();
                return true;
            }
            return false;
        }, selector);
        if (clicked) {
            console.log(`   ✅ JS Click exitoso`);
            return true;
        }
        console.log(`   ❌ Elemento no encontrado para JS click`);
    }
    catch (e) {
        console.log(`   ❌ Falló: ${e}`);
    }
    // Strategy 3: __doPostBack for ASP.NET
    try {
        console.log(`   Estrategia 3 (__doPostBack): ${label}...`);
        const posted = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el)
                return { success: false, reason: "not found" };
            // Check if it's an ASP.NET postback link
            const href = el.getAttribute("href") || "";
            const onclick = el.getAttribute("onclick") || "";
            if (href.includes("__doPostBack")) {
                // Extract the target from javascript:__doPostBack('target','')
                const match = href.match(/__doPostBack\('([^']+)'/);
                if (match) {
                    window.__doPostBack(match[1], "");
                    return { success: true, method: "doPostBack from href", target: match[1] };
                }
            }
            if (onclick.includes("__doPostBack")) {
                const match = onclick.match(/__doPostBack\('([^']+)'/);
                if (match) {
                    window.__doPostBack(match[1], "");
                    return { success: true, method: "doPostBack from onclick", target: match[1] };
                }
            }
            // Try WebForm_DoPostBackWithOptions for ASP.NET buttons
            if (onclick.includes("WebForm_DoPostBackWithOptions")) {
                eval(onclick);
                return { success: true, method: "WebForm_DoPostBackWithOptions" };
            }
            return { success: false, reason: "no postback found", href, onclick };
        }, selector);
        console.log(`   PostBack result:`, JSON.stringify(posted));
        if (posted.success)
            return true;
    }
    catch (e) {
        console.log(`   ❌ Falló: ${e}`);
    }
    // Strategy 4: dispatchEvent
    try {
        console.log(`   Estrategia 4 (dispatchEvent): ${label}...`);
        const dispatched = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el)
                return false;
            el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            return true;
        }, selector);
        if (dispatched) {
            console.log(`   ✅ dispatchEvent exitoso`);
            return true;
        }
    }
    catch (e) {
        console.log(`   ❌ Falló: ${e}`);
    }
    return false;
}
async function main() {
    console.log("🔴 Script de FINALIZAR (Clock Out)");
    console.log(`   URL: ${env.loginUrl}`);
    console.log(`   Clock Out selector: ${env.clockOutSelector}`);
    console.log(`   Confirm selector: ${env.clockOutConfirmSelector}`);
    console.log(`   Reopen selector: ${env.reopenSelector}`);
    console.log("");
    const browser = await chromium.launch({ headless: false, slowMo: 200 });
    const page = await browser.newPage();
    try {
        // === LOGIN ===
        console.log("🔑 Haciendo login...");
        await page.goto(env.loginUrl, { waitUntil: "networkidle" });
        await page.fill(env.userSelector, env.user);
        await page.fill(env.passSelector, env.pass);
        await page.click(env.submitSelector);
        await page.waitForLoadState("networkidle");
        await sleep(env.postActionWait);
        console.log("   ✅ Login completado");
        await screenshot(page, "01-after-login");
        // === CHECK STATE ===
        console.log("\n📋 Estado actual de botones:");
        const knownIds = [
            { id: "ContentPlaceHolder1_ucUsuariosFichaje_User1_btnIniciar", name: "Iniciar" },
            { id: "ContentPlaceHolder1_ucUsuariosFichaje_User1_btnParar", name: "Parar" },
            { id: "ContentPlaceHolder1_ucUsuariosFichaje_User1_btnReanudar", name: "Reanudar" },
            { id: "ContentPlaceHolder1_ucUsuariosFichaje_User1_btnFinalizar", name: "Finalizar" },
            { id: "ContentPlaceHolder1_ucUsuariosFichaje_User1_btnReabrir", name: "Reabrir" },
        ];
        for (const { id, name } of knownIds) {
            const el = await page.$(`#${id}`);
            if (el) {
                const visible = await el.isVisible();
                const html = await el.evaluate((e) => e.outerHTML.substring(0, 200));
                console.log(`   ${name}: ${visible ? "✅ VISIBLE" : "⚠️ OCULTO"} -> ${html}`);
            }
            else {
                console.log(`   ${name}: ❌ no encontrado`);
            }
        }
        // === CLICK FINALIZAR ===
        console.log("\n🔴 Paso 1: Click en Finalizar...");
        const clockOutBtn = await page.$(env.clockOutSelector);
        if (!clockOutBtn) {
            console.log("   ❌ Botón Finalizar NO encontrado con selector: " + env.clockOutSelector);
            console.log("   Probando búsqueda alternativa...");
            await dumpButtons(page);
            await screenshot(page, "02-no-finalizar-btn");
            await sleep(30000);
            return;
        }
        const isVisible = await clockOutBtn.isVisible();
        console.log(`   Botón encontrado, visible: ${isVisible}`);
        const clicked = await tryClick(page, env.clockOutSelector, "Finalizar");
        if (!clicked) {
            console.log("   ❌ Ninguna estrategia funcionó para Finalizar");
            await screenshot(page, "02-click-failed");
            await sleep(30000);
            return;
        }
        console.log("   Esperando respuesta del servidor...");
        await page.waitForLoadState("networkidle").catch(() => console.log("   (networkidle timeout, continuando...)"));
        await sleep(env.postActionWait);
        await screenshot(page, "03-after-finalizar-click");
        // === CONFIRMATION ===
        console.log("\n🔴 Paso 2: Confirmación...");
        console.log(`   Buscando: ${env.clockOutConfirmSelector}`);
        // Wait a bit for the confirm dialog/button to appear
        let confirmFound = false;
        for (let attempt = 0; attempt < 15; attempt++) {
            const confirmEl = await page.$(env.clockOutConfirmSelector);
            if (confirmEl) {
                const vis = await confirmEl.isVisible().catch(() => false);
                if (vis) {
                    console.log(`   ✅ Botón confirmación encontrado (intento ${attempt + 1})`);
                    const html = await confirmEl.evaluate((e) => e.outerHTML.substring(0, 300));
                    console.log(`   HTML: ${html}`);
                    confirmFound = true;
                    break;
                }
            }
            await sleep(500);
        }
        if (!confirmFound) {
            console.log("   ⚠️ Botón de confirmación no encontrado con selector original");
            console.log("   Buscando cualquier botón de confirmación visible...");
            await dumpButtons(page);
            await screenshot(page, "04-no-confirm-btn");
            // Try finding confirm by text content
            const altConfirm = await page.evaluate(() => {
                const btns = [...document.querySelectorAll("a, button, input")];
                return btns
                    .filter((b) => {
                    const text = (b.textContent || b.value || "").toLowerCase();
                    return ((text.includes("finalizar") || text.includes("confirmar") || text.includes("aceptar")) &&
                        getComputedStyle(b).display !== "none");
                })
                    .map((b) => ({
                    tag: b.tagName,
                    id: b.id,
                    text: (b.textContent || "").trim(),
                    outerHTML: b.outerHTML.substring(0, 300),
                }));
            });
            console.log("   Botones con texto 'finalizar/confirmar/aceptar':", JSON.stringify(altConfirm, null, 2));
            if (altConfirm.length > 0 && altConfirm[0].id) {
                console.log(`   Intentando click en alternativo: #${altConfirm[0].id}`);
                await tryClick(page, `#${altConfirm[0].id}`, "Confirmación alternativa");
                await sleep(env.postActionWait);
            }
            else {
                console.log("   ❌ No se encontró ningún botón de confirmación");
                await sleep(30000);
                return;
            }
        }
        else {
            await tryClick(page, env.clockOutConfirmSelector, "Confirmación");
            await page.waitForLoadState("networkidle").catch(() => { });
            await sleep(env.postActionWait);
        }
        await screenshot(page, "05-after-confirm");
        // === SECOND CONFIRMATION (if any) ===
        console.log("\n🔴 Paso 3: Segunda confirmación (si existe)...");
        // Esperar que el selector reaparezca en el DOM tras la recarga de la 1ª confirmación
        let confirm2 = null;
        try {
            await page.waitForSelector(env.clockOutConfirmSelector, { state: "visible", timeout: 20_000 });
            confirm2 = await page.$(env.clockOutConfirmSelector);
        }
        catch {
            confirm2 = null;
        }
        if (confirm2) {
            const vis2 = await confirm2.isVisible().catch(() => false);
            if (vis2) {
                console.log("   ✅ Segunda confirmación encontrada, clickando...");
                await Promise.all([
                    page.waitForNavigation({ waitUntil: "networkidle", timeout: 30_000 }).catch(() => { }),
                    tryClick(page, env.clockOutConfirmSelector, "Segunda confirmación"),
                ]);
                await page.waitForLoadState("networkidle").catch(() => { });
                await sleep(env.postActionWait);
                await screenshot(page, "06-after-confirm2");
            }
            else {
                console.log("   ℹ️ Segundo botón existe pero no es visible");
            }
        }
        else {
            console.log("   ℹ️ No hay segunda confirmación (ni apareció en 20s)");
        }
        // === VERIFY ===
        console.log("\n📋 Verificación final:");
        const reopenBtn = await page.$(env.reopenSelector);
        if (reopenBtn) {
            const vis = await reopenBtn.isVisible().catch(() => false);
            console.log(`   Botón Reabrir: ${vis ? "✅ VISIBLE - Clock out EXITOSO!" : "⚠️ existe pero oculto"}`);
        }
        else {
            console.log("   ❌ Botón Reabrir no encontrado");
        }
        // Final state dump
        console.log("\n📋 Estado final de botones:");
        for (const { id, name } of knownIds) {
            const el = await page.$(`#${id}`);
            if (el) {
                const visible = await el.isVisible().catch(() => false);
                console.log(`   ${name}: ${visible ? "✅ VISIBLE" : "⚠️ OCULTO"}`);
            }
            else {
                console.log(`   ${name}: ❌ no encontrado`);
            }
        }
        await screenshot(page, "07-final");
        console.log("\n   Navegador abierto 15s para inspección...");
        await sleep(15000);
    }
    catch (err) {
        console.error("❌ Error:", err);
        await screenshot(page, "error");
        await dumpButtons(page);
        console.log("   Navegador abierto 30s para depurar...");
        await sleep(30000);
    }
    finally {
        await browser.close();
        console.log("\n🏁 Script finalizado");
    }
}
main();
