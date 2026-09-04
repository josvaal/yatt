<div align="center">

<img src="./assets/logo_yatt.png" alt="Logo de YATT" width="160" />

# YATT — Yet Another Testing Tool

<img src="./assets/banner_yatt.jpg" alt="Banner de YATT" width="720" />

</div>

Testing de UI **interactivo**: apuntas las acciones sobre un Chromium real y el test
se construye y valida paso a paso, sin escribir código. Motor: Playwright (sidecar
Node). Tests guardados como JSON.

Estado actual: **Fase 2 completada — variables, entornos y data-driven** (ver
`ROADMAP.md` y `PRODUCT.md`).

## Integración con IA (MCP)

YATT incluye un **servidor MCP** (`mcp/`) para que un asistente de IA gestione
tests, corra suites headless y controle un navegador en vivo viendo screenshots —
100 % local. ~34 tools, recursos y prompts; manual y configs en
[`mcp/README.md`](mcp/README.md):

```bash
cd mcp && bun install
bun run mcp/src/server.ts [--http] [--root /ruta/al/repo]
```

## Cómo correrlo

```bash
bun install            # dependencias del frontend
cd sidecar && bun install && bunx playwright install chromium   # motor de browser (una vez)
bun tauri dev          # abre la app de escritorio
```

En `bun tauri dev` la app arranca automáticamente un **sidecar Node**
(`sidecar/src/index.ts`) que controla Chromium. La comunicación es JSON-RPC por
líneas (stdin/stdout) con el proceso host (Rust), con watchdog interno por
petición para que el protocolo nunca se quede sin responder.

Para ver el tráfico del puente:

```bash
YATT_DEBUG=1 bun tauri dev
```

## Qué hace la app

- **Abrir navegador**: visible (ventana propia, para apuntar) o headless (corrida).
  En modo visible, si redimensionas la ventana de Chromium el viewport de la página
  la sigue automáticamente (sincronizador CDP con asentamiento: `Browser.getWindowBounds`
  → `setViewportSize`; el grosor del marco se autocalibra). **Reiniciar** cierra y
  reabre con sesión 100 % limpia (sin cookies ni estado) sin perder los pasos.
- **Barra flotante YATT** inyectada en la página: lenguaje visual de shadcn/ui
  (tokens oscuros, radios, hover/focus-visible) con **iconos de lucide** (SVG
  inline, regenerables con `bun run scripts/gen-icons.ts`). Es **draggable** con
  asa superior y recuerda su posición. Arma la acción y luego haces clic sobre el
  elemento objetivo; los valores se piden inline en la propia barra. Acciones:
  Click, Doble click, Hover, Escribir, Limpiar, Seleccionar opción (con las
  opciones reales del `<select>`), Checkbox, Tecla, Esperar visible, Scroll al
  elemento, asserts (visible/oculto/texto/valor/atributo) y Screenshot. Esc cancela.
- **Panel de pasos**: editar selector/valor (✏️), duplicar (copia pausada),
  reordenar (↑↓), pausar/reanudar, ejecutar un paso o todos (los pausados se
  saltan), borrar, y **Reemplazar** (✧): elige una nueva acción en la barra YATT
  y el paso se sustituye completo (acción + selector + valor) en lugar de añadir
  uno nuevo. Selector robusto (`data-testid` → `id` → CSS corto único).
- **Re-grabado en un clic** (↻ en un paso): el siguiente clic en la página
  reemplaza el selector del paso y lo re-ejecuta al instante.
- **Preview de la página** (en la app): vista en vivo del navegador — clic sobre
  la imagen = click real por coordenadas; rueda = scroll real (con throttle);
  botones ↑↓ y actualizar. Imprescindible en headless (no hay ventana); en modo
  visible es un espejo de la ventana.
- **Variables y entornos (Fase 2)**: variables tipadas (texto, número, opción con
  lista de valores, archivo/imagen) con **valores por entorno** (default/dev/prod +
  entornos libres) y **sobrescrituras por corrida**. La interpolación
  `{{nombre}}` funciona en el value, selector y atributo de cualquier paso; se
  resuelve al ejecutar, sin tocar los pasos. El runner muestra el entorno activo
  en el botón de ejecución.
