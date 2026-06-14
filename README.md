# Fichar Bot

Fichaje automático en el portal **Presence** de Adding Plus
(`https://portalempleado.addingplus.net/`): entrada, pausa, reanudación y salida.

Hay **dos formas** de usarlo, elige una:

- **`extension/`** — extensión de Chrome. Precisa, pero requiere tu equipo
  encendido con Chrome. Lee el horario de Google Calendar.
- **`bot/` + GitHub Actions** — script que corre en la nube cada cierto tiempo,
  sin depender de tu equipo. Horario generado por el propio script.

---

## Opción A: Extensión de Chrome

Extensión (Manifest V3) que ficha según el horario que haya en Google Calendar.
No tiene página de configuración: los datos necesarios (URL, credenciales,
botones de fichaje) están fijos en `extension/background.js`.

## Instalación

1. Abre `chrome://extensions`.
2. Activa **Modo de desarrollador** (arriba a la derecha).
3. **Cargar descomprimida** → selecciona la carpeta `extension/`.
4. Abre el popup de la extensión y pulsa **🔑 Google** para autorizar el acceso
   a Google Calendar la primera vez.

## Cómo funciona

- A las **7:55 de lunes a viernes** la extensión lee los eventos del día en el
  calendario **"Fichajes"** y programa las acciones mediante alarmas:
  - `Entrada` → ficha entrada
  - `Pausa` → pausa
  - `Reanudar` → reanuda
  - `Salida` → ficha salida
- A cada hora abre el portal en una pestaña en segundo plano, hace login, pulsa
  el botón correspondiente y confirma en el modal. Verifica el estado resultante
  ("In progress", "On break", "Ended").
- El estado del día se guarda en `chrome.storage`, de modo que si Chrome se
  reinicia retoma la jornada donde la dejó. Al arrancar comprueba el estado real
  en la web y lo reconcilia.

## Popup

- **▶ Iniciar hoy** — fuerza la comprobación del día (normalmente automática a las 7:55).
- **🔑 Google** — autoriza Google Calendar.
- **📅 Generar calendario** — rellena el calendario "Fichajes" del año con horarios
  generados (entrada ~8:00, pausa ~13:00, ~8 h/día, ajuste de viernes para no
  pasar de 40 h/semana). Salta los días que ya tienen eventos y los festivos.

Además muestra el horario de hoy, las horas trabajadas (día/semana) y un log reciente.

## Estructura

```
extension/
  manifest.json       # Manifest V3, permisos y host del portal
  background.js        # Service worker: alarmas, fichaje, Google Calendar
  popup.html / .js     # Interfaz del popup
  generate-icons.html  # Utilidad para regenerar los iconos
  icons/               # Iconos de la extensión
```

## Ajustes

Si cambian los textos/botones del portal o las credenciales, edita el objeto
`CONFIG` al principio de `extension/background.js`. Los festivos están en
`HOLIDAYS_2026` dentro del mismo archivo.

---

## Opción B: Script en GitHub Actions (`bot/`)

Script Playwright **sin estado**: en cada ejecución hace login, lee el estado
real del portal ("Not started / In progress / On break / Ended") y, según la hora
de Madrid, realiza la acción que toque. No necesita guardar nada entre ejecuciones.

El horario lo genera el propio script con variación diaria (entrada ~08:00-08:15,
pausa ~13:00-13:15 de 25-40 min, salida para completar ~8 h). Salta fines de
semana y festivos (`HOLIDAYS` en `bot/fichar.mjs`).

### Puesta en marcha

1. Sube este repo a GitHub (**público**, para Actions ilimitados).
2. En **Settings → Secrets and variables → Actions**, crea:
   - `PORTAL_USER` — tu usuario (DNI).
   - `PORTAL_PASS` — tu contraseña.
3. En la pestaña **Actions**, habilita los workflows.
4. El workflow `.github/workflows/fichar.yml` corre cada 5 min L-V en las ventanas
   horarias. Puedes lanzarlo a mano con **Run workflow** (workflow_dispatch).

### Probar en local

```bash
cd bot
npm install
npx playwright install chromium
DRY_RUN=1 PORTAL_USER=XXXX PORTAL_PASS=YYYY npm run dry-run   # no ficha, solo dice qué haría
```

### Limitaciones

- El cron de GitHub Actions **no es puntual**: puede retrasarse varios minutos y,
  en horas punta, algún día podría no ejecutarse. Para "fichar sobre las 8:00" es
  aceptable, pero no es tan fiable como un cron propio (Raspberry Pi / VPS).
- No compensa el descuadre semanal de los viernes (cada día apunta a ~8 h).
