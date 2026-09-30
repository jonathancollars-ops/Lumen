mod google_oauth;
mod oauth_loopback;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .manage(oauth_loopback::GoogleOAuthState::default())
    .invoke_handler(tauri::generate_handler![
      google_oauth::start_google_oauth,
      google_oauth::open_google_oauth,
      google_oauth::poll_google_oauth,
      google_oauth::stop_google_oauth,
      google_oauth::exchange_google_oauth,
      google_oauth::focus_lumen_window,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
