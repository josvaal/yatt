// Generado por YATT (RF-24). Requiere: npm i -D @playwright/test && npx playwright install chromium
import { test, expect, type Page } from "playwright/test";

// Variables del test con sus valores por defecto (entorno default de YATT).
const VARS: Record<string, string> = {};

// Interpola {{variable}} con los valores de VARS (o del ámbito recibido).
function t(value: string, vars?: Record<string, string>): string;
function t(value: string | undefined, vars?: Record<string, string>): string | undefined;
function t(value: string | undefined, vars: Record<string, string> = VARS): string | undefined {
  if (value === undefined) return undefined;
  return String(value).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : m,
  );
}

/** Sub-flujo "login-mesa-robusto" (embebido desde la biblioteca de YATT). */
async function flow_login_mesa_robusto(page: Page, vars: Record<string, string> = VARS): Promise<void> {

  await page.locator("#username").waitFor({ state: "visible", timeout: 10000 });

  await page.waitForTimeout(Math.max(0, Number("1") || 500));

  await page.locator("#username").fill("prueba@codicore.com", { timeout: 5000 });

  await page.locator("button[type=submit]").click({ timeout: 5000 });
  await page.waitForTimeout(Math.max(0, Number("2") || 500));
  {
    const cond = (await page.locator("#password").count()) > 0;
    if (cond) {

      await page.waitForTimeout(Math.max(0, Number("0.5") || 500));
    } else {

      await page.locator("#username").waitFor({ state: "visible", timeout: 10000 });
      await page.waitForTimeout(Math.max(0, Number("1") || 500));

      await page.locator("#username").fill("prueba@codicore.com", { timeout: 5000 });

      await page.locator("button[type=submit]").click({ timeout: 5000 });
      await page.locator("#password").waitFor({ state: "visible", timeout: 10000 });
    }
  }

  await page.locator("#password").fill("prueba123", { timeout: 5000 });

  await page.locator("button[type=submit]").click({ timeout: 5000 });
  await page.waitForTimeout(Math.max(0, Number("2") || 500));
  {
    const cond = (await page.locator("app-rol-select").count()) > 0;
    if (cond) {

      await page.locator("app-rol-select .role-item:has-text('Mesa de parte')").click({ timeout: 5000 });
    } else {

      await page.waitForTimeout(Math.max(0, Number("1") || 500));
    }
  }

  await page.locator("text=Panel de mesa de partes").waitFor({ state: "visible", timeout: 10000 });
}
test("audit-add-dossier-save (exportado de YATT)", async ({ page }) => {
  await page.goto("http://localhost:4200/tramite-documentario/mesa-parte/dossier", { waitUntil: "domcontentloaded", timeout: 30000 });


  await flow_login_mesa_robusto(page, VARS);

  await page.goto("http://localhost:4200/tramite-documentario/mesa-parte/dossier", { waitUntil: "domcontentloaded", timeout: 30000 });

  await page.locator("tbody tr:nth-of-type(2)").waitFor({ state: "visible", timeout: 10000 });

  await page.locator("tbody tr:nth-of-type(2)").dblclick({ timeout: 5000 });

  await page.locator("button:has-text('Nuevo trámite')").waitFor({ state: "visible", timeout: 10000 });

  await page.locator("button:has-text('Nuevo trámite')").click({ timeout: 5000 });

  await page.locator("input[placeholder='Buscar por nombre, documento o correo...']").waitFor({ state: "visible", timeout: 10000 });

  await page.locator("card.sender-item:nth-of-type(2) button.danger").click({ timeout: 5000 });

  await page.locator("button:has-text('Siguiente')").click({ timeout: 5000 });

  await page.locator(".tree-select-trigger").waitFor({ state: "visible", timeout: 10000 });

  await page.locator(".tree-select-trigger").click({ timeout: 5000 });

  await page.locator("text=CONSTANCIA").click({ timeout: 5000 });

  await page.locator("text=CONSTANCIA DE ESTUDIO").waitFor({ state: "visible", timeout: 10000 });

  await page.locator("text=CONSTANCIA DE ESTUDIO").click({ timeout: 5000 });

  await page.locator(".modal-body textarea").fill("E2E audit T19 - hoja server-side en add-procedure", { timeout: 5000 });

  await page.locator("button:has-text('Siguiente')").click({ timeout: 5000 });

  await page.locator(".modal-body input[type=file] >> nth=0").setInputFiles("/tmp/opencode/test-stamped.pdf", { timeout: 5000 });

  await page.waitForTimeout(Math.max(0, Number("2") || 500));

  await page.locator(".modal-body input[type=file] >> nth=1").setInputFiles("/tmp/opencode/test-stamped.pdf", { timeout: 5000 });

  await page.waitForTimeout(Math.max(0, Number("3") || 500));

  await page.locator(".folios-input").fill("1", { timeout: 5000 });

  await page.waitForTimeout(Math.max(0, Number("6") || 500));

  await page.locator("button:has-text('Siguiente')").click({ timeout: 5000 });

  await page.locator("input[placeholder='Buscar usuarios']").waitFor({ state: "visible", timeout: 10000 });

  await page.locator("input[placeholder='Buscar usuarios']").fill("elssy", { timeout: 5000 });

  await page.waitForTimeout(Math.max(0, Number("2") || 500));

  await page.locator("ngb-typeahead-window button:has-text('ELSSY')").click({ timeout: 5000 });

  await page.waitForTimeout(Math.max(0, Number("1") || 500));

  await page.waitForTimeout(Math.max(0, Number("2") || 500));

  await page.locator("button:has-text('Crear trámite')").click({ timeout: 5000 });

  await page.waitForTimeout(Math.max(0, Number("20") || 500));

  await expect(page.locator("text=Nuevo trámite en el expediente")).toBeHidden();

  await page.screenshot({ path: "baselines/audit-despues-add-dossier-save.png", fullPage: false });
});
