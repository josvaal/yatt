//! Ajustes: entornos (variables por entorno), browser, viewport, tz, geo y sesión.

use crate::app::Message;
use crate::pages::{card, Shared};
use cosmic::app::Task;
use cosmic::widget::{self, text_input};
use std::collections::BTreeMap;

const BROWSERS: &[&str] = &["chromium", "firefox", "webkit"];

pub struct Page {
    pub draft: crate::store::Settings,
    pub envs: Vec<String>,
    pub env_sel: Option<String>,
    pub new_env: String,
    pub var_name: String,
    pub var_value: String,
    pub viewport_w: String,
    pub viewport_h: String,
    pub timezone: String,
    pub lat: String,
    pub lon: String,
    pub session: String,
    pub browser_sel: Option<String>,
    pub notice: Option<String>,
    pub error: Option<String>,
}

impl Default for Page {
    fn default() -> Self {
        Page {
            draft: Default::default(),
            envs: Vec::new(),
            env_sel: None,
            new_env: String::new(),
            var_name: String::new(),
            var_value: String::new(),
            viewport_w: String::new(),
            viewport_h: String::new(),
            timezone: String::new(),
            lat: String::new(),
            lon: String::new(),
            session: String::new(),
            browser_sel: None,
            notice: None,
            error: None,
        }
    }
}

#[derive(Clone, Debug)]
pub enum Msg {
    Noop,
    SelectEnv(Option<String>),
    NewEnv(String),
    AddEnv,
    DelEnv,
    VarName(String),
    VarValue(String),
    /// Edita el valor de una variable existente (por nombre).
    VarValue2(String, String),
    AddVar,
    DelVar(String),
    Browser(Option<String>),
    ViewportW(String),
    ViewportH(String),
    Timezone(String),
    Lat(String),
    Lon(String),
    Session(String),
    Save,
}

impl Page {
    pub fn refresh(&mut self, sh: &mut Shared) {
        self.draft = sh.settings.clone();
        self.envs = sh.env_names();
        self.env_sel = self.draft.active_env.clone();
        self.browser_sel = self.draft.browser.clone().or(Some("chromium".into()));
        self.viewport_w = self.draft.viewport_width.map(|v| v.to_string()).unwrap_or_default();
        self.viewport_h = self.draft.viewport_height.map(|v| v.to_string()).unwrap_or_default();
        self.timezone = self.draft.timezone_id.clone().unwrap_or_default();
        self.lat = self.draft.geo_lat.map(|v| v.to_string()).unwrap_or_default();
        self.lon = self.draft.geo_lon.map(|v| v.to_string()).unwrap_or_default();
        self.session = self.draft.session.clone().unwrap_or_default();
        self.notice = None;
        self.error = None;
    }
}

fn opt_parse_u32(s: &str) -> Option<u32> {
    s.trim().parse().ok()
}

fn opt_parse_f64(s: &str) -> Option<f64> {
    s.trim().parse().ok()
}

