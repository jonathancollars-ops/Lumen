import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { AppUpdateInfo, AppUpdateState } from '../types';
import { APP_VERSION, isNewerVersion, parseSemver } from '../utils/version';
import { SecuritySanitizer } from './SecuritySanitizer';

const GITHUB_REPO_OWNER = 'jonathancollars-ops';
const GITHUB_REPO_NAME = 'organiza';
const GITHUB_RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`;
const UPDATE_STATE_KEY = '@lumen_update_state';

// Throttle automatic checks: check at most once every 3 hours on cold start
const AUTO_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;

export class AppUpdateService {
  /**
   * Retrieves the current application version string.
   */
  public static getCurrentVersion(): string {
    return APP_VERSION;
  }

  /**
   * Checks whether the app is currently running in a Desktop (Windows/macOS Tauri) environment.
   */
  public static isDesktop(): boolean {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      return false;
    }
    return (
      Platform.OS === 'windows' ||
      Platform.OS === 'macos' ||
      (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window)
    );
  }

  /**
   * Retrieves stored update state (last checked timestamp and ignored version).
   * Guaranteed to return a valid object, even when storage holds "null", corrupted strings, or empty data.
   */
  public static async getUpdateState(): Promise<AppUpdateState> {
    try {
      const raw = await AsyncStorage.getItem(UPDATE_STATE_KEY);
      if (raw && typeof raw === 'string' && raw.trim().length > 0) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as AppUpdateState;
        }
      }
    } catch {
      // Ignore read and parse errors safely
    }
    return {};
  }

  /**
   * Saves updated update state to storage.
   */
  public static async saveUpdateState(state: Partial<AppUpdateState>): Promise<void> {
    try {
      const current = await this.getUpdateState();
      const safeCurrent = (current && typeof current === 'object' && !Array.isArray(current)) ? current : {};
      const safeState = (state && typeof state === 'object' && !Array.isArray(state)) ? state : {};
      const merged: AppUpdateState = { ...safeCurrent, ...safeState };
      await AsyncStorage.setItem(UPDATE_STATE_KEY, JSON.stringify(merged));
    } catch {
      // Ignore write errors
    }
  }

  /**
   * Checks GitHub Releases API for new updates.
   * @param force When true, bypasses automatic throttle interval.
   */
  public static async checkForUpdates(force: boolean = false): Promise<AppUpdateInfo | null> {
    let timeoutId: any = null;
    try {
      const state = await this.getUpdateState();
      const now = Date.now();

      // Skip if checked recently unless forced
      if (!force && state?.lastCheckedAt && (now - state.lastCheckedAt) < AUTO_CHECK_INTERVAL_MS) {
        return null;
      }

      // Record check timestamp
      await this.saveUpdateState({ lastCheckedAt: now });

      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(GITHUB_RELEASES_URL, {
        method: 'GET',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Lumen-App-Client'
        },
        signal: controller.signal
      });

      if (!response.ok) {
        return null;
      }

      const release = await response.json();
      if (!release || typeof release !== 'object' || !release.tag_name || typeof release.tag_name !== 'string') {
        return null;
      }

      const rawTag = release.tag_name as string;
      const latestVersion = rawTag.trim().replace(/^refs\/tags\//i, '').replace(/^v/i, '');
      if (!latestVersion) {
        return null;
      }

      // Check if remote version is strictly newer than current app version
      const hasUpdate = isNewerVersion(latestVersion, APP_VERSION);
      
      // Sanitize release page URL
      const safeReleaseHtmlUrl = SecuritySanitizer.sanitizeUrl(release.html_url);

      if (!hasUpdate) {
        return {
          hasUpdate: false,
          currentVersion: APP_VERSION,
          latestVersion: latestVersion,
          downloadUrl: safeReleaseHtmlUrl
        };
      }

      // Check if user chose to ignore this specific version (unless manual force check)
      if (!force && state?.ignoredVersion === latestVersion) {
        return null;
      }

      // Locate appropriate installer asset in release assets and sanitize its URL
      let targetDownloadUrl = safeReleaseHtmlUrl;
      if (Array.isArray(release.assets)) {
        if (this.isDesktop()) {
          // Desktop (Windows/Tauri): look for .exe (preferring *-setup.exe) or .msi
          const exeSetupAsset = release.assets.find((asset: any) =>
            asset &&
            typeof asset.name === 'string' &&
            asset.name.toLowerCase().endsWith('.exe') &&
            asset.name.toLowerCase().includes('setup')
          );
          const exeAsset = release.assets.find((asset: any) =>
            asset &&
            typeof asset.name === 'string' &&
            asset.name.toLowerCase().endsWith('.exe')
          );
          const msiAsset = release.assets.find((asset: any) =>
            asset &&
            typeof asset.name === 'string' &&
            asset.name.toLowerCase().endsWith('.msi')
          );
          const targetDesktopAsset = exeSetupAsset || exeAsset || msiAsset;
          if (targetDesktopAsset && typeof targetDesktopAsset.browser_download_url === 'string') {
            const sanitizedDesktop = SecuritySanitizer.sanitizeUrl(targetDesktopAsset.browser_download_url);
            if (
              sanitizedDesktop &&
              (sanitizedDesktop.toLowerCase().endsWith('.exe') || sanitizedDesktop.toLowerCase().endsWith('.msi'))
            ) {
              targetDownloadUrl = sanitizedDesktop;
            }
          }
        } else {
          // Mobile (Android): locate .apk asset
          const apkAsset = release.assets.find((asset: any) =>
            asset && typeof asset.name === 'string' && asset.name.toLowerCase().endsWith('.apk')
          );
          if (apkAsset && typeof apkAsset.browser_download_url === 'string') {
            const sanitizedApk = SecuritySanitizer.sanitizeUrl(apkAsset.browser_download_url);
            if (sanitizedApk && sanitizedApk.toLowerCase().endsWith('.apk')) {
              targetDownloadUrl = sanitizedApk;
            }
          }
        }
      }

      const rawName = typeof release.name === 'string' ? release.name : '';
      const safeName = rawName.trim().length > 0 ? SecuritySanitizer.sanitizeText(rawName) : `Lumen v${latestVersion}`;

      const rawBody = typeof release.body === 'string' ? release.body : '';
      const safeBody = rawBody.trim().length > 0 ? SecuritySanitizer.sanitizeText(rawBody) : 'Melhorias de estabilidade, desempenho e correções visuais.';

      return {
        hasUpdate: true,
        currentVersion: APP_VERSION,
        latestVersion: latestVersion,
        releaseName: safeName,
        releaseNotes: safeBody,
        downloadUrl: targetDownloadUrl,
        publishedAt: typeof release.published_at === 'string' ? release.published_at : undefined,
        isMandatory: false
      };
    } catch (error) {
      // Network drops or offline states are handled silently
      return null;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Opens the download URL in the device's browser / package installer.
   */
  public static async openDownloadUrl(url: string): Promise<boolean> {
    try {
      const sanitized = SecuritySanitizer.sanitizeUrl(url);
      if (!sanitized) return false;
      const supported = await Linking.canOpenURL(sanitized);
      if (supported) {
        await Linking.openURL(sanitized);
        return true;
      } else {
        // Fallback direto caso canOpenURL retorne false indevidamente em certas versões do Android
        await Linking.openURL(sanitized);
        return true;
      }
    } catch {
      // Fallback silencioso
    }
    return false;
  }

  /**
   * Sets a version to be ignored on automatic checks until the next release.
   */
  public static async ignoreVersion(version: string): Promise<void> {
    if (version && typeof version === 'string') {
      await this.saveUpdateState({ ignoredVersion: version });
    }
  }

  /**
   * Records when the update prompt modal was shown or dismissed by the user.
   */
  public static async recordPromptDismissed(): Promise<void> {
    await this.saveUpdateState({ lastPromptDismissedAt: Date.now() });
  }

  /**
   * Checks if the 24-hour cooldown for automatic update pop-ups has passed.
   */
  public static async shouldShowAutomaticPrompt(): Promise<boolean> {
    try {
      const state = await this.getUpdateState();
      if (!state.lastPromptDismissedAt) return true;
      const COOLDOWN_24H_MS = 24 * 60 * 60 * 1000;
      return (Date.now() - state.lastPromptDismissedAt) >= COOLDOWN_24H_MS;
    } catch {
      return true;
    }
  }

  private static activeDownload: FileSystem.DownloadResumable | null = null;
  private static desktopDownloadCancelled = false;

  /**
   * Cancels any active desktop update download.
   */
  public static cancelDesktopDownload(): void {
    this.desktopDownloadCancelled = true;
  }

  /**
   * Downloads and executes a native Windows desktop updater (.exe or .msi) via Tauri backend.
   * Listens to 'desktop-update-progress' events and executes the installer when complete.
   */
  public static async downloadAndInstallDesktop(
    downloadUrl: string,
    onProgress?: (progress: number, totalBytes: number, downloadedBytes: number) => void
  ): Promise<{ success: boolean; error?: string }> {
    try {
      this.desktopDownloadCancelled = false;
      const sanitizedUrl = SecuritySanitizer.sanitizeUrl(downloadUrl);
      if (!sanitizedUrl) {
        return { success: false, error: 'URL de download inválida ou não fornecida.' };
      }

      // Se a URL não apontar para um arquivo .exe ou .msi (ex: apenas a página html_url da release), faz fallback para o navegador
      const isInstallerFile = sanitizedUrl.toLowerCase().endsWith('.exe') || sanitizedUrl.toLowerCase().endsWith('.msi');
      if (!isInstallerFile) {
        await this.openDownloadUrl(sanitizedUrl);
        return {
          success: false,
          error: 'Instalador Desktop direto não disponível nesta release. Redirecionando para a página de download no navegador...'
        };
      }

      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');

      let unlisten: (() => void) | null = null;
      try {
        unlisten = await listen<{ progress: number; totalBytes: number; downloadedBytes: number }>(
          'desktop-update-progress',
          (event) => {
            if (this.desktopDownloadCancelled) return;
            if (onProgress && event?.payload) {
              onProgress(
                event.payload.progress ?? 0,
                event.payload.totalBytes ?? 0,
                event.payload.downloadedBytes ?? 0
              );
            }
          }
        );

        await invoke('download_and_run_desktop_installer', { url: sanitizedUrl });

        if (this.desktopDownloadCancelled) {
          return { success: false, error: 'Download cancelado pelo usuário.' };
        }

        return { success: true };
      } finally {
        if (typeof unlisten === 'function') {
          try {
            const res: any = unlisten();
            if (res && typeof res.catch === 'function') {
              res.catch(() => {});
            }
          } catch {
            // Defensively swallow unlisten errors in test or teardown contexts
          }
        }
      }
    } catch (error: any) {
      if (this.desktopDownloadCancelled) {
        return { success: false, error: 'Download cancelado pelo usuário.' };
      }
      const errMsg = error?.message || (typeof error === 'string' ? error : 'Falha ao baixar e executar o instalador desktop.');
      return { success: false, error: errMsg };
    }
  }

  public static async cancelDownload(): Promise<void> {
    try {
      this.cancelDesktopDownload();
      if (this.activeDownload) {
        await this.activeDownload.cancelAsync();
        this.activeDownload = null;
      }
      const fileUri = `${FileSystem.cacheDirectory}lumen-update.apk`;
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
    } catch (error) {
      console.warn('Erro ao cancelar o download', error);
    }
  }

  public static async downloadUpdateApk(downloadUrl: string, onProgress: (progress: number, totalBytes: number, downloadedBytes: number) => void): Promise<{ success: boolean; fileUri?: string; error?: string }> {
    const fileUri = `${FileSystem.cacheDirectory}lumen-update.apk`;

    try {
      const sanitizedUrl = SecuritySanitizer.sanitizeUrl(downloadUrl);
      if (!sanitizedUrl) {
        return { success: false, error: 'URL de download inválida ou não fornecida.' };
      }

      // Se a URL não apontar para um arquivo .apk (ex: apenas a página html_url da release), faz fallback para o navegador
      if (!sanitizedUrl.toLowerCase().endsWith('.apk')) {
        await this.openDownloadUrl(sanitizedUrl);
        return {
          success: false,
          error: 'Pacote APK direto não disponível nesta release. Redirecionando para a página de download no navegador...'
        };
      }
      
      const MIN_FREE_SPACE = 60 * 1024 * 1024; // 60 MB
      try {
        const freeSpace = await FileSystem.getFreeDiskStorageAsync();
        if (typeof freeSpace === 'number' && freeSpace < MIN_FREE_SPACE) {
          return { success: false, error: 'Espaço em disco insuficiente. Libere pelo menos 60 MB para baixar a atualização.' };
        }
      } catch (e) {
        // Ignora se getFreeDiskStorageAsync não for suportado em algum dispositivo
      }

      // Prevenção de lixo e corrupção: Exclui qualquer APK parcial ou corrompido de downloads anteriores
      try {
        const fileInfo = await FileSystem.getInfoAsync(fileUri);
        if (fileInfo && fileInfo.exists) {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
        }
      } catch {
        try {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
        } catch {}
      }

      this.activeDownload = FileSystem.createDownloadResumable(
        sanitizedUrl,
        fileUri,
        {},
        (downloadProgress) => {
          const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
          onProgress(progress, downloadProgress.totalBytesExpectedToWrite, downloadProgress.totalBytesWritten);
        }
      );

      const result = await this.activeDownload.downloadAsync();
      
      if (result && result.uri) {
        try {
          const downloadedInfo = await FileSystem.getInfoAsync(result.uri);
          if (downloadedInfo && downloadedInfo.exists && (downloadedInfo.size === undefined || downloadedInfo.size > 0)) {
            return { success: true, fileUri: result.uri };
          } else {
            // Arquivo corrompido ou vazio (0 bytes)
            await FileSystem.deleteAsync(result.uri, { idempotent: true });
            return { success: false, error: 'Arquivo APK baixado está corrompido ou vazio.' };
          }
        } catch {
          return { success: true, fileUri: result.uri };
        }
      }

      // Se o download não retornou URI válida, limpa o arquivo corrompido
      try {
        await FileSystem.deleteAsync(fileUri, { idempotent: true });
      } catch {}

      return { success: false, error: 'Download incompleto ou falhou.' };
    } catch (error: any) {
      // Limpa qualquer arquivo parcial/corrompido gerado durante a falha
      try {
        await FileSystem.deleteAsync(fileUri, { idempotent: true });
      } catch {}
      return { success: false, error: error.message || 'Erro durante o download' };
    } finally {
      this.activeDownload = null;
    }
  }


  public static async installApk(fileUri: string): Promise<{ success: boolean; error?: string }> {
    try {
      const contentUri = await FileSystem.getContentUriAsync(fileUri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1 | 268435456, // FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK
        type: 'application/vnd.android.package-archive',
      });
      return { success: true };
    } catch (error: any) {
      const errMsg = error.message || '';
      
      // Tratamento de Permissões Android 8.0+ (REQUEST_INSTALL_PACKAGES / SecurityException)
      if (
        errMsg.includes('SecurityException') ||
        errMsg.includes('REQUEST_INSTALL_PACKAGES') ||
        errMsg.includes('INSTALL_PACKAGES') ||
        errMsg.toLowerCase().includes('permission') ||
        errMsg.toLowerCase().includes('not allowed')
      ) {
        try {
          await IntentLauncher.startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', {
            data: 'package:com.jothacsf.Organiza',
          });
          return {
            success: false,
            error: 'Permissão necessária para instalar fontes desconhecidas. Por favor, autorize e tente novamente.'
          };
        } catch (settingsError) {
          try {
            await IntentLauncher.startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES');
            return {
              success: false,
              error: 'Permissão necessária para instalar fontes desconhecidas. Por favor, autorize e tente novamente.'
            };
          } catch {
            return {
              success: false,
              error: 'Permissão negada. Habilite a instalação de fontes desconhecidas nas configurações do Android.'
            };
          }
        }
      }
      
      return { success: false, error: errMsg || 'Falha ao acionar o instalador.' };
    }
  }
}
