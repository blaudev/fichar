// ============================================================
// Fichar Bot – Chrome Extension Service Worker (Manifest V3)
// ============================================================

// ── Constants ────────────────────────────────────────────────
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
const ALARM_CHECK = "fichar-check";
const ALARM_CLOCK_IN = "fichar-clockin";
const ALARM_PAUSE = "fichar-pause";
const ALARM_RESUME = "fichar-resume";
const ALARM_CLOCK_OUT = "fichar-clockout";

// ── Helpers ──────────────────────────────────────────────────
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

function minutesToMs(min) {
  return min * 60 * 1000;
}

function todayAt(hours, minutes) {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(date) {
  return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function isWeekday() {
  const day = new Date().getDay();
  return day >= 1 && day <= 5;
}

function isFriday() {
  return new Date().getDay() === 5;
}

function getWeekNumber() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - start.getTime();
  return Math.ceil((diff / (1000 * 60 * 60 * 24) + start.getDay() + 1) / 7);
}

// ── Storage helpers ──────────────────────────────────────────
async function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

async function storageSet(data) {
  return chrome.storage.local.set(data);
}

// ── Logging ──────────────────────────────────────────────────
async function log(message) {
  const timestamp = new Date().toLocaleString("es-ES");
  const line = `[${timestamp}] ${message}`;
  console.log(line);

  const { logs = [] } = await storageGet("logs");
  logs.push(line);
  // Keep last 500 lines
  if (logs.length > 500) logs.splice(0, logs.length - 500);
  await storageSet({ logs });
}

async function logError(message, err) {
  await log(`❌ ${message}: ${err}`);
}

// ── Week log ─────────────────────────────────────────────────
async function loadWeekLog() {
  const currentWeek = getWeekNumber();
  const { weekLog } = await storageGet("weekLog");
  if (weekLog && weekLog.weekNumber === currentWeek) return weekLog;
  return { weekNumber: currentWeek, days: {} };
}

async function saveWeekLog(weekLog) {
  await storageSet({ weekLog });
}

async function getAccumulatedMs() {
  const weekLog = await loadWeekLog();
  return Object.values(weekLog.days).reduce((sum, ms) => sum + ms, 0);
}

async function saveDayMs(dayName, ms) {
  const weekLog = await loadWeekLog();
  weekLog.days[dayName] = ms;
  await saveWeekLog(weekLog);
}

// ── Day state ────────────────────────────────────────────────
async function loadDayState() {
  const { dayState } = await storageGet("dayState");
  if (dayState && dayState.date === todayISO()) return dayState;
  return null;
}

async function saveDayState(state) {
  await storageSet({ dayState: state });
}

// ── Config ───────────────────────────────────────────────────
// Portal "Presence" (SPA). Cada acción = pulsar button.attendanceBtn con cierto
// TEXTO y confirmar en un modal con otro texto (a veces distinto, p.ej. Finish->End).
// Valores fijos: no hay página de configuración.
const CONFIG = {
  loginUrl: "https://portalempleado.addingplus.net/",
  user: "52274153Y",
  pass: "tonTin-40",
  // Login: el SPA no usa name/id. Usuario = primer input que no es checkbox ni password.
  userSelector: "input:not([type=checkbox]):not([type=password])",
  passSelector: 'input[type="password"]',
  submitText: "Enter",
  forceLang: "EN",
  // Fichaje
  attendanceBtnSelector: "button.attendanceBtn",
  modalSelector: ".modal-content",
  clockInButton: "Start",
  clockInConfirm: "Start",
  pauseButton: "Break",
  pauseConfirm: "Break",
  resumeButton: "Resume",
  resumeConfirm: "Resume",
  clockOutButton: "Finish",
  clockOutConfirm: "End",
  reopenButton: "Reopen",
  reopenConfirm: "Reopen",
  // Textos de estado (junto a "Status:") para verificar/detectar la fase
  statusNotStarted: "Not started",
  statusInProgress: "In progress",
  statusOnBreak: "On break",
  statusEnded: "Ended",
  postActionWait: 3000,
};

async function getConfig() {
  return CONFIG;
}

// ── Google Calendar ──────────────────────────────────────────
async function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

async function calendarFetch(path, options = {}) {
  const token = await getAuthToken();
  const base = "https://www.googleapis.com/calendar/v3";
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calendar API ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function findCalendarId() {
  const { calendarId: cached } = await storageGet("calendarId");
  if (cached) {
    // Verify it still exists
    try {
      await calendarFetch(`/calendars/${encodeURIComponent(cached)}`);
      return cached;
    } catch {
      await storageSet({ calendarId: null });
    }
  }

  const data = await calendarFetch("/users/me/calendarList");
  const cal = data.items?.find((c) => c.summary === "Fichajes");
  if (cal?.id) {
    await storageSet({ calendarId: cal.id });
    return cal.id;
  }
  return null;
}

async function getOrCreateCalendar() {
  const existing = await findCalendarId();
  if (existing) return existing;

  const created = await calendarFetch("/calendars", {
    method: "POST",
    body: JSON.stringify({ summary: "Fichajes", timeZone: "Europe/Madrid" }),
  });
  const id = created.id;
  await storageSet({ calendarId: id });
  return id;
}

async function getTodayScheduleFromCalendar() {
  const calendarId = await findCalendarId();
  if (!calendarId) return null;

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const params = new URLSearchParams({
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
  });

  const data = await calendarFetch(`/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
  const events = data.items || [];
  if (events.length === 0) return null;

  const titles = { Entrada: "clockIn", Pausa: "pause", Reanudar: "resume", Salida: "clockOut" };
  const schedule = {};

  for (const ev of events) {
    const key = titles[ev.summary];
    if (key && ev.start?.dateTime) {
      schedule[key] = new Date(ev.start.dateTime).getTime();
    }
  }

  if (!schedule.clockIn || !schedule.pause || !schedule.resume || !schedule.clockOut) return null;
  return schedule;
}

// ── Schedule computation (fallback) ─────────────────────────
async function computeSchedule() {
  const clockInTime = randomBetween(todayAt(8, 0).getTime(), todayAt(8, 15).getTime());
  const pauseTime = randomBetween(todayAt(12, 45).getTime(), todayAt(13, 15).getTime());
  const resumeTime = pauseTime + randomBetween(minutesToMs(20), minutesToMs(40));
  const morningWork = pauseTime - clockInTime;

  let clockOutTime;

  if (isFriday()) {
    const weekLog = await loadWeekLog();
    const workedDays = Object.values(weekLog.days);
    const daysCount = workedDays.length;
    const accumulatedMs = workedDays.reduce((sum, ms) => sum + ms, 0);
    const expectedMs = daysCount * EIGHT_HOURS_MS;
    const excessMs = accumulatedMs - expectedMs;
    const fridayTarget = EIGHT_HOURS_MS - excessMs - randomBetween(minutesToMs(5), minutesToMs(15));
    const remainingWork = fridayTarget - morningWork;
    clockOutTime = resumeTime + Math.max(remainingWork, 0);
  } else {
    const remainingWork = EIGHT_HOURS_MS - morningWork;
    const jitter = randomBetween(-minutesToMs(10), minutesToMs(10));
    clockOutTime = resumeTime + remainingWork + jitter;
  }

  return { clockIn: clockInTime, pause: pauseTime, resume: resumeTime, clockOut: clockOutTime };
}

// ── Content script execution ─────────────────────────────────
async function executeInTab(tabId, func, args = []) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args,
    });
    return results?.[0]?.result;
  } catch (err) {
    console.error("executeInTab error:", err);
    await log(`   ❌ executeInTab error: ${err?.message || err}`);
    return undefined;
  }
}

// ── Funciones inyectadas en la página (deben ser autónomas) ──────────────

// Login: rellena usuario/contraseña (compatible con inputs controlados por React)
// y pulsa el botón cuyo texto coincide con submitText. Si no hay campo de
// contraseña, asume que ya hay sesión iniciada.
function injectedLogin(user, pass, userSel, passSel, submitText) {
  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const passInput = document.querySelector(passSel);
  if (!passInput) return { alreadyLoggedIn: true };
  const userInput = document.querySelector(userSel);
  if (userInput) setNativeValue(userInput, user);
  setNativeValue(passInput, pass);
  const btn = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent || "").trim().toLowerCase() === submitText.toLowerCase(),
  );
  if (btn) btn.click();
  return { alreadyLoggedIn: false, submitFound: !!btn, userFound: !!userInput };
}

// Lee el texto de estado ("Not started", "In progress", "On break", "Ended")
function injectedGetStatus() {
  const el = [...document.querySelectorAll("*")].find(
    (n) => n.children.length === 0 && /Status:/i.test(n.textContent || ""),
  );
  const txt = el?.parentElement?.textContent?.replace(/\s+/g, " ").trim() || "";
  return txt.replace(/.*Status:\s*/i, "");
}

// Lista los textos de los botones de fichaje visibles
function injectedAttendanceButtons(btnSel) {
  return [...document.querySelectorAll(btnSel)]
    .filter((b) => b.offsetParent !== null || b.offsetWidth > 0)
    .map((b) => (b.textContent || "").trim());
}

// Pulsa el botón de fichaje cuyo texto coincide
function injectedClickAttendance(btnSel, text) {
  const btn = [...document.querySelectorAll(btnSel)].find(
    (b) => (b.textContent || "").trim().toLowerCase() === text.toLowerCase(),
  );
  if (!btn) return false;
  btn.click();
  return true;
}

// Indica si el botón de confirmación del modal está realmente visible
// (offsetParent considera ancestros ocultos, evita falsos positivos)
function injectedModalButtonVisible(modalSel, text) {
  const root = document.querySelector(modalSel);
  if (!root) return false;
  const btn = [...root.querySelectorAll("button, a")].find(
    (b) => (b.textContent || "").trim().toLowerCase() === text.toLowerCase(),
  );
  if (!btn) return false;
  const style = getComputedStyle(btn);
  return (btn.offsetParent !== null || btn.offsetWidth > 0) && style.display !== "none" && style.visibility !== "hidden";
}

// Pulsa el botón de confirmación (por texto) dentro del modal
function injectedClickModalConfirm(modalSel, text) {
  const root = document.querySelector(modalSel);
  if (!root) return false;
  const btn = [...root.querySelectorAll("button, a")].find(
    (b) => (b.textContent || "").trim().toLowerCase() === text.toLowerCase(),
  );
  if (!btn) return false;
  btn.click();
  return true;
}

// Fuerza el idioma del portal (mejor esfuerzo)
function injectedForceLang(target) {
  const toggle = document.querySelector("button.lang-toggle");
  if (!toggle) return "no-toggle";
  if ((toggle.textContent || "").trim().toUpperCase() === target.toUpperCase()) return "already";
  toggle.click();
  const item = [...document.querySelectorAll(".lang-item")].find(
    (i) => (i.textContent || "").trim().toUpperCase() === target.toUpperCase(),
  );
  if (item) {
    item.click();
    return "switched";
  }
  return "item-not-found";
}

// ── Orquestación de acciones ────────────────────────────────────────────

// Abre el portal en una pestaña, hace login si hace falta y espera a que cargue
// el panel de fichaje. Devuelve el tabId.
async function openPortalLoggedIn(config) {
  const tab = await chrome.tabs.create({ url: config.loginUrl, active: false });
  const tabId = tab.id;
  await waitForTabLoad(tabId);
  await sleep(1500);

  const res = await executeInTab(tabId, injectedLogin, [
    config.user,
    config.pass,
    config.userSelector,
    config.passSelector,
    config.submitText,
  ]);
  if (res?.alreadyLoggedIn) {
    await log("   🔑 Sesión ya activa");
  } else {
    await log(`   🔑 Login enviado (user=${res?.userFound}, submit=${res?.submitFound})`);
  }

  // Esperar a que aparezca el panel de fichaje (los botones attendanceBtn)
  await waitForSelector(tabId, config.attendanceBtnSelector, 20000);
  await sleep(config.postActionWait || 3000);

  // Forzar idioma (mejor esfuerzo)
  if (config.forceLang) {
    const r = await executeInTab(tabId, injectedForceLang, [config.forceLang]);
    if (r === "switched") {
      await sleep(config.postActionWait || 3000);
      await waitForSelector(tabId, config.attendanceBtnSelector, 15000);
      await log(`   🌐 Idioma forzado a ${config.forceLang}`);
    }
  }
  return tabId;
}

// Espera a que un botón de fichaje con cierto texto esté presente
async function waitForAttendanceButton(tabId, btnSel, text, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const texts = await executeInTab(tabId, injectedAttendanceButtons, [btnSel]);
    if ((texts || []).some((t) => t.toLowerCase() === text.toLowerCase())) return true;
    await sleep(500);
  }
  return false;
}

async function getPageStatus(tabId) {
  return (await executeInTab(tabId, injectedGetStatus, [])) || "";
}

// Ejecuta una acción de fichaje: pulsa el botón con `buttonText`, confirma en el
// modal con `confirmText` y verifica que el estado pasa a contener `expectedStatus`.
async function performAction(phase, buttonText, confirmText, expectedStatus) {
  const config = await getConfig();
  if (!config) throw new Error("No hay configuración guardada. Abre Opciones.");

  await log(`   Ejecutando acción: ${phase}`);
  const wait = config.postActionWait || 3000;
  const tabId = await openPortalLoggedIn(config);

  try {
    // Botón principal
    const hasBtn = await waitForAttendanceButton(tabId, config.attendanceBtnSelector, buttonText, 15000);
    if (!hasBtn) {
      const texts = await executeInTab(tabId, injectedAttendanceButtons, [config.attendanceBtnSelector]);
      await log(`   🔍 Botones disponibles: ${JSON.stringify(texts)}`);
      await captureTab(tabId, phase);
      throw new Error(`Botón de acción no encontrado: "${buttonText}"`);
    }
    await executeInTab(tabId, injectedClickAttendance, [config.attendanceBtnSelector, buttonText]);

    // Esperar a que el botón de confirmación del modal esté visible
    let confirmReady = false;
    const modalStart = Date.now();
    while (Date.now() - modalStart < 15000) {
      if (await executeInTab(tabId, injectedModalButtonVisible, [config.modalSelector, confirmText])) {
        confirmReady = true;
        break;
      }
      await sleep(500);
    }
    if (!confirmReady) {
      await captureTab(tabId, `${phase}-modal`);
      throw new Error(`El modal de confirmación ("${confirmText}") no apareció`);
    }
    await sleep(400);

    await log(`   ✔️ Confirmando con "${confirmText}"...`);
    const confirmed = await executeInTab(tabId, injectedClickModalConfirm, [config.modalSelector, confirmText]);
    if (!confirmed) {
      await captureTab(tabId, `${phase}-confirm`);
      throw new Error(`Botón de confirmación "${confirmText}" no encontrado en el modal`);
    }

    await sleep(wait);

    // Verificar el nuevo estado
    if (expectedStatus) {
      let ok = false;
      for (let i = 0; i < 5 && !ok; i++) {
        const status = await getPageStatus(tabId);
        if (status.toLowerCase().includes(expectedStatus.toLowerCase())) {
          ok = true;
          await log(`   ✅ Verificado: estado "${status}"`);
        } else if (i === 4) {
          await captureTab(tabId, `${phase}-verify`);
          await log(`   ⚠️ Verificación: esperado "${expectedStatus}", estado actual "${status}"`);
        } else {
          await sleep(1000);
        }
      }
    }
  } finally {
    await chrome.tabs.remove(tabId);
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    // Safety timeout
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSelector(tabId, selector, timeout = 15000) {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < timeout) {
    attempt++;
    const result = await executeInTab(
      tabId,
      (sel) => {
        const el = document.querySelector(sel);
        if (!el) return { exists: false };
        const style = getComputedStyle(el);
        return {
          exists: true,
          tag: el.tagName,
          display: style.display,
          visibility: style.visibility,
          offsetWidth: el.offsetWidth,
          offsetHeight: el.offsetHeight,
          offsetParent: !!el.offsetParent,
        };
      },
      [selector],
    );
    if (result?.exists) {
      // Consider it found if the element exists and is not display:none/visibility:hidden
      const visible = result.display !== "none" && result.visibility !== "hidden";
      if (visible) return true;
    }
    if (attempt % 4 === 0) {
      await log(`   🔍 waitForSelector intento ${attempt}: ${JSON.stringify(result)}`);
    }
    await sleep(500);
  }
  return false;
}

async function captureTab(tabId, phase) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const key = `screenshot-${phase}-${timestamp}`;
    // Store last 10 screenshots
    const { screenshots = [] } = await storageGet("screenshots");
    screenshots.push({ key, dataUrl, timestamp: Date.now() });
    if (screenshots.length > 10) screenshots.shift();
    await storageSet({ screenshots });
    await log(`   📸 Screenshot guardado: ${key}`);
  } catch {
    await log("   ⚠️ No se pudo capturar screenshot");
  }
}

// ── Alarm handler ────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === ALARM_CHECK) {
      await dailyCheck();
      return;
    }

    const config = await getConfig();
    if (!config) {
      await logError("No hay configuración", "Abre Opciones para configurar.");
      return;
    }

    const state = await loadDayState();
    if (!state || state.date !== todayISO()) {
      await log(`⚠️ Alarma ${alarm.name} ignorada: no hay estado para hoy`);
      return;
    }

    if (alarm.name === ALARM_CLOCK_IN && state.phase === "started") {
      await log("🟢 Fichando entrada...");
      await performAction("clockin", config.clockInButton, config.clockInConfirm, config.statusInProgress);
      state.phase = "clocked-in";
      state.clockInTimestamp = Date.now();
      await saveDayState(state);
      await log("   ✅ Entrada registrada");
      await scheduleRemainingAlarms(state);
    } else if (alarm.name === ALARM_PAUSE && state.phase === "clocked-in") {
      await log("⏸️ Pausando...");
      await performAction("pause", config.pauseButton, config.pauseConfirm, config.statusOnBreak);
      state.phase = "paused";
      await saveDayState(state);
      await log("   ✅ Pausa registrada");
      await scheduleRemainingAlarms(state);
    } else if (alarm.name === ALARM_RESUME && state.phase === "paused") {
      await log("▶️ Retomando...");
      await performAction("resume", config.resumeButton, config.resumeConfirm, config.statusInProgress);
      state.phase = "resumed";
      await saveDayState(state);
      await log("   ✅ Reanudación registrada");
      await scheduleRemainingAlarms(state);
    } else if (alarm.name === ALARM_CLOCK_OUT && state.phase === "resumed") {
      await log("🔴 Fichando salida...");
      await performAction("clockout", config.clockOutButton, config.clockOutConfirm, config.statusEnded);
      state.phase = "clocked-out";
      await saveDayState(state);
      await log("   ✅ Salida registrada");

      // Save day hours
      const morningMs = state.pauseTime - state.clockInTime;
      const afternoonMs = state.clockOutTime - state.resumeTime;
      const todayMs = morningMs + afternoonMs;
      const dayNames = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
      await saveDayMs(dayNames[new Date().getDay()], todayMs);
      const totalH = (todayMs / (1000 * 60 * 60)).toFixed(2);
      await log(`   💾 Guardadas ${totalH}h`);
      await log("✅ Jornada completada");
    } else {
      await log(`⏭️ Alarma ${alarm.name} ignorada (fase actual: ${state.phase})`);
    }
  } catch (err) {
    await logError(`Error en alarma ${alarm.name}`, err?.message || err);
  }
});

// ── Detect real state from website ───────────────────────────
// Devuelve un "bucket" de estado según el texto de "Status:":
//   "not-started" | "in-progress" | "on-break" | "ended" | null
// Nota: "in-progress" es ambiguo (puede ser tras la entrada o tras reanudar),
// por eso se devuelve el bucket y la reconciliación con la fase guardada se
// hace en reconcilePhase().
async function detectRealState() {
  const config = await getConfig();
  if (!config) return null;

  await log("   🔍 Detectando estado real en la web...");

  let tabId;
  try {
    tabId = await openPortalLoggedIn(config);

    let statusText = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      statusText = await getPageStatus(tabId);
      if (statusText) break;
      await sleep(1500);
    }
    const btns = await executeInTab(tabId, injectedAttendanceButtons, [config.attendanceBtnSelector]);
    await log(`   🔍 Status="${statusText}" botones=${JSON.stringify(btns)}`);

    await chrome.tabs.remove(tabId);
    tabId = null;

    const s = (statusText || "").toLowerCase();
    let bucket = null;
    if (s.includes(config.statusNotStarted.toLowerCase())) bucket = "not-started";
    else if (s.includes(config.statusOnBreak.toLowerCase())) bucket = "on-break";
    else if (s.includes(config.statusEnded.toLowerCase())) bucket = "ended";
    else if (s.includes(config.statusInProgress.toLowerCase())) bucket = "in-progress";

    if (bucket) await log(`   🔍 Estado real detectado: '${bucket}'`);
    else await log("   ⚠️ No se pudo detectar el estado");
    return bucket;
  } catch (err) {
    await log(`   ⚠️ Error detectando estado real: ${err?.message || err}`);
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {}
    }
    return null;
  }
}

// Mapea un bucket de estado a la fase representativa.
// "in-progress" abarca tanto 'clocked-in' como 'resumed': si la fase guardada ya
// encaja en el bucket se respeta; si no, se usa la representativa.
function reconcilePhase(bucket, savedPhase) {
  const buckets = {
    "not-started": ["started"],
    "in-progress": ["clocked-in", "resumed"],
    "on-break": ["paused"],
    ended: ["clocked-out"],
  };
  const valid = buckets[bucket];
  if (!valid) return savedPhase || null;
  if (savedPhase && valid.includes(savedPhase)) return savedPhase;
  return valid[0];
}

// ── Daily check: runs at 7:55 every weekday ──────────────────
async function dailyCheck() {
  if (!isWeekday()) {
    await log("📅 Fin de semana, ignorando");
    return;
  }

  await log("⏰ Iniciando jornada...");

  // Check if already set up today
  const existing = await loadDayState();
  if (existing) {
    // Always verify saved phase against real website state
    try {
      const bucket = await detectRealState();
      const reconciled = reconcilePhase(bucket, existing.phase);
      if (reconciled && reconciled !== existing.phase) {
        await log(`   ⚠️ Fase guardada '${existing.phase}' difiere de la real '${reconciled}', actualizando`);
        existing.phase = reconciled;
        await saveDayState(existing);
      }
    } catch (err) {
      await log(`   ⚠️ No se pudo verificar fase real: ${err?.message || err}`);
    }

    if (existing.phase === "clocked-out") {
      await log("✅ Jornada ya completada hoy");
      return;
    }
    await log(`🔄 Recuperando estado: fase '${existing.phase}'`);
    await scheduleRemainingAlarms(existing);
    return;
  }

  // Try Google Calendar first
  let schedule;
  try {
    schedule = await getTodayScheduleFromCalendar();
    if (schedule) {
      await log("📆 Horario cargado desde Google Calendar");
    } else {
      await log("📭 No hay eventos en Calendar para hoy. Día libre.");
      return;
    }
  } catch (err) {
    await log(`⚠️ No se pudo leer Calendar (${err?.message}), usando horario aleatorio`);
    schedule = await computeSchedule();
  }

  // Detect real phase from the website
  let realPhase = "started";
  try {
    const bucket = await detectRealState();
    const reconciled = reconcilePhase(bucket, null);
    if (reconciled) realPhase = reconciled;
  } catch (err) {
    await log(`   ⚠️ No se pudo detectar fase, asumiendo 'started': ${err?.message || err}`);
  }

  const state = {
    date: todayISO(),
    phase: realPhase,
    clockInTime: schedule.clockIn,
    pauseTime: schedule.pause,
    resumeTime: schedule.resume,
    clockOutTime: schedule.clockOut,
  };
  await saveDayState(state);

  const morningMs = schedule.pause - schedule.clockIn;
  const afternoonMs = schedule.clockOut - schedule.resume;
  const todayMs = morningMs + afternoonMs;

  await log("📅 Horario de hoy:");
  await log(`   Entrada:  ${formatTime(new Date(schedule.clockIn))}`);
  await log(`   Pausa:    ${formatTime(new Date(schedule.pause))}`);
  await log(`   Retomar:  ${formatTime(new Date(schedule.resume))}`);
  await log(`   Salida:   ${formatTime(new Date(schedule.clockOut))}`);
  await log(`   Total trabajo: ${(todayMs / 3600000).toFixed(2)}h`);

  await scheduleRemainingAlarms(state);
}

async function scheduleRemainingAlarms(state) {
  // Clear all action alarms first
  await chrome.alarms.clear(ALARM_CLOCK_IN);
  await chrome.alarms.clear(ALARM_PAUSE);
  await chrome.alarms.clear(ALARM_RESUME);
  await chrome.alarms.clear(ALARM_CLOCK_OUT);

  const now = Date.now();
  const alarms = [
    { name: ALARM_CLOCK_IN, time: state.clockInTime, needsPhase: "started" },
    { name: ALARM_PAUSE, time: state.pauseTime, needsPhase: "clocked-in" },
    { name: ALARM_RESUME, time: state.resumeTime, needsPhase: "paused" },
    { name: ALARM_CLOCK_OUT, time: state.clockOutTime, needsPhase: "resumed" },
  ];

  // Find the phase order
  const phaseOrder = ["started", "clocked-in", "paused", "resumed", "clocked-out"];
  const currentIdx = phaseOrder.indexOf(state.phase);

  for (const alarm of alarms) {
    const alarmIdx = phaseOrder.indexOf(alarm.needsPhase);
    if (alarmIdx >= currentIdx) {
      if (alarm.time > now) {
        await chrome.alarms.create(alarm.name, { when: alarm.time });
        await log(`   ⏰ Alarma '${alarm.name}' programada para ${formatTime(new Date(alarm.time))}`);
      } else if (alarmIdx === currentIdx) {
        // The action for the current phase is overdue — schedule it immediately
        const runAt = now + 5000; // 5 seconds from now
        await chrome.alarms.create(alarm.name, { when: runAt });
        await log(`   ⏰ Alarma '${alarm.name}' atrasada, ejecutando en 5s`);
      }
    }
  }

  // Show next action
  const nextAlarm = alarms.find((a) => {
    const idx = phaseOrder.indexOf(a.needsPhase);
    return idx >= currentIdx && (a.time > now || idx === currentIdx);
  });
  if (nextAlarm) {
    const labels = {
      [ALARM_CLOCK_IN]: "🟢 Fichar entrada",
      [ALARM_PAUSE]: "⏸️ Pausar",
      [ALARM_RESUME]: "▶️ Retomar",
      [ALARM_CLOCK_OUT]: "🔴 Fichar salida",
    };
    await log(`👉 Próxima acción: ${labels[nextAlarm.name]} a las ${formatTime(new Date(nextAlarm.time))}`);
  }
}

// ── Extension lifecycle ──────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  await log("🔧 Extensión instalada/actualizada");

  // Limpiar config antigua que pudiera quedar en storage (ya no se usa)
  await chrome.storage.local.remove("config");

  // Set up daily check alarm at 7:55 every day
  await chrome.alarms.create(ALARM_CHECK, {
    when: getNext755().getTime(),
    periodInMinutes: 24 * 60, // repeat daily
  });
  await log("⏰ Alarma diaria configurada (7:55 L-V)");

  // If we're already past 7:55 today and it's a weekday, run check now
  const now = new Date();
  if (isWeekday() && now.getHours() >= 7) {
    await dailyCheck();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await log("🚀 Chrome iniciado");

  // Ensure daily alarm exists
  const existing = await chrome.alarms.get(ALARM_CHECK);
  if (!existing) {
    await chrome.alarms.create(ALARM_CHECK, {
      when: getNext755().getTime(),
      periodInMinutes: 24 * 60,
    });
  }

  // Check if we need to resume today's schedule
  if (isWeekday()) {
    const now = new Date();
    if (now.getHours() >= 7) {
      await dailyCheck();
    }
  }
});

function getNext755() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(7, 55, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target;
}

// ── Message handler (for popup communication) ────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getStatus") {
    (async () => {
      const state = await loadDayState();
      const { logs = [] } = await storageGet("logs");
      const weekLog = await loadWeekLog();
      sendResponse({ state, logs: logs.slice(-30), weekLog });
    })();
    return true; // async response
  }

  if (message.type === "runNow") {
    (async () => {
      await dailyCheck();
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "authGoogle") {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, token });
      }
    });
    return true;
  }

  if (message.type === "generateCalendar") {
    (async () => {
      try {
        const result = await generateYearCalendar();
        sendResponse({ ok: true, ...result });
      } catch (err) {
        sendResponse({ error: err?.message || String(err) });
      }
    })();
    return true;
  }
});

// ── Holidays ─────────────────────────────────────────────────
const HOLIDAYS_2026 = new Set([
  "2026-01-01",
  "2026-01-06",
  "2026-04-03",
  "2026-04-06",
  "2026-05-01",
  "2026-05-25",
  "2026-06-24",
  "2026-08-15",
  "2026-09-11",
  "2026-09-24",
  "2026-10-12",
  "2026-12-08",
  "2026-12-25",
  "2026-12-26",
]);

function dateToKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isWeekdayDate(d) {
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

function isFridayDate(d) {
  return d.getDay() === 5;
}

function dateAt2(base, hours, minutes) {
  const d = new Date(base);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function generateDaySchedule(date, weekExcessMs = 0) {
  const clockIn = randomBetween(dateAt2(date, 8, 0).getTime(), dateAt2(date, 8, 15).getTime());
  const pause = randomBetween(dateAt2(date, 12, 45).getTime(), dateAt2(date, 13, 15).getTime());
  const resume = pause + randomBetween(minutesToMs(20), minutesToMs(40));
  const morningWork = pause - clockIn;

  let clockOut;
  if (isFridayDate(date)) {
    const fridayTarget = EIGHT_HOURS_MS - weekExcessMs - randomBetween(minutesToMs(5), minutesToMs(15));
    const remaining = fridayTarget - morningWork;
    clockOut = resume + Math.max(remaining, 0);
  } else {
    const remaining = EIGHT_HOURS_MS - morningWork;
    const jitter = randomBetween(-minutesToMs(10), minutesToMs(10));
    clockOut = resume + remaining + jitter;
  }

  return { clockIn, pause, resume, clockOut };
}

async function generateYearCalendar() {
  const calendarId = await getOrCreateCalendar();
  const year = new Date().getFullYear();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);
  let current = new Date(startDate);
  let created = 0;
  let skipped = 0;
  let alreadyExist = 0;
  let weekExcessMs = 0;

  await log(`📅 Generando calendario ${year}...`);

  // Fetch all existing events for the year to avoid duplicates
  const existingDays = new Set();
  let pageToken = null;
  do {
    const params = new URLSearchParams({
      timeMin: startDate.toISOString(),
      timeMax: new Date(year, 11, 31, 23, 59, 59).toISOString(),
      singleEvents: "true",
      maxResults: "2500",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await calendarFetch(`/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
    for (const ev of data.items || []) {
      if (ev.start?.dateTime) {
        const d = new Date(ev.start.dateTime);
        existingDays.add(dateToKey(d));
      }
    }
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  await log(`   📋 ${existingDays.size} días ya tienen eventos, se saltarán`);

  while (current <= endDate) {
    if (current.getDay() === 1) weekExcessMs = 0;

    if (isWeekdayDate(current)) {
      const key = dateToKey(current);

      if (HOLIDAYS_2026.has(key)) {
        skipped++;
        current.setDate(current.getDate() + 1);
        continue;
      }

      if (current < today) {
        skipped++;
        current.setDate(current.getDate() + 1);
        continue;
      }

      // Skip days that already have events
      if (existingDays.has(key)) {
        alreadyExist++;
        current.setDate(current.getDate() + 1);
        continue;
      }

      const sched = generateDaySchedule(current, weekExcessMs);
      const workMs = sched.pause - sched.clockIn + (sched.clockOut - sched.resume);

      const events = [
        { title: "Entrada", start: sched.clockIn },
        { title: "Pausa", start: sched.pause },
        { title: "Reanudar", start: sched.resume },
        { title: "Salida", start: sched.clockOut },
      ];

      for (const ev of events) {
        const startDt = new Date(ev.start);
        const endDt = new Date(ev.start + 5 * 60 * 1000);
        await calendarFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
          method: "POST",
          body: JSON.stringify({
            summary: ev.title,
            start: { dateTime: startDt.toISOString(), timeZone: "Europe/Madrid" },
            end: { dateTime: endDt.toISOString(), timeZone: "Europe/Madrid" },
          }),
        });
      }

      created++;
      if (!isFridayDate(current)) {
        weekExcessMs += workMs - EIGHT_HOURS_MS;
      }
    }

    current.setDate(current.getDate() + 1);
  }

  await log(`✅ Calendario generado: ${created} días creados, ${alreadyExist} ya existían, ${skipped} saltados`);
  return { created, skipped, alreadyExist };
}
