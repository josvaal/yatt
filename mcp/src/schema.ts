/**
 * Documentación del formato de test de YATT (esquema v1). Es el manual de
 * autoría que la IA consulta para crear/editar tests correctos.
 */
export const SCHEMA_DOC = `# Formato de test de YATT (schemaVersion 1)

Un test es un archivo JSON (o objeto) con este contrato:

{
  "schemaVersion": 1,
  "name": "mi-test",            // nombre corto, sin "/", "\\" ni ".."
  "url": "https://ejemplo.com", // URL inicial opcional
  "headless": false,
  "steps": [ ... ],             // lista de pasos (ver abajo)
  "variables": [ ... ],         // opcional
  "envs": ["dev", "prod"],      // opcional: entornos de variables
  "dataset": { "columns": ["col"], "rows": [{ "col": "v" }] } // opcional
}

## Pasos (steps)

Cada paso:

{ "id": "uuid opcional (se genera solo)", "action": "<acción>", "selector": "...", "value": "...", "label": "...", "disabled": false }

Acciones de hoja (más usadas):
- goto             ir a una URL            → value = url
- click            clic en un elemento     → selector
- dblclick         doble clic
- hover            pasar el mouse
- type             escribir texto          → selector + value
- clear            limpiar un campo        → selector
- upload           subir archivo           → selector + value (ruta)
- select_option    elegir opción           → selector + value
- check            marcar checkbox/radio   → selector
- press_key        presionar tecla         → value (p. ej. "Enter", "Tab")
- wait_visible     esperar elemento visible → selector
- scroll_to_element  scrollear hasta el elemento → selector
- wait             esperar segundos        → value (número)
- screenshot       capturar pantalla       → selector opcional
- assert_visible   verificar que existe    → selector
- assert_hidden    verificar que no existe → selector
- assert_text      verificar texto         → selector + value (texto esperado)
- assert_value     verificar valor         → selector + value
- assert_attribute verificar atributo      → selector + attribute (nombre) + value (esperado)
- db_assert        verificar contra la base de datos de la app → sql (+ expect: "rows"|"empty"|"value" + value)
- db_wait          esperar un dato en la base de la app        → sql (+ value opcional, timeout, interval)

Acciones de estructura (contenedores con children):
- if        condición: existe el selector (o value con variable) → children (sí) + elseChildren (no)
- repeat    repetir N veces               → times (número) + children
- for_each  recorrer lista                → list ("a,b,c" o "{{variable}}") + itemVar (nombre de variable) + children
- run_flow  ejecutar sub-flujo            → flow (nombre de otro test guardado) + withVars opcional (mapeo)
- open_tab  abrir pestaña                 → value (url)
- switch_tab cambiar de pestaña           → value (índice, 0-based)
- close_tab cerrar pestaña                → value opcional (índice; sin value cierra la activa)
- capture_screenshot  guardar imagen de referencia → value (nombre base) + fullPage opcional
- assert_screenshot   comparar con la imagen base → baseline (nombre) + tolerance (0-100) + fullPage opcional

Reglas:
- Los pasos se ejecutan en orden. Un paso con "disabled": true se salta.
- "label" es una descripción visible (opcional, la genera la app).
- Selectores: data-testid, id o CSS corto; prioridad data-testid → id → CSS único.
- Los sub-flujos (run_flow) deben existir como tests guardados; el runner los
  busca en tests/ y detecta ciclos.

## Variables y entornos

{
  "variables": [
    { "name": "usuario", "type": "text", "values": { "default": "demo", "dev": "demo", "prod": "admin" } }
  ],
  "envs": ["dev", "prod"]
}

- types: "text" | "number" | "option" | "file". Las variables "option" llevan "options": ["a","b"].
- Cualquier "value"/"selector"/"attribute" de un paso admite interpolación {{nombreDeVariable}}.
- Al correr se elige un entorno (default si no se especifica); los overrides por corrida ganan.

## Dataset (data-driven)

{
  "dataset": { "columns": ["usuario", "pass"], "rows": [ { "usuario": "a@x.com", "pass": "123" }, ... ] }
}
Las filas se usan como overrides de variables (una corrida por fila).

## Verificación contra la base de datos

Los pasos db_assert y db_wait consultan la base de datos de la app bajo prueba.
Definí la conexión con la variable de entorno YATT_APP_DB o el flag --app-db del
CLI (ruta de SQLite o URL "file:" / postgres://; la conexión es de solo lectura
y las respuestas se recortan a 200 filas, aunque totalRows cuenta todas).

{ "action": "db_assert", "sql": "SELECT status FROM orders WHERE id = {{orderId}}", "expect": "value", "value": "paid" }
{ "action": "db_wait", "sql": "SELECT status FROM jobs WHERE id = {{jobId}}", "value": "done", "timeout": 15, "interval": 0.5 }

- expect: "rows" (default; exige ≥1 fila) | "empty" (exige 0 filas) | "value" (compara la primera celda, stringificada y recortada, con value).
- db_wait repite la consulta hasta que cumpla (value coincide, o hay filas si no se pasa value) o venza el timeout en segundos (default 10; interval en segundos, default 0.5, mínimo 0.1).
- Guardia de solo lectura: se rechaza toda sentencia que no empiece con SELECT, WITH, EXPLAIN o PRAGMA.

## Guía rápida para la IA

1. Usa test_validate antes de guardar: devuelve errores o el resumen normalizado.
2. Prefiere acciones assert_* al final del test para verificar resultados.
3. Usa {{variable}} en lugar de valores fijos cuando el dato varie por entorno.
4. Tras crear/editar, corre con test_run y lee el reporte (report_get o yatt://reports/<nombre>) para diagnosticar fallos.
5. Para explorar una página usa browser_open + browser_preview (la IA ve el screenshot) + browser_eval para inspeccionar el DOM y elegir selectores robustos.
6. Un flujo que se repite (login, altas, aprobaciones) va como test guardado con variables y se reutiliza con run_flow + withVars; no lo repitas en vivo ciclo tras ciclo.
7. Sesiones: guarda el estado logueado con session_save y reábrelo con session en browser_open para cambiar de usuario sin re-loguear.
8. Múltiples usuarios o combinaciones de datos: variables + dataset (una corrida por fila) u overrides en test_run; no dupliques tests.
9. Espera por condición, no por plazo: wait_visible, un assert o db_wait (datos que escribe en background otro proceso) antes de seguir; wait fijo solo como último recurso.
10. La prueba fuerte de un flujo va con db_assert contra la base de datos; no salgas del navegador a consultar a mano.`;