//! Correr: ejecuta un test / dataset / set con resultados en vivo y stop.

use crate::app::Message;
use crate::doc::{self, TestFile};
use crate::pages::{card, mono, status_chip, Shared};
use crate::report::RunReport;
use crate::runner::{self, RunEvent};
use cosmic::app::Task;
use cosmic::widget::{self, image, text_input};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub struct Page {
    pub names: Vec<String>,
    pub envs: Vec<String>,
    pub selected: Option<String>,
    pub env: Option<String>,
    pub records: Vec<crate::report::RunRecord>,
    pub preview: Option<image::Handle>,
    pub done: Option<RunReport>,
    pub error: Option<String>,
    pub running: bool,
    pub stop: Arc<AtomicBool>,
    pub resume: Arc<AtomicBool>,
    pub paused: Option<String>,
    pub step_by_step: bool,
    pub timeout_s: String,
}

impl Default for Page {
    fn default() -> Self {
        Page {
            names: Vec::new(),
            envs: Vec::new(),
            selected: None,
            env: None,
            records: Vec::new(),
            preview: None,
            done: None,
            error: None,
            running: false,
            stop: Arc::new(AtomicBool::new(false)),
            resume: Arc::new(AtomicBool::new(false)),
            paused: None,
            step_by_step: false,
            timeout_s: "40".into(),
        }
    }
}

#[derive(Clone, Debug)]
pub enum Msg {
    Refresh,
    Select(String),
    SetEnv(Option<String>),
    RunTest,
    RunDataset,
    RunSet,
    Stop,
    SetSbs(bool),
    SetTimeout(String),
    Resume,
}

impl Page {
    pub fn refresh(&mut self, sh: &mut Shared) {
        self.names = sh.store().map(|s| s.test_list()).unwrap_or_else(|| Ok(Vec::new())).unwrap_or_default();
        self.envs = sh.env_names();
        if self.selected.is_none() {
            self.selected = self.names.first().cloned();
        }
        if let Some(sel) = &self.selected {
            if !self.names.contains(sel) {
                self.selected = self.names.first().cloned().or_else(|| Some(sel.clone()));
            }
        }
    }

    fn load_test(sh: &Shared, name: &Option<String>) -> Result<TestFile, String> {
        let name = name.clone().ok_or("elegí un test primero")?;
        let store = sh.store().ok_or("sin base de datos")?;
        let json = store.test_load(&name)?;
        let doc: TestFile = serde_json::from_str(&json).map_err(|e| format!("test {name} inválido: {e}"))?;
        Ok(doc)
    }

    fn begin(&mut self) {
        self.records.clear();
        self.done = None;
        self.preview = None;
        self.error = None;
        self.running = true;
        self.stop = Arc::new(AtomicBool::new(false));
        self.resume = Arc::new(AtomicBool::new(false));
        self.paused = None;
    }

    fn opts(&self) -> runner::RunOpts {
        let s = self.timeout_s.trim().parse::<u64>().unwrap_or(40).max(1);
        runner::RunOpts { timeout_ms: s * 1000, step_by_step: self.step_by_step }
    }

    fn launch(&mut self, stream: impl cosmic::iced::futures::Stream<Item = RunEvent> + Send + 'static) -> Task<Message> {
        use cosmic::iced::futures::StreamExt;
        let msgs = stream.map(Message::Run);
        let t: cosmic::app::Task<Message> = cosmic::task::stream(msgs);
        t
    }
}

