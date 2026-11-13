//! Playwright/Jest export (RF-24): port of src/lib/export.ts.

use crate::doc::{Step, TestFile};
use crate::store::Store;
use std::collections::{BTreeMap, HashSet};

fn js(s: &str) -> String {
    format!("{s:?}")
}

fn flow_fn(name: &str) -> String {
    let mut out = String::new();
    let mut last_underscore = true;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_underscore = false;
        } else if !last_underscore {
            out.push('_');
            last_underscore = true;
        }
    }
    let trimmed = out.trim_matches('_');
    if trimmed.is_empty() {
        "flow_".to_string()
    } else {
        format!("flow_{trimmed}")
    }
}

fn shot_name(step: &Step) -> String {
    let raw = step.baseline.clone().or_else(|| step.value.clone()).unwrap_or_default();
    let cleaned: String = raw
        .trim()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || "._-".contains(c) { c } else { '-' })
        .collect();
    if cleaned.is_empty() {
        "captura".to_string()
    } else {
        cleaned
    }
}

fn has_template(raw: &str) -> bool {
    let Some(start) = raw.find("{{") else { return false };
    let tail = &raw[start + 2..];
    match tail.find("}}") {
        Some(end) => !tail[..end].trim().is_empty(),
        None => false,
    }
}

/// String literal or `t(lit, vars)` when the value carries a {{template}}.
fn val_expr(raw: &Option<String>, vars_expr: &str) -> String {
    match raw {
        None => "undefined".to_string(),
        Some(v) => {
            let lit = js(v);
            if has_template(v) {
                format!("t({lit}, {vars_expr})")
            } else {
                lit
            }
        }
    }
}

fn val_expr_or(raw: &Option<String>, fallback: &str, vars_expr: &str) -> String {
    match raw {
        None => js(fallback),
        Some(_) => val_expr(raw, vars_expr),
    }
}

struct Writer {
    out: Vec<String>,
    depth: usize,
}

impl Writer {
    fn push(&mut self, line: &str) {
        if line.is_empty() {
            self.out.push(String::new());
        } else {
            self.out.push(format!("{}{}", "  ".repeat(self.depth), line));
        }
    }
    fn text(&self) -> String {
        self.out.join("\n")
    }
}

struct GenCtx<'a> {
    vars_expr: &'a str,
    page: &'a str,
    url: &'a str,
}

