import { google } from "googleapis";
import { getAuthenticatedClient } from "./google-auth";
const CALENDAR_NAME = "Fichajes";
let _calendarId = null;
async function getCalendarApi() {
    const auth = await getAuthenticatedClient();
    return google.calendar({ version: "v3", auth });
}
/**
 * Busca (o crea) el calendario "Fichajes" y devuelve su ID.
 */
export async function getOrCreateCalendar() {
    if (_calendarId)
        return _calendarId;
    const cal = await getCalendarApi();
    // Buscar entre los calendarios existentes
    const list = await cal.calendarList.list();
    const existing = list.data.items?.find((c) => c.summary === CALENDAR_NAME);
    if (existing?.id) {
        _calendarId = existing.id;
        return _calendarId;
    }
    // Crear si no existe
    const created = await cal.calendars.insert({
        requestBody: { summary: CALENDAR_NAME, timeZone: "Europe/Madrid" },
    });
    _calendarId = created.data.id;
    return _calendarId;
}
const EVENT_TITLES = {
    clockIn: "Entrada",
    pause: "Pausa",
    resume: "Reanudar",
    clockOut: "Salida",
};
/**
 * Crea los 4 eventos de un día en el calendario.
 * Cada evento dura 5 minutos (solo como marcador visual).
 */
export async function createDayEvents(schedule) {
    const cal = await getCalendarApi();
    const calendarId = await getOrCreateCalendar();
    const entries = [
        { title: EVENT_TITLES.clockIn, start: schedule.clockIn },
        { title: EVENT_TITLES.pause, start: schedule.pause },
        { title: EVENT_TITLES.resume, start: schedule.resume },
        { title: EVENT_TITLES.clockOut, start: schedule.clockOut },
    ];
    for (const entry of entries) {
        const end = new Date(entry.start.getTime() + 5 * 60 * 1000);
        await cal.events.insert({
            calendarId,
            requestBody: {
                summary: entry.title,
                start: { dateTime: entry.start.toISOString(), timeZone: "Europe/Madrid" },
                end: { dateTime: end.toISOString(), timeZone: "Europe/Madrid" },
            },
        });
    }
}
/**
 * Lee los eventos de hoy del calendario "Fichajes" y devuelve el schedule.
 * Devuelve null si no hay eventos para hoy (día libre/vacaciones).
 */
export async function getTodaySchedule() {
    const cal = await getCalendarApi();
    const calendarId = await getOrCreateCalendar();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const res = await cal.events.list({
        calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
    });
    const events = res.data.items ?? [];
    if (events.length === 0)
        return null;
    const find = (title) => {
        const ev = events.find((e) => e.summary === title);
        if (!ev?.start?.dateTime)
            return null;
        return new Date(ev.start.dateTime);
    };
    const clockIn = find(EVENT_TITLES.clockIn);
    const pause = find(EVENT_TITLES.pause);
    const resume = find(EVENT_TITLES.resume);
    const clockOut = find(EVENT_TITLES.clockOut);
    if (!clockIn || !pause || !resume || !clockOut)
        return null;
    return { clockIn, pause, resume, clockOut };
}
/**
 * Elimina todos los eventos de un día concreto del calendario "Fichajes".
 */
export async function clearDayEvents(date) {
    const cal = await getCalendarApi();
    const calendarId = await getOrCreateCalendar();
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
    const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
    const res = await cal.events.list({
        calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
    });
    const events = res.data.items ?? [];
    for (const ev of events) {
        if (ev.id)
            await cal.events.delete({ calendarId, eventId: ev.id });
    }
    return events.length;
}
