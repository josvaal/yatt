// Generado por YATT (RF-24). Requiere: npm i -D @playwright/test && npx playwright install chromium
import { test, expect, type Page } from "playwright/test";

// Variables del test con sus valores por defecto (entorno default de YATT).
const VARS: Record<string, string> = {
  "email": "elssy@codicore.com",
  "password": "lizbel123",
  "rol": "Usuario final"
};

// Interpola {{variable}} con los valores de VARS (o del ámbito recibido).
function t(value: string, vars?: Record<string, string>): string;
function t(value: string | undefined, vars?: Record<string, string>): string | undefined;
function t(value: string | undefined, vars: Record<string, string> = VARS): string | undefined {
  if (value === undefined) return undefined;
  return String(value).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : m,
  );
}

test("01-login-ciudadano (exportado de YATT)", async ({ page }) => {
  await page.goto("http://localhost:4200/login", { waitUntil: "domcontentloaded", timeout: 30000 });

  await page.locator("#username").waitFor({ state: "visible", timeout: 10000 });
  await page.locator("#username").fill(t("{{email}}", VARS), { timeout: 5000 });

  await page.locator("button[type=\"submit\"]").click({ timeout: 5000 });
  await page.locator("#password").waitFor({ state: "visible", timeout: 10000 });
  await page.locator("#password").fill(t("{{password}}", VARS), { timeout: 5000 });

  await page.locator("button[type=\"submit\"]").click({ timeout: 5000 });
  await page.locator("app-rol-select").waitFor({ state: "visible", timeout: 10000 });

  await page.locator(t("app-rol-select .role-item:has-text(\"{{rol}}\")", VARS)).click({ timeout: 5000 });

  await page.locator("#inbox-tab-procedures").waitFor({ state: "visible", timeout: 10000 });
  await page.goto("http://localhost:4200/tramite-documentario/user/fut", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator(":nth-match(.fut-catalog-card, 1)").waitFor({ state: "visible", timeout: 10000 });

  await expect(page.locator("a[href=\"/tramite-documentario/user/fut/mis-solicitudes\"]")).toBeVisible();

  await page.screenshot({ type: "png" });
});
