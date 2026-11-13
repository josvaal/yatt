//! Tests: biblioteca + editor completo (pasos, grabación, variables, dataset, export).

use crate::app::Message;
use crate::doc::{self, Step, TestFile};
use crate::pages::{card, mono, Shared};
use cosmic::app::Task;
use cosmic::widget::{self, text_input};
use serde_json::Value;
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Field {
    Selector,
    Value,
    Attribute,
    Times,
    List,
    ItemVar,
    Flow,
    WithVars,
    Baseline,
    Tolerance,
}

impl Field {
    #[allow(dead_code)]
    fn label(self) -> &'static str {
        match self {
            Field::Selector => "selector",
            Field::Value => "valor",
            Field::Attribute => "atributo",
            Field::Times => "veces",
            Field::List => "lista (separada por comas)",
            Field::ItemVar => "variable del ítem",
            Field::Flow => "sub-flujo",
            Field::WithVars => "mapeo var=origen (separado por comas)",
            Field::Baseline => "imagen base",
            Field::Tolerance => "tolerancia %",
        }
    }
    fn placeholder(self) -> &'static str {
        match self {
            Field::Selector => "#boton",
            Field::Value => "texto",
            Field::Attribute => "href",
            Field::Times => "2",
            Field::List => "{{nombres}} o ana,eva",
            Field::ItemVar => "item",
            Field::Flow => "nombre del test",
            Field::WithVars => "usuario={{usuario}}",
            Field::Baseline => "login",
            Field::Tolerance => "0",
        }
    }
}

/// Campos editables por acción, en orden de pantalla.
fn fields_for(action: &str) -> &'static [Field] {
    match action {
        "assert_attribute" => &[Field::Selector, Field::Attribute, Field::Value],
        "upload" => &[Field::Selector, Field::Value],
        "if" => &[Field::Selector, Field::Value],
        "repeat" => &[Field::Times],
        "for_each" => &[Field::List, Field::ItemVar],
        "run_flow" => &[Field::Flow, Field::WithVars],
        "capture_screenshot" | "assert_screenshot" => &[Field::Baseline, Field::Tolerance],
        "screenshot" => &[],
        "goto" | "wait" | "open_tab" | "switch_tab" => &[Field::Value],
        _ => &[Field::Selector, Field::Value],
    }
}

fn field_ref<'a>(s: &'a Step, f: Field) -> &'a str {
    let opt = match f {
        Field::Selector => &s.selector,
        Field::Value => &s.value,
        Field::Attribute => &s.attribute,
        Field::Times => &s.times,
        Field::List => &s.list,
        Field::ItemVar => &s.item_var,
        Field::Flow => &s.flow,
        Field::WithVars => &None,
        Field::Baseline => &s.baseline,
        Field::Tolerance => &s.tolerance,
    };
    opt.as_deref().unwrap_or("")
}

fn joined_withvars(s: &Step) -> String {
    s.with_vars
        .as_ref()
        .map(|m| m.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join(", "))
        .unwrap_or_default()
}

fn parse_with_vars(s: &str) -> Option<std::collections::BTreeMap<String, String>> {
    let pairs: Vec<(String, String)> = s
        .split(',')
        .filter_map(|p| {
            let p = p.trim();
            if p.is_empty() {
                return None;
            }
            let (k, v) = p.split_once('=')?;
            Some((k.trim().to_string(), v.trim().to_string()))
        })
        .collect();
    if pairs.is_empty() {
        None
    } else {
        pairs.into_iter().collect::<std::collections::BTreeMap<_, _>>().into()
    }
}

const EXPORT_FORMATS: [&str; 2] = ["playwright", "jest"];

pub struct Page {
    pub names: Vec<String>,
    pub mode: Mode,
    pub draft: TestFile,
    pub original: Option<String>,
    pub open: BTreeSet<Vec<usize>>,
    pub grab: Option<Vec<usize>>,
    pub new_pick: Option<String>,
    pub export_fmt: Option<String>,
    pub csv_path: String,
    pub envs_text: String,
    pub ds_columns_text: String,
    pub withvars: std::collections::BTreeMap<Vec<usize>, String>,
    pub notice: Option<String>,
    pub error: Option<String>,
    pub preview: Option<cosmic::widget::image::Handle>,
    pub ses_name: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    List,
    Editor,
}

