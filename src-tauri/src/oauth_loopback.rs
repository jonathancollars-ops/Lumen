use serde::Serialize;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use std::time::{Duration, Instant};
use url::Url;

#[derive(Clone, Serialize)]
pub struct OAuthReply {
    pub state: String,
    pub code: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct SessionInfo { pub port: u16 }

struct Session {
    state: String,
    port: u16,
    client_id: Option<String>,
    cancel: Arc<AtomicBool>,
    reply: Arc<Mutex<Option<OAuthReply>>>,
}

impl Drop for Session {
    fn drop(&mut self) { self.cancel.store(true, Ordering::Release); }
}

#[derive(Default)]
pub struct GoogleOAuthState(Mutex<Option<Session>>);

impl GoogleOAuthState {
    pub fn start(&self, state: String, lifetime: Duration) -> Result<SessionInfo, String> {
        if !is_pkce_value(&state) { return Err("invalid_state".into()); }
        // Keep the socket bound: selecting a free port and binding later creates a race.
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| "loopback_bind_failed")?;
        listener.set_nonblocking(true).map_err(|_| "loopback_bind_failed")?;
        let port = listener.local_addr().map_err(|_| "loopback_bind_failed")?.port();
        let cancel = Arc::new(AtomicBool::new(false));
        let reply = Arc::new(Mutex::new(None));
        let session = Session { state: state.clone(), port, client_id: None, cancel: cancel.clone(), reply: reply.clone() };
        let mut current = self.0.lock().map_err(|_| "session_unavailable")?;
        *current = Some(session); // Dropping the previous session stops its listener.
        std::thread::spawn(move || serve(listener, port, state, lifetime, cancel, reply));
        Ok(SessionInfo { port })
    }

    pub fn authorization_url(&self, state: &str, client_id: &str, challenge: &str) -> Result<String, String> {
        if !client_id.ends_with(".apps.googleusercontent.com") || client_id.len() > 200 ||
            !client_id.bytes().all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c)) {
            return Err("invalid_desktop_client".into());
        }
        if challenge.len() != 43 || !is_pkce_value(challenge) { return Err("invalid_pkce".into()); }
        let mut current = self.0.lock().map_err(|_| "session_unavailable")?;
        let session = current.as_mut().filter(|s| s.state == state).ok_or("session_expired")?;
        session.client_id = Some(client_id.into());
        let mut url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
        url.query_pairs_mut().extend_pairs([
            ("client_id", client_id), ("redirect_uri", &redirect_uri(session.port)),
            ("response_type", "code"), ("scope", "openid email profile"),
            ("state", state), ("code_challenge", challenge), ("code_challenge_method", "S256"),
            ("prompt", "select_account"),
        ]);
        Ok(url.into())
    }

    pub fn poll(&self, state: &str) -> Result<Option<OAuthReply>, String> {
        let current = self.0.lock().map_err(|_| "session_unavailable")?;
        let session = current.as_ref().filter(|s| s.state == state).ok_or("session_expired")?;
        let reply = session.reply.lock().map_err(|_| "session_unavailable")?.clone();
        Ok(reply)
    }

    pub fn exchange_config(&self, state: &str, code: &str, verifier: &str) -> Result<(String, String), String> {
        if !is_pkce_value(verifier) { return Err("invalid_pkce".into()); }
        let current = self.0.lock().map_err(|_| "session_unavailable")?;
        let session = current.as_ref().filter(|s| s.state == state).ok_or("session_expired")?;
        let reply = session.reply.lock().map_err(|_| "session_unavailable")?;
        if reply.as_ref().and_then(|r| r.code.as_deref()) != Some(code) { return Err("invalid_oauth_code".into()); }
        Ok((session.client_id.clone().ok_or("invalid_desktop_client")?, redirect_uri(session.port)))
    }

    pub fn stop(&self, state: &str) -> Result<(), String> {
        let mut current = self.0.lock().map_err(|_| "session_unavailable")?;
        if current.as_ref().is_some_and(|s| s.state == state) { *current = None; }
        Ok(())
    }
}

fn is_pkce_value(value: &str) -> bool {
    (43..=128).contains(&value.len()) && value.bytes().all(|c| c.is_ascii_alphanumeric() || b"-._~".contains(&c))
}

fn redirect_uri(port: u16) -> String { format!("http://127.0.0.1:{port}/oauth2callback") }

