//! Shell COSMIC: nav de 5 páginas + ruteo de eventos del sidecar y del runner.

use crate::bridge::Bridge;
use crate::db;
use crate::pages::{data, reports, run, settings, tests, Motor, Shared};
use crate::runner;
use cosmic::app::{Core, Task};
use cosmic::app::ApplicationExt;
use cosmic::widget::{self, nav_bar};
use serde_json::Value;
use std::sync::Arc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Page {
    Tests,
    Correr,
    Reports,
    Datos,
    Ajustes,
}

#[derive(Clone, Debug)]
pub enum Message {
    Noop,
    Pinged(Result<(), String>),
    Event(Value),
    Run(runner::RunEvent),
    Tests(tests::Msg),
    Correr(run::Msg),
    Reports(reports::Msg),
    Datos(data::Msg),
    Ajustes(settings::Msg),
}

pub struct Yatt {
    core: Core,
    nav_model: nav_bar::Model,
    page: Page,
    shared: Shared,
    pub tests: tests::Page,
    pub correr: run::Page,
    pub reportes: reports::Page,
    pub datos: data::Page,
    pub ajustes: settings::Page,
}

fn nav_pages() -> nav_bar::Model {
    let mut nav = nav_bar::Model::default();
    nav.insert().text("Tests").icon(cosmic::widget::icon::icon(crate::pages::svg_icon("tests"))).data(Page::Tests);
    nav.insert().text("Correr").icon(cosmic::widget::icon::icon(crate::pages::svg_icon("play"))).data(Page::Correr);
    nav.insert().text("Reportes").icon(cosmic::widget::icon::icon(crate::pages::svg_icon("chart"))).data(Page::Reports);
    nav.insert().text("Datos").icon(cosmic::widget::icon::icon(crate::pages::svg_icon("database"))).data(Page::Datos);
    nav.insert().text("Ajustes").icon(cosmic::widget::icon::icon(crate::pages::svg_icon("sliders"))).data(Page::Ajustes);
    nav.activate_position(0);
    nav
}

impl cosmic::Application for Yatt {
    type Executor = cosmic::executor::Default;
    type Flags = ();
    type Message = Message;
    const APP_ID: &'static str = "dev.yatt.Yatt";

    fn core(&self) -> &Core {
        &self.core
    }

    fn core_mut(&mut self) -> &mut Core {
        &mut self.core
    }

    fn init(core: Core, _flags: Self::Flags) -> (Self, Task<Message>) {
        let bridge = Bridge::global();
        let mut shared = Shared {
            bridge,
            store: None,
            settings: Default::default(),
            browser_open: false,
            tabs_n: 0,
            motor: Motor::Arrancando,
            logs: Default::default(),
        };
        if let Some(store) = crate::store::Store::open(&db::project_root()).ok().map(Arc::new) {
            shared.settings = store.settings_load();
            shared.store = Some(store);
        } else {
            shared.log("ERROR: no se pudo abrir yatt.db");
        }
        let mut app = Yatt {
            core,
            nav_model: nav_pages(),
            page: Page::Tests,
            shared,
            tests: tests::Page::default(),
            correr: run::Page::default(),
            reportes: reports::Page::default(),
            datos: data::Page::default(),
            ajustes: settings::Page::default(),
        };
        app.tests.refresh(&mut app.shared);

        let bridge = app.shared.bridge.clone();
        let ping = cosmic::task::future(async move {
            let r = bridge.request("ping", serde_json::json!({})).await;
            Message::Pinged(r.map(|_| ()).map_err(|e| e))
        });

        let mut tasks = Task::batch([ping]);
        if let Some(id) = app.core.main_window_id() {
            tasks = tasks.chain(ApplicationExt::set_window_title(&mut app, "YATT".to_string(), id));
        }
        app.set_header_title("YATT".to_string());
        (app, tasks)
    }

    fn update(&mut self, message: Message) -> Task<Message> {
        match message {
            Message::Noop => Task::none(),
            Message::Pinged(Ok(())) => {
                self.shared.motor = Motor::Activo;
                self.shared.log("motor activo (sidecar)");
                Task::none()
            }
            Message::Pinged(Err(e)) => {
                self.shared.motor = Motor::Error(e);
                Task::none()
            }
            Message::Event(v) => self.on_event(v),
            Message::Run(ev) => {
                let done = matches!(&ev, runner::RunEvent::Done(_));
                run::on_run_event(&mut self.correr, &mut self.shared, ev);
                if done {
                    self.reportes.refresh(&mut self.shared);
                }
                Task::none()
            }
            Message::Tests(m) => tests::update(&mut self.tests, &mut self.shared, m),
            Message::Correr(m) => run::update(&mut self.correr, &mut self.shared, m),
            Message::Reports(m) => reports::update(&mut self.reportes, &mut self.shared, m),
            Message::Datos(m) => data::update(&mut self.datos, &mut self.shared, m),
            Message::Ajustes(m) => settings::update(&mut self.ajustes, &mut self.shared, m),
        }
    }

