import "dotenv/config";
import cron from "node-cron";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { getTodaySchedule } from "./google-calendar";

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const FORTY_HOURS_MS = 40 * 60 * 60 * 1000;
const WEEK_LOG_PATH = join(__dirname, "..", "week-hours.json");
const DAY_STATE_PATH = join(__dirname, "..", "day-state.json");
const LOG_PATH = join(__dirname, "..", "fichar.log");
const SCREENSHOTS_DIR = join(__dirname, "..", "screenshots");

function log(message: string): void {
  const timestamp = new Date().toLocaleString("es-ES");
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  appendFileSync(LOG_PATH, line + "\n");
}

function logError(message: string, err: unknown): void {
  const timestamp = new Date().toLocaleString("es-ES");
  const line = `[${timestamp}] ❌ ${message}: ${err}`;
  console.error(line);
  appendFileSync(LOG_PATH, line + "\n");
}

const env = {
  loginUrl: process.env.LOGIN_URL!,
  userSelector: process.env.LOGIN_USER_SELECTOR!,
  passSelector: process.env.LOGIN_PASS_SELECTOR!,
  submitSelector: process.env.LOGIN_SUBMIT_SELECTOR!,
  user: process.env.LOGIN_USER!,
  pass: process.env.LOGIN_PASS!,
  postActionWait: Number(process.env.POST_ACTION_WAIT_MS ?? 2000),
  clockInSelector: process.env.CLOCK_IN_SELECTOR!,
  clockInConfirmSelector: process.env.CLOCK_IN_SELECTOR_CONFIRM!,
  pauseSelector: process.env.PAUSE_SELECTOR!,
  pauseConfirmSelector: process.env.PAUSE_SELECTOR_CONFIRM!,
  resumeSelector: process.env.RESUME_SELECTOR!,
  resumeConfirmSelector: process.env.RESUME_SELECTOR_CONFIRM!,
  clockOutSelector: process.env.CLOCK_OUT_SELECTOR!,
  clockOutConfirmSelector: process.env.CLOCK_OUT_SELECTOR_CONFIRM!,
  reopenSelector: process.env.REOPEN_SELECTOR!,
};

function randomBetween(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs)) + minMs;
}

function minutesToMs(min: number): number {
  return min * 60 * 1000;
}