impl Default for Page {
    fn default() -> Self {
        Page {
            names: Vec::new(),
            mode: Mode::List,
            draft: doc::default_test("test sin nombre"),
            original: None,
            open: BTreeSet::new(),
            grab: None,
            new_pick: Some("click".into()),
            export_fmt: Some("playwright".into()),
            csv_path: String::new(),
            envs_text: String::new(),
            ds_columns_text: String::new(),
            withvars: Default::default(),
            preview: None,
            ses_name: String::new(),
            notice: None,
            error: None,
        }
    }
}

#[derive(Clone, Debug)]
pub enum Msg {
    Refresh,
    New,
    Open(String),
    Delete(String),
    Back,
    Save,
    Export,
    SetName(String),
    SetUrl(String),
    ToggleHeadless(bool),
    SetEnvs(String),
    ToggleExpand(Vec<usize>),
    Field(Vec<usize>, Field, String),
    SetFullPage(Vec<usize>, bool),
    Move(Vec<usize>, i32),
    DelStep(Vec<usize>),
    PickNew(String),
    Add(Vec<usize>),
    Grab(Vec<usize>),
    StopGrab,
    #[allow(dead_code)] // llega por el evento action_captured (Page::captured)
    Captured(Step),
    VarName(usize, String),
    VarValue(usize, String),
    VarAdd,
    VarDel(usize),
    DsColumns(String),
    DsCell(usize, String, String),
    DsRowAdd,
    DsRowDel(usize),
    SetCsvPath(String),
    CsvImport,
    PickExport(String),
    Abrir,
    Cerrar,
    Abierto(Result<Value, String>),
    Cerrado(Result<Value, String>),
    PreviewGot(Result<Value, String>),
    SesName(String),
    SesSave,
    SesSaved(Result<Value, String>),
}

impl Page {
    pub fn refresh(&mut self, sh: &mut Shared) {
        self.names = sh.store().map(|s| s.test_list()).unwrap_or_else(|| Ok(Vec::new())).unwrap_or_default();
        self.envs_text = self.draft.envs.join(", ");
        self.ds_columns_text = self.draft.dataset.as_ref().map(|d| d.columns.join(", ")).unwrap_or_default();
        self.withvars.clear();
    }

    pub fn captured(&mut self, sh: &mut Shared, step: Step) -> Task<Message> {
        let Some(path) = self.grab.clone() else {
            return Task::none();
        };
        let vars = self.draft.variables.iter().map(|v| v.name.clone()).collect::<Vec<_>>();
        let target = if path.is_empty() {
            self.draft.steps.push(step);
            &mut self.draft.steps
        } else {
            match step_at(&mut self.draft.steps, &path) {
                Some(s) => s.children.get_or_insert_with(Vec::new),
                None => {
                    self.error = Some("paso de grabación fuera de lugar".into());
                    return Task::none();
                }
            }
        };
        let last = target.last().cloned();
        sh.log(match last {
            Some(s) => format!("capturado: {}", doc::describe_step(&s)),
            None => "capturado".to_string(),
        });
        let bridge = sh.bridge.clone();
        let toolbar = cosmic::task::future(async move {
            let _ = bridge
                .request("toolbar_vars", serde_json::json!({ "variables": vars }))
                .await;
            Message::Noop
        });
        cosmic::task::batch([toolbar, preview_task(sh)])
    }
}

fn step_at<'a>(steps: &'a mut Vec<Step>, path: &[usize]) -> Option<&'a mut Step> {
    let (i, rest) = path.split_first()?;
    let s = steps.get_mut(*i)?;
    if rest.is_empty() {
        Some(s)
    } else {
        step_at(s.children.get_or_insert_with(Vec::new), rest)
    }
}

fn vec_at<'a>(steps: &'a mut Vec<Step>, path: &[usize]) -> Option<&'a mut Vec<Step>> {
    match path.split_last() {
        None => Some(steps),
        Some((i, rest)) => {
            let parent = step_at(steps, rest)?;
            let siblings = parent.children.get_or_insert_with(Vec::new);
            if *i < siblings.len() {
                Some(siblings)
            } else {
                None
            }
        }
    }
}

