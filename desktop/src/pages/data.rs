//! Datos: consulta SQL de solo lectura, sesiones guardadas e imágenes base.

use crate::app::Message;
use crate::pages::Shared;
use cosmic::app::Task;
use cosmic::widget::{self, text_input};
use serde_json::Value;

pub struct Page {
    pub sql: String,
    pub cols: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub sessions: Vec<String>,
    pub baselines: Vec<String>,
    pub error: Option<String>,
    pub notice: Option<String>,
    pub ses_name: String,
}

impl Default for Page {
    fn default() -> Self {
        Page {
            sql: "SELECT * FROM tests".into(),
            cols: Vec::new(),
            rows: Vec::new(),
            sessions: Vec::new(),
            baselines: Vec::new(),
            error: None,
            notice: None,
            ses_name: String::new(),
        }
    }
}

#[derive(Clone, Debug)]
pub enum Msg {
    Refresh,
    SetSql(String),
    Query,
    Queried(Result<(Vec<String>, Vec<Vec<String>>), String>),
    Sessions(Result<Vec<String>, String>),
    SessionDelete(String),
    BaselineDelete(String),
    SesName(String),
    SesSave,
    SesSaved(Result<Value, String>),
}

impl Page {
    pub fn refresh(&mut self, sh: &mut Shared) -> Task<Message> {
        self.baselines = sh
            .store()
            .map(|s| s.baseline_list())
            .unwrap_or_else(|| Ok(Vec::new()))
            .unwrap_or_default();
        let bridge = sh.bridge.clone();
        cosmic::task::future(async move {
            let r = bridge.request("session_list", serde_json::json!({})).await;
            match r {
                Ok(v) => {
                    let names = v
                        .as_array()
                        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                        .unwrap_or_default();
                    Message::Datos(Msg::Sessions(Ok(names)))
                }
                Err(e) => Message::Datos(Msg::Sessions(Err(e))),
            }
        })
    }
}

fn cell(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

pub fn update(page: &mut Page, sh: &mut Shared, msg: Msg) -> Task<Message> {
    match msg {
        Msg::Refresh => page.refresh(sh),
        Msg::SetSql(sql) => {
            page.sql = sql;
            Task::none()
        }
        Msg::Query => {
            let bridge = sh.bridge.clone();
            let sql = page.sql.clone();
            cosmic::task::future(async move {
                let r = bridge.request("db_query", serde_json::json!({ "sql": sql })).await;
                match r {
                    Ok(res) => {
                        let cols = res
                            .get("columns")
                            .and_then(|c| c.as_array())
                            .map(|a| a.iter().map(|v| v.as_str().unwrap_or("?").to_string()).collect())
                            .unwrap_or_default();
                        let rows = res
                            .get("rows")
                            .and_then(|r| r.as_array())
                            .map(|a| {
                                a.iter()
                                    .map(|row| {
                                        row.as_array()
                                            .map(|c| c.iter().map(cell).collect())
                                            .unwrap_or_default()
                                    })
                                    .collect()
                            })
                            .unwrap_or_default();
                        Message::Datos(Msg::Queried(Ok((cols, rows))))
                    }
                    Err(e) => Message::Datos(Msg::Queried(Err(e))),
                }
            })
        }
        Msg::Queried(Ok((cols, rows))) => {
            page.cols = cols;
            page.rows = rows;
            page.error = None;
            Task::none()
        }
        Msg::Queried(Err(e)) => {
            page.error = Some(e);
            Task::none()
        }
        Msg::Sessions(Ok(names)) => {
            page.sessions = names;
            Task::none()
        }
        Msg::Sessions(Err(e)) => {
            page.error = Some(e);
            Task::none()
        }
        Msg::SessionDelete(name) => {
            let bridge = sh.bridge.clone();
            cosmic::task::future(async move {
                let _ = bridge.request("session_delete", serde_json::json!({ "name": name })).await;
                Message::Datos(Msg::Refresh)
            })
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
                Message::Datos(Msg::SesSaved(r))
            })
        }
        Msg::SesSaved(Ok(_)) => {
            page.notice = Some("sesión guardada".into());
            page.refresh(sh)
        }
        Msg::SesSaved(Err(e)) => {
            page.error = Some(e);
            Task::none()
        }
        Msg::BaselineDelete(name) => {
            if let Some(store) = sh.store() {
                if let Err(e) = store.baseline_delete(&name) {
                    page.error = Some(e);
                }
            }
            page.baselines = sh
                .store()
                .map(|s| s.baseline_list())
                .unwrap_or_else(|| Ok(Vec::new()))
                .unwrap_or_default();
            Task::none()
        }
    }
}

