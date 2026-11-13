mod app;
mod bridge;
mod db;
mod doc;
mod export;
mod pages;
mod report;
mod runner;
mod store;

use app::Yatt;

fn main() -> cosmic::iced::Result {
    let settings = cosmic::app::Settings::default()
        .size(cosmic::iced::Size::new(1200., 800.))
        .size_limits(
            cosmic::iced::Limits::NONE
                .min_width(960.)
                .min_height(600.),
        );
    cosmic::app::run::<Yatt>(settings, ())
}
