# Bot web con login y ejecucion periodica

Este proyecto usa Playwright para abrir una web, hacer login y ejecutar acciones automaticamente cada cierto tiempo.

## 1) Instalar dependencias

```bash
npm install
```

## 2) Configurar variables

Crea un archivo `.env` usando `.env.example` como base:

```bash
copy .env.example .env
```

Edita `.env` con:

- URL real de login (`LOGIN_URL`)
- Selectores reales del formulario (`LOGIN_*_SELECTOR`)
- Usuario y password
- URL destino (`TARGET_URL`)
- Selectores de acciones despues del login (`POST_LOGIN_CLICK_SELECTORS`)
- Intervalo (`INTERVAL_MINUTES`)

## 3) Ejecutar

```bash
npm start
```

El script ejecuta una ronda al iniciar y luego repite cada `INTERVAL_MINUTES`.

## Opcional: Ejecutarlo con el Programador de tareas de Windows

Si prefieres que Windows lo inicie automaticamente:

1. Crea una tarea basica en el Programador.
2. En Accion, usa:
   - Programa/script: `node`
   - Agregar argumentos: `src/worker.js`
   - Iniciar en: `D:\dev\fichar`
3. Configura el disparador con la frecuencia que quieras.

Nota: si usas el Programador, no necesitas el loop interno por intervalo. Puedes dejar `INTERVAL_MINUTES` alto o adaptar el script para una sola ejecucion.