- **Dataset · data-driven**: pega un CSV (cabecera = variables) y "Ejecutar con
  dataset" corre el test una vez por fila, con reporte ✓/✗ por fila. Guardado en
  el archivo del test.
- **Guardar / cargar / borrar**: almacenamiento del sistema en **SQLite**
  (`yatt.db` en la raíz, WAL) como fuente de verdad para tests, reportes,
  imágenes base y sesiones; los ficheros `tests/<nombre>.yatt.json`,
  `reports/*` y `baselines/*.png` se mantienen como **espejo automático**
  (git, CLI y "abrir con el SO" siguen funcionando). Esquema
  `schemaVersion: 1`, incluye steps, variables, entornos y dataset.

## Verificación automatizada

```bash
cd sidecar && bun run test/smoke.ts            # todas las secciones
cd sidecar && bun run test/smoke.ts form       # solo una sección
```

Secciones (cada una arranca su propio sidecar para no arrastrar estado):
`core` (abrir/pasos/screenshot/errores), `toolbar` (captura armar→clic, Esc),
`preview` (screenshot/scroll/click por coordenadas), `form` (acciones RF-04 sobre
un formulario real: type/select/check/clear/press_key/asserts/scroll) y
`grab` (re-grabado por evento, cancelación con Esc).

## Estructura relevante

```
sidecar/src/index.ts        sidecar JSON-RPC + Playwright + watchdogs (open/run_step/preview/start_grab…)
sidecar/src/db.ts           acceso a SQLite (bun:sqlite / node:sqlite) con el esquema del sistema
sidecar/src/interaction.ts  helper inyectado en la página (barra de acciones RF-04 + selectores)
sidecar/test/smoke.ts       smoke test por secciones aisladas
src-tauri/src/sidecar.rs    spawn/kill del sidecar + puente JSON-RPC + eventos
src-tauri/src/db.rs         yatt.db (SQLite WAL): conexión, migración de legacy y espejos
src-tauri/src/storage.rs    comandos Tauri sobre SQLite (tests/reports/baselines/exports)
src/lib/yatt.ts             cliente del bridge desde la UI (tipos + invoke)
src/App.tsx                 editor: pasos editables, navegador, preview, resultado, persistencia
```

Nota de despliegue: en este prototipo el sidecar se lanza con `bun run
sidecar/src/index.ts` desde Rust. En un build empaquetado se sustituirá por un
binario sidecar registrado en Tauri (fase de distribución del `ROADMAP.md`).

## Solución de problemas

**El motor WebKit no abre ("missing dependencies to run browsers").** El
binario de WebKit que empaqueta Playwright necesita librerías del sistema que
en Arch/CachyOS no vienen por defecto (Playwright solo documenta Debian/Ubuntu,
y el sidecar antes mostraba solo "launch:" — el mensaje completo se agregó en
`sidecar/src/index.ts`). En Arch:

```bash
sudo pacman -S --needed flite libbacktrace libwpe wpebackend-fdo wpewebkit
# El bundle de Playwright espera sonames más antiguos que los de Arch:
sudo ln -sf /usr/lib/libicuuc.so.78  /usr/lib/libicuuc.so.74
sudo ln -sf /usr/lib/libicui18n.so.78 /usr/lib/libicui18n.so.74
sudo ln -sf /usr/lib/libicudata.so.78 /usr/lib/libicudata.so.74
sudo ln -sf /usr/lib/libjxl.so.0.12   /usr/lib/libjxl.so.0.8
sudo ln -sf /usr/lib/libxml2.so.16   /usr/lib/libxml2.so.2
```

Los números de soname de Arch cambian con cada actualización de `icu`,
`libjxl` o `libxml2`; si vuelve a fallar, ajusta los targets de los symlinks a
la versión actual (`ls /usr/lib/libicu*.so.*`).