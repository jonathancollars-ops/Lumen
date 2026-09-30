use crate::oauth_loopback::{GoogleOAuthState, OAuthReply, SessionInfo};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
pub struct AuthError { code: String }
impl From<String> for AuthError { fn from(code: String) -> Self { Self { code } } }

#[tauri::command]
pub fn start_google_oauth(state: String, sessions: tauri::State<'_, GoogleOAuthState>) -> Result<SessionInfo, AuthError> {
    sessions.start(state, Duration::from_secs(90)).map_err(Into::into)
}

#[tauri::command]
pub fn open_google_oauth(app: tauri::AppHandle, state: String, client_id: String, code_challenge: String,
    sessions: tauri::State<'_, GoogleOAuthState>) -> Result<(), AuthError> {
    let url = sessions.authorization_url(&state, &client_id, &code_challenge)?;
    // The native code constructs a Google-only URL; no general shell permission is exposed.
    app.opener().open_url(url, None::<&str>).map_err(|_| AuthError { code: "browser_open_failed".into() })
}

#[tauri::command]
pub fn poll_google_oauth(state: String, sessions: tauri::State<'_, GoogleOAuthState>) -> Result<Option<OAuthReply>, AuthError> {
    sessions.poll(&state).map_err(Into::into)
}

#[tauri::command]
pub fn stop_google_oauth(state: String, sessions: tauri::State<'_, GoogleOAuthState>) -> Result<(), AuthError> {
    sessions.stop(&state).map_err(Into::into)
}

#[derive(Deserialize)]
struct TokenResponse { id_token: Option<String>, access_token: Option<String>, error: Option<String> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleTokens { id_token: Option<String>, access_token: Option<String> }

#[tauri::command]
pub async fn exchange_google_oauth(state: String, code: String, code_verifier: String,
    sessions: tauri::State<'_, GoogleOAuthState>) -> Result<GoogleTokens, AuthError> {
    let (client_id, redirect_uri) = sessions.exchange_config(&state, &code, &code_verifier)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).build()
        .map_err(|_| AuthError { code: "token_request_failed".into() })?;
    let mut params = vec![
        ("grant_type", "authorization_code"), ("client_id", &client_id),
        ("redirect_uri", &redirect_uri), ("code", &code), ("code_verifier", &code_verifier),
    ];
    // Some Desktop client configurations include a secret. Keep it out of the web bundle.
    if let Some(secret) = option_env!("GOOGLE_DESKTOP_CLIENT_SECRET").filter(|value| !value.is_empty()) {
        params.push(("client_secret", secret));
    }
    let response = client.post("https://oauth2.googleapis.com/token").form(&params)
        .send().await.map_err(|_| AuthError { code: "token_request_failed".into() })?;
    let succeeded = response.status().is_success();
    let tokens: TokenResponse = response.json().await.map_err(|_| AuthError { code: "invalid_token_response".into() })?;
    if let Some(error) = tokens.error {
        let safe = error.len() < 80 && error.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_');
        return Err(AuthError { code: if safe { error } else { "token_exchange_failed".into() } });
    }
    if !succeeded { return Err(AuthError { code: "token_exchange_failed".into() }); }
    // Discard a reply belonging to a session that was cancelled or replaced while awaiting Google.
    sessions.exchange_config(&state, &code, &code_verifier)?;
    Ok(GoogleTokens { id_token: tokens.id_token, access_token: tokens.access_token })
}

#[tauri::command]
pub fn focus_lumen_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") { let _ = window.set_focus(); }
}
