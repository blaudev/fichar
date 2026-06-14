# Fichar Bot

Fichaje automático en el portal **Presence** de Adding Plus
(`https://portalempleado.addingplus.net/`): entrada, pausa, reanudación y salida.

Es un script de Playwright que corre en **GitHub Actions** cada cierto tiempo, sin
depender de tu equipo. En cada ejecución hace login, lee el estado real del portal
("Not started / In progress / On break / Ended") y, según la hora de Madrid, realiza
la acción que toque. No guarda estado entre ejecuciones: el portal es la fuente de
verdad, así que es idempotente (no ficha dos veces aunque el cron dispare varias).

El horario lo genera el propio script con variación diaria (entrada ~08:00-08:15,
pausa ~13:00-13:15 de 25-40 min, salida para completar ~8 h). Salta fines de semana
y festivos (`HOLIDAYS` en `bot/fichar.mjs`).

## Puesta en marcha

1. **Secrets** — en **Settings → Secrets and variables → Actions** del repo, crea:
   - `PORTAL_USER` — tu usuario (DNI).
   - `PORTAL_PASS` — tu contraseña.
2. **Repo público** — para que GitHub Actions sea ilimitado (con privado solo hay
   2.000 min/mes y el cron los agota). Las credenciales van en Secrets, así que no
   se exponen aunque el repo sea público.
3. **Habilita Actions** (pestaña Actions) si está deshabilitado.

El workflow `.github/workflows/fichar.yml` corre cada 5 min L-V en las ventanas
horarias. Puedes lanzarlo a mano con **Actions → Fichar → Run workflow**.

## Detener el fichaje (vacaciones, etc.)

Desactiva el workflow y vuelve a activarlo cuando quieras:

- **Web:** Actions → "Fichar" → menú `···` → **Disable workflow** / **Enable workflow**.
- **CLI:** `gh workflow disable fichar.yml` / `gh workflow enable fichar.yml`.

## Probar en local

```bash
cd bot
npm install
npx playwright install chromium
# No ficha, solo dice qué haría:
DRY_RUN=1 PORTAL_USER=XXXX PORTAL_PASS=YYYY npm run dry-run
```

## Limitaciones

- El cron de GitHub Actions **no es puntual**: puede retrasarse varios minutos y, en
  horas punta, algún día podría no ejecutarse. Para "fichar sobre las 8:00" es
  aceptable, pero no tan fiable como un cron propio (Raspberry Pi / VPS).
- No compensa el descuadre semanal de los viernes (cada día apunta a ~8 h).

## Estructura

```
bot/
  fichar.mjs    # script de fichaje (Playwright, stateless)
  package.json
.github/workflows/
  fichar.yml    # cron que ejecuta el script
```