fn emit_step(w: &mut Writer, s: &Step, ctx: &GenCtx) -> Result<(), String> {
    let p = ctx.page;
    if let Some(label) = &s.label {
        if !label.is_empty() {
            w.push(&format!("// {label}"));
        }
    }
    match s.action.as_str() {
        "click" | "dblclick" | "hover" => {
            let method = match s.action.as_str() {
                "click" => "click",
                "dblclick" => "dblclick",
                _ => "hover",
            };
            w.push(&format!(
                "await {p}.locator({}).{method}({{ timeout: 5000 }});",
                val_expr_or(&s.selector, "", ctx.vars_expr)
            ));
        }
        "type" => w.push(&format!(
            "await {p}.locator({}).fill({}, {{ timeout: 5000 }});",
            val_expr_or(&s.selector, "", ctx.vars_expr),
            val_expr(&s.value, ctx.vars_expr)
        )),
        "clear" => w.push(&format!(
            "await {p}.locator({}).clear({{ timeout: 5000 }});",
            val_expr_or(&s.selector, "", ctx.vars_expr)
        )),
        "upload" => w.push(&format!(
            "await {p}.locator({}).setInputFiles(tOr({}, \"\"), {{ timeout: 5000 }});",
            val_expr_or(&s.selector, "", ctx.vars_expr),
            val_expr(&s.value, ctx.vars_expr)
        )),
        "select_option" => w.push(&format!(
            "await {p}.locator({}).selectOption({});",
            val_expr_or(&s.selector, "", ctx.vars_expr),
            val_expr(&s.value, ctx.vars_expr)
        )),
        "check" => w.push(&format!(
            "await {p}.locator({}).check({{ timeout: 5000 }});",
            val_expr_or(&s.selector, "", ctx.vars_expr)
        )),
        "press_key" => {
            let key = match &s.value {
                None => "\"Enter\"".to_string(),
                Some(_) => val_expr(&s.value, ctx.vars_expr),
            };
            if s.selector.is_some() {
                w.push(&format!(
                    "await {p}.locator({}).press({key}, {{ timeout: 5000 }});",
                    val_expr_or(&s.selector, "", ctx.vars_expr)
                ));
            } else {
                w.push(&format!("await {p}.keyboard.press({key});"));
            }
        }
        "wait_visible" => w.push(&format!(
            "await {p}.locator({}).waitFor({{ state: \"visible\", timeout: 10000 }});",
            val_expr_or(&s.selector, "", ctx.vars_expr)
        )),
        "scroll_to_element" => w.push(&format!(
            "await {p}.locator({}).scrollIntoViewIfNeeded();",
            val_expr_or(&s.selector, "", ctx.vars_expr)
        )),
        "assert_visible" => w.push(&format!(
            "await expect({p}.locator({})).toBeVisible();",
            val_expr_or(&s.selector, "", ctx.vars_expr)
        )),
        "assert_hidden" => w.push(&format!(
            "await expect({p}.locator({})).toBeHidden();",
            val_expr_or(&s.selector, "", ctx.vars_expr)
        )),
        "assert_text" => w.push(&format!(
            "await expect({p}.locator({})).toContainText({});",
            val_expr_or(&s.selector, "", ctx.vars_expr),
            val_expr(&s.value, ctx.vars_expr)
        )),
        "assert_value" => w.push(&format!(
            "await expect({p}.locator({})).toHaveValue({});",
            val_expr_or(&s.selector, "", ctx.vars_expr),
            val_expr(&s.value, ctx.vars_expr)
        )),
        "assert_attribute" => w.push(&format!(
            "await expect({p}.locator({})).toHaveAttribute({}, {});",
            val_expr_or(&s.selector, "", ctx.vars_expr),
            val_expr_or(&s.attribute, "", ctx.vars_expr),
            val_expr(&s.value, ctx.vars_expr)
        )),
        "goto" => w.push(&format!(
            "await {p}.goto(tOr({}, {}), {{ waitUntil: \"domcontentloaded\", timeout: 30000 }});",
            val_expr(&s.value, ctx.vars_expr),
            js(ctx.url)
        )),
        "wait" => w.push(&format!(
            "await {p}.waitForTimeout(Math.max(0, Number(tOr({}, \"500\")) || 500));",
            val_expr(&s.value, ctx.vars_expr)
        )),
        "screenshot" => w.push(&format!("await {p}.screenshot({{ type: \"png\" }});")),
        "capture_screenshot" => w.push(&format!(
            "await {p}.screenshot({{ path: \"baselines/{}.png\", fullPage: {} }});",
            shot_name(s),
            s.full_page
        )),
        "assert_screenshot" => {
            let shot = shot_name(s);
            let tol = format!(
                "Math.max(0, Number(tOr({}, \"0\")) || 0) / 100",
                val_expr_or(&s.tolerance, "0", ctx.vars_expr)
            );
            if s.full_page {
                w.push(&format!(
                    "await expect({p}).toHaveScreenshot(\"{shot}.png\", {{ maxDiffPixelRatio: {tol}, fullPage: true }});"
                ));
            } else {
                w.push(&format!(
                    "await expect({p}).toHaveScreenshot(\"{shot}.png\", {{ maxDiffPixelRatio: {tol} }});"
                ));
            }
        }
        "if" => {
            w.push("{");
            w.indent();
            if s.selector.is_some() {
                w.push(&format!(
                    "const cond = (await {p}.locator({}).count()) > 0;",
                    val_expr_or(&s.selector, "", ctx.vars_expr)
                ));
            } else {
                let v = val_expr(&s.value, ctx.vars_expr);
                w.push(&format!(
                    "const cond = !!tOr({v}, \"\") && tOr({v}, \"\") !== \"false\" && tOr({v}, \"\") !== \"0\";"
                ));
            }
            w.push("if (cond) {");
            w.indent();
            emit_steps(w, s.children(), ctx)?;
            w.dedent();
            if s.else_children.is_some() {
                w.push("} else {");
                w.indent();
                emit_steps(w, s.else_children(), ctx)?;
                w.dedent();
            }
            w.dedent();
            w.push("}");
        }
        "repeat" => {
            let times = val_expr(&s.times, ctx.vars_expr);
            w.push("{");
            w.indent();
            w.push(&format!(
                "const times = Math.max(0, Math.floor(Number(tOr({times}, \"0\")) || 0));"
            ));
            w.push("for (let i = 0; i < times; i++) {");
            w.indent();
            emit_steps(w, s.children(), ctx)?;
            w.dedent();
            w.dedent();
            w.push("}");
        }
        "for_each" => {
            let item = s.item_var.clone().unwrap_or_else(|| "item".into());
            let list = val_expr_or(&s.list, "", ctx.vars_expr);
            w.push("{");
            w.indent();
            w.push(&format!(
                "const items = tOr({list}, \"\").split(\",\").map(x => x.trim()).filter(Boolean);"
            ));
            w.push("for (const item of items) {");
            w.indent();
            w.push(&format!(
                "const vars = {{ ...{} , {}: item }};",
                ctx.vars_expr,
                js(&item)
            ));
            let inner = GenCtx {
                vars_expr: "vars",
                page: ctx.page,
                url: ctx.url,
            };
            emit_steps(w, s.children(), &inner)?;
            w.dedent();
            w.dedent();
            w.push("}");
        }
        "run_flow" => {
            let flow = s.flow.clone().unwrap_or_default();
            let f = flow_fn(&flow);
            let vars_ref = ctx.vars_expr;
            let map = s.with_vars.as_ref().filter(|m| !m.is_empty());
            match map {
                None => {
                    w.push(&format!("await {f}({p}, {vars_ref});"));
                }
                Some(m) => {
                    w.push("{");
                    w.indent();
                    w.push(&format!("const vars = {{ ...{vars_ref} }};"));
                    for (k, src) in m {
                        let src = src.trim();
                        let expr = if src.starts_with("{{") && src.ends_with("}}") {
                            let name = src.trim_start_matches("{{").trim_end_matches("}}").trim();
                            format!("{vars_ref}[{}]", js(name))
                        } else {
                            format!("t({}, vars)", js(src))
                        };
                        w.push(&format!("vars[{}] = {expr};", js(k)));
                    }
                    w.push(&format!("await {f}({p}, vars);"));
                    w.dedent();
                    w.push("}");
                }
            }
        }
        "open_tab" => {
            w.push(&format!("{p} = await {p}.context().newPage();"));
            if s.value.is_some() {
                w.push(&format!(
                    "await {p}.goto({}, {{ waitUntil: \"domcontentloaded\" }});",
                    val_expr(&s.value, ctx.vars_expr)
                ));
            }
        }
        "switch_tab" => w.push(&format!(
            "{p} = {p}.context().pages()[Number(tOr({}, \"0\"))];",
            val_expr(&s.value, ctx.vars_expr)
        )),
        "close_tab" => {
            let v = val_expr_or(&s.value, "", ctx.vars_expr);
            w.push("{");
            w.indent();
            w.push(&format!("const pages = {p}.context().pages();"));
            w.push(&format!(
                "const idx = {v} === \"\" ? pages.indexOf({p}) : Number({v});"
            ));
            w.push("const closing = pages[idx];");
            w.push(&format!(
                "if (closing === {p}) {p} = pages.filter(x => x !== closing)[pages.length - 2];"
            ));
            w.push("await closing.close();");
            w.dedent();
            w.push("}");
        }
        other => {
            return Err(format!("acción no soportada en el export: {other}"));
        }
    }
    Ok(())
}

