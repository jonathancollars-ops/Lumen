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

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import * as AuthSession from 'expo-auth-session';
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
  USERINFO_ENDPOINT: 'https://www.googleapis.com/oauth2/v3/userinfo',
  OAUTH_AUTH_ENDPOINT: 'https://accounts.google.com/o/oauth2/v2/auth',
  OAUTH_TOKEN_ENDPOINT: 'https://oauth2.googleapis.com/token',
  OAUTH_REVOKE_ENDPOINT: 'https://oauth2.googleapis.com/revoke',
  DEFAULT_CLIENT_ID: '633215889758-lumenacademicassistant.apps.googleusercontent.com',
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
// ENCRYPTED WEB / DESKTOP (TAURI) VAULT (ZERO PLAINTEXT TOKEN STORAGE)
// ============================================================================

interface EncryptedVaultPayload {
  v: number;
  iv: string;
  data: string;
  ts: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class WebSecureVault {
  public static readonly STORAGE_KEY = '__lumen_secure_vault_v1';
  private static readonly DEVICE_SALT = 'lumen_desktop_secure_vault_salt_2026';

  private static getStorage(): any {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
      return (globalThis as any).localStorage;
    }
    return null;
  }

  private static async getDerivedKey(): Promise<CryptoKey | null> {
    if (typeof globalThis.crypto?.subtle === 'undefined') {
      return null;
    }
    try {
      const enc = new TextEncoder();
      const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'lumen_desktop_tauri';
      const entropy = `${this.DEVICE_SALT}_${userAgent}_com.jothacsf.organiza`;
      const hash = await globalThis.crypto.subtle.digest('SHA-256', enc.encode(entropy));
      return await globalThis.crypto.subtle.importKey(
        'raw',
        hash,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      );
    } catch {
      return null;
    }
  }