function todayAt(hours: number, minutes: number): Date {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

interface WeekLog {
  weekNumber: number;
  days: Record<string, number>; // "lunes" -> ms trabajados
}

function getWeekNumber(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - start.getTime();
  return Math.ceil((diff / (1000 * 60 * 60 * 24) + start.getDay() + 1) / 7);
}

function loadWeekLog(): WeekLog {
  const currentWeek = getWeekNumber();
  if (existsSync(WEEK_LOG_PATH)) {
    const data: WeekLog = JSON.parse(readFileSync(WEEK_LOG_PATH, "utf-8"));
    if (data.weekNumber === currentWeek) return data;
  }
  return { weekNumber: currentWeek, days: {} };
}

function saveWeekLog(log: WeekLog): void {
  writeFileSync(WEEK_LOG_PATH, JSON.stringify(log, null, 2));
}

function getAccumulatedMs(): number {
  const log = loadWeekLog();
  return Object.values(log.days).reduce((sum, ms) => sum + ms, 0);
}

function saveDayMs(dayName: string, ms: number): void {
  const log = loadWeekLog();
  log.days[dayName] = ms;
  saveWeekLog(log);
}

function isFriday(): boolean {
  return new Date().getDay() === 5;
}

type DayPhase = "started" | "clocked-in" | "paused" | "resumed" | "clocked-out";

interface DayState {
  date: string; // YYYY-MM-DD
  phase: DayPhase;
  clockInTime: string;
  pauseTime: string;
  resumeTime: string;
  clockOutTime: string;
  clockInTimestamp?: number; // real ms timestamp when clock-in happened
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function loadDayState(): DayState | null {
  if (!existsSync(DAY_STATE_PATH)) return null;
  try {
    const data: DayState = JSON.parse(readFileSync(DAY_STATE_PATH, "utf-8"));
    if (data.date === todayISO()) return data;
  } catch {
    /* corrupt file, ignore */
  }
  return null;
}

function saveDayState(state: DayState): void {
  writeFileSync(DAY_STATE_PATH, JSON.stringify(state, null, 2));
}

function computeSchedule() {
  // clockIn: random entre 8:00 y 8:15
  const clockInTime = new Date(randomBetween(todayAt(8, 0).getTime(), todayAt(8, 15).getTime()));

  // pause: random entre 12:45 y 13:15
  const pauseTime = new Date(randomBetween(todayAt(12, 45).getTime(), todayAt(13, 15).getTime()));

  // resume: 30 min después de pause ±10 min (20-40 min después)
  const resumeTime = new Date(pauseTime.getTime() + randomBetween(minutesToMs(20), minutesToMs(40)));

  const morningWork = pauseTime.getTime() - clockInTime.getTime();

  let clockOutTime: Date;

  if (isFriday()) {
    // Viernes: compensar el descuadre de minutos de L-J respecto a 8h/día
    // Solo se cuentan los días que se trabajaron (no compensa días no trabajados)
    const log = loadWeekLog();
    const workedDays = Object.values(log.days);
    const daysCount = workedDays.length;
    const accumulatedMs = workedDays.reduce((sum, ms) => sum + ms, 0);
    const expectedMs = daysCount * EIGHT_HOURS_MS;
    const excessMs = accumulatedMs - expectedMs; // positivo = se ha trabajado de más
    const fridayTarget = EIGHT_HOURS_MS - excessMs - randomBetween(minutesToMs(5), minutesToMs(15));
    const remainingWork = fridayTarget - morningWork;
    clockOutTime = new Date(resumeTime.getTime() + Math.max(remainingWork, 0));
  } else {
    // L-J: ~8h de trabajo (±10 min)
    const remainingWork = EIGHT_HOURS_MS - morningWork;
    const jitter = randomBetween(-minutesToMs(10), minutesToMs(10));
    clockOutTime = new Date(resumeTime.getTime() + remainingWork + jitter);
  }

  return { clockInTime, pauseTime, resumeTime, clockOutTime };
}

async function waitUntil(target: Date): Promise<void> {
  const now = Date.now();
  const delay = target.getTime() - now;
  if (delay > 0) {
    log(`   ⏳ Esperando hasta las ${formatTime(target)}...`);
    await sleep(delay);
  }
}

async function launchBrowser(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  return { browser, page };
}

async function login(page: Page): Promise<void> {
  await page.goto(env.loginUrl);
  await page.fill(env.userSelector, env.user);
  await page.fill(env.passSelector, env.pass);
  await page.click(env.submitSelector);
  await page.waitForLoadState("networkidle");
  await sleep(env.postActionWait);
  log("   🔑 Login completado");
}

async function screenshotOnError(page: Page, phase: string): Promise<void> {
  try {
    if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = join(SCREENSHOTS_DIR, `error-${phase}-${timestamp}.png`);
    await page.screenshot({ path, fullPage: true });
    log(`   📸 Screenshot guardado: ${path}`);
  } catch {
    log("   ⚠️ No se pudo guardar screenshot");
  }
}

async function verifyNextState(page: Page, expectedSelector: string, phase: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await sleep(env.postActionWait);
  const nextBtn = await page.$(expectedSelector);
  const visible = nextBtn ? await nextBtn.isVisible() : false;
  if (!visible) {
    await screenshotOnError(page, `${phase}-verify`);
    throw new Error(`Verificación fallida: no se encontró el botón del siguiente estado (${expectedSelector})`);
  }
  log(`   ✅ Verificado: botón del siguiente estado visible`);
}

async function performAction(
  page: Page,
  label: string,
  selector: string,
  confirmSelector: string,
  secondConfirmOptional = false,
): Promise<void> {
  const phase = label.replace(/[^\w]/g, "").substring(0, 20);

  await login(page);
  log(`   ${label}`);

  // Verificar que el botón principal existe
  const actionBtn = await page.$(selector);
  if (!actionBtn) {
    await screenshotOnError(page, phase);
    throw new Error(`Botón no encontrado: ${selector}`);
  }
  await actionBtn.click();
  await page.waitForLoadState("networkidle");
  await sleep(env.postActionWait);

  // Primera confirmación — la página recarga tras este click
  log(`   ✔️ Confirmando...`);
  const confirmBtn = await page.$(confirmSelector);
  if (!confirmBtn) {
    await screenshotOnError(page, `${phase}-confirm1`);
    throw new Error(`Botón de confirmación no encontrado: ${confirmSelector}`);
  }
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle", timeout: 30_000 }).catch(() => {}),
    confirmBtn.click(),
  ]);
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(env.postActionWait);

  // Segunda confirmación — esperar que el selector reaparezca en el DOM recargado
  let confirm2Btn: import("playwright").ElementHandle | null = null;
  try {
    await page.waitForSelector(confirmSelector, { state: "visible", timeout: 20_000 });
    confirm2Btn = await page.$(confirmSelector);
  } catch {
    confirm2Btn = null;
  }
  if (confirm2Btn) {
    log(`   ✔️ Segunda confirmación...`);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle", timeout: 30_000 }).catch(() => {}),
      confirm2Btn.click(),
    ]);
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(env.postActionWait);
  } else if (!secondConfirmOptional) {
    await screenshotOnError(page, `${phase}-confirm2`);
    throw new Error(`Botón de segunda confirmación no encontrado: ${confirmSelector}`);
  } else {
    log(`   ℹ️ Segunda confirmación no encontrada, continuando...`);
  }
}