fn emit_steps(w: &mut Writer, steps: &[Step], ctx: &GenCtx) -> Result<(), String> {
    for s in steps {
        emit_step(w, s, ctx)?;
    }
    Ok(())
}

fn uses_tabs(steps: &[Step]) -> bool {
    steps.iter().any(|s| {
        matches!(s.action.as_str(), "open_tab" | "switch_tab" | "close_tab")
            || uses_tabs(s.children())
            || uses_tabs(s.else_children())
    })
}

/// BFS of run_flow dependencies, detecting cycles.
fn collect_flows(
    store: &Store,
    root: &TestFile,
    flows: &mut BTreeMap<String, Vec<Step>>,
) -> Result<(), String> {
    let mut queue: Vec<(String, String)> = Vec::new();
    let mut loaded: HashSet<String> = HashSet::new();
    let mut pending: HashSet<String> = HashSet::new();
    for s in &root.steps {
        if s.action == "run_flow" {
            if let Some(f) = &s.flow {
                queue.push((root.name.clone(), f.clone()));
            }
        }
    }
    while let Some((from, flow)) = queue.pop() {
        if loaded.contains(&flow) || flow == root.name {
            continue;
        }
        if pending.contains(&flow) {
            return Err(format!("sub-flujo circular en el export: {from} → {flow}"));
        }
        pending.insert(flow.clone());
        let json = store
            .test_load(&flow)
            .map_err(|e| format!("no se pudo cargar el sub-flujo {flow}: {e}"))?;
        let doc: TestFile = serde_json::from_str(&json)
            .map_err(|e| format!("sub-flujo {flow} inválido: {e}"))?;
        for s in &doc.steps {
            if s.action == "run_flow" {
                if let Some(f) = &s.flow {
                    queue.push((flow.clone(), f.clone()));
                }
            }
        }
        loaded.insert(flow.clone());
        flows.insert(flow, doc.steps);
    }
    Ok(())
}

