//! Reportes: lista + abrir con el SO + borrar.

use crate::app::Message;
use crate::pages::Shared;
use cosmic::app::Task;
use cosmic::widget::{self, text_input};

pub struct Page {
    pub names: Vec<String>,
    pub error: Option<String>,
}

impl Default for Page {
    fn default() -> Self {
        Page { names: Vec::new(), error: None }
    }
}

#[derive(Clone, Debug)]
pub enum Msg {
    Refresh,
    Open(String),
    Delete(String),
}

impl Page {
    pub fn refresh(&mut self, sh: &mut Shared) {
        self.names = sh.store().map(|s| s.report_list()).unwrap_or_else(|| Ok(Vec::new())).unwrap_or_default();
    }
}

pub fn update(page: &mut Page, sh: &mut Shared, msg: Msg) -> Task<Message> {
    match msg {
        Msg::Refresh => {
            page.refresh(sh);
            Task::none()
        }
        Msg::Open(name) => match sh.store().map(|s| s.report_path(&name)) {
            Some(Ok(path)) => {
                // xdg-open: proceso de vida corta, fire and forget.
                let _ = std::process::Command::new("xdg-open").arg(&path).spawn();
                sh.log(format!("abriendo reporte {}", path.display()));
                Task::none()
            }
            Some(Err(e)) => {
                page.error = Some(e);
                Task::none()
            }
            None => {
                page.error = Some("sin base de datos".into());
                Task::none()
            }
        },
        Msg::Delete(name) => {
            if let Some(store) = sh.store() {
                if let Err(e) = store.report_delete(&name) {
                    page.error = Some(e);
                }
            }
            page.refresh(sh);
            Task::none()
        }
    }
}

pub fn view<'a>(page: &'a Page, _sh: &'a Shared) -> cosmic::Element<'a, Message> {
    let mut col = widget::column::with_capacity(page.names.len() + 3).spacing(6).padding(12);
    col = col.push(widget::text::title3("Reportes"));
    if page.names.is_empty() {
        col = col.push(widget::text::body("todavía no hay corridas — ejecutá un test en «Correr»"));
    }
    for name in &page.names {
        col = col.push(widget::row::with_capacity(3)
            .push(text_input("", name).size(13)) // solo lectura visual; el nombre es largo
            .push(widget::button::standard("Abrir").on_press(Message::Reports(Msg::Open(name.clone()))))
            .push(crate::pages::tbtn("edit-delete", "Borrar", Some(Message::Reports(Msg::Delete(name.clone())))))
            .spacing(8));
    }
    if let Some(e) = &page.error {
        col = col.push(widget::text(e.clone()));
    }
    col.into()
}
