//! Execution engine: runs a TestFile step tree against the sidecar, streams
//! per-step records + live preview to the UI, and saves the HTML report.
//! Port of the old GUI runner (context.tsx executeSteps) with the same
//! semantics: run_flow inherits parent vars, dataset rows get a fresh browser.

use crate::bridge::Bridge;
use base64::Engine as _;
use crate::doc::{self, Step, TestFile};
use crate::report::{build_report_html, fmt_date, local_now, RunRecord, RunReport, SetTestResult};
use crate::store::{Settings, Store};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use cosmic::iced::futures::channel::mpsc::Sender;
use cosmic::iced::futures::future::BoxFuture;
use cosmic::iced::futures::{SinkExt, Stream};
use cosmic::widget::image::Handle;

/// Opciones de corrida: RF-15 timeout por paso y RF-17 paso a paso.
#[derive(Clone, Copy)]
pub struct RunOpts {
    pub timeout_ms: u64,
    pub step_by_step: bool,
}

/// Events streamed to the UI while a run is in flight.
#[derive(Clone, Debug)]
pub enum RunEvent {
    /// One per executed step, in order.
    Record(RunRecord),
    /// Live browser preview (decoded PNG).
    Preview(Handle),
    /// Run finished and the report was saved.
    Done(RunReport),
    /// Fatal error: no report.
    Failed(String),
    /// RF-17 paso a paso: pausado antes de ejecutar el paso descrito.
    Paused(String),
}

struct Ctx {
    bridge: Arc<Bridge>,
    store: Arc<Store>,
    stop: Arc<AtomicBool>,
    resume: Arc<AtomicBool>,
    opts: RunOpts,
}

#[derive(Default)]
struct Acc {
    records: Vec<RunRecord>,
    ok: usize,
    fail: usize,
    skipped: usize,
    stopped: bool,
    browser_open: bool,
}

fn push_record(acc: &mut Acc, rec: RunRecord) {
    match rec.status.as_str() {
        "ok" => acc.ok += 1,
        "fail" => acc.fail += 1,
        "skipped" => acc.skipped += 1,
        _ => {}
    }
    acc.records.push(rec);
}

async fn emit_record(out: &mut Sender<RunEvent>, rec: RunRecord) {
    let _ = out.send(RunEvent::Record(rec)).await;
}

/// Stopped rows keep their place in the report so you can see what never ran.
fn stopped_record(acc: &mut Acc, step: &Step, depth: usize) -> RunRecord {
    RunRecord {
        index: acc.records.len() + 1,
        action: step.action.clone(),
        selector: step.selector.clone(),
        value: step.value.clone(),
        attribute: step.attribute.clone(),
        status: "stopped".into(),
        ms: None,
        error: None,
        screenshot: None,
        depth,
        summary: Some(doc::describe_step(step)),
    }
}

fn evidence(resp: &Value) -> Option<String> {
    resp.pointer("/result/screenshot")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Decodes a preview response payload into an image handle (best-effort).
pub fn decode_preview(state: &Value) -> Option<Handle> {
    let b64 = state.get("screenshot")?.as_str()?;
    let png = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
    let img = ::image::load_from_memory(&png).ok()?;
    let rgba = img.to_rgba8();
    Some(Handle::from_rgba(
        rgba.width(),
        rgba.height(),
        rgba.into_raw(),
    ))
}

fn exec_steps<'a>(
    ctx: &'a Ctx,
    steps: &'a [Step],
    vars: &'a BTreeMap<String, String>,
    depth: usize,
    acc: &'a mut Acc,
    out: &'a mut Sender<RunEvent>,
) -> BoxFuture<'a, ()> {
    Box::pin(exec_steps_inner(ctx, steps, vars, depth, acc, out))
}