fn t_helpers() -> &'static str {
    "function t(value: string, vars: Record<string, string> = VARS): string {
  return value.replace(/\\{\\{\\s*([\\w.-]+)\\s*\\}\\}/g, (match: string, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match
  );
}

function tOr(value: string | undefined, fallback: string, vars: Record<string, string> = VARS): string {
  return value == null ? fallback : t(value, vars);
}"
}

/// Builds the full spec file. `format` is "playwright" or "jest".
pub fn build_spec(store: &Store, doc: &TestFile, format: &str) -> Result<String, String> {
    let mut flows = BTreeMap::new();
    collect_flows(store, doc, &mut flows)?;
    let has_tabs =
        uses_tabs(&doc.steps) || flows.values().any(|steps| uses_tabs(steps));
    let page_var = if has_tabs { "pg" } else { "page" };
    let title = format!("{} (exportado de YATT)", doc.name);

    let mut vars: BTreeMap<String, String> = BTreeMap::new();
    for v in &doc.variables {
        vars.insert(v.name.clone(), v.value.clone().unwrap_or_default());
    }
    let vars_json = serde_json::to_string_pretty(&vars).unwrap_or_else(|_| "{}".into());

    let mut w = Writer { out: Vec::new(), depth: 0 };
    if has_tabs {
        w.push(&format!("let {page_var}: Page = page;"));
        w.push(&format!(
            "await {page_var}.goto({}, {{ waitUntil: \"domcontentloaded\", timeout: 30000 }});",
            js(&doc.url)
        ));
    }
    let ctx = GenCtx {
        vars_expr: "VARS",
        page: page_var,
        url: &doc.url,
    };
    emit_steps(&mut w, &doc.steps, &ctx)?;
    let body_lines = w.text();

    let mut flow_code = String::new();
    for (name, steps) in &flows {
        let mut fw = Writer { out: Vec::new(), depth: 0 };
        let fctx = GenCtx {
            vars_expr: "vars",
            page: page_var,
            url: &doc.url,
        };
        emit_steps(&mut fw, steps, &fctx)?;
        let f = flow_fn(name);
        flow_code.push_str(&format!(
            "/** Sub-flujo \"{}\" (embebido desde la biblioteca de YATT). */\nasync function {f}({}: Page, vars: Record<string, string> = VARS): Promise<void> {{\n{}}}\n\n",
            name,
            page_var,
            fw.text()
        ));
    }

    if format == "jest" {
        Ok(format!(
            "// Generado por YATT (RF-24). Requiere: npm i -D playwright jest\nimport {{ describe, expect, it }} from \"@jest/globals\";\nimport type {{ Page }} from \"playwright\";\n\ndeclare const page: Page;\n\nconst VARS: Record<string, string> = {vars_json};\n\n{}\n\n{flow_code}describe({}, () => {{\n  it(\"corrida completa\", async () => {{\n{}\n  }});\n}});\n",
            t_helpers(),
            js(&title),
            indent_block(&body_lines, 4)
        ))
    } else {
        Ok(format!(
            "// Generado por YATT (RF-24). Requiere: npm i -D @playwright/test && npx playwright install chromium\nimport {{ test, expect, type Page }} from \"@playwright/test\";\n\nconst VARS: Record<string, string> = {vars_json};\n\n{}\n\n{flow_code}test({}, async ({{ page }}) => {{\n{}\n}});\n",
            t_helpers(),
            js(&title),
            indent_block(&body_lines, 2)
        ))
    }
}

fn indent_block(body: &str, spaces: usize) -> String {
    let pad = " ".repeat(spaces);
    body.lines()
        .map(|l| if l.is_empty() { String::new() } else { format!("{pad}{l}") })
        .collect::<Vec<_>>()
        .join("\n")
}

trait WriterExt {
    fn indent(&mut self);
    fn dedent(&mut self);
}

impl WriterExt for Writer {
    fn indent(&mut self) {
        self.depth += 1;
    }
    fn dedent(&mut self) {
        self.depth -= 1;
    }
}