pub fn update(page: &mut Page, sh: &mut Shared, msg: Msg) -> Task<Message> {
    match msg {
        Msg::Refresh => {
            page.refresh(sh);
            Task::none()
        }
        Msg::New => {
            page.draft = doc::default_test("test sin nombre");
            page.original = None;
            page.open.clear();
            page.notice = None;
            page.error = None;
            page.mode = Mode::Editor;
            Task::none()
        }
        Msg::Open(name) => {
            let loaded = sh.store().map(|s| s.test_load(&name));
            match loaded {
                Some(Ok(json)) => match serde_json::from_str::<TestFile>(&json) {
                    Ok(doc) => {
                        page.draft = doc;
                        page.original = Some(name);
                        page.open.clear();
                        page.notice = None;
                        page.error = None;
                        page.mode = Mode::Editor;
                    }
                    Err(e) => page.error = Some(format!("test inválido: {e}")),
                },
                Some(Err(e)) => page.error = Some(e),
                None => page.error = Some("sin base de datos".into()),
            }
            Task::none()
        }
        Msg::Delete(name) => {
            if let Some(store) = sh.store() {
                if let Err(e) = store.test_delete(&name) {
                    page.error = Some(e);
                }
            }
            page.refresh(sh);
            Task::none()
        }
        Msg::Back => {
            page.mode = Mode::List;
            page.grab = None;
            page.refresh(sh);
            Task::none()
        }
        Msg::SetName(v) => {
            page.draft.name = v;
            Task::none()
        }
        Msg::SetUrl(v) => {
            page.draft.url = v;
            Task::none()
        }
        Msg::ToggleHeadless(b) => {
            page.draft.headless = b;
            Task::none()
        }
        Msg::SetEnvs(v) => {
            page.envs_text = v.clone();
            page.draft.envs = v.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
            Task::none()
        }
        Msg::ToggleExpand(path) => {
            if page.open.remove(&path) {
                Task::none()
            } else {
                if let Some(s) = step_at(&mut page.draft.steps, &path) {
                    if s.action == "run_flow" {
                        page.withvars.insert(path.clone(), joined_withvars(s));
                    }
                }
                page.open.insert(path);
                Task::none()
            }
        }
        Msg::Field(path, field, value) => {
            if field == Field::WithVars {
                page.withvars.insert(path.clone(), value.clone());
            }
            if let Some(s) = step_at(&mut page.draft.steps, &path) {
                let empty = value.trim().is_empty();
                let opt = if empty { None } else { Some(value.clone()) };
                match field {
                    Field::Selector => s.selector = opt,
                    Field::Value => s.value = opt,
                    Field::Attribute => s.attribute = opt,
                    Field::Times => s.times = opt,
                    Field::List => s.list = opt,
                    Field::ItemVar => s.item_var = opt,
                    Field::Flow => s.flow = opt,
                    Field::WithVars => s.with_vars = parse_with_vars(&value),
                    Field::Baseline => s.baseline = opt,
                    Field::Tolerance => s.tolerance = opt,
                }
            }
            Task::none()
        }
        Msg::SetFullPage(path, b) => {
            if let Some(s) = step_at(&mut page.draft.steps, &path) {
                s.full_page = b;
            }
            Task::none()
        }
        Msg::Move(path, dir) => {
            let (parent, i) = match path.split_last() {
                Some((i, rest)) => (rest.to_vec(), *i),
                None => return Task::none(),
            };
            if let Some(siblings) = vec_at(&mut page.draft.steps, &parent) {
                let j = i as isize + dir as isize;
                if j >= 0 && (j as usize) < siblings.len() {
                    siblings.swap(i, j as usize);
                }
            }
            Task::none()
        }
        Msg::DelStep(path) => {
            let (parent, i) = match path.split_last() {
                Some((i, rest)) => (rest.to_vec(), *i),
                None => return Task::none(),
            };
            if let Some(siblings) = vec_at(&mut page.draft.steps, &parent) {
                if i < siblings.len() {
                    siblings.remove(i);
                }
            }
            Task::none()
        }
        Msg::PickNew(action) => {
            page.new_pick = Some(action);
            Task::none()
        }
        Msg::Add(at) => {
            let Some(action) = page.new_pick.clone() else { return Task::none() };
            if action.trim().is_empty() {
                return Task::none();
            }
            let mut step = Step::new(&action);
            match action.as_str() {
                "wait" => step.value = Some("500".into()),
                "repeat" => step.times = Some("2".into()),
                "goto" => step.value = Some(page.draft.url.clone()),
                "press_key" => step.value = Some("Enter".into()),
                _ => {}
            }
            if at.is_empty() {
                page.draft.steps.push(step);
            } else if let Some(s) = step_at(&mut page.draft.steps, &at) {
                s.children.get_or_insert_with(Vec::new).push(step);
            }
            Task::none()
        }
        Msg::Grab(at) => {
            // La grabación real la hace la barra del browser (__yattRecord →
            // action_captured); acá solo marcamos dónde insertar el paso.
            page.grab = Some(at);
            sh.log("grabando en este nivel: usá la barra del browser");
            Task::none()
        }
        Msg::StopGrab => {
            page.grab = None;
            sh.log("grabación detenida".to_string());
            Task::none()
        }
        Msg::Captured(_) => Task::none(), // llega por Page::captured (evento del sidecar)
        Msg::VarName(i, v) => {
            if let Some(var) = page.draft.variables.get_mut(i) {
                var.name = v;
            }
            Task::none()
        }
        Msg::VarValue(i, v) => {
            if let Some(var) = page.draft.variables.get_mut(i) {
                var.value = if v.is_empty() { None } else { Some(v) };
            }
            Task::none()
        }
        Msg::VarAdd => {
            page.draft.variables.push(doc::YattVariable::new("nueva"));
            Task::none()
        }
        Msg::VarDel(i) => {
            if i < page.draft.variables.len() {
                page.draft.variables.remove(i);
            }
            Task::none()
        }
        Msg::DsColumns(v) => {
            page.ds_columns_text = v.clone();
            let cols: Vec<String> = v.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
            let ds = page.draft.dataset.get_or_insert_with(Default::default);
            ds.columns = cols;
            Task::none()
        }
        Msg::DsCell(row, col_name, value) => {
            if let Some(ds) = page.draft.dataset.as_mut() {
                if let Some(r) = ds.rows.get_mut(row) {
                    r.cells.insert(col_name, value);
                }
            }
            Task::none()
        }
        Msg::DsRowAdd => {
            page.draft.dataset.get_or_insert_with(Default::default).rows.push(Default::default());
            Task::none()
        }
        Msg::DsRowDel(i) => {
            if let Some(ds) = page.draft.dataset.as_mut() {
                if i < ds.rows.len() {
                    ds.rows.remove(i);
                }
            }
            Task::none()
        }
        Msg::SetCsvPath(v) => {
            page.csv_path = v;
            Task::none()
        }
        Msg::CsvImport => {
            let parsed = std::fs::read_to_string(&page.csv_path).map_err(|e| e.to_string()).and_then(|content| {
                let table = doc::parse_csv(&content);
                if table.len() < 2 {
                    Err("el CSV necesita encabezado y al menos una fila".to_string())
                } else {
                    Ok(table)
                }
            });
            match parsed {
                Ok(table) => {
                    let (header, rows) = table.split_first().expect("len >= 2");
                    let ds = page.draft.dataset.get_or_insert_with(Default::default);
                    ds.columns = header.clone();
                    ds.rows = rows
                        .iter()
                        .map(|row| doc::DatasetRow {
                            cells: header
                                .iter()
                                .zip(row.iter())
                                .filter(|(h, _)| !h.is_empty())
                                .map(|(h, v)| (h.clone(), v.clone()))
                                .collect(),
                        })
                        .collect();
                    page.notice = Some(format!("dataset importado: {} filas", ds.rows.len()));
                }
                Err(e) => page.error = Some(e),
            }
            Task::none()
        }
        Msg::PickExport(v) => {
            page.export_fmt = Some(v);
            Task::none()
        }
        Msg::Export => {
            let fmt = page.export_fmt.clone().unwrap_or_else(|| "playwright".into());
            let Some(store) = sh.store() else {
                page.error = Some("sin base de datos".into());
                return Task::none();
            };
            match crate::export::build_spec(store, &page.draft, &fmt) {
                Ok(spec) => match store.export_save(&format!("{}.spec.ts", page.draft.name), &spec) {
                    Ok(path) => {
                        page.notice = Some(format!("exportado a {}", path.display()));
                        page.error = None;
                    }
                    Err(e) => page.error = Some(e),
                },
                Err(e) => page.error = Some(e),
            }
            Task::none()
        }
        Msg::Save => {
            let Some(store) = sh.store() else {
                page.error = Some("sin base de datos".into());
                return Task::none();
            };
            if page.draft.name.trim().is_empty() {
                page.error = Some("el test necesita nombre".into());
                return Task::none();
            }
            let json = match serde_json::to_string_pretty(&page.draft) {
                Ok(j) => j,
                Err(e) => {
                    page.error = Some(e.to_string());
                    return Task::none();
                }
            };
            match store.test_save(&page.draft.name, &json) {
                Ok(()) => {
                    if let Some(orig) = &page.original {
                        if orig != &page.draft.name {
                            let _ = store.test_delete(orig);
                        }
                    }
                    page.original = Some(page.draft.name.clone());
                    page.notice = Some("guardado".into());
                    page.error = None;
                    sh.log(format!("test guardado: {}", page.draft.name));
                }
                Err(e) => page.error = Some(e),
            }
            page.refresh(sh);
            Task::none()
        }
        Msg::Abrir => {
            let bridge = sh.bridge.clone();
            let url = page.draft.url.clone();
            cosmic::task::future(async move {
                let r = bridge.request("open", serde_json::json!({ "url": url, "headless": false })).await;
                Message::Tests(Msg::Abierto(r))
            })
        }
        Msg::Cerrar => {
            let bridge = sh.bridge.clone();
            cosmic::task::future(async move {
                let r = bridge.request("close", serde_json::json!({})).await;
                Message::Tests(Msg::Cerrado(r))
            })
        }
        Msg::Abierto(Ok(_)) => {
            sh.log("browser abierto");
            preview_task(sh)
        }
        Msg::Abierto(Err(e)) => {
            page.error = Some(e);
            Task::none()
        }
        Msg::Cerrado(Ok(_)) => {
            page.preview = None;
            Task::none()
        }
        Msg::Cerrado(Err(e)) => {
            page.error = Some(e);
            Task::none()
        }
        Msg::PreviewGot(Ok(v)) => {
            page.preview = crate::runner::decode_preview(&v);
            Task::none()
        }
        Msg::PreviewGot(Err(_)) => {
            page.preview = None;
            Task::none()
        }
        Msg::SesName(v) => {
            page.ses_name = v;
            Task::none()
        }
        Msg::SesSave => {
            let bridge = sh.bridge.clone();
            let name = page.ses_name.clone();
            cosmic::task::future(async move {
                let r = bridge.request("session_save", serde_json::json!({ "name": name })).await;
                Message::Tests(Msg::SesSaved(r))
            })
        }
        Msg::SesSaved(Ok(_)) => {
            page.notice = Some("sesión guardada".into());
            sh.log("sesión guardada");
            Task::none()
        }
        Msg::SesSaved(Err(e)) => {
            page.error = Some(e);
            Task::none()
        }
    }
}

