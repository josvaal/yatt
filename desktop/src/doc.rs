//! Document model: mirrors the TS contract in src/lib/yatt.ts + vars.ts
//! (serde-compatible with `tests/<name>.yatt.json` files).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

fn default_true() -> bool {
    true
}

fn default_schema() -> i64 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Step {
    pub id: String,
    pub action: String,
    pub selector: Option<String>,
    pub value: Option<String>,
    pub attribute: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub disabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<Step>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub else_children: Option<Vec<Step>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub times: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_var: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flow: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub with_vars: Option<BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tolerance: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub full_page: bool,
}

impl Step {
    pub fn new(action: &str) -> Self {
        Self {
            id: new_id(),
            action: action.to_string(),
            ..Default::default()
        }
    }

    /// Container actions carry nested children (if / repeat / for_each / run_flow
    /// except run_flow which only maps withVars).
    pub fn is_container(&self) -> bool {
        matches!(self.action.as_str(), "if" | "repeat" | "for_each")
    }

    /// SQL-backed steps hit the app database (sidecar-only actions).
    #[allow(dead_code)] // paleta y validaciones futuras del editor
    pub fn is_db(&self) -> bool {
        matches!(self.action.as_str(), "db_assert" | "db_wait")
    }

    #[allow(dead_code)] // edición anidada por path (editor)
    pub fn children_mut(&mut self) -> Option<&mut Vec<Step>> {
        self.children.as_mut()
    }

    pub fn children(&self) -> &[Step] {
        self.children.as_deref().unwrap_or(&[])
    }

