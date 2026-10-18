//! 구조체 STRUCTS on the desktop: the web client in a native window. The page is the same build as
//! the website (scripts/build-desktop.mjs); this side only adds what a browser tab can't do:
//! answering structs-kor:// links, updating itself, and handing web links to the real browser.
//!
//! The page talks to it with three commands (src/core/desktop.ts):
//!   take_links      structs-kor:// links that arrived (at launch, or from a second launch)
//!   update_check    a newer signed release, if there is one
//!   update_install  download it, install it, restart
//! plus open_external for web pages, which must not open inside the game window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_updater::UpdaterExt;

/// Links not yet taken by the page (one can arrive before the page is listening).
#[derive(Default)]
struct Links(Mutex<Vec<String>>);

fn deliver(app: &AppHandle, urls: impl IntoIterator<Item = String>) {
    let urls: Vec<String> = urls.into_iter().filter(|u| u.starts_with("structs-kor:")).collect();
    if urls.is_empty() {
        return;
    }
    app.state::<Links>().0.lock().unwrap().extend(urls);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    let _ = app.emit("deep-link", ());
}

#[tauri::command]
fn take_links(links: State<Links>) -> Vec<String> {
    std::mem::take(&mut *links.0.lock().unwrap())
}

#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    notes: Option<String>,
    /// A Linux .deb can't replace itself (it needs dpkg); it gets the releases page instead.
    installable: bool,
}

fn installable() -> bool {
    !cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some()
}

#[tauri::command]
async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateInfo { version: u.version, notes: u.body, installable: installable() }))
}

#[tauri::command]
async fn update_install(app: AppHandle) -> Result<(), String> {
    let Some(update) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? else {
        return Ok(());
    };
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

/// A web page, in the player's browser. Only http(s) and mailto: nothing else leaves the app.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "https" | "http" | "mailto") {
        return Err(format!("not a web link: {}", parsed.scheme()));
    }
    tauri_plugin_opener::open_url(parsed.as_str(), None::<&str>).map_err(|e| e.to_string())
}

/// The app's own pages: tauri://localhost (macOS, Linux), http://tauri.localhost (Windows), and the
/// dev server.
fn is_app_page(url: &Url) -> bool {
    url.scheme() == "tauri" || matches!(url.host_str(), Some("tauri.localhost") | Some("localhost"))
}

fn main() {
    let builder = tauri::Builder::default();
    // Windows/Linux: must be the first plugin, so a second launch hands its link over and exits.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .manage(Links::default())
        .invoke_handler(tauri::generate_handler![take_links, update_check, update_install, open_external])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("구조체 STRUCTS")
                .inner_size(1440.0, 900.0)
                .min_inner_size(960.0, 640.0)
                .center()
                // A link off the app (a guild page, the docs) opens in the browser, not over the game.
                .on_navigation(|url| {
                    if is_app_page(url) {
                        return true;
                    }
                    if matches!(url.scheme(), "https" | "http" | "mailto") {
                        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                    }
                    false
                })
                .build()?;

            // Installers register the scheme; this covers dev runs and the AppImage.
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            if let Err(e) = app.deep_link().register_all() {
                eprintln!("[deep-link] scheme not registered: {e}");
            }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                deliver(&handle, event.urls().iter().map(|u| u.to_string()));
            });
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                deliver(app.handle(), urls.iter().map(|u| u.to_string()));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running 구조체 STRUCTS");
}