fn preview_task(sh: &Shared) -> Task<Message> {
    let bridge = sh.bridge.clone();
    cosmic::task::future(async move {
        let r = bridge.request("preview", serde_json::json!({})).await;
        Message::Tests(Msg::PreviewGot(r))
    })
}

pub fn view<'a>(page: &'a Page, sh: &'a Shared) -> cosmic::Element<'a, Message> {
    match page.mode {
        Mode::List => list_view(page),
        Mode::Editor => editor_view(page, sh),
    }
}

/// Detalle del paso sin repetir la etiqueta de la acción.
fn step_detail(step: &Step) -> String {
    let d = doc::describe_step(step);
    let label = doc::action_label(&step.action);
    match d.strip_prefix(label) {
        Some(rest) => rest.trim_start().to_string(),
        None => d,
    }
}

/// Número de orden jerárquico ("2", "1.3"): es el orden real de ejecución.
fn step_number(path: &[usize]) -> String {
    path.iter().map(|p| (p + 1).to_string()).collect::<Vec<_>>().join(".")
}

fn list_view(page: &Page) -> cosmic::Element<'_, Message> {
    let mut col = widget::column::with_capacity(page.names.len() + 3).spacing(12).padding(16);
    col = col.push(widget::row::with_capacity(3)
        .push(widget::container(widget::text::title2("Tests")).width(cosmic::iced::Length::Fill))
        .push(crate::pages::ibtn(cosmic::theme::Button::Suggested, "plus", "Nuevo test", Some(Message::Tests(Msg::New))))
        .spacing(8));
    if page.names.is_empty() {
        col = col.push(card(widget::text::body("biblioteca vacía — creá un test y grabá pasos")));
    } else {
        let mut rows = widget::column::with_capacity(page.names.len()).spacing(8);
        for name in &page.names {
            rows = rows.push(widget::row::with_capacity(3)
                .push(widget::container(mono(name)).width(cosmic::iced::Length::Fill))
                .push(crate::pages::tbtn("edit", "Editar", Some(Message::Tests(Msg::Open(name.clone())))))
                .push(widget::button::destructive("Borrar").on_press(Message::Tests(Msg::Delete(name.clone()))))
                .spacing(8));
        }
        col = col.push(card(rows));
    }
    if let Some(e) = &page.error {
        col = col.push(widget::text(e.clone()));
    }
    widget::scrollable(col).into()
}

