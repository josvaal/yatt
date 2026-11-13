//! Run report model + self-contained HTML/JSON generation.
//! Port of src/lib/report.ts (same structure and Spanish labels).
use crate::doc::action_label;
use serde::Serialize;
use time::OffsetDateTime;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub index: usize,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selector: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribute: Option<String>,
    /// "ok" | "fail" | "skipped" | "stopped"
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// base64 PNG evidence (failures + screenshot steps).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshot: Option<String>,
    pub depth: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SetTestResult {
    pub name: String,
    pub ok: bool,
    pub ms: u64,
    pub fail: usize,
    pub stopped: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub steps: Vec<RunRecord>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunReport {
    /// "test" | "set"
    pub kind: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<String>,
    pub headless: bool,
    pub started_at: String,
    pub finished_at: String,
    pub duration_ms: u64,
    pub ok: usize,
    pub fail: usize,
    pub skipped: usize,
    pub stopped: bool,
    pub logs: Vec<String>,
    pub steps: Vec<RunRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tests: Option<Vec<SetTestResult>>,
}

pub fn local_now() -> OffsetDateTime {
    // shortcut: now_local() is indeterminate in multithreaded programs; reports fall back to UTC.
    OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc())
}

pub fn fmt_date(d: &OffsetDateTime) -> String {
    format!(
        "{:02}/{:02}/{:02} {:02}:{:02}:{:02}",
        d.day(),
        u8::from(d.month()),
        d.year().rem_euclid(100),
        d.hour(),
        d.minute(),
        d.second()
    )
}

/// Report file name: sanitized title + epoch ms (monotonic sort; human date lives inside the report).
pub fn report_slug(title: &str) -> String {
    let mut base = String::new();
    let mut last_sep = true;
    for ch in title.trim().chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
            base.push(ch);
            last_sep = false;
        } else if !last_sep {
            base.push('-');
            last_sep = true;
        }
    }
    while base.ends_with('-') {
        base.pop();
    }
    let base = if base.is_empty() { "corrida".to_string() } else { base };
    format!("{}-{}", base, local_now().unix_timestamp_nanos() / 1_000_000)
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn fmt_ms(ms: Option<u64>) -> String {
    match ms {
        None => "—".to_string(),
        Some(v) if v >= 1000 => format!("{:.2} s", v as f64 / 1000.0),
        Some(v) => format!("{} ms", v),
    }
}

fn status_meta(status: &str) -> (&'static str, &'static str) {
    match status {
        "fail" => ("falló", "chip-fail"),
        "skipped" => ("saltado", "chip-skip"),
        "stopped" => ("detenido", "chip-stop"),
        _ => ("ok", "chip-ok"),
    }
}

fn record_row(rec: &RunRecord) -> String {
    let (label, cls) = status_meta(&rec.status);
    let indent = if rec.depth > 0 {
        format!(
            " style=\"margin-left:{}px\"",
            rec.depth.min(6) * 22
        )
    } else {
        String::new()
    };
    let summary = rec
        .summary
        .as_ref()
        .map(|s| format!("<span class=\"sum\">{}</span>", esc(s)))
        .unwrap_or_default();
    let value = rec
        .value
        .as_ref()
        .map(|v| format!("<span class=\"val\">“{}”</span>", esc(v)))
        .unwrap_or_default();
    let selector = rec
        .selector
        .as_ref()
        .map(|s| format!("<span class=\"sel\">{}</span>", esc(s)))
        .unwrap_or_default();
    let attribute = rec
        .attribute
        .as_ref()
        .map(|a| format!("<span class=\"attr\">[{}]</span>", esc(a)))
        .unwrap_or_default();
    let error = rec
        .error
        .as_ref()
        .map(|e| format!("<pre class=\"err\">{}</pre>", esc(e)))
        .unwrap_or_default();
    let shot = rec
        .screenshot
        .as_ref()
        .map(|s| {
            format!("<img src=\"data:image/png;base64,{s}\" alt=\"Evidencia del paso\" />")
        })
        .unwrap_or_default();
    format!(
        r#"
  <div class="row {status}"{indent}>
    <span class="num">{index}</span>
    <div class="body">
      <div class="line">
        <span class="label">{action}</span>
        {summary}{value}{selector}{attribute}
      </div>
      <div class="time">{time}</div>
      {error}{shot}
    </div>
    <span class="chip {cls}">{label}</span>
  </div>"#,
        status = rec.status,
        indent = indent,
        index = rec.index,
        action = esc(action_label(&rec.action)),
        summary = summary,
        value = value,
        selector = selector,
        attribute = attribute,
        time = fmt_ms(rec.ms),
        error = error,
        shot = shot,
        cls = cls,
        label = label,
    )
}

