# Arquitectura — YATT

## Vista de alto nivel

```
┌────────────────────────────────────────────────────────────┐
│                       YATT (Tauri 2)                       │
│                                                             │
│  ┌────────────────────┐    ┌────────────────────────────┐   │
│  │  Frontend React 19 │    │   Core Rust (Tauri)        │   │
│  │  - Editor de pasos │    │   - Commands (IPC)         │   │
│  │  - Toolbar flotante│    │   - Gestión de sets/JSON   │   │
│  │  - Variables/envs. │    │   - Orquestación sidecar   │   │
│  │  - Runner UI/rep.  │    │   - Spawn/kill Chromium    │   │
│  └─────────┬──────────┘    └────────────┬───────────────┘   │
│            │      (Tauri IPC: invoke / event)               │
│            ▼                              ▼                 │
│  ┌────────────────────────────────────────────────────┐     │
│  │            Playwright sidecar (Node)               │     │
│  │   JSON-RPC sobre stdin/stdout (proceso hijo)       │     │
│  │   - Abre/pausa/cierra browser (visible | headless) │     │
│  │   - Ejecuta pasos y asserts sobre Chromium         │     │
│  │   - Captura selectores, screenshots, evidencia     │     │
│  └────────────────────────────────────────────────────┘     │
│                       │  Chrome DevTools Protocol            │
│                       ▼                                      │
│              ┌──────────────────┐                            │
│              │     Chromium     │  (ventana propia o         │
│              │   (Playwright)   │   headless + preview)      │
│              └──────────────────┘                            │
└────────────────────────────────────────────────────────────┘
           │                              │
           ▼                              ▼
  ┌───────────────────┐        ┌──────────────────────┐
  │ Filesystem: tests │        │ Reports: JSON + HTML │
  │ *.yatt.json, sets │        │ screenshots, logs,   │
  │ (usuario/proyecto)│        │ tiempos              │
  └───────────────────┘        └──────────────────────┘
```

## Componentes

- **Frontend / cliente (React 19 + Vite + Tailwind 4 + shadcn/ui)**: la interfaz del editor (panel de pasos, barra de acciones flotante, variables y entornos), la vista de sets (lista de tests JSON) y la UI del runner con reportes. Se comunica con Rust únicamente vía Tauri IPC.
- **Core Rust (Tauri 2)**: expone los comandos de la app (crear/abrir/guardar tests, lanzar browser, ejecutar pasos), gestiona el ciclo de vida del sidecar Node (spawn, estado, kill limpio) y manipula el filesystem local.
- **Playwright sidecar (Node)**: proceso hijo que controla Chromium y habla JSON-RPC sobre stdin/stdout con Rust. Es el único componente que toca el navegador: abre la instancia (visible o headless), ejecuta pasos, captura selectores y evidencia. Al estar separado, un crash del browser no tumba la app: se mata el sidecar y se relanza.
- **Datos**: tests y sets como archivos JSON (esquema versionado) en el filesystem del usuario; histórico de corridas y reportes también en JSON + HTML. Sin base de datos.
- **Servicios externos**: ninguno en la primera versión (100 % local).

## Flujo principal

1. El usuario crea un test en YATT; el frontend pide a Rust lanzar el browser.
2. Rust arranca el sidecar Node y le ordena abrir Chromium en la URL inicial (visible o headless).
3. El usuario señala elementos sobre la página; la UI muestra la barra de acciones y crea pasos con el selector capturado por el sidecar.
4. Cada paso nuevo se envía al sidecar para ejecutarse al instante; el resultado (OK/fail + screenshot de evidencia) vuelve a la UI.
5. Al guardar, Rust serializa el test a `*.yatt.json` (schemaVersion, steps, variables, entornos, config del navegador).
6. Para correr un set: el runner itera los tests, el sidecar ejecuta la secuencia de pasos en headless y devuelve resultados; Rust genera el reporte (JSON + HTML) con evidencia.
7. Si un paso falla en una corrida, el reporte guarda screenshot + error (y en los pasos ok, screenshot de evidencia); en el editor, el usuario re-graba el selector y revalida en un clic.

## Stack tecnológico propuesto

| Capa | Tecnología | Justificación |
|---|---|---|
| Shell desktop | Tauri 2 (Rust) | Ya en el repo; app ligera, acceso a filesystem y procesos, instaladores nativos |
| Cliente (UI) | React 19 + Vite + TypeScript + Tailwind 4 + shadcn/ui (base-ui) + lucide-react | Ya en el repo; UI rápida, consistente y con a11y decente |
| Motor de browser | Playwright (Node) en sidecar | Ya conocida por el equipo; estándar para controlar Chromium; APIs maduras de selector, assert y screenshots |
| Comunicación | Tauri IPC (invoke/event) + JSON-RPC (stdin/stdout) en el sidecar | Separa UI ↔ Rust ↔ Node; el sidecar es aislable y reiniciable |
| Persistencia | Archivos JSON (`*.yatt.json`) en el filesystem | Requisito del usuario: formato universal, portable y versionable |
| Reportes | JSON + HTML estático generado localmente, screenshots en carpeta de artefactos | Legibles y compartibles, sin infraestructura |
| Gestión de paquetes | Bun | Ya en el repo (`bun.lock`) |

## Decisiones clave

- **Playwright en sidecar Node, no en Rust**: el ecosistema Node de Playwright es el que el equipo ya usa; mantener el motor en Node evita reimplementar selectores/asserts en Rust. El sidecar es un proceso aislado: si Chromium se cuelga, se mata y se relanza sin reiniciar la app.
- **Browser visible en ventana propia**, no embebido en la webview de Tauri: un Chromium real no se incrusta de forma fiable; una ventana separada es fiel, sin lag y permite interacción natural. En headless, la UI muestra previews por screenshot de cada paso.
- **JSON versionado como fuente de verdad**: `schemaVersion` permite migrar tests viejos al abrir sin romper el formato; los archivos pueden vivir en el repo del proyecto bajo prueba.
- **Selectores con varias estrategias y fallback**: prioridad `data-testid` → role/texto accesible → CSS autogenerado; captura automática al apuntar + edición manual y re-grabado en un clic cuando un paso falla.
- **Runner secuencial en v1**: un browser a la vez; el paralelismo y la interrupción limpia quedan para fases posteriores (RNF-08).
- **Sin telemetría y sin servicios externos**: todo corre local; las variables sensibles se enmascaran en logs y reportes (RNF-05).

## Despliegue

- **Desarrollo**: `bun tauri dev` (Vite + hot reload; el sidecar Node se arranca como proceso hijo también en dev).
- **Build/Package**: `bun tauri build` → instaladores nativos (deb/rpm/AppImage en Linux, NSIS en Windows, DMG en macOS).
- **Distribución**: instalador local primero; auto-updater de Tauri cuando haya canal de release.
- **CI del propio proyecto (futuro)**: el equipo usa YATT para testear YATT — los tests de la app corren vía runner headless en el pipeline (depende de RF-28, CLI headless).