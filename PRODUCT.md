# YATT — Yet Another Testing Tool

> **Resumen ejecutivo**: herramienta **open source** de testing de UI que permite crear,
> validar y ejecutar tests de interfaces web señalando las acciones sobre un Chromium
> real — sin escribir código — con tests guardados como JSON y un servidor MCP para que
> un asistente de IA los gestione y ejecute. 100 % local.

## Problema

Escribir tests de UI con las herramientas modernas (Playwright, Cypress) es lento por tres
motivos que se encadenan:

1. **Escribir el test es escribir código**: selectores, esperas, asserts. Acertar con el
   selector correcto, la espera adecuada y el assert a la primera es raro — hay que conocer
   el DOM, los atributos y los tiempos de la aplicación bajo prueba.
2. **El test no sale bien a la primera**: el bucle habitual es correr → falla → debuggear →
   corregir → volver a correr. Cada vuelta del feedback loop cuesta minutos, y el error suele
   ser un selector frágil o una espera mal puesta.
3. **Mantener los tests es trabajo manual**: cuando la web cambia, hay que localizar el paso
   roto en el código y reescribirlo.

Y además, las alternativas visuales del mercado son SaaS caros que suben tu web y tus tests
a la nube, o grabadores antiguos (Selenium IDE) con selectores frágiles y sin variables.

## Solución

YATT reemplaza la escritura de código por **autoría visual interactiva**:

- Apuntas y haces clic sobre la página real en Chromium; la **barra flotante YATT** captura
  un selector robusto automáticamente (`data-testid` → `id` → CSS corto único) y crea el
  paso por ti.
- Cada paso se ejecuta **al instante** en el momento de crearlo: si no funciona, lo corriges
  ahí mismo (re-grabar el selector con un clic, reemplazar el paso completo, ajustar el
  valor). El test queda bien construido a la primera.
- Las **variables tipadas** (texto, número, opción, archivo/imagen) con **valores por
  entorno** (default/dev/prod + entornos libres) y **sobrescrituras por corrida**
  parametrizan cualquier paso; la interpolación `{{nombre}}` se resuelve al ejecutar.
- **Data-driven**: pegás un CSV y el test corre una vez por fila, con reporte ✓/✗ por fila.
- Los tests se guardan como **JSON versionable** (`schemaVersion: 1`) con espejo en
  **SQLite** (`yatt.db`) como fuente de verdad — portable, legible por Git y por cualquier
  otra herramienta.
- **Servidor MCP** integrado: un asistente de IA (Claude, Cursor, etc.) puede gestionar
  tests, correr suites headless y controlar un navegador en vivo viendo screenshots
  (~34 tools, recursos y prompts). Testing de UI asistido por IA, 100 % local.
- Se ejecuta **100 % local**, sin nube ni telemetría: modo visible para depurar (con
  preview en vivo interactiva dentro de la app), modo headless para correr sets completos
  con reporte de evidencia (screenshots de fallo, logs, tiempos).

**Propuesta de valor**: pasar de "escribir y depurar tests" a "señalar y validar tests" —
crear un test se mide en minutos, funciona desde el primer guardado, y hasta tu asistente
de IA puede operarlo.

## Usuarios objetivo

- **Ingenieros QA**: crean y mantienen los tests del producto sin la fricción del código;
  obtienen un reporte claro por corrida y tests versionables en Git.
- **Desarrolladores**: validan flujos rápidamente sin montar infraestructura de tests;
  guardan el test como JSON en el repo.
- **Agentes de IA / desarrolladores con asistentes**: vía el servidor MCP, delegan en la IA
  la exploración de la web, la creación de tests y la ejecución headless con evidencia
  visual.

## Plataforma

**Aplicación de escritorio** (Tauri + React), porque:

- Lanza y controla un navegador real (Chromium visible o headless) sin las restricciones de
  un navegador anfitrión.
- Acceso directo al filesystem y a SQLite para guardar tests, reportes y baselines donde el
  equipo quiera, incluso dentro del repo de la aplicación bajo prueba.
- Feedback inmediato, cero latencia de red: el editor y el runner viven en la misma máquina.

Complementos: **CLI headless** (`sidecar`) para correr tests desde terminal, y **servidor
MCP** para clientes de IA.