pub fn update(page: &mut Page, sh: &mut Shared, msg: Msg) -> Task<Message> {
    match msg {
        Msg::Noop => Task::none(),
        Msg::SelectEnv(env) => {
            page.env_sel = env;
            Task::none()
        }
        Msg::NewEnv(name) => {
            page.new_env = name;
            Task::none()
        }
        Msg::AddEnv => {
            let name = crate::store::sanitize(&page.new_env).unwrap_or_default();
            if !name.is_empty() && !page.draft.envs.contains_key(&name) {
                page.draft.envs.insert(name.clone(), BTreeMap::new());
                page.env_sel = Some(name);
                page.new_env.clear();
            }
            Task::none()
        }
        Msg::DelEnv => {
            if let Some(env) = page.env_sel.clone() {
                page.draft.envs.remove(&env);
                if page.draft.active_env.as_deref() == Some(env.as_str()) {
                    page.draft.active_env = None;
                }
                page.env_sel = None;
            }
            Task::none()
        }
        Msg::VarName(name) => {
            page.var_name = name;
            Task::none()
        }
        Msg::VarValue(value) => {
            page.var_value = value;
            Task::none()
        }
        Msg::VarValue2(name, value) => {
            if let Some(env) = page.env_sel.clone() {
                page.draft.envs.entry(env).or_default().insert(name, value);
            }
            Task::none()
        }
        Msg::AddVar => {
            if let Some(env) = page.env_sel.clone() {
                if let Ok(name) = crate::store::sanitize(&page.var_name) {
                    page.draft.envs.entry(env).or_default().insert(name, page.var_value.clone());
                    page.var_name.clear();
                    page.var_value.clear();
                }
            }
            Task::none()
        }
        Msg::DelVar(name) => {
            if let Some(env) = page.env_sel.clone() {
                page.draft.envs.entry(env).or_default().remove(&name);
            }
            Task::none()
        }
        Msg::Browser(b) => {
            page.browser_sel = b.clone();
            page.draft.browser = b;
            Task::none()
        }
        Msg::ViewportW(w) => {
            page.viewport_w = w.clone();
            page.draft.viewport_width = opt_parse_u32(&w);
            Task::none()
        }
        Msg::ViewportH(h) => {
            page.viewport_h = h.clone();
            page.draft.viewport_height = opt_parse_u32(&h);
            Task::none()
        }
        Msg::Timezone(tz) => {
            page.timezone = tz.clone();
            page.draft.timezone_id = if tz.trim().is_empty() { None } else { Some(tz) };
            Task::none()
        }
        Msg::Lat(v) => {
            page.lat = v.clone();
            page.draft.geo_lat = opt_parse_f64(&v);
            Task::none()
        }
        Msg::Lon(v) => {
            page.lon = v.clone();
            page.draft.geo_lon = opt_parse_f64(&v);
            Task::none()
        }
        Msg::Session(s) => {
            page.session = s.clone();
            page.draft.session = if s.trim().is_empty() { None } else { Some(s) };
            Task::none()
        }
        Msg::Save => {
            page.draft.active_env = page.env_sel.clone();
            page.draft.browser = page.browser_sel.clone();
            page.draft.viewport_width = opt_parse_u32(&page.viewport_w);
            page.draft.viewport_height = opt_parse_u32(&page.viewport_h);
            page.draft.timezone_id = if page.timezone.trim().is_empty() { None } else { Some(page.timezone.clone()) };
            page.draft.geo_lat = opt_parse_f64(&page.lat);
            page.draft.geo_lon = opt_parse_f64(&page.lon);
            page.draft.session = if page.session.trim().is_empty() { None } else { Some(page.session.clone()) };
            match sh.store() {
                Some(store) => match store.settings_save(&page.draft) {
                    Ok(()) => {
                        sh.settings = page.draft.clone();
                        page.notice = Some("ajustes guardados".into());
                        page.error = None;
                    }
                    Err(e) => {
                        page.error = Some(e);
                        page.notice = None;
                    }
                },
                None => page.error = Some("sin base de datos".into()),
            }
            Task::none()
        }
    }
}

fn inp<'a>(placeholder: &'static str, value: &'a str, on_input: impl Fn(String) -> Msg + 'a) -> cosmic::Element<'a, Message> {
    text_input(placeholder, value)
        .on_input(move |v| Message::Ajustes(on_input(v)))
        .size(13)
        .into()
}

/// Campo con etiqueta arriba (estructura legible antes que el placeholder).
fn campo<'a>(label: &'static str, control: cosmic::Element<'a, Message>) -> cosmic::Element<'a, Message> {
    widget::column::with_capacity(2)
        .push(widget::text(label).size(11))
        .push(control)
        .spacing(2)
        .into()
}