pub fn view<'a>(page: &'a Page, _sh: &'a Shared) -> cosmic::Element<'a, Message> {
    let mut col = widget::column::with_capacity(10).spacing(10).padding(12);
    col = col.push(widget::text::title3("Datos"));

    // --- Consulta SQL ---
    col = col.push(widget::text::body("Consulta de solo lectura contra yatt.db (misma base que usan los pasos db_*)"));
    col = col.push(widget::row::with_capacity(2)
        .push(text_input("SELECT ...", &page.sql).on_input(|v| Message::Datos(Msg::SetSql(v))).size(13).width(cosmic::iced::Length::Fill))
        .push(widget::button::standard("Consultar").on_press(Message::Datos(Msg::Query)))
        .spacing(8));
    if !page.cols.is_empty() {
        let mut table = widget::column::with_capacity(page.rows.len() + 1).spacing(2);
        let mut header = widget::row::with_capacity(page.cols.len());
        for c in &page.cols {
            header = header.push(widget::container(widget::text(c.clone())).width(160));
        }
        table = table.push(header);
        for row in page.rows.iter().take(50) {
            let mut r = widget::row::with_capacity(row.len());
            for c in row {
                r = r.push(widget::container(widget::text(c.clone()).size(12)).width(160));
            }
            table = table.push(r);
        }
        col = col.push(widget::scrollable(table).height(cosmic::iced::Length::Fixed(220.0)));
        if page.rows.len() > 50 {
            col = col.push(widget::text::body(format!("(mostrando 50 de {} filas)", page.rows.len())));
        }
    }

    col = col.push(widget::divider::horizontal::default());

    // --- Sesiones ---
    col = col.push(widget::text::body("Sesiones (cookies + localStorage)"));
    col = col.push(widget::row::with_capacity(3)
        .push(text_input("nombre de sesión", &page.ses_name).on_input(|v| Message::Datos(Msg::SesName(v))).size(13).width(200))
        .push(widget::button::standard("Guardar sesión actual").on_press(Message::Datos(Msg::SesSave)))
        .spacing(8));
    if page.sessions.is_empty() {
        col = col.push(widget::text::body("ninguna sesión guardada"));
    }
    for s in &page.sessions {
        col = col.push(widget::row::with_capacity(2)
            .push(widget::text(s.clone()))
            .push(crate::pages::tbtn("edit-delete", "Borrar", Some(Message::Datos(Msg::SessionDelete(s.clone())))))
            .spacing(8));
    }

    col = col.push(widget::divider::horizontal::default());

    // --- Bases de asserts visuales ---
    col = col.push(widget::text::body("Imágenes base de asserts visuales"));
    if page.baselines.is_empty() {
        col = col.push(widget::text::body("ninguna imagen base"));
    }
    for b in &page.baselines {
        col = col.push(widget::row::with_capacity(2)
            .push(widget::text(b.clone()))
            .push(crate::pages::tbtn("edit-delete", "Borrar", Some(Message::Datos(Msg::BaselineDelete(b.clone())))))
            .spacing(8));
    }

    if let Some(e) = &page.error {
        col = col.push(widget::text(e.clone()));
    }
    if let Some(n) = &page.notice {
        col = col.push(widget::text(n.clone()));
    }
    col.into()
}