## Diferenciación

| Herramienta | Enfoque | Punto débil frente a YATT |
|---|---|---|
| Playwright / Cypress | Código primero | Hay que escribir y depurar código; feedback loop lento |
| Selenium IDE | Grabador visual | Selectores frágiles, sin variables modernas, sin validación paso a paso |
| Testim / Mabl / SaaS | Visual en la nube | Costosos, propietarios, suben web y tests a la nube; no funcionan 100 % local |
| Grabadores de IA genéricos | Prompt → script | Generan código opaco que hay que mantener a mano; sin editor visual ni variables |

YATT es la combinación que falta en el mercado: **autoría visual interactiva + motor
Playwright + JSON local + integración MCP para IA**, todo open source y sin nube.

## Alcance

**Incluido (implementado a la fecha)**
- Lanzar Chromium controlado desde la app: modo visible (ventana propia con viewport
  sincronizado por CDP) y headless (preview interactiva en la app); reinicio con sesión
  limpia sin perder pasos.
- Barra flotante inyectada en la página (shadcn/ui + lucide, draggable): Click, Doble click,
  Hover, Escribir, Limpiar, Seleccionar opción, Checkbox, Tecla, Esperar visible, Scroll,
  asserts (visible/oculto/texto/valor/atributo) y Screenshot.
- Captura automática de selectores robustos con edición manual, reemplazo completo de paso
  y **re-grabado en un clic** (↻).
- Panel de pasos: editar, duplicar, reordenar, pausar, ejecutar paso a paso o todo.
- Variables tipadas, entornos con valores por entorno, sobrescrituras por corrida,
  interpolación `{{nombre}}` en value/selector/atributo.
- Dataset CSV para ejecución data-driven con reporte por fila.
- Gestión de tests y sets: crear, abrir, guardar, renombrar, duplicar, eliminar.
- Persistencia: SQLite (`yatt.db`, WAL) como fuente de verdad + espejo automático en
  `tests/*.yatt.json`, `reports/` y `baselines/` (git-friendly).
- Runner local headless con reporte (pasado/fallado, screenshots, logs, tiempos).
- CLI headless (`sidecar/src/cli.ts`) y **servidor MCP** (~34 tools) con navegador en vivo
  y screenshots visibles para la IA.
- Smoke tests end-to-end automatizados por secciones.

**Fuera de alcance (por ahora)**
- SaaS en la nube, colaboración multi-usuario en tiempo real, marketplace de tests.
- Ejecución distribuida; runners remotos.
- Navegadores Firefox/WebKit y viewports móviles — solo Chromium.
- App móvil nativa o versión web del editor.

## Métricas de éxito

- **Tiempo hasta el primer test válido**: un QA construye un test de login en menos de
  15 minutos sin escribir código.
- **Tasa de acierto a la primera**: % de pasos que validan al primer intento.
- **Adopción open source**: estrellas, issues de la comunidad, contribuciones externas.
- **Uso del MCP**: tests creados/ejecutados por agentes de IA en flujos reales.
- **Mantenimiento**: tiempo medio para arreglar un test roto tras un cambio de UI.

## Riesgos y supuestos

- **Riesgo técnico**: controlar Chromium requiere un sidecar Node (JSON-RPC por stdio con
  watchdog) estable; si falla, el flujo interactivo muere. Mitigación: protocolo con
  watchdog por petición y reinicio limpio del browser sin reiniciar la app.
- **Riesgo de selectores**: ningún selector es eterno; por eso la captura usa varias
  estrategias y el paso fallido se re-graba en un clic.
- **Supuestos**:
  - [supuesto: licencia] el proyecto se distribuye como open source con licencia permisiva
    (MIT/Apache-2.0, a confirmar en el repo).
  - [supuesto: browser] el Chromium visible se abre en su propia ventana (más fiel y
    simple); en headless se usa la preview interactiva de la app.
  - [supuesto: sidecar] Playwright corre en un sidecar Node orquestado por Rust (Tauri).
  - [supuesto: idioma] interfaz en español por defecto; inglés en roadmap.
  - [supuesto: privacidad] 100 % local, sin telemetría ni servicios externos.
  - [supuesto: ejecución] un browser activo por editor y runner secuencial.