pub fn view<'a>(page: &'a Page, _sh: &'a Shared) -> cosmic::Element<'a, Message> {
    let mut col = widget::column::with_capacity(6).spacing(12).padding(16);

    // ── Entornos y variables ──
    let mut ent = widget::column::with_capacity(8).spacing(10)
        .push(widget::text::title3("Entornos"))
        .push(widget::text::body("Valores por defecto de variables; la corrida elige cuál activar."));
    ent = ent.push(widget::row::with_capacity(5)
        .push(campo("entorno activo", crate::pages::pick(
            &page.envs,
            page.env_sel.as_deref(),
            move |v| Message::Ajustes(Msg::SelectEnv(v)),
        )))
        .push(campo("crear entorno", text_input("nuevo entorno", &page.new_env).on_input(|v| Message::Ajustes(Msg::NewEnv(v))).size(13).into()))
        .push(widget::row::with_capacity(2)
            .push(crate::pages::tbtn("plus", "Agregar", Some(Message::Ajustes(Msg::AddEnv))))
            .push(crate::pages::tbtn("edit-delete", "Borrar entorno", page.env_sel.as_ref().map(|_| Message::Ajustes(Msg::DelEnv))))
            .align_y(cosmic::iced::Alignment::Center)
            .spacing(8))
        .spacing(8));

    if let Some(env) = page.env_sel.clone() {
        let mut vars = widget::column::with_capacity(8).spacing(6);
        vars = vars.push(widget::text::body(format!("variables de «{env}»")));
        if let Some(map) = page.draft.envs.get(&env) {
            for (name, value) in map {
                vars = vars.push(cosmic::iced::widget::row::with_capacity(3)
                    .push(widget::container(crate::pages::mono(name)).width(140))
                    .push(text_input("valor", value).on_input(move |v| Message::Ajustes(Msg::VarValue2(name.clone(), v))).size(13))
                    .push(widget::button::icon(crate::pages::svg_icon("edit-delete")).on_press(Message::Ajustes(Msg::DelVar(name.clone()))))
                    .align_y(cosmic::iced::Alignment::Center)
                    .spacing(8));
            }
        }
        vars = vars.push(widget::row::with_capacity(4)
            .push(campo("nombre", text_input("nombre", &page.var_name).on_input(|v| Message::Ajustes(Msg::VarName(v))).size(13).into()))
            .push(campo("valor", text_input("valor", &page.var_value).on_input(|v| Message::Ajustes(Msg::VarValue(v))).size(13).into()))
            .push(widget::button::standard("Agregar variable").on_press_maybe(
                page.env_sel.as_ref().map(|_| Message::Ajustes(Msg::AddVar)),
            ))
            .align_y(cosmic::iced::Alignment::Center)
            .spacing(8));
        ent = ent.push(vars);
    } else {
        ent = ent.push(widget::text::body("sin entornos — creá uno para definir variables por defecto"));
    }
    col = col.push(card(ent));

    // ── Ejecución (browser del motor) ──
    let ejec = widget::column::with_capacity(6).spacing(10)
        .push(widget::text::title3("Ejecución"))
        .push(widget::row::with_capacity(3)
            .push(campo("browser", crate::pages::pick(
                BROWSERS,
                page.browser_sel.as_deref(),
                move |v| Message::Ajustes(Msg::Browser(v)),
            )))
            .push(campo("viewport — ancho", inp("960", &page.viewport_w, Msg::ViewportW)))
            .push(campo("viewport — alto", inp("600", &page.viewport_h, Msg::ViewportH)))
            .spacing(10))
        .push(widget::row::with_capacity(3)
            .push(campo("zona horaria", inp("America/Argentina/Buenos_Aires", &page.timezone, Msg::Timezone)))
            .push(campo("geo — latitud", inp("-34.6", &page.lat, Msg::Lat)))
            .push(campo("geo — longitud", inp("-58.4", &page.lon, Msg::Lon)))
            .spacing(10))
        .push(campo(
            "sesión inicial (cookies + localStorage)",
            text_input("(ninguna)", &page.session).on_input(|v| Message::Ajustes(Msg::Session(v))).size(13).into(),
        ));
    col = col.push(card(ejec));

    // ── Guardado ──
    let mut foot = widget::row::with_capacity(3).spacing(8)
        .push(crate::pages::ibtn(cosmic::theme::Button::Suggested, "save", "Guardar ajustes", Some(Message::Ajustes(Msg::Save))));
    if let Some(n) = &page.notice {
        foot = foot.push(crate::pages::mono(n));
    }
    if let Some(e) = &page.error {
        foot = foot.push(widget::container(widget::text(e.clone()).size(12)).style(|_| widget::container::Style {
            text_color: Some(cosmic::iced::Color::from_rgb(0.75, 0.23, 0.16)),
            ..Default::default()
        }));
    }
    col = col.push(foot);

    widget::scrollable(col).into()
}