async fn exec_steps_inner(
    ctx: &Ctx,
    steps: &[Step],
    vars: &BTreeMap<String, String>,
    depth: usize,
    acc: &mut Acc,
    out: &mut Sender<RunEvent>,
) {
    for step in steps {
        if ctx.stop.load(Ordering::Relaxed) {
            acc.stopped = true;
            let rec = stopped_record(acc, step, depth);
            push_record(acc, rec.clone());
            emit_record(out, rec).await;
            continue;
        }
        // RF-17: el modo paso a paso pausa antes de cada paso raíz.
        if depth == 0 && ctx.opts.step_by_step {
            let _ = out
                .send(RunEvent::Paused(doc::describe_step(step)))
                .await;
            while !ctx.resume.load(Ordering::Relaxed) && !ctx.stop.load(Ordering::Relaxed) {
                futures_timer::Delay::new(std::time::Duration::from_millis(120)).await;
            }
            ctx.resume.store(false, Ordering::Relaxed);
        }
        match step.action.as_str() {
            "if" => exec_if(ctx, step, vars, depth, acc, out).await,
            "repeat" => exec_repeat(ctx, step, vars, depth, acc, out).await,
            "for_each" => exec_for_each(ctx, step, vars, depth, acc, out).await,
            "run_flow" => exec_run_flow(ctx, step, vars, depth, acc, out).await,
            _ => exec_leaf(ctx, step, vars, depth, acc, out).await,
        }
    }
}

async fn exec_leaf(
    ctx: &Ctx,
    step: &Step,
    vars: &BTreeMap<String, String>,
    depth: usize,
    acc: &mut Acc,
    out: &mut Sender<RunEvent>,
) {
    if step.disabled {
        let rec = RunRecord {
            index: acc.records.len() + 1,
            action: step.action.clone(),
            selector: step.selector.clone(),
            value: step.value.clone(),
            attribute: step.attribute.clone(),
            status: "skipped".into(),
            ms: None,
            error: None,
            screenshot: None,
            depth,
            summary: Some(doc::describe_step(step)),
        };
        push_record(acc, rec.clone());
        emit_record(out, rec).await;
        return;
    }
    let resolved = doc::resolve_step(step, vars);
    let t0 = Instant::now();
    let resp = ctx
        .bridge
        .clone()
        .request_raw("run_step", json!({ "step": resolved, "timeoutMs": ctx.opts.timeout_ms }))
        .await;
    let ms = t0.elapsed().as_millis() as u64;
    let (status, error, screenshot) = match resp {
        Ok(r) if r.get("ok").and_then(Value::as_bool).unwrap_or(false) => {
            let shot = evidence(&r);
            ("ok", None, shot)
        }
        Ok(r) => {
            let err = r
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("error del paso")
                .to_string();
            let shot = evidence(&r);
            ("fail", Some(err), shot)
        }
        Err(e) => ("fail", Some(e), None),
    };
    let rec = RunRecord {
        index: acc.records.len() + 1,
        action: step.action.clone(),
        selector: step.selector.clone(),
        value: step.value.clone(),
        attribute: step.attribute.clone(),
        status: status.into(),
        ms: Some(ms),
        error,
        screenshot,
        depth,
        summary: Some(doc::describe_step(step)),
    };
    push_record(acc, rec.clone());
    emit_record(out, rec).await;
    if acc.browser_open {
        if let Ok(state) = ctx.bridge.clone().request("preview", json!({})).await {
            if let Some(h) = decode_preview(&state) {
                let _ = out.send(RunEvent::Preview(h)).await;
            }
        }
    }
}

async fn container_fail(
    acc: &mut Acc,
    step: &Step,
    depth: usize,
    error: String,
    out: &mut Sender<RunEvent>,
) {
    let rec = RunRecord {
        index: acc.records.len() + 1,
        action: step.action.clone(),
        selector: step.selector.clone(),
        value: step.value.clone(),
        attribute: step.attribute.clone(),
        status: "fail".into(),
        ms: None,
        error: Some(error),
        screenshot: None,
        depth,
        summary: Some(doc::describe_step(step)),
    };
    push_record(acc, rec.clone());
    emit_record(out, rec).await;
}