const CSS: &str = r#"
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #14171f; color: #e8eaf0; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { padding: 24px 32px; border-bottom: 1px solid #2a2f3a; background: #181c26; }
  h1 { margin: 0 0 6px; font-size: 20px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 16px; color: #9aa3b2; font-size: 12.5px; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
  .counts { display: flex; gap: 14px; margin-top: 10px; font-weight: 600; }
  .c-ok { color: #7bd88f; } .c-fail { color: #f87171; } .c-skip { color: #e3c565; } .c-stop { color: #f59e0b; }
  main { max-width: 900px; margin: 0 auto; padding: 24px 32px 64px; }
  h2 { font-size: 15px; margin: 26px 0 10px; color: #c6cdd9; }
  .row { display: flex; gap: 12px; align-items: flex-start; border: 1px solid #2a2f3a; border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; background: #1b1f29; }
  .row.fail { border-color: rgba(248, 113, 113, 0.45); }
  .row .num { font-size: 12px; color: #7a8292; width: 22px; text-align: center; margin-top: 2px; }
  .row .body { flex: 1; min-width: 0; }
  .row .line { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
  .row .label { font-weight: 600; }
  .row .val, .row .sel, .row .attr { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px; color: #9fd0ff; }
  .row .sum { color: #9aa3b2; font-size: 12px; }
  .row .time { font-size: 11.5px; color: #7a8292; margin-top: 2px; }
  .err { margin: 8px 0 0; padding: 8px 10px; background: rgba(248, 113, 113, 0.08); border: 1px solid rgba(248, 113, 113, 0.25); border-radius: 8px; color: #fca5a5; font: 12px ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
  .row img { max-width: 100%; margin-top: 8px; border: 1px solid #2a2f3a; border-radius: 8px; }
  .chip { padding: 2px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .chip-ok { background: rgba(123, 216, 143, 0.15); color: #7bd88f; }
  .chip-fail { background: rgba(248, 113, 113, 0.15); color: #f87171; }
  .chip-skip { background: rgba(227, 197, 101, 0.15); color: #e3c565; }
  .chip-stop { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
  .trow { display: flex; gap: 12px; align-items: center; border: 1px solid #2a2f3a; border-radius: 10px; padding: 10px 14px; margin-bottom: 8px; }
  .trow.fail { border-color: rgba(248, 113, 113, 0.45); }
  .trow .tname { flex: 1; font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
  .trow .ttime { color: #7a8292; font-size: 12.5px; }
  .test-title { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; font-size: 13px; margin: 18px 0 8px; color: #c6cdd9; }
  .test-title .tmeta { font-size: 11.5px; color: #7a8292; font-weight: 400; }
  .test-steps { margin-bottom: 6px; }
  .empty { color: #9aa3b2; }
  details { margin-top: 12px; }
  summary { cursor: pointer; color: #9aa3b2; font-size: 13px; }
  pre.logs { margin: 8px 0 0; padding: 12px; background: #10131a; border: 1px solid #2a2f3a; border-radius: 8px; font: 12px ui-monospace, Menlo, Consolas, monospace; color: #9aa3b2; white-space: pre-wrap; max-height: 320px; overflow: auto; }
  footer { margin-top: 40px; color: #565e6e; font-size: 12px; text-align: center; }
"#;

fn header_info(r: &RunReport) -> String {
    format!(
        r#"
    <div class="meta">
      <span>{kind}</span>
      <span>{date}</span>
      <span>duración {dur}</span>
      {env}{url}
    </div>
    <div class="counts">
      <span class="c-ok">{ok} ok</span>
      <span class="c-fail">{fail} fallo{s}</span>
      {skip}{stop}
    </div>"#,
        kind = if r.kind == "set" { "Set de tests" } else { "Test" },
        date = esc(&r.started_at),
        dur = fmt_ms(Some(r.duration_ms)),
        env = r
            .env
            .as_ref()
            .map(|e| format!("<span>entorno {}</span>", esc(e)))
            .unwrap_or_default(),
        url = r
            .url
            .as_ref()
            .map(|u| format!("<span class=\"mono\">{}</span>", esc(u)))
            .unwrap_or_default(),
        ok = r.ok,
        fail = r.fail,
        s = if r.fail == 1 { "" } else { "s" },
        skip = if r.skipped > 0 {
            format!(
                "<span class=\"c-skip\">{} saltado{}</span>",
                r.skipped,
                if r.skipped == 1 { "" } else { "s" }
            )
        } else {
            String::new()
        },
        stop = if r.stopped {
            "<span class=\"c-stop\">detenida</span>".to_string()
        } else {
            String::new()
        },
    )
}

/// Self-contained HTML report (embedded images, no external deps).
pub fn build_report_html(r: &RunReport) -> String {
    let mut set_rows = String::new();
    let mut set_steps_html = String::new();
    for t in r.tests.iter().flatten() {
        set_rows.push_str(&format!(
            r#"
    <div class="trow {cls}">
      <span class="tname">{name}</span>
      <span class="ttime">{n} pasos · {fail} fallo{s} · {ms}</span>
      {err}
      <span class="chip {cls}">{label}{stopped}</span>
    </div>"#,
            cls = if t.ok { "ok" } else { "fail" },
            name = esc(&t.name),
            n = t.steps.len(),
            fail = t.fail,
            s = if t.fail == 1 { "" } else { "s" },
            ms = fmt_ms(Some(t.ms)),
            err = t
                .error
                .as_ref()
                .map(|e| format!("<pre class=\"err\">{}</pre>", esc(e)))
                .unwrap_or_default(),
            label = if t.ok { "ok" } else { "falló" },
            stopped = if t.stopped { " · detenido" } else { "" },
        ));
        set_steps_html.push_str(&format!(
            r#"
    <h3 class="test-title">{name} <span class="tmeta">{n} paso{s} · {fail} fallo{s} · {ms}</span></h3>
    <div class="test-steps">{steps}</div>"#,
            name = esc(&t.name),
            n = t.steps.len(),
            s = if t.steps.len() == 1 { "" } else { "s" },
            fail = t.fail,
            ms = fmt_ms(Some(t.ms)),
            steps = if t.steps.is_empty() {
                "<p class=\"empty\">Sin pasos ejecutados.</p>".to_string()
            } else {
                t.steps.iter().map(record_row).collect::<Vec<_>>().join("")
            },
        ));
    }

    let steps_block = if r.steps.is_empty() {
        "<p class=\"empty\">Sin pasos ejecutados.</p>".to_string()
    } else {
        r.steps.iter().map(record_row).collect::<Vec<_>>().join("")
    };

    let logs_block = if r.logs.is_empty() {
        String::new()
    } else {
        format!(
            r#"<details><summary>Logs del sidecar ({n})</summary><pre class="logs">{logs}</pre></details>"#,
            n = r.logs.len(),
            logs = esc(&r.logs.join("\n")),
        )
    };

    let sets_section = if r.tests.is_some() {
        format!(
            "<h2>Tests del set</h2>{set_rows}<h2>Pasos por test</h2>{set_steps_html}"
        )
    } else {
        format!("<h2>Pasos</h2>{steps_block}")
    };

    format!(
        r#"<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{title} · YATT</title>
<style>{css}</style></head>
<body>
  <header>
    <h1>{title}</h1>
    {header}
  </header>
  <main>
    {sets}
    {logs}
    <footer>Generado por YATT · Yet Another Testing Tool</footer>
  </main>
</body></html>"#,
        title = esc(&r.title),
        css = CSS,
        header = header_info(r),
        sets = sets_section,
        logs = logs_block,
    )
}

/// JSON report: same content, parseable by other tools.
#[allow(dead_code)] // disponible para reportes .json (paridad con la GUI vieja)
pub fn build_report_json(r: &RunReport) -> String {
    serde_json::to_string_pretty(r).unwrap_or_else(|_| "{}".to_string())
}