pub fn update(page: &mut Page, sh: &mut Shared, msg: Msg) -> Task<Message> {
    match msg {
        Msg::Refresh => {
            page.refresh(sh);
            Task::none()
        }
        Msg::Select(name) => {
            page.selected = Some(name);
            Task::none()
        }
        Msg::SetEnv(env) => {
            page.env = env;
            Task::none()
        }
        Msg::RunTest => {
            let test = match Page::load_test(sh, &page.selected) {
                Ok(t) => t,
                Err(e) => {
                    page.error = Some(e);
                    return Task::none();
                }
            };
            page.begin();
            sh.log(format!("corriendo {}", test.name));
            let stream = runner::stream_test(
                sh.bridge.clone(),
                sh.store.clone().expect("store"),
                test,
                sh.settings.clone(),
                page.env.clone(),
                page.stop.clone(),
                page.resume.clone(),
                page.opts(),
            );
            page.launch(stream)
        }
        Msg::RunDataset => {
            let test = match Page::load_test(sh, &page.selected) {
                Ok(t) => t,
                Err(e) => {
                    page.error = Some(e);
                    return Task::none();
                }
            };
            if test.dataset.as_ref().map(|d| d.rows.is_empty()).unwrap_or(true) {
                page.error = Some("el test no tiene filas de dataset".into());
                return Task::none();
            }
            page.begin();
            sh.log(format!("dataset de {}", test.name));
            let stream = runner::stream_dataset(
                sh.bridge.clone(),
                sh.store.clone().expect("store"),
                test,
                sh.settings.clone(),
                page.env.clone(),
                page.stop.clone(),
                page.resume.clone(),
                page.opts(),
            );
            page.launch(stream)
        }
        Msg::RunSet => {
            let store = match sh.store() {
                Some(s) => s.clone(),
                None => {
                    page.error = Some("sin base de datos".into());
                    return Task::none();
                }
            };
            let mut tests = Vec::new();
            for name in &page.names {
                match store.test_load(name).and_then(|json| serde_json::from_str::<TestFile>(&json).map_err(|e| e.to_string())) {
                    Ok(t) => tests.push(t),
                    Err(e) => {
                        page.error = Some(format!("{name}: {e}"));
                        return Task::none();
                    }
                }
            }
            if tests.is_empty() {
                page.error = Some("no hay tests guardados".into());
                return Task::none();
            }
            page.begin();
            sh.log("corrida de set".to_string());
            let stream = runner::stream_set(
                sh.bridge.clone(),
                store,
                tests,
                sh.settings.clone(),
                page.env.clone(),
                page.stop.clone(),
                page.resume.clone(),
                page.opts(),
            );
            page.launch(stream)
        }
        Msg::Stop => {
            page.stop.store(true, Ordering::SeqCst);
            page.resume.store(true, Ordering::SeqCst);
            sh.log("stop pedido".to_string());
            Task::none()
        }
        Msg::SetSbs(v) => {
            page.step_by_step = v;
            Task::none()
        }
        Msg::SetTimeout(v) => {
            page.timeout_s = v;
            Task::none()
        }
        Msg::Resume => {
            page.resume.store(true, Ordering::SeqCst);
            Task::none()
        }
    }
}

/// RunEvent handler, invoked from the app shell.
pub fn on_run_event(page: &mut Page, sh: &mut Shared, ev: RunEvent) {
    match ev {
        RunEvent::Record(rec) => page.records.push(rec),
        RunEvent::Preview(handle) => page.preview = Some(handle),
        RunEvent::Done(report) => {
            page.done = Some(report.clone());
            page.running = false;
            sh.log(format!("listo: {} ({} ok, {} fail)", report.title, report.ok, report.fail));
            if let Some(store) = sh.store() {
                let _ = store.report_list();
            }
        }
        RunEvent::Failed(e) => {
            page.error = Some(e);
            page.running = false;
        }
        RunEvent::Paused(desc) => {
            page.paused = Some(desc);
        }
    }
}