async fn exec_if(
    ctx: &Ctx,
    step: &Step,
    vars: &BTreeMap<String, String>,
    depth: usize,
    acc: &mut Acc,
    out: &mut Sender<RunEvent>,
) {
    match ctx
        .bridge
        .clone()
        .request_raw(
            "condition",
            json!({ "selector": step.selector, "value": step.value }),
        )
        .await
    {
        Ok(r) => {
            let hit = r
                .pointer("/result/value")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let kids = if hit {
                step.children.as_deref().unwrap_or(&[])
            } else {
                step.else_children.as_deref().unwrap_or(&[])
            };
            exec_steps(ctx, kids, vars, depth + 1, acc, out).await;
        }
        Err(e) => container_fail(acc, step, depth, e, out).await,
    }
}

async fn exec_repeat(
    ctx: &Ctx,
    step: &Step,
    vars: &BTreeMap<String, String>,
    depth: usize,
    acc: &mut Acc,
    out: &mut Sender<RunEvent>,
) {
    // Same rule as the engine: absent times means 2, garbage means 1.
    let n = match &step.times {
        Some(t) => t.trim().parse::<usize>().ok().filter(|&n| n > 0).unwrap_or(1),
        None => 2,
    };
    for _ in 0..n {
        if ctx.stop.load(Ordering::Relaxed) {
            acc.stopped = true;
            break;
        }
        exec_steps(ctx, step.children(), vars, depth + 1, acc, out).await;
        if acc.stopped {
            break;
        }
    }
}

async fn exec_for_each(
    ctx: &Ctx,
    step: &Step,
    vars: &BTreeMap<String, String>,
    depth: usize,
    acc: &mut Acc,
    out: &mut Sender<RunEvent>,
) {
    let resolved = doc::resolve_step(step, vars);
    let list = resolved.list.clone().unwrap_or_default();
    let item_var = resolved.item_var.clone().unwrap_or_else(|| "item".into());
    for item in list.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        if ctx.stop.load(Ordering::Relaxed) {
            acc.stopped = true;
            break;
        }
        let mut ivars = vars.clone();
        ivars.insert(item_var.clone(), item.to_string());
        exec_steps(ctx, resolved.children(), &ivars, depth + 1, acc, out).await;
        if acc.stopped {
            break;
        }
    }
}

async fn exec_run_flow(
    ctx: &Ctx,
    step: &Step,
    vars: &BTreeMap<String, String>,
    depth: usize,
    acc: &mut Acc,
    out: &mut Sender<RunEvent>,
) {
    let flow_name = doc::interpolate(step.flow.as_deref().unwrap_or(""), vars);
    let flow: TestFile = match ctx
        .store
        .test_load(&flow_name)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
    {
        Some(d) => d,
        None => {
            container_fail(acc, step, depth, format!("no se pudo cargar el sub-flujo {flow_name}"), out)
                .await;
            return;
        }
    };
    // Sub-flows inherit the caller's vars (old engine semantics), then withVars
    // maps caller values in: exact {{x}} interpolates, known var resolves, else literal.
    let mut fvars = vars.clone();
    if let Some(with) = &step.with_vars {
        for (k, src) in with {
            let trimmed = src.trim();
            let v = if trimmed.starts_with("{{") && trimmed.ends_with("}}") {
                doc::interpolate(src, vars)
            } else {
                vars.get(src).cloned().unwrap_or_else(|| src.clone())
            };
            fvars.insert(k.clone(), v);
        }
    }
    exec_steps(ctx, &flow.steps, &fvars, depth + 1, acc, out).await;
}

fn run_settings(settings: &Settings, env: Option<String>) -> Settings {
    let mut s = settings.clone();
    s.active_env = env;
    s
}

fn base_vars(test: &TestFile, settings: &Settings) -> BTreeMap<String, String> {
    let mut vars: BTreeMap<String, String> = test
        .variables
        .iter()
        .map(|v| (v.name.clone(), v.value.clone().unwrap_or_default()))
        .collect();
    if let Some(env) = &settings.active_env {
        if let Some(map) = settings.envs.get(env) {
            for (k, v) in map {
                vars.insert(k.clone(), v.clone());
            }
        }
    }
    vars
}