fn editor_view<'a>(page: &'a Page, sh: &'a Shared) -> cosmic::Element<'a, Message> {
    let mut col = widget::column::with_capacity(8).spacing(12).padding(16);

    // ── Cabecera del test ──
    let header = widget::column::with_capacity(3).spacing(8)
        .push(widget::row::with_capacity(4)
            .push(crate::pages::tbtn("go-previous", "Volver", Some(Message::Tests(Msg::Back))))
            .push(text_input("nombre del test", &page.draft.name).on_input(|v| Message::Tests(Msg::SetName(v))).size(13))
            .push(crate::pages::ibtn(cosmic::theme::Button::Suggested, "save", "Guardar", Some(Message::Tests(Msg::Save))))
            .spacing(8))
        .push(widget::row::with_capacity(5)
            .push(text_input("url inicial", &page.draft.url).on_input(|v| Message::Tests(Msg::SetUrl(v))).size(13).width(300))
            .push(widget::checkbox(page.draft.headless).label("headless").on_toggle(|b| Message::Tests(Msg::ToggleHeadless(b))))
            .push(crate::pages::pick(
                &EXPORT_FORMATS,
                page.export_fmt.as_deref(),
                |v| match v {
                    Some(f) => Message::Tests(Msg::PickExport(f)),
                    None => Message::Noop,
                },
            ))
            .push(crate::pages::tbtn("export", "Exportar", Some(Message::Tests(Msg::Export))))
            .spacing(8));
    col = col.push(card(header));

    if let Some(n) = &page.notice {
        col = col.push(mono(n));
    }
    if let Some(e) = &page.error {
        col = col.push(widget::container(widget::text(e.clone()).size(12)).style(|_| widget::container::Style {
            text_color: Some(cosmic::iced::Color::from_rgb(0.75, 0.23, 0.16)),
            ..Default::default()
        }));
    }

    // ── Browser / sesión / preview ──
    let mut browser = widget::column::with_capacity(4).spacing(8)
        .push(widget::text::title3("Browser"))
        .push(widget::row::with_capacity(6)
            .push(crate::pages::tbtn("globe", "Abrir", Some(Message::Tests(Msg::Abrir))))
            .push(crate::pages::tbtn("edit-delete", "Cerrar", sh.browser_open.then(|| Message::Tests(Msg::Cerrar))))
            .push(mono(format!("pestañas: {}", sh.tabs_n)))
            .push(text_input("nombre de sesión", &page.ses_name).on_input(|v| Message::Tests(Msg::SesName(v))).size(13).width(160))
            .push(crate::pages::tbtn("save", "Guardar sesión", sh.browser_open.then(|| Message::Tests(Msg::SesSave))))
            .spacing(8));
    if let Some(handle) = &page.preview {
        browser = browser.push(widget::image(handle).height(cosmic::iced::Length::Fixed(200.0)));
    }
    col = col.push(card(browser));

    // ── Pasos (la cinta numerada) ──
    let mut pasos = widget::column::with_capacity(6).spacing(8)
        .push(widget::row::with_capacity(3)
            .push(widget::container(widget::text::title3("Pasos")).width(cosmic::iced::Length::Fill))
            .push(mono(format!("{} en total", page.draft.steps.len())))
            .spacing(8));
    if page.grab.is_some() {
        pasos = pasos.push(widget::container(widget::row::with_capacity(3)
            .push(widget::text("● grabando en este nivel — elegí una acción en la barra del browser y hacé clic en el elemento").size(12))
            .push(widget::Space::new().width(cosmic::iced::Length::Fill))
            .push(crate::pages::tbtn("stop", "Detener grabación", Some(Message::Tests(Msg::StopGrab))))
            .spacing(8))
            .padding([6, 10])
            .style(|_| widget::container::Style {
                text_color: Some(cosmic::iced::Color::from_rgb(0.85, 0.55, 0.05)),
                border: cosmic::iced::Border {
                    radius: 6.0.into(),
                    width: 1.0,
                    color: cosmic::iced::Color::from_rgb(0.85, 0.55, 0.05),
                },
                ..Default::default()
            }));
    }
    pasos = pasos.push(steps_view(page, sh, &[], &page.draft.steps));
    pasos = pasos.push(add_row(page, sh, &[]));
    col = col.push(card(pasos));

    // ── Variables ──
    let mut vars_card = widget::column::with_capacity(page.draft.variables.len() + 4).spacing(8)
        .push(widget::text::title3("Variables"));
    for (i, var) in page.draft.variables.iter().enumerate() {
        vars_card = vars_card.push(widget::row::with_capacity(4)
            .push(text_input("nombre", &var.name).on_input(move |v| Message::Tests(Msg::VarName(i, v))).size(13))
            .push(text_input("valor por defecto", var.value.as_deref().unwrap_or("")).on_input(move |v| Message::Tests(Msg::VarValue(i, v))).size(13))
            .push(widget::button::destructive("✕").on_press(Message::Tests(Msg::VarDel(i))))
            .spacing(8));
    }
    vars_card = vars_card.push(widget::row::with_capacity(4)
        .push(crate::pages::tbtn("plus", "Agregar variable", Some(Message::Tests(Msg::VarAdd))))
        .push(widget::text::body("entornos"))
        .push(text_input("prod, staging", &page.envs_text).on_input(|v| Message::Tests(Msg::SetEnvs(v))).size(13))
        .spacing(8));
    col = col.push(card(vars_card));

    // ── Dataset ──
    let mut ds_card = widget::column::with_capacity(8).spacing(8).push(widget::text::title3("Dataset"));
    if let Some(ds) = &page.draft.dataset {
        ds_card = ds_card.push(text_input("columnas (separadas por comas)", &page.ds_columns_text).on_input(|v| Message::Tests(Msg::DsColumns(v))).size(13));
        for (ri, row) in ds.rows.iter().enumerate() {
            let mut r = widget::row::with_capacity(ds.columns.len() + 1).spacing(6);
            for c in &ds.columns {
                let value = row.cells.get(c).map(String::as_str).unwrap_or("");
                r = r.push(text_input(c, value).on_input(move |v| Message::Tests(Msg::DsCell(ri, c.clone(), v))).size(13));
            }
            r = r.push(widget::button::destructive("✕").on_press(Message::Tests(Msg::DsRowDel(ri))));
            ds_card = ds_card.push(r);
        }
        ds_card = ds_card.push(crate::pages::tbtn("plus", "Agregar fila", Some(Message::Tests(Msg::DsRowAdd))));
    } else {
        ds_card = ds_card.push(widget::text::body("sin dataset — importá un CSV o agregá columnas para activarlo"));
    }
    ds_card = ds_card.push(widget::row::with_capacity(3)
        .push(text_input("ruta del CSV", &page.csv_path).on_input(|v| Message::Tests(Msg::SetCsvPath(v))).size(13).width(340))
        .push(crate::pages::tbtn("folder", "Importar CSV", Some(Message::Tests(Msg::CsvImport))))
        .spacing(8));
    col = col.push(card(ds_card));

    widget::scrollable(col).into()
}