    fn view(&self) -> cosmic::Element<'_, Message> {
        let motor_txt = match &self.shared.motor {
            Motor::Arrancando => "arrancando…".to_string(),
            Motor::Activo => "activo".to_string(),
            Motor::Apagado => "apagado".to_string(),
            Motor::Error(e) => format!("error: {e}"),
        };
        let last_log = self
            .shared
            .logs
            .back()
            .cloned()
            .unwrap_or_else(|| "sin novedades".to_string());
        let dot_color = match &self.shared.motor {
            Motor::Activo => cosmic::iced::Color::from_rgb(0.23, 0.61, 0.35),
            Motor::Arrancando => cosmic::iced::Color::from_rgb(0.85, 0.55, 0.05),
            Motor::Error(_) => cosmic::iced::Color::from_rgb(0.75, 0.23, 0.16),
            Motor::Apagado => cosmic::iced::Color::from_rgb(0.45, 0.47, 0.5),
        };
        let dot = widget::container(widget::text("●").size(12)).style(move |_| widget::container::Style {
            text_color: Some(dot_color),
            ..Default::default()
        });
        let status_text = format!(
            "motor {} · browser {} · {}",
            motor_txt,
            if self.shared.browser_open { "abierto" } else { "cerrado" },
            last_log
        );
        let status_row = widget::row::with_capacity(2)
            .push(dot)
            .push(widget::text(status_text).size(12).font(cosmic::font::mono()))
            .spacing(6);

        let content = match self.page {
            Page::Tests => tests::view(&self.tests, &self.shared),
            Page::Correr => run::view(&self.correr, &self.shared),
            Page::Reports => reports::view(&self.reportes, &self.shared),
            Page::Datos => data::view(&self.datos, &self.shared),
            Page::Ajustes => settings::view(&self.ajustes, &self.shared),
        };

        widget::column::with_capacity(2)
            .push(widget::container(status_row).padding([4, 12]))
            .push(content)
            .into()
    }

    fn nav_model(&self) -> Option<&nav_bar::Model> {
        Some(&self.nav_model)
    }

    fn on_nav_select(&mut self, id: nav_bar::Id) -> Task<Message> {
        self.nav_model.activate(id);
        if let Some(page) = self.nav_model.active_data::<Page>() {
            self.page = *page;
        }
        match self.page {
            Page::Tests => tests::update(&mut self.tests, &mut self.shared, tests::Msg::Refresh),
            Page::Correr => run::update(&mut self.correr, &mut self.shared, run::Msg::Refresh),
            Page::Reports => reports::update(&mut self.reportes, &mut self.shared, reports::Msg::Refresh),
            Page::Datos => data::update(&mut self.datos, &mut self.shared, data::Msg::Refresh),
            Page::Ajustes => {
                let _ = settings::update(&mut self.ajustes, &mut self.shared, settings::Msg::Noop);
                self.ajustes.refresh(&mut self.shared);
                Task::none()
            }
        }
    }

    fn subscription(&self) -> cosmic::iced::Subscription<Message> {
        Bridge::subscription().map(Message::Event)
    }
}

impl Yatt {
    fn on_event(&mut self, v: Value) -> Task<Message> {
        let name = v.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let data = v.get("data").cloned().unwrap_or(Value::Null);
        match name.as_str() {
            "browser_status" => {
                self.shared.browser_open = data.get("open").and_then(|x| x.as_bool()).unwrap_or(false);
                Task::none()
            }
            "tabs_changed" => {
                self.shared.tabs_n = data.get("tabs").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0);
                Task::none()
            }
            "sidecar_exited" => {
                self.shared.motor = Motor::Apagado;
                self.shared.browser_open = false;
                self.shared.log("sidecar terminado");
                Task::none()
            }
            "sidecar_error" => {
                let e = data.get("error").and_then(|x| x.as_str()).unwrap_or("desconocido").to_string();
                self.shared.motor = Motor::Error(e);
                Task::none()
            }
            "action_captured" => {
                match serde_json::from_value::<crate::doc::Step>(data.get("step").cloned().unwrap_or(Value::Null)) {
                    Ok(step) => {
                        let page = &mut self.tests;
                        let sh = &mut self.shared;
                        tests::Page::captured(page, sh, step)
                    }
                    Err(_) => Task::none(),
                }
            }
            "grab_result" => {
                self.shared.log("re-grabado: volvé a hacer clic para capturar otro paso");
                Task::none()
            }
            _ => Task::none(),
        }
    }
}
