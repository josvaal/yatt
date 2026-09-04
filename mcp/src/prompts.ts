import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Prompts: plantillas de trabajo que el cliente puede cargar. */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt("crear-test", {
    description: "Guía para crear un test YATT desde cero, correrlo y dejarlo verde",
  }, async () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Vas a crear un test YATT completo. Procedimiento:

1. Lee el recurso yatt://schema (o llama a la tool schema) para conocer el formato exacto y las acciones disponibles.
2. Si necesitás explorar la página bajo prueba: browser_open (url) → browser_preview (podés ver el screenshot) → browser_eval para inspeccionar el DOM y elegir selectores robustos (prioridad: data-testid → id → CSS corto único).
3. Construí el documento de test (schemaVersion 1, steps con acciones goto/click/type/assert_*…).
4. Validalo con test_validate; corregí los errores que devuelva.
5. Guardalo con test_create y corrido con test_run (headless, guarda reporte).
6. Si hay fallos, leé el reporte (report_get o yatt://reports/<slug>.json), mirá el screenshot del paso fallido con el navegador en vivo si hace falta, corregí con test_update y volvé a correr.
7. Terminá solo cuando el reporte dé ok sin fallos.

Reglas: selectores concretos y estables; variables {{nombre}} para datos que varíen por entorno; asserts al final para verificar resultados; nunca inventes URL ni datos que no vengan del usuario.`,
        },
      },
    ],
  }));

  server.registerPrompt("diagnosticar-reporte", {
    description: "Analiza un reporte de corrida, encuentra la causa de los fallos y propone correcciones",
  }, async () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Vas a diagnosticar un reporte de corrida de YATT. Procedimiento:

1. Pedí el nombre del reporte a diagnosticar, o listalos con report_list.
2. Leé el reporte con report_get (o el recurso yatt://reports/<nombre>). Cada paso fallido tiene status "fail", error y ms; los pasos también pueden estar "skipped" o "stopped".
3. Identificá la causa raíz del primer fallo: selector roto, espera insuficiente (agregá wait_visible antes), valor de variable incorrecto, URL caída, o flujo de página distinto.
4. Verificá la hipótesis con el navegador en vivo: browser_open → browser_preview → browser_eval (¿existe el selector? ¿el texto difiere?).
5. Proponé el cambio concreto del paso (selector o valor nuevo) y, si el usuario lo aprueba, aplicalo con test_update.

Formato de respuesta: causa raíz, evidencia (del reporte y del browser), y la corrección exacta propuesta.`,
        },
      },
    ],
  }));

  server.registerPrompt("explorar-pagina", {
    description: "Explora una página con el navegador en vivo (screenshots visibles) y produce un mapa de la UI",
  }, async () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Vas a explorar una página web con el navegador controlado de YATT. Procedimiento:

1. browser_open con la URL (headless por defecto).
2. browser_preview para ver la página; repetí browser_scroll (dy positivo hacia abajo) + browser_preview hasta cubrirla.
3. Usá browser_eval para extraer información útil: texto visible, enlaces (hrefs), inputs (nombres/ids/placeholders), botones, títulos de sección. Ejemplos de expresiones:
   - [...document.querySelectorAll("a")].map(a => [a.textContent.trim(), a.href])
   - [...document.querySelectorAll("input")].map(i => ({type: i.type, name: i.name, id: i.id, ph: i.placeholder}))
   - document.title + location.href
4. Si hay interacción (login, menús), ejecutá pasos con browser_run_step y verificá con browser_condition/browser_preview.
5. Entregá un mapa estructurado: secciones, elementos interactivos con selectores robustos recomendados, y flujos posibles de test.

Regla: no modifiques datos reales; si necesitás escribir en formularios, usá valores de prueba y deja constancia.`,
        },
      },
    ],
  }));

  server.registerPrompt("exportar-spec", {
    description: "Exporta un test YATT a código Playwright (spec TypeScript)",
  }, async () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Vas a exportar un test YATT a código Playwright. Procedimiento:

1. Pedí el nombre del test o listalos con test_list.
2. Llamá a test_export_playwright(name, write: true) para generarlo (también devuelve el contenido).
3. Revisá el spec generado: verifica que los require (npm i -D @playwright/test) estén documentados y que los sub-flujos estén embebidos.
4. Entregá el path del archivo exports/<nombre>.spec.ts y un resumen de qué cubre el spec.`,
        },
      },
    ],
  }));
}