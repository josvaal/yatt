//! Pages of the COSMIC app: shared state + per-page modules.

pub mod data;
pub mod reports;
pub mod run;
pub mod settings;
pub mod tests;

use crate::bridge::Bridge;
use crate::store::{Settings, Store};
use cosmic::widget;
use std::collections::VecDeque;
use std::sync::Arc;

pub enum Motor {
    Arrancando,
    Activo,
    Apagado,
    Error(String),
}

/// State shared by every page (bridge, store, settings, global status).
pub struct Shared {
    pub bridge: Arc<Bridge>,
    pub store: Option<Arc<Store>>,
    pub settings: Settings,
    pub browser_open: bool,
    pub tabs_n: usize,
    pub motor: Motor,
    pub logs: VecDeque<String>,
}


/// Iconos simbólicos embebidos en el binario: no dependen de un tema del sistema.
const ICON_SVGS: &[(&str, &str)] = &[
    ("pan-end", r##"<svg width="16" height="16" viewBox="0 0 16 16"><path fill="#9a9da2" d="M6 3l6 5-6 5z"/></svg>"##),
    ("pan-down", r##"<svg width="16" height="16" viewBox="0 0 16 16"><path fill="#9a9da2" d="M3 6l5 6 5-6z"/></svg>"##),
    ("go-up", r##"<svg width="16" height="16" viewBox="0 0 16 16"><path fill="#9a9da2" d="M8 4l5 6H3z"/></svg>"##),
    ("go-down", r##"<svg width="16" height="16" viewBox="0 0 16 16"><path fill="#9a9da2" d="M8 12L3 6h10z"/></svg>"##),
    ("edit-delete", r##"<svg width="16" height="16" viewBox="0 0 16 16"><path fill="#9a9da2" d="M4 5.3 5.3 4 8 6.7 10.7 4 12 5.3 9.3 8l2.7 2.7-1.3 1.3L8 9.3 5.3 12 4 10.7 6.7 8z"/></svg>"##),
    ("plus", r##"<svg width="16" height="16" viewBox="0 0 16 16"><path fill="#9a9da2" d="M7 4h2v3h3v2H9v3H7V9H4V7h3z"/></svg>"##),
    ("save", r##"<svg width="16" height="16" viewBox="0 0 24 24"><path fill="#9a9da2" d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>"##),
    ("export", r##"<svg width="16" height="16" viewBox="0 0 16 16"><path fill="#9a9da2" d="M3 10v3h10v-3h-2v1H5v-1H3z"/><path fill="#9a9da2" d="M8 2l3 3H9v4H7V5H5l3-3z"/></svg>"##),
    ("globe", r##"<svg width="16" height="16" viewBox="0 0 16 16"><g fill="none" stroke="#9a9da2" stroke-width="1.2"><circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11"/><path d="M8 2.5c-3 3-3 8 0 11"/><path d="M8 2.5c3 3 3 8 0 11"/></g></svg>"##),
    ("stop", r##"<svg width="16" height="16" viewBox="0 0 16 16"><rect x="5" y="5" width="6" height="6" fill="#d9534f"/></svg>"##),
    ("play", r##"<svg width="16" height="16" viewBox="0 0 16 16"><path fill="#9a9da2" d="M6 3l7 5-7 5z"/></svg>"##),
    ("record", r##"<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.5" fill="#d9534f"/></svg>"##),
    ("magnifier", r##"<svg width="16" height="16" viewBox="0 0 16 16"><g fill="none" stroke="#9a9da2" stroke-width="1.3"><circle cx="7" cy="7" r="4"/><path d="M10.2 10.2L14 14"/></g></svg>"##),
    ("go-previous", r##"<svg width="16" height="16" viewBox="0 0 16 16"><path fill="#9a9da2" d="M11 3v10L5 8z"/></svg>"##),
    ("folder", r##"<svg width="16" height="16" viewBox="0 0 16 16"><path fill="#9a9da2" d="M2 4h4l1 2h7v6H2z"/></svg>"##),
    ("database", r##"<svg width="16" height="16" viewBox="0 0 16 16"><g fill="none" stroke="#9a9da2" stroke-width="1.2"><ellipse cx="8" cy="4.5" rx="5" ry="2"/><path d="M3 4.5v7c0 1.1 2.2 2 5 2s5-.9 5-2v-7"/><path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2"/></g></svg>"##),
    ("external-link", r##"<svg width="16" height="16" viewBox="0 0 16 16"><path fill="#9a9da2" d="M3 5v8h8V9h-1.5v2.5h-5V6.5H8V5H3z"/><path fill="#9a9da2" d="M9 2h5v5h-1.5V4.6L8.1 9.1 7 8l4.4-4.5H9V2z"/></svg>"##),
    ("sliders", r##"<svg width="16" height="16" viewBox="0 0 16 16"><g stroke="#9a9da2" stroke-width="1.3"><path d="M4 3v10M8 3v10M12 3v10"/></g><circle cx="4" cy="6" r="1.6" fill="#9a9da2"/><circle cx="8" cy="10" r="1.6" fill="#9a9da2"/><circle cx="12" cy="5" r="1.6" fill="#9a9da2"/></svg>"##),
    ("edit", r##"<svg width="16" height="16" viewBox="0 0 16 16"><path fill="#9a9da2" d="M11 2l3 3-8 8H3v-3z"/></svg>"##),
    ("tests", r##"<svg width="16" height="16" viewBox="0 0 16 16"><g fill="none" stroke="#9a9da2" stroke-width="1.2"><rect x="3" y="2.5" width="10" height="11" rx="1"/></g><path fill="#9a9da2" d="M5.5 6h5v1.2h-5zM5.5 8.5h5v1.2h-5zM5.5 11h3v1.2h-3z"/></svg>"##),
    ("chart", r##"<svg width="16" height="16" viewBox="0 0 16 16"><path fill="#9a9da2" d="M4 8h2v5H4zM7 5h2v8H7zM10 3h2v10h-2z"/></svg>"##),
];

pub fn svg_icon(name: &str) -> cosmic::widget::icon::Handle {
    let bytes = ICON_SVGS
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, s)| s.as_bytes().to_vec())
        .unwrap_or_default();
    cosmic::widget::icon::from_svg_bytes(bytes)
}

/// Botón estándar con icono embebido + texto (cosmic no expone .icon en texto).
pub fn tbtn<'a>(
    icon: &'static str,
    label: &'a str,
    on_press: Option<crate::app::Message>,
) -> cosmic::Element<'a, crate::app::Message> {
    let content = cosmic::iced::widget::row::with_capacity(2)
        .push(widget::icon::icon(svg_icon(icon)))
        .push(widget::text(label).size(13))
        .align_y(cosmic::iced::Alignment::Center)
        .spacing(6);
    let mut b = widget::button::custom(content).padding([5, 10]);
    if let Some(m) = on_press {
        b = b.on_press(m);
    }
    b.into()
}

/// CTA con clase cosmic (Suggested/Destructive) + icono + texto.
pub fn ibtn<'a>(
    class: cosmic::theme::Button,
    icon: &'static str,
    label: &'a str,
    on_press: Option<crate::app::Message>,
) -> cosmic::Element<'a, crate::app::Message> {
    let content = cosmic::iced::widget::row::with_capacity(2)
        .push(widget::icon::icon(svg_icon(icon)))
        .push(widget::text(label).size(13))
        .align_y(cosmic::iced::Alignment::Center)
        .spacing(6);
    let b = cosmic::widget::button::custom(content)
        .padding([5, 10])
        .on_press_maybe(on_press);
    let btn: cosmic::widget::Button<crate::app::Message> = b.into();
    btn.class(class).into()
}

/// Dropdown de strings (cosmic no tiene pick_list; mapea índice ↔ valor).
pub fn pick<'a, S: AsRef<str> + Clone + Send + Sync + 'static>(
    options: &'a [S],
    selected: Option<&str>,
    on_pick: impl Fn(Option<String>) -> crate::app::Message + Send + Sync + 'static,
) -> cosmic::Element<'a, crate::app::Message> {
    let idx = selected.and_then(|s| options.iter().position(|o| o.as_ref() == s));
    let owned: Vec<S> = options.to_vec();
    let captured = owned.clone();
    widget::dropdown(owned, idx, move |i| {
        on_pick(captured.get(i).map(|o| o.as_ref().to_string()))
    })
    .into()
}

impl Shared {
    pub fn log(&mut self, line: impl Into<String>) {
        self.logs.push_back(line.into());
        while self.logs.len() > 6 {
            self.logs.pop_front();
        }
    }

    pub fn store(&self) -> Option<&Arc<Store>> {
        self.store.as_ref()
    }

    pub fn env_names(&self) -> Vec<String> {
        self.settings.envs.keys().cloned().collect()
    }
}

/// Colored status chip (plain cosmic container, fixed colors).
pub fn status_chip(status: &str) -> cosmic::Element<'_, crate::app::Message> {
    let (label, color) = match status {
        "ok" => ("✓", cosmic::iced::Color::from_rgb(0.23, 0.61, 0.35)),
        "fail" => ("✗", cosmic::iced::Color::from_rgb(0.75, 0.23, 0.16)),
        "skipped" => ("—", cosmic::iced::Color::from_rgb(0.45, 0.47, 0.5)),
        _ => ("■", cosmic::iced::Color::from_rgb(0.85, 0.55, 0.05)),
    };
    widget::container(widget::text(label))
        .padding([1, 7])
        .style(move |_| widget::container::Style {
            text_color: Some(color),
            ..Default::default()
        })
        .into()
}

/// Texto "de test" (selectores, valores, detalles): tipografía mono del tema.
pub fn mono<'a>(text: impl std::fmt::Display) -> cosmic::widget::Text<'a, cosmic::Theme, cosmic::Renderer> {
    widget::text(text.to_string())
        .size(12)
        .font(cosmic::font::mono())
}

/// Card contenedora con fondo/borde de tokens COSMIC (tema del sistema).
pub fn card<'a>(
    content: impl Into<cosmic::Element<'a, crate::app::Message>>,
) -> cosmic::Element<'a, crate::app::Message> {
    widget::container(content)
        .padding(12)
        .style(|t| {
            let comp = &t.cosmic().background(false).component;
            widget::container::Style {
                background: Some(cosmic::iced::Background::Color(cosmic::iced::Color::from(
                    comp.base,
                ))),
                border: cosmic::iced::Border {
                    radius: 8.0.into(),
                    width: 1.0,
                    color: cosmic::iced::Color::from(comp.divider),
                },
                ..Default::default()
            }
        })
        .into()
}