fn read_request(stream: &mut TcpStream) -> Result<String, ()> {
    stream.set_read_timeout(Some(Duration::from_millis(500))).map_err(|_| ())?;
    stream.set_write_timeout(Some(Duration::from_millis(500))).map_err(|_| ())?;
    let mut request = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(2);
    while request.len() < 16_384 && Instant::now() < deadline {
        let mut buffer = [0; 1024];
        let count = stream.read(&mut buffer).map_err(|_| ())?;
        if count == 0 { return Err(()); }
        request.extend_from_slice(&buffer[..count]);
        if request.windows(4).any(|w| w == b"\r\n\r\n") { return String::from_utf8(request).map_err(|_| ()); }
    }
    Err(())
}

fn parse_callback(request: &str, port: u16, expected_state: &str) -> Result<OAuthReply, &'static str> {
    let mut lines = request.split("\r\n");
    let mut first = lines.next().ok_or("400 Bad Request")?.split_whitespace();
    if first.next() != Some("GET") { return Err("405 Method Not Allowed"); }
    let target = first.next().ok_or("400 Bad Request")?;
    if !matches!(first.next(), Some("HTTP/1.1" | "HTTP/1.0")) || first.next().is_some() {
        return Err("400 Bad Request");
    }
    if !target.starts_with('/') || target.starts_with("//") { return Err("400 Bad Request"); }
    let hosts: Vec<_> = lines.filter_map(|line| line.split_once(':'))
        .filter(|(name, _)| name.eq_ignore_ascii_case("host")).map(|(_, value)| value.trim()).collect();
    if hosts.len() != 1 || hosts[0] != format!("127.0.0.1:{port}") { return Err("400 Bad Request"); }
    let url = Url::parse(&format!("http://127.0.0.1:{port}{target}")).map_err(|_| "400 Bad Request")?;
    if url.path() != "/oauth2callback" { return Err("404 Not Found"); }
    let params: Vec<_> = url.query_pairs().collect();
    let parameter = |name: &str| -> Result<Option<String>, &'static str> {
        let values: Vec<_> = params.iter().filter(|(key, _)| key.as_ref() == name).collect();
        if values.len() > 1 { return Err("400 Bad Request"); }
        Ok(values.first().map(|(_, value)| value.to_string()))
    };
    if parameter("state")?.as_deref() != Some(expected_state) { return Err("400 Bad Request"); }
    let code = parameter("code")?.filter(|value| !value.is_empty());
    let error = parameter("error")?.filter(|value| !value.is_empty());
    if code.is_some() == error.is_some() { return Err("400 Bad Request"); }
    Ok(OAuthReply { state: expected_state.into(), code, error })
}

fn respond(stream: &mut TcpStream, status: &str, completed: bool) {
    let text = if completed { "O Google respondeu ao Lumen. Pode fechar esta aba e voltar ao aplicativo." }
        else { "Esta solicita&ccedil;&atilde;o n&atilde;o concluiu o login. Continue na aba do Google." };
    let body = format!("<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\"><title>Lumen</title><h1>Lumen</h1><p>{text}</p></html>");
    let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n{body}", body.len());
}

