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
  clockOutSelector: process.env.CLOCK_OUT_SELECTOR!,
  clockOutConfirmSelector: process.env.CLOCK_OUT_SELECTOR_CONFIRM!,
  reopenSelector: process.env.REOPEN_SELECTOR!,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
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

    // Inspect clock-out button
    console.log("\n📋 Inspeccionando botón Finalizar...");
    const clockOutInfo = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { exists: false, selector: sel };
      return {
        exists: true,
        selector: sel,
        tag: el.tagName,
        id: el.id,
        type: (el as HTMLInputElement).type || null,
        text: (el.textContent || "").trim(),
        href: (el as HTMLAnchorElement).href || null,
        outerHTML: el.outerHTML.substring(0, 300),
        display: getComputedStyle(el).display,
        visibility: getComputedStyle(el).visibility,
      };
    }, env.clockOutSelector);
    console.log("   Botón Finalizar:", JSON.stringify(clockOutInfo, null, 2));

    if (!clockOutInfo.exists) {
      console.log("❌ Botón Finalizar no encontrado. Listando todos los botones/links...");
      await dumpVisibleElements(page);
      await sleep(30000);
      return;
    }

    // Click clock-out using evaluate (like the extension does)
    console.log("\n🔴 Haciendo click en Finalizar (vía evaluate, como la extensión)...");
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) (el as HTMLElement).click();
    }, env.clockOutSelector);

    console.log("   Click realizado, esperando respuesta...");
    await sleep(2000);

    // Inspect confirm button - poll for it
    console.log("\n📋 Buscando botón de confirmación...");
    console.log(`   Selector: ${env.clockOutConfirmSelector}`);

    for (let i = 0; i < 20; i++) {
      const confirmInfo = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { exists: false };
        return {
          exists: true,
          tag: el.tagName,
          id: el.id,
          text: (el.textContent || "").trim(),
          href: (el as HTMLAnchorElement).href || null,
          outerHTML: el.outerHTML.substring(0, 300),
          display: getComputedStyle(el).display,
          visibility: getComputedStyle(el).visibility,
          offsetWidth: (el as HTMLElement).offsetWidth,
          offsetHeight: (el as HTMLElement).offsetHeight,
        };
      }, env.clockOutConfirmSelector);

      if (confirmInfo.exists) {
        console.log(`   ✅ Encontrado en intento ${i + 1}:`, JSON.stringify(confirmInfo, null, 2));

        // Try clicking it
        await sleep(500);
        console.log("\n   ✔️ Haciendo click en confirmación...");
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) (el as HTMLElement).click();
        }, env.clockOutConfirmSelector);

        await sleep(3000);

        // Check for second confirm
        console.log("\n📋 Buscando segunda confirmación...");
        const confirm2 = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return { exists: false };
          return {
            exists: true,
            tag: el.tagName,
            outerHTML: el.outerHTML.substring(0, 300),
          };
        }, env.clockOutConfirmSelector);

        if (confirm2.exists) {
          console.log("   ✅ Segunda confirmación encontrada:", JSON.stringify(confirm2, null, 2));
          await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) (el as HTMLElement).click();
          }, env.clockOutConfirmSelector);
          await sleep(3000);
        } else {
          console.log("   ℹ️ No hay segunda confirmación");
        }

        // Verify: check if reopen button is visible
        const reopenInfo = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          return el ? { exists: true, tag: el.tagName, text: (el.textContent || "").trim() } : { exists: false };
        }, env.reopenSelector);
        console.log("\n📋 Botón Reabrir:", JSON.stringify(reopenInfo, null, 2));

        if (reopenInfo.exists) {
          console.log("\n✅ Clock out completado con éxito!");
        } else {
          console.log("\n⚠️ Clock out puede haber fallado (botón Reabrir no visible)");
          await dumpVisibleElements(page);
        }

        break;
      }

      if (i % 4 === 3) {
        console.log(`   Intento ${i + 1}/20: no encontrado aún...`);
        // Dump page elements every few attempts
        if (i === 7) {
          console.log("   Listando elementos visibles:");
          await dumpVisibleElements(page);
        }
      }
      await sleep(500);
    }

    // Also try with Playwright's native click for comparison
    console.log("\n\n--- COMPARACIÓN: Click nativo de Playwright ---");
    console.log("(Si lo anterior falló, reintentando con page.click)");

    const stillResumed = await page.evaluate((sel) => !!document.querySelector(sel), env.clockOutSelector);
    if (stillResumed) {
      console.log("   Botón Finalizar aún presente, reintentando con Playwright...");
      await page.click(env.clockOutSelector);
      await page.waitForLoadState("networkidle");
      await sleep(env.postActionWait);

      try {
        await page.waitForSelector(env.clockOutConfirmSelector, { timeout: 15000 });
        console.log("   ✅ Confirmación encontrada con Playwright!");
        const html = await page.evaluate((sel) => document.querySelector(sel)?.outerHTML, env.clockOutConfirmSelector);
        console.log("   HTML:", html);
      } catch {
        console.log("   ❌ Playwright tampoco encontró la confirmación");
      }
    } else {
      console.log("   (Botón Finalizar ya no está, el click anterior funcionó)");
    }

    console.log("\n   Navegador abierto 30s para inspección manual...");
    await sleep(30000);
  } catch (err) {
    console.error("❌ Error:", err);
    await dumpVisibleElements(page);
    console.log("   Navegador abierto 30s para depurar...");
    await sleep(30000);
  } finally {
    await browser.close();
  }
}

async function dumpVisibleElements(page: import("playwright").Page) {
  const elements = await page.evaluate(() => {
    const els = [...document.querySelectorAll("a, button, input[type='submit'], input[type='button']")];
    return els
      .filter((e) => {
        const s = getComputedStyle(e);
        return s.display !== "none" && s.visibility !== "hidden";
      })
      .map((e) => ({
        tag: e.tagName,
        id: e.id || "(sin id)",
        text: (e.textContent || "").trim().substring(0, 60),
        href: (e as HTMLAnchorElement).href ? (e as HTMLAnchorElement).href.substring(0, 100) : null,
      }));
  });
  console.log("   Elementos visibles:");
  elements.forEach((e, i) => console.log(`   ${i + 1}. <${e.tag}> id="${e.id}" text="${e.text}" href=${e.href}`));
}

main();
