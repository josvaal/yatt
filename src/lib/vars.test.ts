import { describe, expect, test } from "bun:test";

import { ENV_DEFAULT, interpolate, parseCsv, resolveStep, resolveVars, validVarName } from "./vars.ts";

describe("interpolate", () => {
  test("reemplaza variables conocidas", () => {
    expect(interpolate("hola {{nombre}}!", { nombre: "ana" })).toBe("hola ana!");
  });
  test("deja {{desconocida}} intacta", () => {
    expect(interpolate("{{nope}}", { otra: "x" })).toBe("{{nope}}");
  });
  test("undefined pasa tal cual", () => {
    expect(interpolate(undefined, {})).toBeUndefined();
  });
});

describe("resolveStep", () => {
  test("interpola value, selector, attribute y sql", () => {
    const out = resolveStep(
      { action: "db_assert", value: "{{v}}", selector: ".a", attribute: "{{att}}", sql: "SELECT * FROM t WHERE id = {{id}}" },
      { v: "1", att: "href", id: "7" },
    );
    expect(out.value).toBe("1");
    expect(out.selector).toBe(".a");
    expect(out.attribute).toBe("href");
    expect(out.sql).toBe("SELECT * FROM t WHERE id = 7");
  });
});

describe("resolveVars", () => {
  const vars = [
    { name: "base", type: "text" as const, values: { [ENV_DEFAULT]: "def", prod: "prod-val" } },
  ];
  test("override gana sobre entorno y default", () => {
    expect(resolveVars(vars, "prod", { base: "over" }).base).toBe("over");
  });
  test("entorno gana sobre default", () => {
    expect(resolveVars(vars, "prod", {}).base).toBe("prod-val");
  });
  test("override vacío cae al entorno (sin sobrescribir)", () => {
    expect(resolveVars(vars, "prod", { base: "" }).base).toBe("prod-val");
  });
  test("sin nada → vacío", () => {
    expect(resolveVars(vars, "noexiste", {}).base).toBe("def");
  });
});

describe("parseCsv", () => {
  test("comas dentro de comillas", () => {
    const d = parseCsv('user,pass\n"lopez, ana",s3cret');
    expect(d.columns).toEqual(["user", "pass"]);
    expect(d.rows[0]).toEqual({ user: "lopez, ana", pass: "s3cret" });
  });
  test("comillas escapadas y fila corta → vacío", () => {
    const d = parseCsv('a,b,c\n"di ""hola""",x');
    expect(d.rows[0]).toEqual({ a: 'di "hola"', b: "x", c: "" });
  });
});

describe("validVarName", () => {
  test("acepta letras, números, guion, punto y guion bajo", () => {
    expect(validVarName("user_name-2.x")).toBe(true);
  });
  test("rechaza vacío, espacios y nombres que empiezan con dígito", () => {
    expect(validVarName("")).toBe(false);
    expect(validVarName("mi var")).toBe(false);
    expect(validVarName("2var")).toBe(false);
  });
});