    pub fn else_children(&self) -> &[Step] {
        self.else_children.as_deref().unwrap_or(&[])
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct YattVariable {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

impl YattVariable {
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            value: None,
        }
    }
}

impl Default for YattVariable {
    fn default() -> Self {
        Self::new("")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DatasetRow {
    pub cells: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Dataset {
    pub columns: Vec<String>,
    pub rows: Vec<DatasetRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TestFile {
    #[serde(default = "default_schema")]
    pub schema_version: i64,
    pub name: String,
    pub url: String,
    #[serde(default = "default_true")]
    pub headless: bool,
    #[serde(default)]
    pub steps: Vec<Step>,
    #[serde(default)]
    pub variables: Vec<YattVariable>,
    #[serde(default)]
    pub envs: Vec<String>,
    #[serde(default)]
    pub dataset: Option<Dataset>,
}

impl Default for TestFile {
    fn default() -> Self {
        default_test("test sin nombre")
    }
}

pub fn default_test(name: &str) -> TestFile {
    TestFile {
        schema_version: 1,
        name: name.to_string(),
        url: "https://example.com".to_string(),
        headless: true,
        steps: Vec::new(),
        variables: Vec::new(),
        envs: Vec::new(),
        dataset: None,
    }
}

/// Actions offered in the editor picker, in display order.
pub const ACTIONS: &[&str] = &[
    "click",
    "dblclick",
    "hover",
    "type",
    "clear",
    "upload",
    "select_option",
    "check",
    "press_key",
    "wait_visible",
    "scroll_to_element",
    "assert_visible",
    "assert_hidden",
    "assert_text",
    "assert_value",
    "assert_attribute",
    "goto",
    "wait",
    "screenshot",
    "if",
    "repeat",
    "for_each",
    "run_flow",
    "open_tab",
    "switch_tab",
    "close_tab",
    "capture_screenshot",
    "assert_screenshot",
    "db_assert",
    "db_wait",
];

pub fn action_label(action: &str) -> &'static str {
    match action {
        "click" => "Click",
        "dblclick" => "Doble click",
        "hover" => "Hover",
        "type" => "Escribir",
        "clear" => "Limpiar",
        "upload" => "Subir archivo",
        "select_option" => "Seleccionar opción",
        "check" => "Checkbox",
        "press_key" => "Tecla",
        "wait_visible" => "Esperar visible",
        "scroll_to_element" => "Scroll",
        "assert_visible" => "Verificar visible",
        "assert_hidden" => "Verificar oculto",
        "assert_text" => "Verificar texto",
        "assert_value" => "Verificar valor",
        "assert_attribute" => "Verificar atributo",
        "goto" => "Ir a URL",
        "wait" => "Esperar",
        "screenshot" => "Captura de pantalla",
        "if" => "Si (condición)",
        "repeat" => "Repetir",
        "for_each" => "Por cada",
        "run_flow" => "Sub-flujo",
        "open_tab" => "Abrir pestaña",
        "switch_tab" => "Cambiar pestaña",
        "close_tab" => "Cerrar pestaña",
        "capture_screenshot" => "Guardar imagen de referencia",
        "assert_screenshot" => "Verificar imagen",
        "db_assert" => "Verificar consulta",
        "db_wait" => "Esperar consulta",
        _ => "Desconocido",
    }
}

/// Human summary of a step, matching the old GUI style (`type "txt" → #sel`).
pub fn describe_step(step: &Step) -> String {
    let sel = step.selector.clone().unwrap_or_default();
    let val = step.value.clone().unwrap_or_default();
    match step.action.as_str() {
        "click" | "dblclick" | "hover" | "clear" | "check" | "wait_visible" | "scroll_to_element"
        | "assert_visible" | "assert_hidden" => {
            if sel.is_empty() {
                action_label(&step.action).to_string()
            } else {
                format!("{} → {}", action_label(&step.action), sel)
            }
        }
        "type" | "press_key" => format!("{} \"{}\" → {}", action_label(&step.action), val, sel),
        "upload" => format!("{} \"{}\"", action_label(&step.action), val),
        "select_option" => format!("{} \"{}\" → {}", action_label(&step.action), val, sel),
        "assert_text" | "assert_value" => {
            format!("{} \"{}\" → {}", action_label(&step.action), val, sel)
        }
        "assert_attribute" => format!(
            "{} {}=\"{}\" → {}",
            action_label(&step.action),
            step.attribute.clone().unwrap_or_default(),
            val,
            sel
        ),
        "goto" => format!("{} {}", action_label(&step.action), val),
        "wait" => format!("{} {} ms", action_label(&step.action), val),
        "screenshot" | "capture_screenshot" => action_label(&step.action).to_string(),
        "assert_screenshot" => format!(
            "{} {} (tol {}%)",
            action_label(&step.action),
            step.baseline.clone().unwrap_or_default(),
            step.tolerance.clone().unwrap_or_else(|| "0".into())
        ),
        "if" => format!("si {} ≈ \"{}\"", sel, val),
        "repeat" => format!("repetir {} veces", step.times.clone().unwrap_or_else(|| "2".into())),
        "for_each" => format!(
            "por cada {} en [{}]",
            step.item_var.clone().unwrap_or_else(|| "item".into()),
            step.list.clone().unwrap_or_default()
        ),
        "run_flow" => format!("sub-flujo {}", step.flow.clone().unwrap_or_default()),
        "open_tab" => format!("abrir pestaña {}", val),
        "switch_tab" => format!("cambiar a pestaña {}", val),
        "close_tab" => "cerrar pestaña".to_string(),
        "db_assert" | "db_wait" => format!(
            "{} {}",
            action_label(&step.action),
            step.value.clone().unwrap_or_default()
        ),
        _ => action_label(&step.action).to_string(),
    }
}

static mut ID_SEQ: u64 = 0;

/// Unique-enough step id for one machine, one user (same assumption as the old GUI).
pub fn new_id() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let seq = unsafe {
        ID_SEQ += 1;
        ID_SEQ
    };
    format!("s{}{}", ms, seq)
}

/// `{{var}}` interpolation; unknown or empty names stay literal (same rule as vars.ts).
pub fn interpolate(input: &str, vars: &BTreeMap<String, String>) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let (Some(start), Some(open_end)) = (rest.find("{{"), rest.find("{{").map(|p| p + 2)) {
        out.push_str(&rest[..start]);
        let tail = &rest[open_end..];
        match tail.find("}}") {
            Some(close) => {
                let name = tail[..close].trim();
                if let Some(v) = vars.get(name) {
                    out.push_str(v);
                } else {
                    // Keep the original placeholder when the var is not defined.
                    out.push_str(&rest[start..open_end + close + 2]);
                }
                rest = &tail[close + 2..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// Recursively interpolate the editable string fields of a step tree.
pub fn resolve_step(step: &Step, vars: &BTreeMap<String, String>) -> Step {
    let mut s = step.clone();
    s.selector = s.selector.map(|v| interpolate(&v, vars));
    s.value = s.value.map(|v| interpolate(&v, vars));
    s.attribute = s.attribute.map(|v| interpolate(&v, vars));
    s.list = s.list.map(|v| interpolate(&v, vars));
    if let Some(children) = &mut s.children {
        *children = children.iter().map(|c| resolve_step(c, vars)).collect();
    }
    if let Some(else_children) = &mut s.else_children {
        *else_children = else_children.iter().map(|c| resolve_step(c, vars)).collect();
    }
    s
}

/// CSV parser for dataset import (same rules as old vars.ts parseCsv):
/// quoted fields may contain commas and ""-escaped quotes; short rows
/// fill missing cells as empty strings; blank lines are skipped.
pub fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut row = Vec::new();
        let mut field = String::new();
        let mut in_quotes = false;
        let mut chars = line.chars().peekable();
        while let Some(c) = chars.next() {
            if in_quotes {
                if c == '"' {
                    if chars.peek() == Some(&'"') {
                        field.push('"');
                        chars.next();
                    } else {
                        in_quotes = false;
                    }
                } else {
                    field.push(c);
                }
            } else {
                match c {
                    '"' if field.is_empty() => in_quotes = true,
                    ',' => {
                        row.push(std::mem::take(&mut field));
                    }
                    _ => field.push(c),
                }
            }
        }
        row.push(field);
        rows.push(row);
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpolate_replaces_known_and_keeps_unknown() {
        let mut vars = BTreeMap::new();
        vars.insert("usuario".to_string(), "ana".to_string());
        assert_eq!(interpolate("hola {{usuario}}", &vars), "hola ana");
        assert_eq!(interpolate("{{nadie}}", &vars), "{{nadie}}");
        assert_eq!(interpolate("{{ roto ", &vars), "{{ roto ");
    }

    #[test]
    fn resolve_step_interpolates_children() {
        let mut vars = BTreeMap::new();
        vars.insert("t".to_string(), "h1".to_string());
        let mut inner = Step::new("click");
        inner.selector = Some("{{t}}".into());
        let mut outer = Step::new("repeat");
        outer.times = Some("2".into());
        outer.children = Some(vec![inner]);
        let resolved = resolve_step(&outer, &vars);
        assert_eq!(resolved.children()[0].selector.as_deref(), Some("h1"));
    }

    #[test]
    fn parse_csv_handles_quotes_and_short_rows() {
        let rows = parse_csv("usuario, clave\n\"ana, jr\",\"dijo \"\"hola\"\"\"\nsolo");
        assert_eq!(rows[0], vec!["usuario", " clave"]);
        assert_eq!(rows[1], vec!["ana, jr", "dijo \"hola\""]);
        assert_eq!(rows[2], vec!["solo"]);
        assert!(parse_csv("\n  \n").is_empty());
    }
}
