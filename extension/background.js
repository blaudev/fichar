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
const DEFAULT_CONFIG = {
  loginUrl: "https://presence.addingplus.net/default.aspx",
  user: "52274153Y",
  pass: "tonTin-40",
  userSelector: 'input[name="username"]',
  passSelector: 'input[name="pwd"]',
  submitSelector: 'button[id="btnEntrar"]',
  clockInSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_btnIniciar",
  clockInConfirmSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_ucFichajeUser1_btnIniciar",
  pauseSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_btnParar",
  pauseConfirmSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_ucFichajeUser1_btnParar",
  resumeSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_btnReanudar",
  resumeConfirmSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_ucFichajeUser1_btnReanudar",
  clockOutSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_btnFinalizar",
  clockOutConfirmSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_ucFichajeUser1_btnFinalizar",
  reopenSelector: "#ContentPlaceHolder1_ucUsuariosFichaje_User1_btnReabrir",
  postActionWait: 3000,
};

async function getConfig() {
  const { config } = await storageGet("config");
  // Always return defaults merged with any overrides from options
  return { ...DEFAULT_CONFIG, ...config };
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

async function waitForTabReady(tabId, maxWait = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete" && tab.url && !tab.url.startsWith("chrome://")) {
        return true;
      }
    } catch {
      return false;
    }
    await sleep(500);
  }
  return false;
}

