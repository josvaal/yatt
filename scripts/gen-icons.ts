/**
 * Genera sidecar/src/icons.ts con los iconos de lucide (SVG inline, 16px) que
 * usa la barra flotante inyectada en la página. Es un script de build, se ejecuta
 * desde la raíz del proyecto (donde viven react y lucide-react):
 *
 *   bun run scripts/gen-icons.ts
 */

import { writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Lucide from "lucide-react";

const NAMES = [
  "mouse-pointer-click",
  "mouse-pointer-2",
  "type",
  "eraser",
  "chevrons-up-down",
  "square-check",
  "keyboard",
  "eye",
  "scroll-text",
  "badge-check",
  "eye-off",
  "text",
  "circle-check",
  "list-checks",
  "camera",
  "upload",
  "x",
  "grip-vertical",
  "shield-check",
];

function pascal(name: string): string {
  return name
    .split("-")
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
}

const map: Record<string, string> = {};
for (const name of NAMES) {
  const Icon = (Lucide as Record<string, unknown>)[pascal(name)];
  if (typeof Icon !== "function" && typeof Icon !== "object") {
    throw new Error("Icono lucide no encontrado: " + name + " (" + pascal(name) + ")");
  }
  map[name] = renderToStaticMarkup(
    createElement(Icon as never, {
      width: 16,
      height: 16,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      xmlns: "http://www.w3.org/2000/svg",
      "aria-hidden": true,
    }),
  );
}

const out = `// GENERADO por scripts/gen-icons.ts (lucide-react) — no editar a mano.\n
export const ICONS: Record<string, string> = ${JSON.stringify(map, null, 2)};\n`;
writeFileSync(new URL("../sidecar/src/icons.ts", import.meta.url), out);
console.log("Iconos generados:", Object.keys(map).length, "->", new URL("../sidecar/src/icons.ts", import.meta.url).pathname);