async function clockIn(page: Page): Promise<void> {
  await performAction(page, "🟢 Fichando entrada...", env.clockInSelector, env.clockInConfirmSelector, true);
  await verifyNextState(page, env.pauseSelector, "clockIn");
}

async function pause(page: Page): Promise<void> {
  await performAction(page, "⏸️ Pausando...", env.pauseSelector, env.pauseConfirmSelector);
  await verifyNextState(page, env.resumeSelector, "pause");
}

async function resume(page: Page): Promise<void> {
  await performAction(page, "▶️ Retomando...", env.resumeSelector, env.resumeConfirmSelector);
  await verifyNextState(page, env.clockOutSelector, "resume");
}

async function clockOut(page: Page): Promise<void> {
  await performAction(page, "🔴 Fichando salida...", env.clockOutSelector, env.clockOutConfirmSelector);
  await verifyNextState(page, env.reopenSelector, "clockOut");
}

async function main() {
  // Intentar recuperar estado del día actual
  const existingState = loadDayState();
  let schedule: ReturnType<typeof computeSchedule>;
  let startPhase: DayPhase = "started";

  if (existingState) {
    // Restaurar horario guardado
    schedule = {
      clockInTime: new Date(existingState.clockInTime),
      pauseTime: new Date(existingState.pauseTime),
      resumeTime: new Date(existingState.resumeTime),
      clockOutTime: new Date(existingState.clockOutTime),
    };
    startPhase = existingState.phase;
    log(`🔄 Recuperando estado: fase '${startPhase}' guardada hoy`);
  } else {
    // Intentar leer horario de Google Calendar
    try {
      const calSchedule = await getTodaySchedule();
      if (calSchedule) {
        schedule = {
          clockInTime: calSchedule.clockIn,
          pauseTime: calSchedule.pause,
          resumeTime: calSchedule.resume,
          clockOutTime: calSchedule.clockOut,
        };
        log("📆 Horario cargado desde Google Calendar");
      } else {
        log("📭 No hay eventos en Google Calendar para hoy. Día libre.");
        return;
      }
    } catch (err) {
      log(`⚠️ No se pudo leer Google Calendar (${err}), usando horario aleatorio`);
      schedule = computeSchedule();
    }
  }

  log("📅 Horario de hoy:");
  log(`   Entrada:  ${formatTime(schedule.clockInTime)}`);
  log(`   Pausa:    ${formatTime(schedule.pauseTime)}`);
  log(`   Retomar:  ${formatTime(schedule.resumeTime)}`);
  log(`   Salida:   ${formatTime(schedule.clockOutTime)}`);

  const morningMs = schedule.pauseTime.getTime() - schedule.clockInTime.getTime();
  const afternoonMs = schedule.clockOutTime.getTime() - schedule.resumeTime.getTime();
  const todayMs = morningMs + afternoonMs;
  const totalH = (todayMs / (1000 * 60 * 60)).toFixed(2);
  log(`   Total trabajo hoy: ${totalH}h`);

  const dayNames = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
  const todayName = dayNames[new Date().getDay()];
  const accumulatedMs = getAccumulatedMs();
  const weekTotalH = ((accumulatedMs + todayMs) / (1000 * 60 * 60)).toFixed(2);
  log(`   Acumulado semanal (con hoy): ${weekTotalH}h`);
  if (isFriday()) {
    log(`   📌 Viernes: salida ajustada para no superar 40h semanales`);
  }

  // Guardar estado inicial con horario (si no existía)
  const state: DayState = existingState ?? {
    date: todayISO(),
    phase: "started",
    clockInTime: schedule.clockInTime.toISOString(),
    pauseTime: schedule.pauseTime.toISOString(),
    resumeTime: schedule.resumeTime.toISOString(),
    clockOutTime: schedule.clockOutTime.toISOString(),
  };
  if (!existingState) saveDayState(state);

  // Mostrar próxima acción
  const nextActions: { phase: DayPhase; label: string; time: Date }[] = [
    { phase: "started", label: "🟢 Fichar entrada", time: schedule.clockInTime },
    { phase: "clocked-in", label: "⏸️ Pausar", time: schedule.pauseTime },
    { phase: "paused", label: "▶️ Retomar", time: schedule.resumeTime },
    { phase: "resumed", label: "🔴 Fichar salida", time: schedule.clockOutTime },
  ];
  const nextAction = nextActions.find((a) => a.phase === startPhase);
  if (nextAction) {
    log(`👉 Próxima acción: ${nextAction.label} a las ${formatTime(nextAction.time)}`);
  }

  if (startPhase === "clocked-out") {
    log("✅ La jornada de hoy ya está completada. No hay nada que hacer.");
    return;
  }

  const { browser, page } = await launchBrowser();

  try {
    // Clock in (skip if already done)
    if (startPhase === "started") {
      await waitUntil(schedule.clockInTime);
      await clockIn(page);
      state.phase = "clocked-in";
      state.clockInTimestamp = Date.now();
      saveDayState(state);
      log("   ✅ Entrada registrada");
    } else {
      log(`   ⏭️ Entrada ya registrada, saltando...`);
    }

    // Pause (skip if already done)
    if (startPhase === "started" || startPhase === "clocked-in") {
      await waitUntil(schedule.pauseTime);
      await pause(page);
      state.phase = "paused";
      saveDayState(state);
      log("   ✅ Pausa registrada");
    } else {
      log(`   ⏭️ Pausa ya registrada, saltando...`);
    }

    // Resume (skip if already done)
    if (startPhase === "started" || startPhase === "clocked-in" || startPhase === "paused") {
      await waitUntil(schedule.resumeTime);
      await resume(page);
      state.phase = "resumed";
      saveDayState(state);
      log("   ✅ Reanudación registrada");
    } else {
      log(`   ⏭️ Reanudación ya registrada, saltando...`);
    }

    // Clock out
    await waitUntil(schedule.clockOutTime);
    await clockOut(page);
    state.phase = "clocked-out";
    saveDayState(state);
    log("   ✅ Salida registrada");
  } catch (err) {
    logError("Fallo en la jornada, abortando resto de acciones", err);
    await screenshotOnError(page, "abort");
    throw err;
  } finally {
    await browser.close();
  }

  log("✅ Jornada completada. Esperando al próximo día...");

  // Guardar horas trabajadas hoy
  saveDayMs(todayName, todayMs);
  log(`   💾 Guardadas ${totalH}h para ${todayName}`);
}

