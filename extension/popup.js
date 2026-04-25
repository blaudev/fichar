function formatTimeMs(ms) {
  return new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatHours(ms) {
  return (ms / 3600000).toFixed(1) + "h";
}

const phaseLabels = {
  started: "Esperando entrada",
  "clocked-in": "Fichado",
  paused: "En pausa",
  resumed: "Trabajando",
  "clocked-out": "Jornada completa",
};

const phaseNext = {
  started: { emoji: "🟢", label: "Entrada", timeKey: "clockInTime" },
  "clocked-in": { emoji: "⏸️", label: "Pausa", timeKey: "pauseTime" },
  paused: { emoji: "▶️", label: "Retomar", timeKey: "resumeTime" },
  resumed: { emoji: "🔴", label: "Salida", timeKey: "clockOutTime" },
};

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "getStatus" });
  const { state, hasConfig, logs, weekLog } = response;

  const badge = document.getElementById("statusBadge");

  if (!hasConfig) {
    badge.textContent = "Sin configurar";
    badge.className = "status-badge status-no-config";
    return;
  }

  if (!state) {
    badge.textContent = "Día libre";
    badge.className = "status-badge status-day-off";
    document.getElementById("tClockIn").textContent = "--:--";
    document.getElementById("tPause").textContent = "--:--";
    document.getElementById("tResume").textContent = "--:--";
    document.getElementById("tClockOut").textContent = "--:--";
  } else {
    badge.textContent = phaseLabels[state.phase] || state.phase;
    badge.className = `status-badge status-${state.phase}`;

    document.getElementById("tClockIn").textContent = formatTimeMs(state.clockInTime);
    document.getElementById("tPause").textContent = formatTimeMs(state.pauseTime);
    document.getElementById("tResume").textContent = formatTimeMs(state.resumeTime);
    document.getElementById("tClockOut").textContent = formatTimeMs(state.clockOutTime);

    // Highlight active phase
    const phases = ["started", "clocked-in", "paused", "resumed"];
    const timeIds = ["tClockIn", "tPause", "tResume", "tClockOut"];
    const currentIdx = phases.indexOf(state.phase);
    timeIds.forEach((id, i) => {
      document.getElementById(id).classList.toggle("active", i === currentIdx);
    });

    // Next action
    const next = phaseNext[state.phase];
    const nextDiv = document.getElementById("nextAction");
    if (next && state.phase !== "clocked-out") {
      nextDiv.style.display = "flex";
      nextDiv.style.alignItems = "center";
      nextDiv.style.gap = "8px";
      document.getElementById("nextEmoji").textContent = next.emoji;
      document.getElementById("nextInfo").textContent = `${next.label} a las ${formatTimeMs(state[next.timeKey])}`;
    } else {
      nextDiv.style.display = "none";
    }

    // Hours
    const morningMs = state.pauseTime - state.clockInTime;
    const afternoonMs = state.clockOutTime - state.resumeTime;
    const todayMs = morningMs + afternoonMs;
    document.getElementById("todayHours").textContent = formatHours(todayMs);

    if (weekLog) {
      const weekMs = Object.values(weekLog.days).reduce((s, v) => s + v, 0);
      document.getElementById("weekHours").textContent = formatHours(weekMs + todayMs);
    }
  }

  // Logs
  const container = document.getElementById("logsContainer");
  container.innerHTML = "";
  for (const line of logs || []) {
    const div = document.createElement("div");
    div.className = "line";
    div.textContent = line;
    container.appendChild(div);
  }
  container.scrollTop = container.scrollHeight;
}

document.getElementById("btnRun").addEventListener("click", async () => {
  const btn = document.getElementById("btnRun");
  btn.disabled = true;
  btn.textContent = "⏳ ...";
  await chrome.runtime.sendMessage({ type: "runNow" });
  setTimeout(async () => {
    await refresh();
    btn.disabled = false;
    btn.textContent = "▶ Iniciar hoy";
  }, 2000);
});

document.getElementById("btnGoogle").addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "authGoogle" });
  if (res.error) {
    alert("Error: " + res.error);
  } else {
    alert("✅ Google Calendar autorizado");
  }
});

document.getElementById("btnOptions").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("btnGenerate").addEventListener("click", async () => {
  const btn = document.getElementById("btnGenerate");
  if (!confirm("Esto creará eventos para todo el año en el calendario 'Fichajes'. ¿Continuar?")) return;
  btn.disabled = true;
  btn.textContent = "⏳ Generando...";
  const res = await chrome.runtime.sendMessage({ type: "generateCalendar" });
  if (res.error) {
    alert("Error: " + res.error);
  } else {
    alert(`✅ Calendario generado: ${res.created} días creados, ${res.skipped} saltados`);
  }
  btn.disabled = false;
  btn.textContent = "📅 Generar calendario";
  await refresh();
});

refresh();
