# Requisitos — YATT

## Requisitos funcionales

### Editor y navegador

- **RF-01** (MVP) — El usuario puede crear un test desde cero y la app lanza una instancia controlada de Chromium (modo visible o headless) apuntando a una URL inicial.
- **RF-02** (MVP) — El usuario puede navegar manualmente dentro del Chromium visible; la navegación queda reflejada en el test como paso "ir a URL" al guardar.
- **RF-03** (MVP) — Al pasar el mouse sobre la página, la barra de herramientas flotante resalta los elementos interactivos y permite elegir una acción.
- **RF-04** (MVP) — Acciones disponibles: click, doble click, hover, scroll, escribir texto, limpiar campo, subir archivo/imagen, seleccionar opción en lista (`select`), marcar checkbox/radio, presionar tecla, esperar elemento visible, esperar un tiempo, verificar (assert) que un elemento esté visible/oculto/tenga un texto/valor/atributo, y capturar screenshot.
- **RF-05** (MVP) — Cada acción genera un paso con selector automático (prioridad: `data-testid` → role/texto accesible → CSS robusto autogenerado), visible y editable en el panel de pasos.
- **RF-06** (MVP) — El editor puede ejecutar un paso individualmente en el momento; si falla, muestra el error y permite re-grabar el selector, cambiar el valor o ajustar el paso sin salir del flujo.
- **RF-07** (MVP) — Los pasos son reordenables, duplicables, borrables y pausables/desactivables, y admiten una descripción opcional.

### Variables

- **RF-08** (MVP) — El usuario puede definir variables con tipos: texto, número, opción (lista de valores) e imagen/archivo (ruta o datos).
- **RF-09** (MVP) — Cualquier valor de un paso (texto a escribir, opción a seleccionar, archivo a subir, espera, selector) es interpolable con variables tipo `{{miVariable}}`.
- **RF-10** (MVP) — El usuario puede agrupar valores por entorno (dev/prod o nombres libres) y elegir el entorno al ejecutar.
- **RF-11** (MVP) — Durante una corrida, el usuario puede sobrescribir variables (valores por corrida, p. ej. el usuario con el que se loguea).

### Sets y almacenamiento

- **RF-12** (MVP) — El usuario puede crear sets de tests (carpeta) y tests (archivo `*.yatt.json`), abrirlos, guardarlos, renombrarlos, duplicarlos y borrarlos en el filesystem local.
- **RF-13** (MVP) — El formato de archivo es JSON con esquema versionado (`schemaVersion`) que incluye steps, variables, entornos y config del navegador; legible y "diffable" con Git.
- **RF-14** (MVP) — El editor detecta cambios externos en archivos abiertos (p. ej. tras un `git pull`) y permite recargar sin pisar lo editado.

### Runner y reportes

- **RF-15** (MVP) — El usuario puede correr un test individual o un set completo en modo headless, con timeout configurable por paso y global.
- **RF-16** (MVP) — El runner produce un reporte: por paso (pasado/fallado, duración, screenshot por paso), resumen del set y ruta de evidencia; exportable a HTML.
- **RF-17** (MVP) — En modo visible, la ejecución se puede pausar/reanudar y seguir paso a paso.

### Robustez (Alta)

- **RF-18** (Alta) — Condicionales (if/else sobre existencia de elemento o valor de variable) y bucles (repetir N veces, por cada valor de una lista o dataset).
- **RF-19** (Alta) — Data-driven: datasets desde CSV/JSON que iteran un test con distintas filas de datos.
- **RF-20** (Alta) — Assert visual: comparación de screenshots (página completa o región) con tolerancia configurable.
- **RF-21** (Alta) — Sub-flujos reutilizables (p. ej. login, crear usuario) con variables propias, insertables en otros tests.
- **RF-22** (Alta) — Soporte multi-pestaña y pop-ups (abrir, cambiar de pestaña, cerrar).
- **RF-23** (Alta) — Estado de sesión: guardar/cargar contexto de navegación (cookies/localStorage) para tests que requieren autenticación previa.

### Media y Baja

- **RF-24** (Media) — Exportar un test a código Playwright (spec TypeScript) generado a partir de los pasos.
- **RF-25** (Media) — Sugerencias de asserts: al seleccionar un elemento, YATT propone asserts comunes (visible, texto, valor).
- **RF-26** (Media) — Presets de viewport (desktop, tablet, móvil) y geolocalización/timezone simulados.
- **RF-27** (Baja) — Navegadores adicionales (Firefox, WebKit) vía Playwright.
- **RF-28** (Baja) — CLI headless (`yatt run test.yatt.json`) para CI.

## Requisitos no funcionales

- **RNF-01** (Alta) — Rendimiento: cada acción del editor responde en <300 ms; un paso individual se valida en <1 s (excluyendo tiempos de carga de la web bajo prueba).
- **RNF-02** (Alta) — App ligera: Tauri, consumo base ≤300 MB de RAM y bundle de instalación pequeño.
- **RNF-03** (Alta) — 100 % local y offline: sin telemetría, sin registros externos, sin dependencias de red para el flujo principal.
- **RNF-04** (Alta) — El JSON de tests es estable y compatible hacia atrás (migración de esquema automática al abrir versiones antiguas).
- **RNF-05** (Media) — Seguridad: las variables sensibles (contraseñas, tokens) se enmascaran en logs y reportes; los archivos se abren solo por rutas elegidas por el usuario.
- **RNF-06** (Media) — Interfaz en español por defecto, con estructura preparada para i18n (inglés en roadmap).
- **RNF-07** (Media) — Accesibilidad básica: navegación por teclado, foco visible, contraste AA en la UI de la app.
- **RNF-08** (Media) — El runner debe poder interrumpirse limpiamente (cancelar corrida, matar Chromium) sin dejar procesos huérfanos.

## Fuera de alcance

- SaaS/cloud, colaboración en tiempo real, marketplace de tests comunitarios.
- Ejecución distribuida y orquestación multi-máquina.
- Pruebas nativas en dispositivos móviles reales.
- Grabación de video continuo de corridas (solo screenshots por paso en la primera versión).

## Criterios de aceptación (minimales)

- Un QA construye un test de login + creación de pedido en menos de 15 minutos, sin escribir código, y lo corre headless con éxito.
- Todos los pasos del test se validan en el momento de crearse; cualquier fallo se corrige sin salir del editor.
- El test guardado es un JSON legible y versionable, y se puede abrir/ejecutar de nuevo desde otra máquina.
- Un test parametrizado con variables se ejecuta con dos juegos de datos distintos sin modificar los pasos.
- El runner headless produce un reporte con estado por paso y screenshot de evidencia por paso.