fn open_params(test: &TestFile, settings: &Settings, force_headless: bool) -> Value {
    let mut p = json!({
        "url": test.url,
        "headless": force_headless || test.headless,
        "variables": test.variables.iter().map(|v| v.name.clone()).collect::<Vec<_>>(),
    });
    if let Some(s) = &settings.session {
        p["session"] = json!(s);
    }
    if let Some(b) = &settings.browser {
        p["browser"] = json!(b);
    }
    if let (Some(w), Some(h)) = (settings.viewport_width, settings.viewport_height) {
        p["viewport"] = json!({ "width": w, "height": h });
    }
    if let Some(tz) = &settings.timezone_id {
        p["timezoneId"] = json!(tz);
    }
    if let (Some(lat), Some(lon)) = (settings.geo_lat, settings.geo_lon) {
        p["geolocation"] = json!({ "latitude": lat, "longitude": lon });
    }
    p
}

async fn open_quiet(ctx: &Ctx, test: &TestFile, settings: &Settings, force_headless: bool) -> bool {
    let _ = ctx.bridge.clone().request("close", json!({})).await;
    ctx.bridge
        .clone()
        .request("open", open_params(test, settings, force_headless))
        .await
        .is_ok()
}

async fn close_quiet(ctx: &Ctx) {
    let _ = ctx.bridge.clone().request("close", json!({})).await;
}

async fn run_test(
    ctx: &Ctx,
    test: &TestFile,
    settings: &Settings,
    env: Option<String>,
    out: &mut Sender<RunEvent>,
) -> Option<RunReport> {
    let settings = run_settings(settings, env.clone());
    let started = local_now();
    let t0 = Instant::now();
    if !open_quiet(ctx, test, &settings, false).await {
        let _ = out
            .send(RunEvent::Failed("no se pudo abrir el browser".into()))
            .await;
        close_quiet(ctx).await;
        return None;
    }
    let mut acc = Acc::default();
    acc.browser_open = true;
    let vars = base_vars(test, &settings);
    exec_steps(ctx, &test.steps, &vars, 0, &mut acc, out).await;
    close_quiet(ctx).await;
    let report = RunReport {
        kind: "test".into(),
        title: test.name.clone(),
        test_name: Some(test.name.clone()),
        url: Some(test.url.clone()),
        env,
        headless: test.headless,
        started_at: fmt_date(&started),
        finished_at: fmt_date(&local_now()),
        duration_ms: t0.elapsed().as_millis() as u64,
        ok: acc.ok,
        fail: acc.fail,
        skipped: acc.skipped,
        stopped: acc.stopped,
        logs: vec![],
        steps: acc.records,
        tests: None,
    };
    Some(report)
}

async fn run_test_headless_acc(
    ctx: &Ctx,
    test: &TestFile,
    settings: &Settings,
    out: &mut Sender<RunEvent>,
) -> (SetTestResult, usize, usize, usize, bool) {
    let started = Instant::now();
    if !open_quiet(ctx, test, settings, true).await {
        return (
            SetTestResult {
                name: test.name.clone(),
                ok: false,
                ms: 0,
                fail: 0,
                stopped: false,
                error: Some("no se pudo abrir el browser".into()),
                steps: vec![],
            },
            0,
            0,
            0,
            false,
        );
    }
    let mut acc = Acc::default();
    acc.browser_open = true;
    let vars = base_vars(test, settings);
    exec_steps(ctx, &test.steps, &vars, 0, &mut acc, out).await;
    close_quiet(ctx).await;
    (
        SetTestResult {
            name: test.name.clone(),
            ok: acc.fail == 0 && !acc.stopped,
            ms: started.elapsed().as_millis() as u64,
            fail: acc.fail,
            stopped: acc.stopped,
            error: None,
            steps: acc.records,
        },
        acc.ok,
        acc.fail,
        acc.skipped,
        acc.stopped,
    )
}