async function performAction(phase, actionSelector, confirmSelector, verifySelector, secondConfirmOptional = false) {
  const config = await getConfig();
  if (!config) throw new Error("No hay configuración guardada. Abre Opciones.");

  await log(`   Ejecutando acción: ${phase}`);

  // Open tab and login
  const tab = await chrome.tabs.create({ url: config.loginUrl, active: false });
  const tabId = tab.id;

  // Wait for page to load
  await waitForTabLoad(tabId);
  await sleep(1000);

  // Login
  await executeInTab(
    tabId,
    (user, pass, userSel, passSel, submitSel) => {
      const userInput = document.querySelector(userSel);
      const passInput = document.querySelector(passSel);
      const submitBtn = document.querySelector(submitSel);
      if (userInput) {
        userInput.value = user;
        userInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (passInput) {
        passInput.value = pass;
        passInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (submitBtn) submitBtn.click();
    },
    [config.user, config.pass, config.userSelector, config.passSelector, config.submitSelector],
  );

  await waitForTabLoad(tabId);
  const wait = config.postActionWait || 3000;
  await sleep(wait);
  await log("   🔑 Login completado");

  // Click main action button
  const clicked = await executeInTab(
    tabId,
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.click();
      return true;
    },
    [actionSelector],
  );

  if (!clicked) {
    await captureTab(tabId, phase);
    await chrome.tabs.remove(tabId);
    throw new Error(`Botón no encontrado: ${actionSelector}`);
  }

  // Wait for confirm button to appear (ASP.NET partial postback)
  await log("   ✔️ Esperando botón de confirmación...");
  await log(`   🔍 Buscando selector: ${confirmSelector}`);
  const confirmed = await waitForSelector(tabId, confirmSelector, 15000);

  if (!confirmed) {
    // Diagnostic: dump all buttons/links on the page
    const diag = await executeInTab(tabId, () => {
      const els = [...document.querySelectorAll("a, button, input[type='submit'], input[type='button']")];
      return els
        .filter((e) => e.offsetParent !== null || e.offsetWidth > 0)
        .slice(0, 30)
        .map((e) => ({
          tag: e.tagName,
          id: e.id,
          text: (e.textContent || "").trim().substring(0, 50),
          href: e.href ? e.href.substring(0, 80) : null,
          display: getComputedStyle(e).display,
        }));
    }, []);
    await log(`   🔍 Elementos visibles en página: ${JSON.stringify(diag, null, 2)}`);
    await captureTab(tabId, `${phase}-confirm1`);
    await chrome.tabs.remove(tabId);
    throw new Error(`Botón de confirmación no encontrado: ${confirmSelector}`);
  }

  await sleep(500); // brief settle before clicking
  await log("   ✔️ Confirmando...");
  await executeInTab(
    tabId,
    (sel) => {
      const el = document.querySelector(sel);
      if (el) el.click();
    },
    [confirmSelector],
  );

  // Wait for second confirm button (may or may not appear)
  const confirmed2 = await waitForSelector(tabId, confirmSelector, 10000);

  if (confirmed2) {
    await sleep(500);
    await log("   ✔️ Segunda confirmación...");
    await executeInTab(
      tabId,
      (sel) => {
        const el = document.querySelector(sel);
        if (el) el.click();
      },
      [confirmSelector],
    );
  } else if (!secondConfirmOptional) {
    await captureTab(tabId, `${phase}-confirm2`);
    await chrome.tabs.remove(tabId);
    throw new Error(`Botón de segunda confirmación no encontrado: ${confirmSelector}`);
  } else {
    await log("   ℹ️ Segunda confirmación no encontrada, continuando...");
  }

  await waitForTabLoad(tabId);
  await sleep(wait);

  // Verify next state
  if (verifySelector) {
    const verified = await executeInTab(
      tabId,
      (sel) => {
        const btn = document.querySelector(sel);
        return btn ? true : false;
      },
      [verifySelector],
    );

    if (verified) {
      await log("   ✅ Verificado: botón del siguiente estado visible");
    } else {
      await captureTab(tabId, `${phase}-verify`);
      await log("   ⚠️ Verificación fallida: botón del siguiente estado no encontrado");
    }
  }

  await chrome.tabs.remove(tabId);
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
      await performAction("clockin", config.clockInSelector, config.clockInConfirmSelector, config.pauseSelector, true);
      state.phase = "clocked-in";
      state.clockInTimestamp = Date.now();
      await saveDayState(state);
      await log("   ✅ Entrada registrada");
      await scheduleRemainingAlarms(state);
    } else if (alarm.name === ALARM_PAUSE && state.phase === "clocked-in") {
      await log("⏸️ Pausando...");
      await performAction("pause", config.pauseSelector, config.pauseConfirmSelector, config.resumeSelector);
      state.phase = "paused";
      await saveDayState(state);
      await log("   ✅ Pausa registrada");
      await scheduleRemainingAlarms(state);
    } else if (alarm.name === ALARM_RESUME && state.phase === "paused") {
      await log("▶️ Retomando...");
      await performAction("resume", config.resumeSelector, config.resumeConfirmSelector, config.clockOutSelector);
      state.phase = "resumed";
      await saveDayState(state);
      await log("   ✅ Reanudación registrada");
      await scheduleRemainingAlarms(state);
    } else if (alarm.name === ALARM_CLOCK_OUT && state.phase === "resumed") {
      await log("🔴 Fichando salida...");
      await performAction("clockout", config.clockOutSelector, config.clockOutConfirmSelector, config.reopenSelector);
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

// ── Detect real phase from website ───────────────────────────
async function detectRealPhase() {
  const config = await getConfig();
  if (!config) return null;

  await log("   🔍 Detectando fase real en la web...");

  let tabId;
  try {
    const tab = await chrome.tabs.create({ url: config.loginUrl, active: false });
    tabId = tab.id;

    // Wait until tab is fully loaded and ready
    const ready = await waitForTabReady(tabId);
    await log(`   🔍 Tab ready: ${ready}`);
    const tabInfo = await chrome.tabs.get(tabId);
    await log(`   🔍 Tab status: ${tabInfo.status}, url: ${tabInfo.url}`);
    await sleep(2000);

    // Login
    const loginResult = await executeInTab(
      tabId,
      (user, pass, userSel, passSel, submitSel) => {
        const userInput = document.querySelector(userSel);
        const passInput = document.querySelector(passSel);
        const submitBtn = document.querySelector(submitSel);
        const debug = {
          userFound: !!userInput,
          passFound: !!passInput,
          submitFound: !!submitBtn,
          url: window.location.href,
          userSel,
          passSel,
          submitSel,
        };
        if (userInput) {
          userInput.value = user;
          userInput.dispatchEvent(new Event("input", { bubbles: true }));
          userInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (passInput) {
          passInput.value = pass;
          passInput.dispatchEvent(new Event("input", { bubbles: true }));
          passInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (submitBtn) submitBtn.click();
        return debug;
      },
      [config.user, config.pass, config.userSelector, config.passSelector, config.submitSelector],
    );

    await log(
      `   🔍 Login debug: user=${loginResult?.userFound}, pass=${loginResult?.passFound}, submit=${loginResult?.submitFound}`,
    );
    await log(`   🔍 URL pre-login: ${loginResult?.url}`);
    await log(
      `   🔍 Selectores: user="${loginResult?.userSel}" pass="${loginResult?.passSel}" submit="${loginResult?.submitSel}"`,
    );

    // Wait for navigation after login - try multiple strategies
    await waitForTabLoad(tabId);
    const wait = config.postActionWait || 3000;
    await sleep(wait);

    // Check if we're still on the login page
    const postLoginUrl = await executeInTab(tabId, () => window.location.href, []);
    await log(`   🔍 URL post-login: ${postLoginUrl}`);

    // Check which button is visible (retry up to 5 times for async ASP.NET loading)
    const selectorList = [
      { selector: config.clockInSelector, phase: "started" },
      { selector: config.pauseSelector, phase: "clocked-in" },
      { selector: config.resumeSelector, phase: "paused" },
      { selector: config.clockOutSelector, phase: "resumed" },
      { selector: config.reopenSelector, phase: "clocked-out" },
    ];

    let visibleButton = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await sleep(2000);

      visibleButton = await executeInTab(
        tabId,
        (selectors) => {
          const results = [];
          for (const { selector, phase } of selectors) {
            const btn = document.querySelector(selector);
            if (btn) {
              const visible =
                btn.offsetParent !== null || btn.offsetWidth > 0 || getComputedStyle(btn).display !== "none";
              results.push({ phase, selector, found: true, visible });
              if (visible) return { phase, debug: results };
            } else {
              results.push({ phase, selector, found: false, visible: false });
            }
          }
          return { phase: null, debug: results };
        },
        [selectorList],
      );

      if (visibleButton?.phase) break;

      // Log debug info on each failed attempt
      const debugInfo = visibleButton?.debug || [];
      const summary = debugInfo.map((d) => `${d.phase}:${d.found ? (d.visible ? "✓" : "hidden") : "✗"}`).join(" | ");
      await log(`   🔍 Intento ${attempt + 1}/5: ${summary || "sin resultados"}`);
    }

    // Log current URL for debugging
    const currentUrl = await executeInTab(tabId, () => window.location.href, []);
    await log(`   🔍 URL actual: ${currentUrl}`);

    await chrome.tabs.remove(tabId);
    tabId = null;

    const detectedPhase = visibleButton?.phase || null;
    if (detectedPhase) {
      await log(`   🔍 Fase real detectada: '${detectedPhase}'`);
    } else {
      await log("   ⚠️ No se pudo detectar la fase (ningún botón encontrado)");
    }
    return detectedPhase;
  } catch (err) {
    await log(`   ⚠️ Error detectando fase real: ${err?.message || err}`);
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {}
    }
    return null;
  }
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
      const realPhase = await detectRealPhase();
      if (realPhase && realPhase !== existing.phase) {
        await log(`   ⚠️ Fase guardada '${existing.phase}' difiere de la real '${realPhase}', actualizando`);
        existing.phase = realPhase;
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
    const detected = await detectRealPhase();
    if (detected) realPhase = detected;
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
      const config = await getConfig();
      const { logs = [] } = await storageGet("logs");
      const weekLog = await loadWeekLog();
      sendResponse({ state, hasConfig: !!config, logs: logs.slice(-30), weekLog });
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