fn add_row<'a>(page: &'a Page, sh: &'a Shared, at: &[usize]) -> cosmic::Element<'a, Message> {
    let grabbing = page.grab.as_deref() == Some(at);
    let mut row = widget::row::with_capacity(4).spacing(8);
    row = row.push(crate::pages::pick(
        doc::ACTIONS,
        page.new_pick.as_deref(),
        |v| match v {
            Some(a) => Message::Tests(Msg::PickNew(a)),
            None => Message::Noop,
        },
    ));
    row = row.push(crate::pages::tbtn("plus", "Agregar paso", Some(Message::Tests(Msg::Add(at.to_vec())))));
    if !grabbing {
        row = row.push(crate::pages::tbtn("record", "Grabar acá", sh.browser_open.then(|| Message::Tests(Msg::Grab(at.to_vec())))));
    }
    row.into()
}

fn steps_view<'a>(page: &'a Page, sh: &'a Shared, prefix: &[usize], steps: &'a [Step]) -> cosmic::Element<'a, Message> {
    let mut col = widget::column::with_capacity(steps.len() * 3).spacing(6);
    for (i, step) in steps.iter().enumerate() {
        let path: Vec<usize> = prefix.iter().copied().chain(std::iter::once(i)).collect();
        let expanded = page.open.contains(&path);

        let mut row = widget::row::with_capacity(8).spacing(6);
        let arrow = if expanded { "pan-down-symbolic" } else { "pan-end-symbolic" };
        row = row.push(widget::button::icon(crate::pages::svg_icon(arrow)).on_press(Message::Tests(Msg::ToggleExpand(path.clone()))));
        row = row.push(widget::container(mono(step_number(&path))).width(30));
        row = row.push(widget::container(widget::text(doc::action_label(&step.action)).size(13)).width(150));
        let detail = step_detail(step);
        if !detail.is_empty() {
            row = row.push(mono(detail));
        }
        row = row.push(widget::Space::new().width(cosmic::iced::Length::Fill));
        row = row.push(widget::button::icon(crate::pages::svg_icon("go-up")).on_press(Message::Tests(Msg::Move(path.clone(), -1))));
        row = row.push(widget::button::icon(crate::pages::svg_icon("go-down")).on_press(Message::Tests(Msg::Move(path.clone(), 1))));
        row = row.push(widget::button::icon(crate::pages::svg_icon("edit-delete")).on_press(Message::Tests(Msg::DelStep(path.clone()))));
        if step.disabled {
            row = row.push(widget::text("(inhabilitado)").size(11));
        }
        col = col.push(row);

        if page.grab.as_deref() == Some(path.as_slice()) {
            col = col.push(mono("● grabando en este nivel — usá la barra del browser"));
        }

        if expanded {
            let mut panel = widget::column::with_capacity(6).spacing(6);
            for f in fields_for(&step.action) {
                let p = path.clone();
                let value = if *f == Field::WithVars {
                    page.withvars.get(&path).map(String::as_str).unwrap_or("")
                } else {
                    field_ref(step, *f)
                };
                panel = panel.push(text_input(f.placeholder(), value)
                    .on_input(move |v| Message::Tests(Msg::Field(p.clone(), *f, v)))
                    .size(13));
            }
            if step.action == "capture_screenshot" || step.action == "assert_screenshot" {
                let p = path.clone();
                panel = panel.push(widget::checkbox(step.full_page).label("página completa").on_toggle(move |b| Message::Tests(Msg::SetFullPage(p.clone(), b))));
            }
            col = col.push(widget::container(panel).padding([0, 0, 0, 30]));

            if step.is_container() {
                col = col.push(widget::container(steps_view(page, sh, &path, step.children())).padding([0, 0, 0, 26]));
                col = col.push(widget::container(add_row(page, sh, &path)).padding([0, 0, 0, 26]));
            }
        }
    }
    col.into()
}
