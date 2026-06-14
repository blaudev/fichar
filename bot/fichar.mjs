// Fichaje automático stateless para GitHub Actions.
// En cada ejecución: login -> lee el estado real del portal -> decide qué acción
// toca según la hora (Europe/Madrid) y la realiza. No guarda estado entre runs:
// el portal es la fuente de verdad ("Not started/In progress/On break/Ended").
import { chromium } from "playwright";

const URL = "https://portalempleado.addingplus.net/";
const USER = process.env.PORTAL_USER;
const PASS = process.env.PORTAL_PASS;
const DRY_RUN = process.env.DRY_RUN === "1";

if (!USER || !PASS) {
  console.error("❌ Faltan PORTAL_USER / PORTAL_PASS (configúralos en Secrets).");
  process.exit(1);
}

// Festivos (Barcelona 2026). Días sin fichaje.
const HOLIDAYS = new Set([
  "2026-01-01", "2026-01-06", "2026-04-03", "2026-04-06", "2026-05-01",
  "2026-05-25", "2026-06-24", "2026-08-15", "2026-09-11", "2026-09-24",
  "2026-10-12", "2026-12-08", "2026-12-25", "2026-12-26",
]);

// ── Hora local de Madrid (maneja el horario de verano automáticamente) ──
function madridNow() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  let hh = parseInt(p.hour, 10);
  if (hh === 24) hh = 0;
  const dateISO = `${p.year}-${p.month}-${p.day}`;
  const weekday = new Date(`${dateISO}T12:00:00Z`).getUTCDay(); // 0=domingo
  return { dateISO, minutes: hh * 60 + parseInt(p.minute, 10), weekday };
}

// Pseudoaleatorio determinista por día (mismo resultado en todas las ejecuciones del día)
function seed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function fmtMin(m) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// Horario objetivo del día (minutos desde medianoche), con jitter diario
function targetsFor(dateISO) {
  const clockIn = 8 * 60 + (seed(dateISO) % 16); // 08:00–08:15
  const pause = 13 * 60 + (seed(dateISO + "p") % 16); // 13:00–13:15
  const resume = pause + 25 + (seed(dateISO + "b") % 16); // pausa de 25–40 min
  const morning = pause - clockIn;
  const clockOut = resume + Math.max(8 * 60 - morning, 0); // completar ~8 h
  return { clockIn, pause, resume, clockOut };
}

// Decide la acción según estado real + hora. Devuelve null si no toca nada.
function decide(status, t, T) {
  const s = status.toLowerCase();
  const notStarted = s.includes("not started");
  const inProgress = s.includes("in progress");
  const onBreak = s.includes("on break");

  if (notStarted && t >= T.clockIn && t < T.pause) {
    return { name: "Entrada", button: "Start", confirm: "Start", expect: "In progress" };
  }
  if (inProgress && t >= T.pause && t < T.resume) {
    return { name: "Pausa", button: "Break", confirm: "Break", expect: "On break" };
  }
  if (onBreak && t >= T.resume) {
    return { name: "Reanudar", button: "Resume", confirm: "Resume", expect: "In progress" };
  }
  if (inProgress && t >= T.clockOut) {
    return { name: "Salida", button: "Finish", confirm: "End", expect: "Ended" };
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(page) {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator("input:not([type=checkbox]):not([type=password])").first().fill(USER);
  await page.fill('input[type="password"]', PASS);
  await Promise.all([
    page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {}),
    page.locator('button:has-text("Enter")').first().click(),
  ]);
  await page.waitForSelector("button.attendanceBtn", { timeout: 25_000 });
  await sleep(2000);
  // Forzar inglés para que los textos de estado/botón sean estables
  const toggle = page.locator("button.lang-toggle").first();
  if ((await toggle.count()) && (await toggle.textContent())?.trim().toUpperCase() !== "EN") {
    await toggle.click();
    await page.locator(".lang-item", { hasText: /^\s*EN\s*$/i }).first().click().catch(() => {});
    await page.waitForSelector("button.attendanceBtn", { timeout: 15_000 }).catch(() => {});
    await sleep(1500);
  }
}

async function readStatus(page) {
  return page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find(
      (n) => n.children.length === 0 && /Status:/i.test(n.textContent || ""),
    );
    const txt = el?.parentElement?.textContent?.replace(/\s+/g, " ").trim() || "";
    return txt.replace(/.*Status:\s*/i, "");
  });
}

async function doAction(page, action) {
  const btn = page.locator("button.attendanceBtn", { hasText: new RegExp(`^\\s*${action.button}\\s*$`, "i") }).first();
  if (!(await btn.count())) throw new Error(`Botón "${action.button}" no encontrado`);
  await btn.click();
  // Esperar a que el botón de confirmación del modal sea visible
  const confirm = page
    .locator(`.modal-content button`, { hasText: new RegExp(`^\\s*${action.confirm}\\s*$`, "i") })
    .first();
  await confirm.waitFor({ state: "visible", timeout: 15_000 });
  await sleep(500);
  await confirm.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(3000);
}

async function main() {
  const { dateISO, minutes, weekday } = madridNow();
  const T = targetsFor(dateISO);
  console.log(`📅 ${dateISO} (Madrid) ${fmtMin(minutes)} | objetivos: entrada ${fmtMin(T.clockIn)}, pausa ${fmtMin(T.pause)}, reanudar ${fmtMin(T.resume)}, salida ${fmtMin(T.clockOut)}`);

  const isWorkday = weekday >= 1 && weekday <= 5 && !HOLIDAYS.has(dateISO);
  if (!isWorkday && !DRY_RUN) {
    console.log("🟫 Fin de semana o festivo. Nada que hacer.");
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await login(page);
    const status = await readStatus(page);
    console.log(`🔎 Estado actual en el portal: "${status}"`);

    const action = decide(status, minutes, T);
    if (!action) {
      console.log("⏸️ No toca ninguna acción ahora.");
      return;
    }

    if (DRY_RUN) {
      console.log(`🧪 DRY_RUN: haría "${action.name}" (botón ${action.button} → confirmar ${action.confirm}).`);
      return;
    }

    console.log(`▶️ Ejecutando: ${action.name}...`);
    await doAction(page, action);
    const after = await readStatus(page);
    if (after.toLowerCase().includes(action.expect.toLowerCase())) {
      console.log(`✅ ${action.name} OK. Nuevo estado: "${after}"`);
    } else {
      console.log(`⚠️ ${action.name}: esperado "${action.expect}" pero el estado es "${after}"`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
