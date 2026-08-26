# YATT — Yet Another Testing Tool

> **Resumen ejecutivo**: aplicación de escritorio para que QAs y desarrolladores creen y ejecuten tests de interfaz web señalando las acciones directamente sobre un navegador Chromium real — sin escribir código, con validación paso a paso al instante y tests guardados como archivos JSON.

## Problema

Escribir tests de UI con las herramientas modernas (Playwright, Cypress) es lento por tres motivos que se encadenan:

1. **Escribir el test es escribir código**: selectores, esperas, asserts. Elegir el selector correcto, esperar al elemento adecuado y acertar el assert a la primera es raro — hay que conocer el DOM, los atributos y los tiempos de carga de la aplicación bajo prueba.
2. **El test no sale bien a la primera**: el bucle habitual es correr → falla → debuggear → corregir → volver a correr. Cada vuelta del feedback loop cuesta minutos, y el error suele ser un selector frágil o una espera mal puesta.
3. **Mantener los tests es trabajo manual**: cuando la web cambia, hay que localizar el paso roto en el código y reescribirlo.

El resultado: el testing de UI se percibe como una tarea pesada, costosa y fácil de abandonar, cuando debería ser una validación rápida y continua.

## Solución

YATT reemplaza la escritura de código por **autoría visual interactiva**:

- Apuntas y haces clic sobre la página real en Chromium; el tool captura el selector robusto automáticamente y crea el paso por ti.
- Cada paso se ejecuta **al instante** en el momento de crearlo: si no funciona, lo corriges ahí mismo (re-grabar el selector, cambiar el valor, ajustar la espera). El test queda bien construido a la primera.
- Las **variables** (texto, número, imagen, opciones) parametrizan cualquier paso: un solo test se ejecuta con distintos datos, por entorno (dev/prod) o por corrida.
- Los tests y sets de tests se guardan como **JSON** — el formato más universal: portable, versionable con Git, legible y editable por cualquier otra herramienta.
- Se ejecuta **100 % local**: modo visible para depurar, modo headless para correr el set completo con reporte de evidencia.

**Propuesta de valor**: pasar de "escribir y depurar tests" a "señalar y validar tests" — el tiempo de creación de un test se mide en minutos, no en horas, y el test funciona desde el primer guardado.

## Usuarios objetivo

- **Ingenieros QA**: crean y mantienen los tests del producto. Hoy escriben Playwright a mano y pierden tiempo en selectores y feedback loops. YATT elimina la fricción del código y les da un reporte claro de cada corrida.
- **Desarrolladores**: validan flujos rápidamente sin montar ni mantener infraestructura de tests. Abren la app, señalan el flujo, lo ejecutan y dejan el test guardado como JSON en el repo.
- **Contexto de uso**: equipos que quieren testing **local y controlado**, con el motor Playwright que ya conocen, sin depender de una plataforma en la nube ni de un servicio externo.

## Plataforma

**Aplicación de escritorio** (Tauri), porque:

- Lanza y controla un navegador real (Chromium visible o headless) sin las restricciones de un navegador anfitrión.
- Acceso directo al filesystem para guardar y abrir los tests JSON donde el equipo quiera, incluso dentro del repo de la aplicación bajo prueba.
- Feedback inmediato y cero latencia de red: el editor y el runner viven en la misma máquina.

## Diferenciación

| Herramienta | Enfoque | Punto débil frente a YATT |
|---|---|---|
| Playwright / Cypress | Código primero | Hay que escribir y depurar código; feedback loop lento |
| Selenium IDE | Grabador visual | Selectores frágiles, sin sistema de variables moderno, sin ejecución paso a paso confiable |
| Testim / Mabl / SaaS | Visual en la nube | Costosos, suben la web y los tests a la nube; no funcionan 100 % local |

YATT es la combinación que falta en el mercado: **autoría visual interactiva + motor Playwright + JSON local**, con validación paso a paso que garantiza que el test funciona antes de guardarlo y se puede versionar con Git.

## Alcance

**MVP**
- Lanzar Chromium controlado desde la app (modo visible y headless).
- Barra de herramientas interactiva: click, doble click, escribir, subir archivo/imagen, seleccionar opción, checkbox/radio, esperar elemento o tiempo, verificar (assert), scroll, hover, teclas, navegar.
- Captura automática de selectores robustos (con fallback y edición manual).
- Ejecución paso a paso: cada paso se valida en el momento de crearse.
- Sistema de variables: texto, número, opción, imagen/archivo; interpolación en cualquier paso; valores por entorno o por corrida.
- Sets de tests: crear, abrir, guardar, renombrar, duplicar, eliminar (archivos JSON en el filesystem).
- Runner local: correr un test o un set completo en headless con reporte (pasado/fallado, screenshots de fallo, logs, tiempos).
- Formato JSON v1 del test (esquema versionado).

**Fuera de alcance (por ahora)**
- SaaS en la nube, colaboración multi-usuario en tiempo real, marketplace de tests.
- Ejecución distribuida / CI desde línea de comandos (llegará en fases posteriores).
- Navegadores Firefox/WebKit y viewports móviles — solo Chromium en la primera versión.
- App móvil nativa o versión web del editor.

## Métricas de éxito

- **Tiempo hasta el primer test válido**: un QA construye un test de login en menos de 15 minutos sin escribir código.
- **Tasa de acierto a la primera**: % de pasos que validan al primer intento durante la creación.
- **Uso**: pruebas ejecutadas por día/semana con la herramienta en el equipo.
- **Mantenimiento**: tiempo medio para arreglar un test roto tras un cambio de UI.

## Riesgos y supuestos

- **Riesgo técnico**: controlar Chromium desde Tauri requiere un proceso sidecar (Node) y comunicación estable; si falla, el flujo interactivo muere. Mitigación: capa de comunicación aislada y reinicio limpio del browser sin reiniciar la app.
- **Riesgo de selectores**: ningún selector es eterno; por eso la captura es automática con varias estrategias y el paso fallido se puede re-grabar en un clic.
- **Supuestos**:
  - [supuesto: nombre] "YATT — Yet Another Testing Tool" es el nombre del producto (ya es el nombre del repo).
  - [supuesto: browser] el Chromium visible se abre en su propia ventana, no embebido en la interfaz (más fiel y simple; en headless se muestra una preview por pasos).
  - [supuesto: sidecar] Playwright corre en un sidecar Node orquestado por Rust (el equipo ya usa el ecosistema Node de Playwright).
  - [supuesto: idioma] interfaz en español por defecto; inglés en roadmap.
  - [supuesto: privacidad] 100 % local, sin telemetría ni servicios externos.
  - [supuesto: ejecución] un browser activo por editor y runner secuencial en la primera versión.