async fn run_set(
    ctx: &Ctx,
    tests: Vec<TestFile>,
    settings: &Settings,
    env: Option<String>,
    title: String,
    url: Option<String>,
    test_name: Option<String>,
    out: &mut Sender<RunEvent>,
) -> Option<RunReport> {
    let settings = run_settings(settings, env.clone());
    let started = local_now();
    let t0 = Instant::now();
    let mut results = Vec::new();
    let (mut ok, mut fail, mut skipped, mut stopped) = (0usize, 0usize, 0usize, false);
    for t in &tests {
        if ctx.stop.load(Ordering::Relaxed) {
            break;
        }
        let (res, o, f, s, st) = run_test_headless_acc(ctx, t, &settings, out).await;
        ok += o;
        fail += f;
        skipped += s;
        stopped |= st;
        results.push(res);
    }
    let report = RunReport {
        kind: "set".into(),
        title,
        test_name,
        url,
        env,
        headless: true,
        started_at: fmt_date(&started),
        finished_at: fmt_date(&local_now()),
        duration_ms: t0.elapsed().as_millis() as u64,
        ok,
        fail,
        skipped,
        stopped,
        logs: vec![],
        steps: vec![],
        tests: Some(results),
    };
    Some(report)
}

async fn run_dataset(
    ctx: &Ctx,
    test: &TestFile,
    settings: &Settings,
    env: Option<String>,
    out: &mut Sender<RunEvent>,
) -> Option<RunReport> {
    let settings = run_settings(settings, env.clone());
    let started = local_now();
    let t0 = Instant::now();
    let rows = test
        .dataset
        .as_ref()
        .map(|d| d.rows.clone())
        .unwrap_or_default();
    let mut results = Vec::new();
    let (mut ok, mut fail, mut skipped, mut stopped) = (0usize, 0usize, 0usize, false);
    for (i, row) in rows.iter().enumerate() {
        if ctx.stop.load(Ordering::Relaxed) {
            break;
        }
        // Row cells overlay env/defaults; empty cells fall through (audit fix 7 semantics).
        let mut vars = base_vars(test, &settings);
        for (k, v) in &row.cells {
            if !v.is_empty() {
                vars.insert(k.clone(), v.clone());
            }
        }
        let row_started = Instant::now();
        if !open_quiet(ctx, test, &settings, false).await {
            results.push(SetTestResult {
                name: format!("fila {}", i + 1),
                ok: false,
                ms: 0,
                fail: 0,
                stopped: false,
                error: Some("no se pudo abrir el browser".into()),
                steps: vec![],
            });
            continue;
        }
        let mut acc = Acc::default();
        acc.browser_open = true;
        exec_steps(ctx, &test.steps, &vars, 0, &mut acc, out).await;
        close_quiet(ctx).await;
        ok += acc.ok;
        fail += acc.fail;
        skipped += acc.skipped;
        stopped |= acc.stopped;
        results.push(SetTestResult {
            name: format!("fila {}", i + 1),
            ok: acc.fail == 0 && !acc.stopped,
            ms: row_started.elapsed().as_millis() as u64,
            fail: acc.fail,
            stopped: acc.stopped,
            error: None,
            steps: acc.records,
        });
    }
    let report = RunReport {
        kind: "set".into(),
        title: format!("{} · dataset", test.name),
        test_name: Some(test.name.clone()),
        url: Some(test.url.clone()),
        env,
        headless: test.headless,
        started_at: fmt_date(&started),
        finished_at: fmt_date(&local_now()),
        duration_ms: t0.elapsed().as_millis() as u64,
        ok,
        fail,
        skipped,
        stopped,
        logs: vec![],
        steps: vec![],
        tests: Some(results),
    };
    Some(report)
}

async fn finish(ctx: &Ctx, report: Option<RunReport>, out: &mut Sender<RunEvent>) {
    let Some(report) = report else { return };
    let html = build_report_html(&report);
    let name = format!("{}.html", crate::report::report_slug(&report.title));
    match ctx.store.report_save(&name, &html) {
        Ok(_) => {
            let _ = out.send(RunEvent::Done(report)).await;
        }
        Err(e) => {
            let _ = out.send(RunEvent::Failed(format!("guardando reporte: {e}"))).await;
        }
    }
}