fn serve(listener: TcpListener, port: u16, state: String, lifetime: Duration,
    cancel: Arc<AtomicBool>, reply: Arc<Mutex<Option<OAuthReply>>>) {
    let deadline = Instant::now() + lifetime;
    while !cancel.load(Ordering::Acquire) && Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let result = read_request(&mut stream).map_err(|_| "400 Bad Request")
                    .and_then(|request| parse_callback(&request, port, &state));
                match result {
                    Ok(result) => {
                        if cancel.load(Ordering::Acquire) { return; }
                        if let Ok(mut stored) = reply.lock() { *stored = Some(result); }
                        respond(&mut stream, "200 OK", true);
                        return;
                    }
                    Err(status) => respond(&mut stream, status, false),
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                if let Ok(mut stored) = reply.lock() { *stored = Some(OAuthReply { state, code: None, error: Some("loopback_failed".into()) }); }
                return;
            }
        }
    }
    if !cancel.load(Ordering::Acquire) {
        if let Ok(mut stored) = reply.lock() { *stored = Some(OAuthReply { state, code: None, error: Some("timeout".into()) }); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> String { "s".repeat(43) }
    fn request(port: u16, target: &str, host: &str) -> String {
        format!("GET {target} HTTP/1.1\r\nHost: {host}\r\n\r\n")
    }
    fn send(port: u16, target: &str, host: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        stream.write_all(request(port, target, host).as_bytes()).unwrap();
        let mut body = String::new();
        stream.read_to_string(&mut body).unwrap();
        body
    }

    #[test]
    fn real_listener_receives_encoded_code_and_uses_the_same_redirect_for_exchange() {
        let sessions = GoogleOAuthState::default();
        let state = state();
        let info = sessions.start(state.clone(), Duration::from_secs(5)).unwrap();
        let challenge = "c".repeat(43);
        let url = Url::parse(&sessions.authorization_url(&state, "desktop.apps.googleusercontent.com", &challenge).unwrap()).unwrap();
        let params: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(url.host_str(), Some("accounts.google.com"));
        assert_eq!(params["redirect_uri"], redirect_uri(info.port));
        assert_eq!(params["state"], state);
        assert_eq!(params["code_challenge"], challenge);
        assert_eq!(params["code_challenge_method"], "S256");
        let query = url::form_urlencoded::Serializer::new(String::new()).append_pair("state", &state)
            .append_pair("code", "code+with/=value").finish();
        let body = send(info.port, &format!("/oauth2callback?{query}"), &format!("127.0.0.1:{}", info.port));
        assert!(body.starts_with("HTTP/1.1 200"));
        assert!(!body.contains("code+with/=value"));
        assert!(!body.contains(&state));
        let reply = sessions.poll(&state).unwrap().unwrap();
        assert_eq!(reply.code.as_deref(), Some("code+with/=value"));
        let (client, redirect) = sessions.exchange_config(&state, "code+with/=value", &"v".repeat(43)).unwrap();
        assert_eq!(client, "desktop.apps.googleusercontent.com");
        assert_eq!(redirect, params["redirect_uri"]);
        assert!(sessions.exchange_config(&state, "another-code", &"v".repeat(43)).is_err());
        sessions.stop(&state).unwrap();
    }

    #[test]
    fn invalid_callback_cannot_consume_the_session_before_a_legitimate_return() {
        let sessions = GoogleOAuthState::default();
        let state = state();
        let info = sessions.start(state.clone(), Duration::from_secs(5)).unwrap();
        let host = format!("127.0.0.1:{}", info.port);
        let wrong = send(info.port, "/oauth2callback?state=wrong&code=attacker", &host);
        assert!(wrong.starts_with("HTTP/1.1 400"));
        assert!(sessions.poll(&state).unwrap().is_none());
        let correct = send(info.port, &format!("/oauth2callback?state={state}&error=access_denied"), &host);
        assert!(correct.starts_with("HTTP/1.1 200"));
        assert_eq!(sessions.poll(&state).unwrap().unwrap().error.as_deref(), Some("access_denied"));
    }

    #[test]
    fn wrong_host_path_method_missing_state_and_duplicate_parameters_are_rejected() {
        let port = 54321;
        let state = state();
        let host = format!("127.0.0.1:{port}");
        for target in [
            format!("/other?state={state}&code=test"),
            "/oauth2callback?code=test".into(),
            format!("/oauth2callback?state={state}&state={state}&code=test"),
            format!("/oauth2callback?state={state}&code=test&code=other"),
            format!("/oauth2callback?state={state}&code=test&error=access_denied"),
        ] { assert!(parse_callback(&request(port, &target, &host), port, &state).is_err()); }
        let target = format!("/oauth2callback?state={state}&code=test");
        assert!(parse_callback(&request(port, &target, "attacker.example"), port, &state).is_err());
        assert!(parse_callback(&request(port, &target, &host).replace("GET ", "POST "), port, &state).is_err());
    }

    #[test]
    fn replacing_or_stopping_a_session_releases_its_port_and_stale_cleanup_cannot_stop_a_retry() {
        let sessions = GoogleOAuthState::default();
        let old = state();
        let info = sessions.start(old.clone(), Duration::from_secs(5)).unwrap();
        let next = "n".repeat(43);
        sessions.start(next.clone(), Duration::from_secs(5)).unwrap();
        sessions.stop(&old).unwrap();
        assert!(sessions.poll(&old).is_err());
        assert!(sessions.poll(&next).unwrap().is_none());
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if TcpListener::bind(("127.0.0.1", info.port)).is_ok() { break; }
            assert!(Instant::now() < deadline, "old listener did not close");
            std::thread::sleep(Duration::from_millis(10));
        }
        sessions.stop(&next).unwrap();
        assert!(sessions.poll(&next).is_err());
    }

    #[test]
    fn expired_session_reports_timeout_and_untrusted_configuration_is_rejected() {
        let sessions = GoogleOAuthState::default();
        assert!(sessions.start("short-state".into(), Duration::from_secs(1)).is_err());
        let state = state();
        sessions.start(state.clone(), Duration::from_millis(20)).unwrap();
        assert!(sessions.authorization_url(&state, "https://attacker.example", &"c".repeat(43)).is_err());
        assert!(sessions.authorization_url(&state, "desktop.apps.googleusercontent.com", "bad").is_err());
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if let Some(reply) = sessions.poll(&state).unwrap() {
                assert_eq!(reply.error.as_deref(), Some("timeout"));
                break;
            }
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