// Capturar errores no controlados para que el proceso nunca muera
process.on("uncaughtException", (err) => {
  logError("Error no controlado", err);
});

process.on("unhandledRejection", (reason) => {
  logError("Promesa rechazada no controlada", reason);
});

// Ejecutar todos los días a las 7:55 para que el schedule se calcule antes de las 8:00
// Cada día se generan horarios aleatorios nuevos
cron.schedule("55 7 * * 1-5", () => {
  log("⏰ Iniciando jornada...");
  main().catch((err) => logError("Error en la jornada", err));
});

log("🕐 Bot activo. Se ejecutará de lunes a viernes a las 7:55.");
log("   El proceso se mantiene vivo indefinidamente. Cada día genera horarios aleatorios nuevos.");

// Mostrar estado actual al iniciar la app
const currentState = loadDayState();
if (currentState && currentState.phase !== "clocked-out") {
  const schedule = {
    clockInTime: new Date(currentState.clockInTime),
    pauseTime: new Date(currentState.pauseTime),
    resumeTime: new Date(currentState.resumeTime),
    clockOutTime: new Date(currentState.clockOutTime),
  };
  const actions: { phase: DayPhase; label: string; time: Date }[] = [
    { phase: "started", label: "🟢 Fichar entrada", time: schedule.clockInTime },
    { phase: "clocked-in", label: "⏸️ Pausar", time: schedule.pauseTime },
    { phase: "paused", label: "▶️ Retomar", time: schedule.resumeTime },
    { phase: "resumed", label: "🔴 Fichar salida", time: schedule.clockOutTime },
  ];
  const next = actions.find((a) => a.phase === currentState.phase);
  if (next) {
    log(`👉 Próxima acción: ${next.label} a las ${formatTime(next.time)}`);
  }
} else if (currentState?.phase === "clocked-out") {
  log("✅ La jornada de hoy ya está completada.");
} else {
  log("📭 No hay estado guardado para hoy. Se generará horario a las 7:55.");
}
