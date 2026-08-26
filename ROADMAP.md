# Roadmap — YATT

## Fase 0 — Validación

- **Objetivo**: confirmar el enfoque con usuarios reales y fijar el esquema JSON antes de construir sobre él.
- **Entregables**: PRODUCT.md y REQUIREMENTS.md validados con 2–3 QAs; prototipo navegable mínimo (lanzar Chromium + apuntar a un elemento + 1 click + 1 paso ejecutándose); borrador del esquema JSON v1.
- **Done cuando**: al menos 2 QAs construyen un micro-test (login) solos, sin ayuda, en menos de 15 minutos.

## Fase 1 — Núcleo del editor

- **Objetivo**: que el flujo interactivo completo funcione localmente: apuntar → paso → validar al instante → guardar JSON.
- **Entregables**: modo visible y headless (RF-01/02), toolbar con todas las acciones de la RF-04, captura automática de selectores con edición manual (RF-05), ejecución paso a paso con re-grabado (RF-06), sets/tests como JSON con `schemaVersion` (RF-12/13), UI del editor completa.
- **Done cuando**: un QA crea el test de login + pedido en <15 min sin código y lo guarda/abre desde archivo.

## Fase 2 — Variables y datos

- **Objetivo**: parametrizar tests y correrlos con distintos juegos de datos.
- **Entregables**: tipos de variable texto, número, opción e imagen/archivo (RF-08); interpolación en pasos (RF-09); entornos + sobrescritura por corrida (RF-10/11); data-driven con CSV/JSON (RF-19).
- **Done cuando**: un test único se ejecuta con 2 entornos y con un dataset de 10 filas sin tocar los pasos.

## Fase 3 — Runner completo y reportes

- **Objetivo**: convertir la herramienta en un runner confiable para el equipo.
- **Entregables**: runner headless de tests y sets con timeouts (RF-15), reporte JSON + HTML con screenshots de fallo y logs (RF-16), pausa/reanudar en visible (RF-17), cancelación limpia (RNF-08).
- **Done cuando**: un set completo corre headless en una sola pasada y el reporte HTML permite identificar el fallo exacto en menos de 1 minuto.

## Fase 4 — Robustez y mantenimiento

- **Objetivo**: que los tests sobrevivan a webapps reales y a cambios de UI.
- **Entregables**: condicionales y bucles (RF-18), sub-flujos reutilizables (RF-21), asserts visuales con tolerancia (RF-20), multi-pestaña/pop-ups (RF-22), sesión/estado (RF-23), export a código Playwright (RF-24), sugerencias de asserts (RF-25).
- **Done cuando**: un test del core de una webapp real (con auth, formularios y navegación) se mantiene en verde tras un rediseño de UI re-grabando solo 2 selectores.

## Fase 5 — Distribución y pulido

- **Objetivo**: uso cómodo y masivo en el equipo.
- **Entregables**: instaladores nativos, auto-updater, i18n EN (RNF-06), a11y completo (RNF-07), presets de viewport (RF-26), navegadores extra (RF-27), CLI headless para CI (RF-28).
- **Done cuando**: un QA nuevo se pone productivo en un día y el equipo corre YATT en su pipeline de CI.

## Hitos y dependencias

- **Esquema JSON v1** (Fase 0) — bloquea todo lo demás: el formato es el contrato entre editor, runner y archivos.
- **Sidecar Node funcional** (Fase 1) — desbloquea el editor interactivo; sin él no hay apuntar-y-crear-paso.
- **Captura de selectores y re-grabado** (Fase 1) — se apoya en la ejecución paso a paso y es la base de la propuesta de valor.
- **Variables + interpolación** (Fase 2) — requiere pasos guardables; desbloquea el data-driven.
- **Runner headless estable** (Fase 3) — desbloquea el reporte, el uso en CI (Fase 5) y la confianza del equipo.