pub fn view<'a>(page: &'a Page, _sh: &'a Shared) -> cosmic::Element<'a, Message> {
    let mut col = widget::column::with_capacity(10).spacing(12).padding(16);

    // ── Héroe: título + acción primaria ──
    let mut hero = widget::row::with_capacity(3)
        .push(widget::container(widget::text::title2("Correr")).width(cosmic::iced::Length::Fill))
        .push(widget::button::suggested("Correr test").on_press_maybe((!page.running).then(|| Message::Correr(Msg::RunTest))))
        .spacing(8);
    if page.running {
        hero = hero.push(crate::pages::ibtn(cosmic::theme::Button::Destructive, "stop", "Detener", Some(Message::Correr(Msg::Stop))));
    }
    col = col.push(hero);

    // ── Qué correr ──
    let pick_test = widget::column::with_capacity(2).spacing(2)
        .push(widget::text::body("test"))
        .push(crate::pages::pick(&page.names, page.selected.as_deref(), move |v| match v {
            Some(n) => Message::Correr(Msg::Select(n)),
            None => Message::Noop,
        }));
    let pick_env = widget::column::with_capacity(2).spacing(2)
        .push(widget::text::body("entorno"))
        .push(crate::pages::pick(&page.envs, page.env.as_deref(), move |v| Message::Correr(Msg::SetEnv(v))));
    let mut config = widget::column::with_capacity(3).spacing(8)
        .push(widget::row::with_capacity(4).push(pick_test).push(pick_env).spacing(16))
        .push(widget::row::with_capacity(5)
            .push(widget::checkbox(page.step_by_step).label("paso a paso").on_toggle(|b| Message::Correr(Msg::SetSbs(b))))
            .push(widget::text::body("timeout (s)"))
            .push(text_input("40", &page.timeout_s).on_input(|v| Message::Correr(Msg::SetTimeout(v))).size(13).width(90))
            .push(crate::pages::tbtn("play", "Continuar", page.paused.as_ref().map(|_| Message::Correr(Msg::Resume))))
            .spacing(8))
        .push(widget::row::with_capacity(3)
            .push(crate::pages::tbtn("play", "Correr dataset", (!page.running).then(|| Message::Correr(Msg::RunDataset))))
            .push(crate::pages::tbtn("play", "Correr todos", (!page.running).then(|| Message::Correr(Msg::RunSet))))
            .spacing(8));
    if page.running {
        match &page.paused {
            Some(desc) => config = config.push(widget::container(widget::text(format!("pausado (paso a paso): {desc}")).size(12)).padding([6, 10]).style(|_| widget::container::Style {
                text_color: Some(cosmic::iced::Color::from_rgb(0.85, 0.55, 0.05)),
                border: cosmic::iced::Border { radius: 6.0.into(), width: 1.0, color: cosmic::iced::Color::from_rgb(0.85, 0.55, 0.05) },
                ..Default::default()
            })),
            None => config = config.push(widget::text::body("corriendo…")),
        }
    }
    if let Some(e) = &page.error {
        config = config.push(widget::container(widget::text(e.clone()).size(12)).style(|_| widget::container::Style {
            text_color: Some(cosmic::iced::Color::from_rgb(0.75, 0.23, 0.16)),
            ..Default::default()
        }));
    }
    col = col.push(card(config));

    // ── Resultados (la cinta) ──
    if !page.records.is_empty() {
        let mut list = widget::column::with_capacity(page.records.len()).spacing(4);
        for rec in &page.records {
            let mut row = widget::row::with_capacity(6).spacing(8)
                .push(widget::container(status_chip(&rec.status)).width(26))
                .push(widget::container(widget::text(doc::action_label(&rec.action)).size(13)).width(140))
                .push(mono(rec.summary.clone().unwrap_or_else(|| rec.selector.clone().unwrap_or_default())));
            if let Some(ms) = rec.ms {
                row = row.push(mono(format!("{ms} ms")));
            }
            if let Some(err) = &rec.error {
                row = row.push(widget::container(widget::text(err.clone()).size(12)).style(|_| widget::container::Style {
                    text_color: Some(cosmic::iced::Color::from_rgb(0.75, 0.23, 0.16)),
                    ..Default::default()
                }));
            }
            list = list.push(widget::container(row).padding([0, 0, 0, (rec.depth * 16) as u16]));
        }
        col = col.push(card(widget::column::with_capacity(2).spacing(8)
            .push(widget::text::title3("Resultados"))
            .push(list)));
    }

    // ── Banner de corrida terminada ──
    if let Some(r) = &page.done {
        col = col.push(card(widget::column::with_capacity(2).spacing(4)
            .push(widget::text(format!(
                "✓ {} · {} ok · {} fail · {} omitidos{}",
                r.title, r.ok, r.fail, r.skipped,
                if r.stopped { " · detenido" } else { "" },
            )).size(13))
            .push(widget::text::body("el reporte quedó guardado en «Reportes»"))));
    }

    // ── Vista previa ──
    if let Some(handle) = &page.preview {
        col = col.push(card(widget::column::with_capacity(2).spacing(8)
            .push(widget::text::title3("Vista previa"))
            .push(widget::image(handle).width(cosmic::iced::Length::Fill).height(cosmic::iced::Length::Fixed(260.0)))));
    }

    col.into()
}
