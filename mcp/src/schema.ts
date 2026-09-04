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

## Guía rápida para la IA

1. Usa test_validate antes de guardar: devuelve errores o el resumen normalizado.
2. Prefiere acciones assert_* al final del test para verificar resultados.
3. Usa {{variable}} en lugar de valores fijos cuando el dato varie por entorno.
4. Tras crear/editar, corre con test_run y lee el reporte (report_get o yatt://reports/<nombre>) para diagnosticar fallos.
5. Para explorar una página usa browser_open + browser_preview (la IA ve el screenshot) + browser_eval para inspeccionar el DOM y elegir selectores robustos.`;