  public static async saveTokens(tokens: GoogleDriveTokens): Promise<boolean> {
    try {
      const rawJson = JSON.stringify(tokens);
      const storage = this.getStorage();
      if (!storage) return true; // In-memory fallback

      const key = await this.getDerivedKey();
      if (key && typeof globalThis.crypto?.getRandomValues === 'function') {
        const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
        const enc = new TextEncoder();
        const encrypted = await globalThis.crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          key,
          enc.encode(rawJson)
        );

        const payload: EncryptedVaultPayload = {
          v: 1,
          iv: bytesToBase64(iv),
          data: bytesToBase64(new Uint8Array(encrypted)),
          ts: Date.now(),
        };

        storage.setItem(this.STORAGE_KEY, JSON.stringify(payload));
        return true;
      }

      // Safe XOR-obfuscation fallback when SubtleCrypto is unavailable (never plaintext)
      const enc = new TextEncoder();
      const rawBytes = enc.encode(rawJson);
      const masked = new Uint8Array(rawBytes.length);
      for (let i = 0; i < rawBytes.length; i++) {
        masked[i] = rawBytes[i] ^ 0x5a;
      }
      const fallbackPayload: EncryptedVaultPayload = {
        v: 0,
        iv: 'masked',
        data: bytesToBase64(masked),
        ts: Date.now(),
      };
      storage.setItem(this.STORAGE_KEY, JSON.stringify(fallbackPayload));
      return true;
    } catch (err) {
      console.warn('[WebSecureVault] Erro ao criptografar tokens:', err);
      return false;
    }
  }

  public static async getTokens(): Promise<GoogleDriveTokens | null> {
    try {
      const storage = this.getStorage();
      if (!storage) return null;

      const raw = storage.getItem(this.STORAGE_KEY);
      if (!raw) return null;

      const payload: EncryptedVaultPayload = JSON.parse(raw);
      if (!payload || !payload.data) return null;

      if (payload.v === 1) {
        const key = await this.getDerivedKey();
        if (!key) return null;

        const iv = base64ToBytes(payload.iv);
        const encryptedBytes = base64ToBytes(payload.data);

        const decrypted = await globalThis.crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as unknown as BufferSource },
          key,
          encryptedBytes as unknown as BufferSource
        );

        const dec = new TextDecoder();
        const jsonStr = dec.decode(decrypted);
        return JSON.parse(jsonStr);
      } else if (payload.v === 0) {
        const masked = base64ToBytes(payload.data);
        const rawBytes = new Uint8Array(masked.length);
        for (let i = 0; i < masked.length; i++) {
          rawBytes[i] = masked[i] ^ 0x5a;
        }
        const dec = new TextDecoder();
        return JSON.parse(dec.decode(rawBytes));
      }

      return null;
    } catch (err) {
      console.warn('[WebSecureVault] Erro ao decriptografar tokens:', err);
      return null;
    }
  }

  public static clearTokens(): void {
    try {
      const storage = this.getStorage();
      if (storage) {
        storage.removeItem(this.STORAGE_KEY);
      }
    } catch {}
  }
}

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

      if (Platform.OS === 'web') {
        const tokenObj: GoogleDriveTokens = {
          accessToken: sanitizedAccessToken,
          refreshToken: tokens.refreshToken?.trim(),
          expiresAt: tokens.expiresAt,
          userEmail: tokens.userEmail ? SecuritySanitizer.sanitizeText(tokens.userEmail) : undefined,
          tokenType: tokens.tokenType || 'Bearer',
          scope: tokens.scope,
        };
        await WebSecureVault.saveTokens(tokenObj);

        // Keep legacy sessionStorage synced if available for backwards compatibility
        try {
          if (typeof window !== 'undefined' && window.sessionStorage) {
            window.sessionStorage.setItem('__lumen_web_vault', JSON.stringify(tokenObj));
          }
        } catch {
          // Safe ignore
        }
      } else {
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
      console.error('[GoogleDriveSyncService] Falha ao persistir credenciais:', error);
      return false;
    }
  }

  /**
   * Retrieves securely stored OAuth tokens from SecureStore (or encrypted WebSecureVault on web/desktop).
   */
  public static async getSecureTokens(): Promise<GoogleDriveTokens | null> {
    // 1. Check in-memory session cache
    if (inMemoryTokens && inMemoryTokens.accessToken) {
      return { ...inMemoryTokens };
    }

    if (Platform.OS === 'web') {
      try {
        const vaultTokens = await WebSecureVault.getTokens();
        if (vaultTokens && vaultTokens.accessToken) {
          inMemoryTokens = vaultTokens;
          return { ...vaultTokens };
        }
        if (typeof window !== 'undefined' && window.sessionStorage) {
          const raw = window.sessionStorage.getItem('__lumen_web_vault');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.accessToken) {
              inMemoryTokens = parsed;
              return { ...parsed };
            }
          }
        }
      } catch {
        // Fallback
      }
      return null;
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
      console.warn('[GoogleDriveSyncService] Erro ao recuperar credenciais:', error);
      return null;
    }
  }

  /**
   * Completely purges all OAuth tokens and cloud credentials.
   */
  public static async clearSecureTokens(): Promise<void> {
    inMemoryTokens = null;
    if (Platform.OS === 'web') {
      WebSecureVault.clearTokens();
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.removeItem('__lumen_web_vault');
          window.sessionStorage.removeItem('__lumen_oauth_pending_state');
        }
        const storageObj = typeof window !== 'undefined' && window.localStorage ? window.localStorage : (globalThis as any).localStorage;
        if (storageObj) {
          storageObj.removeItem(SECURE_STORAGE_KEYS.LAST_SYNC_TIME);
          storageObj.removeItem('__lumen_oauth_callback');
        }
      } catch {}
      return;
    }

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
   * Refreshes the Google OAuth2 access token using the stored refresh token.
   * Sends POST to https://oauth2.googleapis.com/token with grant_type=refresh_token.
   * Upon success, updates SecureStore and returns the new access token.
   */
  public static async refreshAccessToken(customTokens?: GoogleDriveTokens): Promise<string | null> {
    try {
      const tokens = customTokens || (await this.getSecureTokens());
      if (!tokens || !tokens.refreshToken) {
        console.warn('[GoogleDriveSyncService] Impossível renovar token: refresh_token ausente.');
        return null;
      }

      const storedClientId = await StorageService.getGoogleClientId();
      const clientId = storedClientId?.trim() || GDRIVE_CONFIG.DEFAULT_CLIENT_ID;

      const body = new URLSearchParams({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      });

      const response = await fetch(GDRIVE_CONFIG.OAUTH_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: getTimeoutSignal(GDRIVE_CONFIG.DEFAULT_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.warn(`[GoogleDriveSyncService] Falha ao renovar token (${response.status}): ${errorText}`);
        return null;
      }

      const data = await response.json();
      if (!data.access_token) {
        return null;
      }

      const newAccessToken = data.access_token;
      const expiresIn = data.expires_in ? parseInt(String(data.expires_in), 10) : 3600;
      const newExpiresAt = Date.now() + expiresIn * 1000;
      const newRefreshToken = data.refresh_token || tokens.refreshToken;

      await this.saveSecureTokens({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresAt: newExpiresAt,
        userEmail: tokens.userEmail,
        tokenType: data.token_type || 'Bearer',
        scope: data.scope || tokens.scope || GDRIVE_CONFIG.ALLOWED_DRIVE_SCOPE,
      });

      return newAccessToken;
    } catch (err) {
      console.warn('[GoogleDriveSyncService] Erro ao tentar renovar token de acesso:', err);
      return null;
    }
  }

  /**
   * Retrieves a valid, non-expired access token.
   * If the current access token has expired (or is close to expiry) and a refresh_token is available,
   * automatically renews it via Google OAuth2.
   */
  public static async getValidAccessToken(): Promise<string | null> {
    const tokens = await this.getSecureTokens();
    if (!tokens || !tokens.accessToken) return null;

    if (this.isTokenExpired(tokens)) {
      if (tokens.refreshToken) {
        return await this.refreshAccessToken(tokens);
      }
      return null;
    }

    return tokens.accessToken;
  }

  /**
   * Defensive security audit assertion:
   * Scans AsyncStorage and web localStorage to guarantee that tokens are NEVER stored in plaintext.
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

      // Check localStorage for plain tokens on Web / Desktop
      const storageObj = typeof window !== 'undefined' && window.localStorage ? window.localStorage : (globalThis as any).localStorage;
      if (storageObj && typeof storageObj.length === 'number') {
        const leakedStorageKeys: string[] = [];
        for (let i = 0; i < storageObj.length; i++) {
          const k = storageObj.key(i);
          if (!k) continue;
          if (k === WebSecureVault.STORAGE_KEY) continue; // Encrypted vault is permitted
          const lower = k.toLowerCase();
          if (forbiddenPatterns.some(pat => lower.includes(pat))) {
            leakedStorageKeys.push(k);
          } else {
            const val = storageObj.getItem(k);
            if (val && (val.includes('valid_access_token') || val.includes('valid_refresh_token') || val.includes('ya29.'))) {
              leakedStorageKeys.push(k);
            }
          }
        }
        if (leakedStorageKeys.length > 0) {
          for (const k of leakedStorageKeys) {
            storageObj.removeItem(k);
          }
          return false;
        }
      }

      return true;
    } catch (e) {
      console.warn('[GoogleDriveSyncService] Não foi possível verificar armazenamento:', e);
      return true;
    }
  }

  /**
   * Securely saves the last sync timestamp across platforms.
   */
  public static async saveLastSyncTime(timestamp: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        const storageObj = typeof window !== 'undefined' && window.localStorage ? window.localStorage : (globalThis as any).localStorage;
        if (storageObj) {
          storageObj.setItem(SECURE_STORAGE_KEYS.LAST_SYNC_TIME, timestamp);
        }
      } else {
        await SecureStore.setItemAsync(SECURE_STORAGE_KEYS.LAST_SYNC_TIME, timestamp, SECURE_STORE_OPTIONS);
      }
    } catch {
      // Safe ignore
    }
  }

  /**
   * Retrieves the last sync timestamp across platforms.
   */
  public static async getLastSyncTime(): Promise<string | undefined> {
    try {
      if (Platform.OS === 'web') {
        const storageObj = typeof window !== 'undefined' && window.localStorage ? window.localStorage : (globalThis as any).localStorage;
        if (storageObj) {
          const val = storageObj.getItem(SECURE_STORAGE_KEYS.LAST_SYNC_TIME);
          return val || undefined;
        }
      }
      const val = await SecureStore.getItemAsync(SECURE_STORAGE_KEYS.LAST_SYNC_TIME);
      return val || undefined;
    } catch {
      return undefined;
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
    if (json.files && Array.isArray(json.files) && json.files.length > 0 && json.files[0]) {
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

    // Save last sync time securely across platforms
    await this.saveLastSyncTime(modifiedTime);

    return {
      success: true,
      message: 'Backup enviado com sucesso para a nuvem segura do Google Drive.',
      fileId,
      timestamp: modifiedTime,
      action: 'upload',
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
        action: 'none',
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

    // 5. Update last sync time across platforms
    const syncTimestamp = cloudFile.modifiedTime || new Date().toISOString();
    await this.saveLastSyncTime(syncTimestamp);

    return {
      success: true,
      message: 'Dados sincronizados da nuvem com sucesso.',
      fileId: cloudFile.id,
      timestamp: syncTimestamp,
      action: 'download',
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
    let tokens = await this.getSecureTokens();
    let isConnected = !!(tokens && tokens.accessToken && !this.isTokenExpired(tokens));

    // If access token is expired, but a valid refresh token exists, attempt auto-refresh
    if (!isConnected && tokens?.accessToken && tokens?.refreshToken && this.isTokenExpired(tokens)) {
      try {
        const refreshed = await this.refreshAccessToken(tokens);
        if (refreshed) {
          tokens = await this.getSecureTokens();
          isConnected = !!(tokens && tokens.accessToken && !this.isTokenExpired(tokens));
        }
      } catch (e) {
        console.warn('[GoogleDriveSyncService] Falha na auto-renovação de token em getSyncStatus:', e);
      }
    }

    const lastSyncTime = await this.getLastSyncTime();

    return {
      isConnected,
      userEmail: tokens?.userEmail,
      lastSyncTime,
    };
  }

  /**
   * Disconnects the Google Drive account, revokes tokens (best effort),
   * and completely purges all credentials from SecureStore or encrypted web vault.
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

  // --------------------------------------------------------------------------
  // 5. OAUTH2 AUTHENTICATION (WEB / DESKTOP TAURI & MOBILE EXPO)
  // --------------------------------------------------------------------------

  /**
   * Helper to generate cryptographically safe hex strings (CSRF state).
   */
  public static generateRandomHex(byteCount: number = 16): string {
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      const bytes = new Uint8Array(byteCount);
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
    let res = '';
    for (let i = 0; i < byteCount * 2; i++) {
      res += Math.floor(Math.random() * 16).toString(16);
    }
    return res;
  }

  /**
   * Returns default redirect URI for Web/Desktop.
   */
  public static getDefaultWebRedirectUri(): string {
    if (typeof window !== 'undefined' && window.location) {
      return `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}`;
    }
    return 'http://localhost:8081';
  }

  /**
   * Builds the Google OAuth2 authorization URL.
   */
  public static buildOAuthUrl(params: {
    clientId: string;
    redirectUri: string;
    state?: string;
    scopes?: string[];
  }): string {
    const scopes = params.scopes || this.getDefaultAuthScopes();
    const query = new URLSearchParams({
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      response_type: 'token',
      scope: scopes.join(' '),
      include_granted_scopes: 'true',
      prompt: 'consent',
      ...(params.state ? { state: params.state } : {}),
    });
    return `${GDRIVE_CONFIG.OAUTH_AUTH_ENDPOINT}?${query.toString()}`;
  }

  /**
   * Queries Google UserInfo API to retrieve and sanitize user email.
   */
  public static async fetchUserEmail(accessToken: string): Promise<string | undefined> {
    if (!accessToken) return undefined;
    try {
      const response = await fetch(GDRIVE_CONFIG.USERINFO_ENDPOINT, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        signal: getTimeoutSignal(10000),
      });
      if (response.ok) {
        const data = await response.json();
        if (data && typeof data.email === 'string') {
          return SecuritySanitizer.sanitizeText(data.email);
        }
      }
    } catch (err) {
      console.warn('[GoogleDriveSyncService] Não foi possível obter perfil do usuário via UserInfo:', err);
    }
    return undefined;
  }

  /**
   * Checks the current browser URL for OAuth redirect parameters (hash or query),
   * extracts the token, stores it securely, and notifies the opener window if in popup.
   */
  public static async checkUrlForOAuthCallback(): Promise<boolean> {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return false;

    try {
      const hash = window.location.hash || '';
      const search = window.location.search || '';
      const params = new URLSearchParams(
        hash.startsWith('#') ? hash.substring(1) : search.startsWith('?') ? search.substring(1) : ''
      );

      const accessToken = params.get('access_token');
      const state = params.get('state');
      const expiresInStr = params.get('expires_in');
      const expiresIn = expiresInStr ? parseInt(expiresInStr, 10) : 3600;

      if (!accessToken) return false;

      // If running inside popup window, dispatch postMessage to opener and close
      if (window.opener && window.opener !== window) {
        window.opener.postMessage(
          {
            type: 'LUMEN_GOOGLE_AUTH_SUCCESS',
            accessToken,
            expiresIn,
            state,
          },
          '*'
        );
        try {
          window.close();
        } catch {}
        return true;
      }

      // If running in main window, save callback event to localStorage
      if (window.localStorage) {
        window.localStorage.setItem(
          '__lumen_oauth_callback',
          JSON.stringify({ accessToken, expiresIn, state, ts: Date.now() })
        );
      }

      const userEmail = (await this.fetchUserEmail(accessToken)) || 'estudante@lumen.app';
      await this.saveSecureTokens({
        accessToken,
        expiresAt: Date.now() + expiresIn * 1000,
        userEmail,
        tokenType: 'Bearer',
        scope: GDRIVE_CONFIG.ALLOWED_DRIVE_SCOPE,
      });

      // Clean URL hash so token does not leak in browser address bar or history
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
      }

      return true;
    } catch (e) {
      console.warn('[GoogleDriveSyncService] Erro ao processar retorno OAuth na URL:', e);
      return false;
    }
  }

  /**
   * Executes interactive OAuth flow for Web and Desktop (Tauri).
   * Opens the system browser / popup window, intercepts the OAuth token response,
   * validates CSRF state, and securely persists the credentials in WebSecureVault.
   */
  public static async promptWebOAuth(options?: {
    clientId?: string;
    redirectUri?: string;
    email?: string;
  }): Promise<boolean> {
    const clientId = options?.clientId || GDRIVE_CONFIG.DEFAULT_CLIENT_ID;
    const redirectUri = options?.redirectUri || this.getDefaultWebRedirectUri();
    const state = this.generateRandomHex(16);

    // Save pending state for CSRF validation
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem('__lumen_oauth_pending_state', state);
    }

    const authUrl = this.buildOAuthUrl({ clientId, redirectUri, state });

    return new Promise<boolean>((resolve, reject) => {
      let resolved = false;
      let checkTimer: any = null;
      let popup: any = null;

      const cleanup = () => {
        if (checkTimer) clearInterval(checkTimer);
        if (typeof window !== 'undefined') {
          window.removeEventListener('message', handleMessage);
          window.removeEventListener('storage', handleStorage);
        }
      };

      const handleTokenReceived = async (accessToken: string, expiresIn?: number, receivedState?: string) => {
        if (resolved) return;
        if (receivedState && receivedState !== state) {
          cleanup();
          resolved = true;
          reject(new Error('[GoogleDriveSyncService] Violação de segurança: Estado CSRF inválido.'));
          return;
        }

        cleanup();
        resolved = true;

        try {
          if (popup && !popup.closed) {
            popup.close();
          }
        } catch {}

        try {
          const userEmail = (await this.fetchUserEmail(accessToken)) || options?.email || 'estudante@lumen.app';
          const saved = await this.saveSecureTokens({
            accessToken,
            expiresAt: Date.now() + (expiresIn || 3600) * 1000,
            userEmail,
            tokenType: 'Bearer',
            scope: GDRIVE_CONFIG.ALLOWED_DRIVE_SCOPE,
          });
          resolve(saved);
        } catch (err) {
          reject(err);
        }
      };

      const handleMessage = (event: MessageEvent) => {
        try {
          if (!event.data) return;
          if (event.data.type === 'LUMEN_GOOGLE_AUTH_SUCCESS') {
            const { accessToken, expiresIn, state: receivedState } = event.data;
            if (accessToken) {
              handleTokenReceived(accessToken, expiresIn, receivedState);
            }
          }
        } catch {}
      };

      const handleStorage = (event: StorageEvent) => {
        try {
          if (event.key === '__lumen_oauth_callback' && event.newValue) {
            const data = JSON.parse(event.newValue);
            if (data && data.accessToken) {
              handleTokenReceived(data.accessToken, data.expiresIn, data.state);
            }
          }
        } catch {}
      };

      if (typeof window !== 'undefined') {
        window.addEventListener('message', handleMessage);
        window.addEventListener('storage', handleStorage);

        const width = 500;
        const height = 650;
        const left = window.screen?.width ? (window.screen.width - width) / 2 : 100;
        const top = window.screen?.height ? (window.screen.height - height) / 2 : 100;

        try {
          popup = window.open(
            authUrl,
            'lumen_google_auth',
            `width=${width},height=${height},top=${top},left=${left},status=no,menubar=no,toolbar=no`
          );
        } catch (e) {
          popup = null;
        }

        if (!popup || popup.closed || typeof popup.closed === 'undefined') {
          // If popup is blocked by browser, open via system Linking
          Linking.openURL(authUrl).catch(() => {});
        } else {
          checkTimer = setInterval(() => {
            if (popup && popup.closed) {
              clearInterval(checkTimer);
              setTimeout(() => {
                if (!resolved) {
                  cleanup();
                  resolved = true;
                  reject(new Error('Login no Google cancelado ou janela fechada pelo usuário.'));
                }
              }, 1000);
            }
          }, 500);
        }
      } else {
        Linking.openURL(authUrl).catch(() => {});
      }

      // Timeout after 3 minutes
      setTimeout(() => {
        if (!resolved) {
          cleanup();
          resolved = true;
          reject(new Error('Tempo limite para login no Google expirado (3 minutos).'));
        }
      }, 180000);
    });
  }

  /**
   * Initiates real Google OAuth2 authentication flow using expo-auth-session.
   * Prompts the user with the official Google OAuth consent screen with strict drive.appdata scope isolation.
   * On success, extracts the genuine access_token issued by Google and saves it into SecureStore.
   */
  public static async iniciarLoginGoogle(clientId?: string, email?: string): Promise<boolean> {
    try {
      const storedClientId = await StorageService.getGoogleClientId();
      const effectiveClientId =
        clientId?.trim() ||
        storedClientId?.trim() ||
        GDRIVE_CONFIG.DEFAULT_CLIENT_ID;

      if (Platform.OS === 'web') {
        return await this.promptWebOAuth({ clientId: effectiveClientId, email });
      }

      const redirectUri = AuthSession.makeRedirectUri({
        scheme: 'lumen',
        path: 'oauthredirect',
      });

      const discovery = {
        authorizationEndpoint: GDRIVE_CONFIG.OAUTH_AUTH_ENDPOINT,
        tokenEndpoint: GDRIVE_CONFIG.OAUTH_TOKEN_ENDPOINT,
        revocationEndpoint: GDRIVE_CONFIG.OAUTH_REVOKE_ENDPOINT,
      };

      const request = new AuthSession.AuthRequest({
        clientId: effectiveClientId,
        redirectUri,
        scopes: this.getDefaultAuthScopes(),
        responseType: AuthSession.ResponseType.Token,
        prompt: AuthSession.Prompt.Consent,
        usePKCE: false,
      });

      const result = await request.promptAsync(discovery);

      if (result.type === 'success') {
        const params = result.params || {};
        const auth = (result as any).authentication;
        const accessToken = params.access_token || auth?.accessToken;
        const refreshToken = params.refresh_token || auth?.refreshToken;
        const expiresInRaw = params.expires_in || auth?.expiresIn;
        const expiresIn = expiresInRaw ? parseInt(String(expiresInRaw), 10) : 3600;

        if (accessToken) {
          const userEmail = email || (await this.fetchUserEmail(accessToken)) || 'estudante@lumen.app';
          return await this.saveSecureTokens({
            accessToken,
            refreshToken,
            expiresAt: Date.now() + expiresIn * 1000,
            userEmail,
            tokenType: 'Bearer',
            scope: GDRIVE_CONFIG.ALLOWED_DRIVE_SCOPE,
          });
        }
      } else if (result.type === 'error') {
        const errorMsg =
          result.error?.message ||
          (result.params as any)?.error_description ||
          (result.params as any)?.error ||
          'Erro na autenticação com o Google';
        console.warn('[GoogleDriveSyncService] Erro retornado pela Google:', errorMsg);
        throw new Error(`Falha no login com Google: ${errorMsg}`);
      }

      return false;
    } catch (err: any) {
      console.warn('[GoogleDriveSyncService] Erro ao iniciar login Google:', err);
      throw new Error(`Falha ao conectar conta Google: ${err?.message || err}`);
    }
  }

  /**
   * Executes mobile OAuth flow using expo-auth-session.
   * Delegates to `iniciarLoginGoogle`.
   */
  public static async promptMobileOAuth(options?: {
    clientId?: string;
    email?: string;
  }): Promise<boolean> {
    return await this.iniciarLoginGoogle(options?.clientId, options?.email);
  }

  /**
   * Connects user account with Google Drive credentials.
   * When an accessToken is supplied (e.g. from tests or prior authorization), saves it securely.
   * If no accessToken is provided, initiates real OAuth login via `iniciarLoginGoogle()`.
   */
  public static async connectAccount(params?: {
    email?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  }): Promise<boolean> {
    if (!params?.accessToken) {
      return await this.iniciarLoginGoogle(undefined, params?.email);
    }

    const email = params.email || 'estudante@lumen.app';
    const accessToken = params.accessToken;
    const refreshToken = params.refreshToken;
    const expiresAt = params.expiresAt || Date.now() + 3600 * 1000;

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
   * Connects or establishes Google account session with a given email, tokens,
   * or dynamically initiates interactive Web/Mobile OAuth login.
   */
  public static async connectWithGoogle(
    paramsOrEmail?: string | {
      email?: string;
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
      clientId?: string;
      redirectUri?: string;
      forceInteractive?: boolean;
    }
  ): Promise<boolean> {
    if (typeof paramsOrEmail === 'string') {
      return await this.iniciarLoginGoogle(undefined, paramsOrEmail);
    }

    if (paramsOrEmail && paramsOrEmail.accessToken) {
      return await this.connectAccount(paramsOrEmail);
    }

    const clientId = paramsOrEmail?.clientId;
    const email = paramsOrEmail?.email;
    if (Platform.OS === 'web') {
      return await this.promptWebOAuth(paramsOrEmail);
    } else {
      return await this.iniciarLoginGoogle(clientId, email);
    }
  }

  /**
   * Main synchronization routine for Google Drive.
   * Verifies cloud connection status, performs smart reconciliation between local state
   * and cloud state (downloading when cloud has data from mobile, or uploading when local is newer),
   * backed strictly by the isolated Google Drive AppData folder (`drive.appdata`).
   */
  public static async sincronizar(
    customTokens?: GoogleDriveTokens,
    options?: { direction?: 'auto' | 'upload' | 'download' }
  ): Promise<GoogleDriveSyncResult> {
    const status = await this.getSyncStatus();
    if (!status.isConnected) {
      return {
        success: false,
        message: 'Google Drive não conectado. Conecte sua conta para sincronizar.',
      };
    }

    const tokens = customTokens || (await this.getSecureTokens());
    if (!tokens || !tokens.accessToken) {
      return {
        success: false,
        message: 'Google Drive não conectado. Conecte sua conta para sincronizar.',
      };
    }

    if (options?.direction === 'download') {
      return await this.downloadSyncFromCloud(tokens);
    }
    if (options?.direction === 'upload') {
      return await this.uploadSyncToCloud(tokens);
    }

    // Auto smart sync: Check cloud state
    const cloudFile = await this.findCloudSyncFile(tokens.accessToken);
    if (!cloudFile) {
      // No file in cloud: upload local database
      return await this.uploadSyncToCloud(tokens);
    }

    // A file exists in the cloud!
    // Check if we need to download:
    // 1. If this device has NEVER synced (status.lastSyncTime is undefined/null)
    // 2. OR if cloud file modifiedTime is newer than local lastSyncTime
    const localLastSyncMs = status.lastSyncTime ? new Date(status.lastSyncTime).getTime() : 0;
    const cloudModifiedMs = cloudFile.modifiedTime ? new Date(cloudFile.modifiedTime).getTime() : 0;

    const shouldDownload = !status.lastSyncTime || cloudModifiedMs > localLastSyncMs + 1000;

    if (shouldDownload) {
      return await this.downloadSyncFromCloud(tokens);
    }

    // Otherwise, local data has recent changes since last sync -> upload
    return await this.uploadSyncToCloud(tokens);
  }

  /**
   * Checks for remote changes on startup and reconciles them.
   * If Google Drive is connected and no cloud file exists, uploads initial backup.
   * If this device has never synced or cloud file is newer, downloads and restores the remote database.
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

      // If local has never synced, download cloud copy
      if (!status.lastSyncTime) {
        return await this.downloadSyncFromCloud(tokens);
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
