import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clearDayEvents, createDayEvents } from "./google-calendar";
const HOLIDAYS_PATH = join(__dirname, "..", "holidays.json");
function loadHolidays() {
    const data = JSON.parse(readFileSync(HOLIDAYS_PATH, "utf-8"));
    return new Set(data.map((h) => h.date));
}
function toDateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
}
function minutesToMs(min) {
    return min * 60 * 1000;
}
function dateAt(base, hours, minutes) {
    const d = new Date(base);
    d.setHours(hours, minutes, 0, 0);
    return d;
}
function isWeekday(date) {
    const day = date.getDay();
    return day >= 1 && day <= 5;
}
function isFriday(date) {
    return date.getDay() === 5;
}
function formatDate(d) {
    return d.toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit" });
}
function formatTime(d) {
    return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
/**
 * Genera un horario aleatorio para un día concreto.
 * Para viernes, acepta un exceso acumulado L-J para ajustar la salida.
 */
function generateDaySchedule(date, weekExcessMs = 0) {
    const clockIn = new Date(randomBetween(dateAt(date, 8, 0).getTime(), dateAt(date, 8, 15).getTime()));
    const pause = new Date(randomBetween(dateAt(date, 12, 45).getTime(), dateAt(date, 13, 15).getTime()));
    const resume = new Date(pause.getTime() + randomBetween(minutesToMs(20), minutesToMs(40)));
    const morningWork = pause.getTime() - clockIn.getTime();
    let clockOut;
    if (isFriday(date)) {
        const fridayTarget = EIGHT_HOURS_MS - weekExcessMs - randomBetween(minutesToMs(5), minutesToMs(15));
        const remainingWork = fridayTarget - morningWork;
        clockOut = new Date(resume.getTime() + Math.max(remainingWork, 0));
    }
    else {
        const remainingWork = EIGHT_HOURS_MS - morningWork;
        const jitter = randomBetween(-minutesToMs(10), minutesToMs(10));
        clockOut = new Date(resume.getTime() + remainingWork + jitter);
    }
    return { clockIn, pause, resume, clockOut };
}
function getTotalWorkMs(s) {
    return s.pause.getTime() - s.clockIn.getTime() + (s.clockOut.getTime() - s.resume.getTime());
}
async function main() {
    const args = process.argv.slice(2);
    const year = args[0] ? Number(args[0]) : new Date().getFullYear();
    const clearFirst = args.includes("--clear");
    const holidays = loadHolidays();
    console.log(`📅 Generando horarios para ${year} (${holidays.size} festivos cargados)...`);
    if (clearFirst) {
        console.log("🗑️  Se eliminarán eventos existentes de cada día antes de crear nuevos");
    }
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let current = new Date(startDate);
    let created = 0;
    let skipped = 0;
    let holidaySkipped = 0;
    let weekExcessMs = 0;
    let weekDaySchedules = [];
    while (current <= endDate) {
        // Reset acumulado semanal los lunes
        if (current.getDay() === 1) {
            weekExcessMs = 0;
            weekDaySchedules = [];
        }
        if (isWeekday(current)) {
            // Saltar festivos
            if (holidays.has(toDateKey(current))) {
                console.log(`   ${formatDate(current)}: 🎉 Festivo, saltando`);
                holidaySkipped++;
                current.setDate(current.getDate() + 1);
                continue;
            }
            // Saltar días pasados (no sobreescribir lo ya fichado)
            if (current < today && !clearFirst) {
                skipped++;
                current.setDate(current.getDate() + 1);
                continue;
            }
            const schedule = generateDaySchedule(current, weekExcessMs);
            const workMs = getTotalWorkMs(schedule);
            console.log(`   ${formatDate(current)}: ${formatTime(schedule.clockIn)} → ${formatTime(schedule.pause)} | ${formatTime(schedule.resume)} → ${formatTime(schedule.clockOut)}  (${(workMs / 3600000).toFixed(2)}h)`);
            if (clearFirst) {
                const removed = await clearDayEvents(current);
                if (removed > 0)
                    console.log(`      🗑️ ${removed} eventos eliminados`);
            }
            await createDayEvents(schedule);
            created++;
            // Acumular exceso para viernes
            if (!isFriday(current)) {
                weekExcessMs += workMs - EIGHT_HOURS_MS;
                weekDaySchedules.push(schedule);
            }
        }
        current.setDate(current.getDate() + 1);
    }
    console.log(`\n✅ ${created} días creados, ${skipped} días pasados saltados, ${holidaySkipped} festivos excluidos`);
}
main().catch(console.error);