fn stream(
    bridge: Arc<Bridge>,
    store: Arc<Store>,
    stop: Arc<AtomicBool>,
    resume: Arc<AtomicBool>,
    opts: RunOpts,
    which: Which,
    settings: Settings,
    env: Option<String>,
) -> impl Stream<Item = RunEvent> {
    cosmic::iced::stream::channel(100, move |mut out: Sender<RunEvent>| async move {
        let ctx = Ctx { bridge, store: store.clone(), stop, resume, opts };
        let report = match which {
            Which::Test(test) => run_test(&ctx, &test, &settings, env, &mut out).await,
            Which::Set(tests, title, url, test_name) => {
                run_set(&ctx, tests, &settings, env, title, url, test_name, &mut out).await
            }
            Which::Dataset(test) => run_dataset(&ctx, &test, &settings, env, &mut out).await,
        };
        finish(&ctx, report, &mut out).await;
    })
}

enum Which {
    Test(TestFile),
    Set(Vec<TestFile>, String, Option<String>, Option<String>),
    Dataset(TestFile),
}

/// Runs one test end to end (single-browser flow).
pub fn stream_test(
    bridge: Arc<Bridge>,
    store: Arc<Store>,
    test: TestFile,
    settings: Settings,
    env: Option<String>,
    stop: Arc<AtomicBool>,
    resume: Arc<AtomicBool>,
    opts: RunOpts,
) -> impl Stream<Item = RunEvent> {
    stream(bridge, store, stop, resume, opts, Which::Test(test), settings, env)
}

/// Runs several tests, each with its own headless browser (corrida de set).
pub fn stream_set(
    bridge: Arc<Bridge>,
    store: Arc<Store>,
    tests: Vec<TestFile>,
    settings: Settings,
    env: Option<String>,
    stop: Arc<AtomicBool>,
    resume: Arc<AtomicBool>,
    opts: RunOpts,
) -> impl Stream<Item = RunEvent> {
    let title = format!("corrida de {} tests", tests.len());
    stream(
        bridge,
        store,
        stop,
        resume,
        opts,
        Which::Set(tests, title, None, None),
        settings,
        env,
    )
}

/// Runs one test once per dataset row, fresh browser per row.
pub fn stream_dataset(
    bridge: Arc<Bridge>,
    store: Arc<Store>,
    test: TestFile,
    settings: Settings,
    env: Option<String>,
    stop: Arc<AtomicBool>,
    resume: Arc<AtomicBool>,
    opts: RunOpts,
) -> impl Stream<Item = RunEvent> {
    stream(bridge, store, stop, resume, opts, Which::Dataset(test), settings, env)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_vars_overlays_env_and_row() {
        let mut test = doc::default_test("t");
        test.variables = vec![
            doc::YattVariable { name: "usuario".into(), value: Some("default".into()) },
            doc::YattVariable { name: "vacio".into(), value: None },
        ];
        let mut settings = Settings::default();
        let mut qa = BTreeMap::new();
        qa.insert("usuario".to_string(), "ana".to_string());
        settings.envs.insert("qa".into(), qa);
        settings.active_env = Some("qa".into());
        let mut vars = base_vars(&test, &settings);
        assert_eq!(vars.get("usuario").unwrap(), "ana");
        assert_eq!(vars.get("vacio").unwrap(), "");
        // Row overlay skips empty cells.
        let mut row = doc::DatasetRow::default();
        row.cells.insert("usuario".into(), String::new());
        row.cells.insert("extra".into(), "x".into());
        for (k, v) in &row.cells {
            if !v.is_empty() {
                vars.insert(k.clone(), v.clone());
            }
        }
        assert_eq!(vars.get("usuario").unwrap(), "ana");
        assert_eq!(vars.get("extra").unwrap(), "x");
    }

    #[test]
    fn repeat_times_semantics() {
        let n = |t: Option<&str>| match t {
            Some(t) => t.trim().parse::<usize>().ok().filter(|&n| n > 0).unwrap_or(1),
            None => 2,
        };
        assert_eq!(n(None), 2);
        assert_eq!(n(Some("3")), 3);
        assert_eq!(n(Some("basura")), 1);
        assert_eq!(n(Some("0")), 1);
    }
}
