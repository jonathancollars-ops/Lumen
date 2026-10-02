use std::fs::File;
use std::io::Write;
use std::time::Duration;
use tauri::Emitter;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdateProgress {
    pub progress: f64,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
}

#[tauri::command]
pub async fn download_and_run_desktop_installer(
    app: tauri::AppHandle,
    url: String,
) -> Result<(), String> {
    log::info!("[DesktopUpdater] Iniciando download da atualização: {}", url);

    let parsed_url = url::Url::parse(&url).map_err(|e| format!("URL inválida: {e}"))?;
    if parsed_url.scheme() != "https" {
        return Err("Apenas downloads seguros HTTPS são permitidos.".into());
    }

    let filename = parsed_url
        .path_segments()
        .and_then(|segments| segments.last())
        .filter(|name| name.ends_with(".exe") || name.ends_with(".msi"))
        .unwrap_or("lumen-setup.exe");

    let safe_filename: String = filename
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect();

    let safe_filename = if safe_filename.is_empty() {
        "lumen-setup.exe".to_string()
    } else {
        safe_filename
    };

    let temp_dir = std::env::temp_dir();
    let installer_path = temp_dir.join(&safe_filename);

    if installer_path.exists() {
        let _ = std::fs::remove_file(&installer_path);
    }

    let client = reqwest::Client::builder()
        .user_agent("Lumen-Desktop-Updater")
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Falha ao inicializar cliente HTTP: {e}"))?;

    let mut response = client
        .get(parsed_url.as_str())
        .send()
        .await
        .map_err(|e| format!("Falha ao conectar ao servidor de atualização: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Download falhou com status HTTP {}", response.status()));
    }

    let total_bytes = response.content_length().unwrap_or(0);
    let mut file = File::create(&installer_path)
        .map_err(|e| format!("Falha ao criar arquivo temporário: {e}"))?;

    let mut downloaded_bytes: u64 = 0;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Erro durante o download do instalador: {e}"))?
    {
        file.write_all(&chunk)
            .map_err(|e| format!("Erro ao gravar dados no disco: {e}"))?;
        downloaded_bytes += chunk.len() as u64;

        let progress = if total_bytes > 0 {
            (downloaded_bytes as f64) / (total_bytes as f64)
        } else {
            0.0
        };

        let _ = app.emit(
            "desktop-update-progress",
            DesktopUpdateProgress {
                progress,
                total_bytes,
                downloaded_bytes,
            },
        );
    }

    file.flush()
        .map_err(|e| format!("Falha ao finalizar gravação do arquivo: {e}"))?;
    drop(file);

    if downloaded_bytes == 0 {
        return Err("O arquivo baixado está vazio (0 bytes).".into());
    }

    log::info!(
        "[DesktopUpdater] Download concluído com sucesso ({} bytes). Iniciando instalador: {:?}",
        downloaded_bytes,
        installer_path
    );

    let _ = app.emit(
        "desktop-update-progress",
        DesktopUpdateProgress {
            progress: 1.0,
            total_bytes: downloaded_bytes,
            downloaded_bytes,
        },
    );

    #[cfg(target_os = "windows")]
    {
        if safe_filename.ends_with(".msi") {
            std::process::Command::new("msiexec")
                .arg("/i")
                .arg(&installer_path)
                .spawn()
                .map_err(|e| format!("Falha ao iniciar instalador MSI: {e}"))?;
        } else {
            std::process::Command::new(&installer_path)
                .spawn()
                .map_err(|e| format!("Falha ao iniciar instalador executável: {e}"))?;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new(&installer_path)
            .spawn()
            .map_err(|e| format!("Falha ao executar instalador: {e}"))?;
    }

    // Fecha a aplicação Lumen graciosamente para liberar arquivos para o instalador
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(600));
        app.exit(0);
    });

    Ok(())
}
