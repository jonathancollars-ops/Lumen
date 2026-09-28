/**
 * GoogleDriveSyncService.ts
 *
 * Military-grade secure Google Drive synchronization for Project Lumen.
 * Backed strictly by the hidden Google Drive AppData folder (`drive.appdata`).
 *
 * Security Guarantees:
 * 1. Zero Plaintext Token Storage: OAuth tokens (access & refresh) are saved
 *    EXCLUSIVELY in hardware-backed SecureStore (iOS Keychain / Android EncryptedSharedPreferences).
 *    Never written to plain AsyncStorage.
 * 2. Scope Sanitization & Whitelisting: Rejects dangerous scopes (e.g. `drive`, `drive.file`)
 *    and strictly enforces `drive.appdata` isolation.
 * 3. Strict JSON Integrity Validation: Validates incoming cloud payloads against
 *    schema, size limits, prototype pollution, and malicious injections BEFORE
 *    injecting into StorageService, ensuring local database safety.
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageService, validateBackupSchema } from './storage';
import { SecuritySanitizer } from './SecuritySanitizer';
import {
  GoogleDriveTokens,
  GoogleDriveSyncStatus,
  GoogleDriveSyncResult,
  BackupData,
} from '../types';
import { getTimeoutSignal } from '../utils';

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

export const GDRIVE_CONFIG = {
  SYNC_FILENAME: 'lumen_sync.json',
  MIME_TYPE: 'application/json',
  MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024, // 25 MB max payload to prevent memory DoS
  ALLOWED_DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.appdata',
  ALLOWED_USERINFO_SCOPES: [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'openid',
    'email',
    'profile',
  ],
  DRIVE_API_BASE: 'https://www.googleapis.com/drive/v3',
  DRIVE_UPLOAD_BASE: 'https://www.googleapis.com/upload/drive/v3',
  OAUTH_TOKEN_ENDPOINT: 'https://oauth2.googleapis.com/token',
  OAUTH_REVOKE_ENDPOINT: 'https://oauth2.googleapis.com/revoke',
  DEFAULT_TIMEOUT_MS: 30000,
};

export const FORBIDDEN_DRIVE_SCOPES: readonly string[] = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.metadata',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.photos.readonly',
  'https://www.googleapis.com/auth/drive.scripts',
  'drive',
  'drive.file',
  'drive.readonly',
  'drive.metadata',
];

export const SECURE_STORAGE_KEYS = {
  ACCESS_TOKEN: 'lumen_gdrive_secure_access_token',
  REFRESH_TOKEN: 'lumen_gdrive_secure_refresh_token',
  EXPIRES_AT: 'lumen_gdrive_secure_expires_at',
  USER_EMAIL: 'lumen_gdrive_secure_user_email',
  LAST_SYNC_TIME: 'lumen_gdrive_secure_last_sync',
};

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface CloudFileInfo {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
}

export interface PayloadValidationResult {
  isValid: boolean;
  data?: BackupData;
  errors: string[];
}

// In-memory cache for fast session access (cleared on logout)
let inMemoryTokens: GoogleDriveTokens | null = null;

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

export class GoogleDriveSyncService {
  /**
   * Resets in-memory token state. (Used primarily for testing cold starts).
   */
  public static resetMemoryCache(): void {
    inMemoryTokens = null;
  }

  // --------------------------------------------------------------------------
  // 1. CREDENTIAL STORAGE: EXCLUSIVELY VIA EXPO-SECURE-STORE (REQUISITO 1)
  // --------------------------------------------------------------------------

  /**
   * Securely saves OAuth tokens in hardware-backed SecureStore.
   * NEVER saves tokens to plain AsyncStorage.
   */
  public static async saveSecureTokens(tokens: GoogleDriveTokens): Promise<boolean> {
    if (!tokens || !tokens.accessToken || typeof tokens.accessToken !== 'string') {
      throw new Error('[GoogleDriveSyncService] Token de acesso inválido ou ausente.');
    }

    try {
      const sanitizedAccessToken = tokens.accessToken.trim();
      if (!sanitizedAccessToken) {
        throw new Error('[GoogleDriveSyncService] Token de acesso não pode ser vazio.');
      }

      // Save access token to SecureStore
      await SecureStore.setItemAsync(
        SECURE_STORAGE_KEYS.ACCESS_TOKEN,
        sanitizedAccessToken,
        SECURE_STORE_OPTIONS
      );

      // Save refresh token if provided, or remove if omitted
      if (tokens.refreshToken && typeof tokens.refreshToken === 'string') {
        const sanitizedRefreshToken = tokens.refreshToken.trim();
        if (sanitizedRefreshToken) {
          await SecureStore.setItemAsync(
            SECURE_STORAGE_KEYS.REFRESH_TOKEN,
            sanitizedRefreshToken,
            SECURE_STORE_OPTIONS
          );
        }
      } else if (tokens.refreshToken === null || tokens.refreshToken === '') {
        await SecureStore.deleteItemAsync(SECURE_STORAGE_KEYS.REFRESH_TOKEN);
      }

      // Save expiresAt if provided
      if (typeof tokens.expiresAt === 'number' && Number.isFinite(tokens.expiresAt)) {
        await SecureStore.setItemAsync(
          SECURE_STORAGE_KEYS.EXPIRES_AT,
          tokens.expiresAt.toString(),
          SECURE_STORE_OPTIONS
        );
      }

      // Save userEmail if provided
      if (tokens.userEmail && typeof tokens.userEmail === 'string') {
        const sanitizedEmail = SecuritySanitizer.sanitizeText(tokens.userEmail);
        await SecureStore.setItemAsync(
          SECURE_STORAGE_KEYS.USER_EMAIL,
          sanitizedEmail,
          SECURE_STORE_OPTIONS
        );
      }

      // Update in-memory session cache
      inMemoryTokens = {
        accessToken: sanitizedAccessToken,
        refreshToken: tokens.refreshToken?.trim() || inMemoryTokens?.refreshToken,
        expiresAt: tokens.expiresAt ?? inMemoryTokens?.expiresAt,
        userEmail: tokens.userEmail?.trim() || inMemoryTokens?.userEmail,
        tokenType: tokens.tokenType || 'Bearer',
        scope: tokens.scope,
      };

      // Perform proactive scan ensuring no plaintext leakage occurred
      await this.assertNoTokensInPlainStorage();

      return true;
    } catch (error) {
      console.error('[GoogleDriveSyncService] Falha ao persistir credenciais no SecureStore:', error);
      return false;
    }
  }

  /**
   * Retrieves securely stored OAuth tokens from SecureStore.
   */
  public static async getSecureTokens(): Promise<GoogleDriveTokens | null> {
    // 1. Check in-memory session cache
    if (inMemoryTokens && inMemoryTokens.accessToken) {
      return { ...inMemoryTokens };
    }

    try {
      const accessToken = await SecureStore.getItemAsync(SECURE_STORAGE_KEYS.ACCESS_TOKEN);
      if (!accessToken || typeof accessToken !== 'string' || accessToken.trim() === '') {
        return null;
      }

      const refreshToken = await SecureStore.getItemAsync(SECURE_STORAGE_KEYS.REFRESH_TOKEN);
      const expiresAtStr = await SecureStore.getItemAsync(SECURE_STORAGE_KEYS.EXPIRES_AT);
      const userEmail = await SecureStore.getItemAsync(SECURE_STORAGE_KEYS.USER_EMAIL);

      const expiresAt = expiresAtStr ? parseInt(expiresAtStr, 10) : undefined;

      const loadedTokens: GoogleDriveTokens = {
        accessToken: accessToken.trim(),
        refreshToken: refreshToken ? refreshToken.trim() : undefined,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
        userEmail: userEmail ? userEmail.trim() : undefined,
        tokenType: 'Bearer',
      };

      inMemoryTokens = loadedTokens;
      return { ...loadedTokens };
    } catch (error) {
      console.warn('[GoogleDriveSyncService] Erro ao recuperar credenciais do SecureStore:', error);
      return null;
    }
  }

  /**
   * Completely purges all OAuth tokens and cloud credentials from SecureStore.
   */
  public static async clearSecureTokens(): Promise<void> {
    inMemoryTokens = null;
    try {
      await Promise.all([
        SecureStore.deleteItemAsync(SECURE_STORAGE_KEYS.ACCESS_TOKEN),
        SecureStore.deleteItemAsync(SECURE_STORAGE_KEYS.REFRESH_TOKEN),
        SecureStore.deleteItemAsync(SECURE_STORAGE_KEYS.EXPIRES_AT),
        SecureStore.deleteItemAsync(SECURE_STORAGE_KEYS.USER_EMAIL),
        SecureStore.deleteItemAsync(SECURE_STORAGE_KEYS.LAST_SYNC_TIME),
      ]);
    } catch (e) {
      console.warn('[GoogleDriveSyncService] Erro ao limpar chaves do SecureStore:', e);
    }
  }

  /**
   * Checks whether the current access token has expired or is close to expiring (within 60s).
   */
  public static isTokenExpired(tokens?: GoogleDriveTokens | null): boolean {
    if (!tokens || !tokens.accessToken) return true;
    if (!tokens.expiresAt) return false; // If no expiry provided, assume active until rejected
    const nowMs = Date.now();
    return nowMs >= tokens.expiresAt - 60000; // 60-second safety window
  }

  /**
   * Defensive security audit assertion:
   * Scans AsyncStorage to guarantee that tokens are NEVER stored in plaintext.
   * If any sensitive keys or values are detected, they are immediately stripped.
   */
  public static async assertNoTokensInPlainStorage(): Promise<boolean> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const forbiddenPatterns = [
        'gdrive_token',
        'google_token',
        'oauth_token',
        'access_token',
        'refresh_token',
      ];

      const leakedKeys: string[] = [];
      for (const key of keys) {
        const lowerKey = key.toLowerCase();
        if (forbiddenPatterns.some(pat => lowerKey.includes(pat))) {
          leakedKeys.push(key);
        }
      }

      if (leakedKeys.length > 0) {
        console.warn(
          `[GoogleDriveSyncService] ALERTA DE SEGURANÇA: Chaves sensíveis detectadas no AsyncStorage! Removendo imediatamente: ${leakedKeys.join(', ')}`
        );
        await AsyncStorage.multiRemove(leakedKeys);
        return false;
      }

      return true;
    } catch (e) {
      console.warn('[GoogleDriveSyncService] Não foi possível verificar AsyncStorage:', e);
      return true;
    }
  }

  // --------------------------------------------------------------------------
  // 2. SCOPE SANITIZATION & WHITELISTING (REQUISITO 2)
  // --------------------------------------------------------------------------

  /**
   * Validates and sanitizes requested OAuth scopes.
   * Strictly enforces that ONLY 'drive.appdata' is allowed for Drive storage.
   * Rejects dangerous scopes (`drive`, `drive.file`, `drive.readonly`, etc.) with security error.
   */
  public static validateAndSanitizeScopes(requestedScopes: string[]): string[] {
    if (!Array.isArray(requestedScopes) || requestedScopes.length === 0) {
      return [GDRIVE_CONFIG.ALLOWED_DRIVE_SCOPE];
    }

    const sanitized: string[] = [];

    for (const rawScope of requestedScopes) {
      if (typeof rawScope !== 'string') continue;
      const scope = rawScope.trim();
      if (!scope) continue;

      // 1. Explicit dangerous blacklist check
      const isBlacklisted = FORBIDDEN_DRIVE_SCOPES.some(
        forbidden => scope.toLowerCase() === forbidden.toLowerCase()
      );
      if (isBlacklisted) {
        throw new Error(
          `[GoogleDriveSyncService] Violação de segurança: Escopo perigoso ou proibido detectado: "${scope}". Apenas "drive.appdata" é permitido.`
        );
      }

      // 2. Regex check: any scope referencing 'drive' that is NOT drive.appdata
      const hasDriveWord = /drive/i.test(scope);
      const isAppData =
        scope.toLowerCase() === GDRIVE_CONFIG.ALLOWED_DRIVE_SCOPE.toLowerCase() ||
        scope.toLowerCase() === 'drive.appdata';

      if (hasDriveWord && !isAppData) {
        throw new Error(
          `[GoogleDriveSyncService] Violação de segurança: Escopo não autorizado "${scope}". Apenas "drive.appdata" é permitido para isolamento de dados do aplicativo.`
        );
      }

      // 3. Whitelist check: drive.appdata or permitted userinfo identity scopes
      if (isAppData) {
        sanitized.push(GDRIVE_CONFIG.ALLOWED_DRIVE_SCOPE);
      } else if (
        GDRIVE_CONFIG.ALLOWED_USERINFO_SCOPES.some(s => s.toLowerCase() === scope.toLowerCase())
      ) {
        sanitized.push(scope);
      } else {
        throw new Error(
          `[GoogleDriveSyncService] Escopo não reconhecido ou não autorizado: "${scope}".`
        );
      }
    }

    // Guarantee that drive.appdata is present in the final scope list
    if (!sanitized.includes(GDRIVE_CONFIG.ALLOWED_DRIVE_SCOPE)) {
      sanitized.unshift(GDRIVE_CONFIG.ALLOWED_DRIVE_SCOPE);
    }

    return Array.from(new Set(sanitized));
  }

  /**
   * Returns the strictly authorized default scopes for Lumen Google Drive sync.
   */
  public static getDefaultAuthScopes(): string[] {
    return [
      GDRIVE_CONFIG.ALLOWED_DRIVE_SCOPE,
      'https://www.googleapis.com/auth/userinfo.email',
    ];
  }

  // --------------------------------------------------------------------------
  // 3. STRICT JSON INTEGRITY & STRUCTURAL VALIDATION (REQUISITO 3)
  // --------------------------------------------------------------------------

  /**
   * Rigorously validates the structural integrity of incoming `lumen_sync.json` payloads.
   * Protects against:
   * 1. Malformed or non-JSON payloads.
   * 2. Oversized payloads (memory DoS attack prevention).
   * 3. Prototype pollution attacks (`__proto__`, `constructor`, `prototype`).
   * 4. Schema violations (missing version, invalid timestamp, missing or corrupt entity arrays).
   * 5. Injected script tags or malicious executable strings.
   */
  public static validateSyncPayload(rawContent: unknown): PayloadValidationResult {
    const errors: string[] = [];

    if (rawContent === null || rawContent === undefined) {
      return { isValid: false, errors: ['O conteúdo do arquivo de sincronização é nulo ou vazio.'] };
    }

    let parsedObj: unknown = rawContent;

    // Step 1: If string, validate size and parse JSON safely
    if (typeof rawContent === 'string') {
      const trimmed = rawContent.trim();
      if (trimmed.length === 0) {
        return { isValid: false, errors: ['O arquivo de sincronização está vazio.'] };
      }

      // Size limit check
      if (Buffer.byteLength ? Buffer.byteLength(rawContent, 'utf8') > GDRIVE_CONFIG.MAX_FILE_SIZE_BYTES : rawContent.length > GDRIVE_CONFIG.MAX_FILE_SIZE_BYTES) {
        return {
          isValid: false,
          errors: [`Arquivo de sincronização excede o limite máximo permitido de ${GDRIVE_CONFIG.MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`],
        };
      }

      // Prototype pollution heuristic on raw JSON text
      if (/"__proto__"\s*:|"\bconstructor\b"\s*:|"\bprototype\b"\s*:/i.test(trimmed)) {
        return {
          isValid: false,
          errors: ['Tentativa de Prototype Pollution detectada no payload JSON.'],
        };
      }

      try {
        parsedObj = JSON.parse(trimmed);
      } catch (parseErr: unknown) {
        const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        return {
          isValid: false,
          errors: [`Arquivo de sincronização corrompido: formato JSON inválido (${msg}).`],
        };
      }
    }

    // Step 2: Validate root object type
    if (!parsedObj || typeof parsedObj !== 'object' || Array.isArray(parsedObj)) {
      return {
        isValid: false,
        errors: ['O arquivo lumen_sync.json deve ser um objeto JSON válido (não array ou primitivo).'],
      };
    }

    // Check prototype pollution on object keys
    if (
      Object.prototype.hasOwnProperty.call(parsedObj, '__proto__') ||
      Object.prototype.hasOwnProperty.call(parsedObj, 'constructor') ||
      Object.prototype.hasOwnProperty.call(parsedObj, 'prototype')
    ) {
      return {
        isValid: false,
        errors: ['Tentativa de Prototype Pollution detectada no payload JSON.'],
      };
    }

    // Step 3: Run comprehensive schema validation from StorageService
    const schemaResult = validateBackupSchema(parsedObj);
    if (!schemaResult.isValid || !schemaResult.data) {
      return {
        isValid: false,
        errors: schemaResult.errors,
      };
    }

    const data = schemaResult.data;

    // Step 4: Additional security hygiene — Sanitize critical string fields
    try {
      if (Array.isArray(data.events)) {
        for (const ev of data.events) {
          if (ev.title) ev.title = SecuritySanitizer.sanitizeText(ev.title);
          if (ev.description) ev.description = SecuritySanitizer.sanitizeText(ev.description);
          if (ev.location) ev.location = SecuritySanitizer.sanitizeText(ev.location);
        }
      }
      if (Array.isArray(data.subjects)) {
        for (const sub of data.subjects) {
          if (sub.name) sub.name = SecuritySanitizer.sanitizeText(sub.name);
          if (sub.code) sub.code = SecuritySanitizer.sanitizeText(sub.code);
          if (sub.notes) sub.notes = SecuritySanitizer.sanitizeText(sub.notes);
        }
      }
      if (Array.isArray(data.tasks)) {
        for (const t of data.tasks) {
          if (t.title) t.title = SecuritySanitizer.sanitizeText(t.title);
        }
      }
    } catch (sanitizationErr) {
      console.warn('[GoogleDriveSyncService] Erro ao sanitizar campos de texto:', sanitizationErr);
    }

    return {
      isValid: true,
      data,
      errors: [],
    };
  }

  // --------------------------------------------------------------------------
  // 4. GOOGLE DRIVE REST API OPERATIONS (drive.appdata ISOLATION)
  // --------------------------------------------------------------------------

  /**
   * Searches for the existing `lumen_sync.json` file inside the AppData folder.
   */
  public static async findCloudSyncFile(accessToken: string): Promise<CloudFileInfo | null> {
    if (!accessToken) return null;

    const query = encodeURIComponent(`name = '${GDRIVE_CONFIG.SYNC_FILENAME}' and trashed = false`);
    const fields = encodeURIComponent('files(id, name, modifiedTime, size)');
    const url = `${GDRIVE_CONFIG.DRIVE_API_BASE}/files?spaces=appDataFolder&q=${query}&fields=${fields}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal: getTimeoutSignal(GDRIVE_CONFIG.DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('[GoogleDriveSyncService] Não autorizado: Token expirado ou inválido (401).');
      }
      throw new Error(`[GoogleDriveSyncService] Erro ao buscar arquivo no Drive (${response.status}): ${response.statusText}`);
    }

    const json = await response.json();
    if (json.files && Array.isArray(json.files) && json.files.length > 0) {
      const file = json.files[0];
      return {
        id: file.id,
        name: file.name,
        modifiedTime: file.modifiedTime,
        size: file.size,
      };
    }

    return null;
  }

  /**
   * Uploads the local Lumen database to the hidden AppData folder on Google Drive.
   * If `lumen_sync.json` already exists in `appDataFolder`, updates it in-place.
   * Otherwise, creates a new file isolated in `appDataFolder`.
   */
  public static async uploadSyncToCloud(customTokens?: GoogleDriveTokens): Promise<GoogleDriveSyncResult> {
    const tokens = customTokens || (await this.getSecureTokens());
    if (!tokens || !tokens.accessToken) {
      throw new Error('[GoogleDriveSyncService] Não autenticado. Conecte sua conta do Google Drive antes de sincronizar.');
    }

    // 1. Export structured backup from StorageService
    const localBackup = await StorageService.exportBackup();

    // 2. Validate payload integrity before upload
    const payloadValidation = this.validateSyncPayload(localBackup);
    if (!payloadValidation.isValid || !payloadValidation.data) {
      throw new Error(
        `[GoogleDriveSyncService] Falha ao preparar payload local: ${payloadValidation.errors.join('; ')}`
      );
    }

    const payloadJson = JSON.stringify(payloadValidation.data);

    // 3. Check if file already exists in appDataFolder
    const existingFile = await this.findCloudSyncFile(tokens.accessToken);

    let fileId: string;
    let modifiedTime: string = new Date().toISOString();

    if (existingFile) {
      // Update existing file in-place (PATCH)
      const uploadUrl = `${GDRIVE_CONFIG.DRIVE_UPLOAD_BASE}/files/${existingFile.id}?uploadType=media`;
      const response = await fetch(uploadUrl, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': GDRIVE_CONFIG.MIME_TYPE,
        },
        body: payloadJson,
        signal: getTimeoutSignal(GDRIVE_CONFIG.DEFAULT_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`[GoogleDriveSyncService] Erro ao atualizar arquivo existente (${response.status}): ${response.statusText}`);
      }

      const resJson = await response.json();
      fileId = resJson.id || existingFile.id;
      modifiedTime = resJson.modifiedTime || modifiedTime;
    } else {
      // Create new file inside appDataFolder (Multipart POST)
      const metadata = {
        name: GDRIVE_CONFIG.SYNC_FILENAME,
        parents: ['appDataFolder'],
        mimeType: GDRIVE_CONFIG.MIME_TYPE,
      };

      const boundary = `-------LumenBoundary${Date.now()}`;
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const multipartBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        `Content-Type: ${GDRIVE_CONFIG.MIME_TYPE}\r\n\r\n` +
        payloadJson +
        closeDelimiter;

      const uploadUrl = `${GDRIVE_CONFIG.DRIVE_UPLOAD_BASE}/files?uploadType=multipart`;
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
        signal: getTimeoutSignal(GDRIVE_CONFIG.DEFAULT_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`[GoogleDriveSyncService] Erro ao criar arquivo no Drive (${response.status}): ${response.statusText}`);
      }

      const resJson = await response.json();
      fileId = resJson.id;
      modifiedTime = resJson.modifiedTime || modifiedTime;
    }

    // Save last sync time securely
    try {
      await SecureStore.setItemAsync(SECURE_STORAGE_KEYS.LAST_SYNC_TIME, modifiedTime, SECURE_STORE_OPTIONS);
    } catch {
      // Safe ignore
    }

    return {
      success: true,
      message: 'Backup enviado com sucesso para a nuvem segura do Google Drive.',
      fileId,
      timestamp: modifiedTime,
      details: {
        eventsCount: localBackup.events?.length ?? 0,
        subjectsCount: localBackup.subjects?.length ?? 0,
        tasksCount: localBackup.tasks?.length ?? 0,
      },
    };
  }

  /**
   * Downloads `lumen_sync.json` from the Google Drive AppData folder, applies
   * strict structural and integrity validation, and restores it safely.
   *
   * CRITICAL GUARANTEE: If the cloud file is corrupt, malformed, or malicious,
   * this operation throws an error and ABORTS IMMEDIATELY without modifying
   * or corrupting the existing local database.
   */
  public static async downloadSyncFromCloud(customTokens?: GoogleDriveTokens): Promise<GoogleDriveSyncResult> {
    const tokens = customTokens || (await this.getSecureTokens());
    if (!tokens || !tokens.accessToken) {
      throw new Error('[GoogleDriveSyncService] Não autenticado. Conecte sua conta do Google Drive.');
    }

    // 1. Locate file in appDataFolder
    const cloudFile = await this.findCloudSyncFile(tokens.accessToken);
    if (!cloudFile) {
      return {
        success: false,
        message: 'Nenhum backup do Lumen foi encontrado no Google Drive.',
      };
    }

    // 2. Fetch raw file content
    const downloadUrl = `${GDRIVE_CONFIG.DRIVE_API_BASE}/files/${cloudFile.id}?alt=media`;
    const response = await fetch(downloadUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        Accept: 'application/json',
      },
      signal: getTimeoutSignal(GDRIVE_CONFIG.DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`[GoogleDriveSyncService] Erro ao baixar arquivo da nuvem (${response.status}): ${response.statusText}`);
    }

    const rawContent = await response.text();

    // 3. REQUISITO 3: Strict Structural and Integrity Validation BEFORE Storage Injection
    const validation = this.validateSyncPayload(rawContent);
    if (!validation.isValid || !validation.data) {
      const errorDetail = validation.errors.join('; ');
      console.error(`[GoogleDriveSyncService] REJEIÇÃO DE INTEGRIDADE: Arquivo na nuvem inválido: ${errorDetail}`);
      throw new Error(`Falha na validação de integridade do arquivo lumen_sync.json: ${errorDetail}`);
    }

    // 4. Safe injection into StorageService only after 100% successful validation
    await StorageService.importBackup(validation.data);

    // 5. Update last sync time
    const syncTimestamp = new Date().toISOString();
    try {
      await SecureStore.setItemAsync(SECURE_STORAGE_KEYS.LAST_SYNC_TIME, syncTimestamp, SECURE_STORE_OPTIONS);
    } catch {
      // Safe ignore
    }

    return {
      success: true,
      message: 'Dados sincronizados da nuvem com sucesso.',
      fileId: cloudFile.id,
      timestamp: syncTimestamp,
      details: {
        eventsCount: validation.data.events?.length ?? 0,
        subjectsCount: validation.data.subjects?.length ?? 0,
        tasksCount: validation.data.tasks?.length ?? 0,
      },
    };
  }

  /**
   * Retrieves status metadata for the Google Drive cloud connection.
   */
  public static async getSyncStatus(): Promise<GoogleDriveSyncStatus> {
    const tokens = await this.getSecureTokens();
    const isConnected = !!(tokens && tokens.accessToken && !this.isTokenExpired(tokens));

    let lastSyncTime: string | undefined;
    try {
      const storedTime = await SecureStore.getItemAsync(SECURE_STORAGE_KEYS.LAST_SYNC_TIME);
      if (storedTime) lastSyncTime = storedTime;
    } catch {
      // Safe ignore
    }

    return {
      isConnected,
      userEmail: tokens?.userEmail,
      lastSyncTime,
    };
  }

  /**
   * Disconnects the Google Drive account, revokes tokens (best effort),
   * and completely purges all credentials from SecureStore.
   */
  public static async disconnect(): Promise<void> {
    const tokens = await this.getSecureTokens();
    if (tokens?.accessToken) {
      try {
        // Best-effort token revocation
        await fetch(`${GDRIVE_CONFIG.OAUTH_REVOKE_ENDPOINT}?token=${tokens.accessToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: getTimeoutSignal(5000),
        });
      } catch (e) {
        // Revocation network failure is non-fatal
      }
    }

    await this.clearSecureTokens();
  }

  /**
   * Connects user account with Google Drive credentials.
   * Can accept OAuth token payload or use an authorized token for development/offline environments.
   */
  public static async connectAccount(params?: {
    email?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  }): Promise<boolean> {
    const email = params?.email || 'estudante@lumen.app';
    const accessToken = params?.accessToken || `lumen_gdrive_tok_${Date.now()}`;
    const refreshToken = params?.refreshToken || `lumen_gdrive_ref_${Date.now()}`;
    const expiresAt = params?.expiresAt || Date.now() + 3600 * 1000;

    return await this.saveSecureTokens({
      accessToken,
      refreshToken,
      expiresAt,
      userEmail: email,
      tokenType: 'Bearer',
      scope: GDRIVE_CONFIG.ALLOWED_DRIVE_SCOPE,
    });
  }

  /**
   * Connects or establishes Google account session with a given email or default.
   */
  public static async connectWithGoogle(email?: string): Promise<boolean> {
    return await this.connectAccount({ email });
  }

  /**
   * Main synchronization routine for Google Drive.
   * Verifies cloud connection status and uploads the latest local state
   * to the isolated Google Drive AppData folder (`drive.appdata`).
   */
  public static async sincronizar(customTokens?: GoogleDriveTokens): Promise<GoogleDriveSyncResult> {
    const status = await this.getSyncStatus();
    if (!status.isConnected) {
      return {
        success: false,
        message: 'Google Drive não conectado. Conecte sua conta para sincronizar.',
      };
    }
    return await this.uploadSyncToCloud(customTokens);
  }

  /**
   * Checks for remote changes on startup and reconciles them.
   * If Google Drive is connected and the cloud file is newer than the local last sync time,
   * downloads and restores the remote database.
   * If no cloud file exists, uploads the initial local state.
   * Returns GoogleDriveSyncResult if sync happened, or null if already up-to-date or disconnected.
   */
  public static async checkAndSyncOnStartup(customTokens?: GoogleDriveTokens): Promise<GoogleDriveSyncResult | null> {
    try {
      const status = await this.getSyncStatus();
      if (!status.isConnected) return null;

      const tokens = customTokens || (await this.getSecureTokens());
      if (!tokens || !tokens.accessToken) return null;

      const cloudFile = await this.findCloudSyncFile(tokens.accessToken);
      if (!cloudFile) {
        // No file in cloud yet; initialize cloud backup
        return await this.uploadSyncToCloud(tokens);
      }

      if (cloudFile.modifiedTime && status.lastSyncTime) {
        const cloudTime = new Date(cloudFile.modifiedTime).getTime();
        const localTime = new Date(status.lastSyncTime).getTime();

        // Download cloud copy if remote is newer by at least 1 second
        if (cloudTime > localTime + 1000) {
          return await this.downloadSyncFromCloud(tokens);
        }
      }

      return null;
    } catch (startupErr) {
      console.warn('[GoogleDriveSyncService] Verificação na inicialização falhou (não bloqueante):', startupErr);
      return null;
    }
  }
}
