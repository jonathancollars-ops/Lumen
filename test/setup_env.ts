// Preload environment setup for Node test execution
(globalThis as any).__DEV__ = true;

// In-memory AsyncStorage implementation
export const memoryStore: Record<string, string> = {};

export const mockAsyncStorage = {
  getItem: async (key: string) => memoryStore[key] ?? null,
  setItem: async (key: string, value: string) => { memoryStore[key] = value; },
  removeItem: async (key: string) => { delete memoryStore[key]; },
  clear: async () => { Object.keys(memoryStore).forEach(k => delete memoryStore[k]); },
  multiRemove: async (keys: string[]) => { keys.forEach(k => delete memoryStore[k]); },
  multiGet: async (keys: string[]) => keys.map(k => [k, memoryStore[k] ?? null] as [string, string | null]),
  multiSet: async (pairs: [string, string][]) => { pairs.forEach(([k, v]) => { memoryStore[k] = v; }); },
  getAllKeys: async () => Object.keys(memoryStore),
};

// In-memory FileSystem store
export const mockFileSystemStore: Record<string, { exists: boolean; size: number; isDirectory: boolean }> = {};
export let mockFreeDiskStorageBytes = 10 * 1024 * 1024 * 1024; // 10 GB free by default
export function setMockFreeDiskStorageBytes(bytes: number) {
  mockFreeDiskStorageBytes = bytes;
}

export const appStateListeners: ((state: string) => void)[] = [];
export const mockAppState = {
  currentState: 'active',
  addEventListener: (type: string, listener: (state: any) => void) => {
    if (type === 'change') {
      appStateListeners.push(listener);
    }
    return {
      remove: () => {
        const idx = appStateListeners.indexOf(listener);
        if (idx !== -1) appStateListeners.splice(idx, 1);
      }
    };
  }
};
export function triggerAppStateChange(newState: 'active' | 'background' | 'inactive') {
  mockAppState.currentState = newState;
  appStateListeners.slice().forEach(listener => listener(newState));
}

export const lastAlertCalls: { title: string; message?: string; buttons?: any[] }[] = [];
export function clearMockAlertCalls() {
  lastAlertCalls.length = 0;
}
export const mockAlert = {
  alert: (title: string, message?: string, buttons?: any[]) => {
    lastAlertCalls.push({ title, message, buttons });
  }
};

export const linkingListeners: ((event: { url: string }) => void)[] = [];
export let initialLinkingUrl: string | null = null;
export function setInitialLinkingUrl(url: string | null) {
  initialLinkingUrl = url;
}
export function triggerLinkingUrl(url: string) {
  linkingListeners.slice().forEach(listener => listener({ url }));
}
export function clearLinkingListeners() {
  linkingListeners.length = 0;
  initialLinkingUrl = null;
}

export const mockExpoLinking = {
  parse: (url: string) => {
    try {
      let scheme = '';
      let urlToParse = url;
      const match = url.match(/^([a-zA-Z0-9+.-]+):\/\/(.*)$/);
      if (match) {
        scheme = match[1];
        urlToParse = `http://${match[2]}`;
      }
      const parsed = new URL(urlToParse);
      const queryParams: Record<string, string> = {};
      parsed.searchParams.forEach((val, key) => {
        queryParams[key] = val;
      });
      return {
        scheme: scheme || null,
        hostname: parsed.hostname,
        path: parsed.pathname.replace(/^\//, ''),
        queryParams,
      };
    } catch {
      return { scheme: null, hostname: null, path: null, queryParams: {} };
    }
  },
  addEventListener: (type: string, handler: (event: { url: string }) => void) => {
    if (type === 'url') {
      linkingListeners.push(handler);
    }
    return {
      remove: () => {
        const idx = linkingListeners.indexOf(handler);
        if (idx !== -1) linkingListeners.splice(idx, 1);
      }
    };
  },
  getInitialURL: async () => initialLinkingUrl,
  createURL: (path: string, options?: any) => `lumen://${path}`,
  openURL: async (url: string) => true,
  canOpenURL: async (url: string) => true,
};

// Hook require for Expo/React-Native modules
const Module = require('module');
export const mockReactNative = {
  Platform: { OS: 'ios', select: (obj: any) => obj.ios || obj.default },
  StyleSheet: { create: (styles: any) => styles },
  View: 'View',
  Text: 'Text',
  ScrollView: 'ScrollView',
  TouchableOpacity: 'TouchableOpacity',
  Alert: mockAlert,
  StatusBar: { setBarStyle: () => {} },
  ActivityIndicator: 'ActivityIndicator',
  Modal: 'Modal',
  Dimensions: { get: () => ({ width: 375, height: 812 }) },
  TextInput: 'TextInput',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Switch: 'Switch',
  AppState: mockAppState,
  Share: {
    share: async (content: any) => ({ action: 'sharedAction' }),
    sharedAction: 'sharedAction',
    dismissedAction: 'dismissedAction',
  },
  Linking: mockExpoLinking,
};

export const mockReactNativeCalendars = {
  Calendar: 'Calendar',
  LocaleConfig: { locales: {} as Record<string, any>, defaultLocale: 'pt-br' },
};

const origRequire = Module.prototype.require;

export const mockSecureStore: Record<string, string> = {};
export const mockSecureStoreImpl = {
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  setItemAsync: async (k: string, v: string) => { mockSecureStore[k] = v; },
  getItemAsync: async (k: string) => mockSecureStore[k] ?? null,
  deleteItemAsync: async (k: string) => { delete mockSecureStore[k]; },
};

export const mockNotifications = {
  setNotificationHandler: () => {},
  setNotificationChannelAsync: async () => {},
  getPermissionsAsync: async () => ({ status: 'granted' }),
  requestPermissionsAsync: async () => ({ status: 'granted' }),
  scheduleNotificationAsync: async () => 'mock_notif_id',
  getAllScheduledNotificationsAsync: async () => [],
  cancelScheduledNotificationAsync: async () => {},
  addNotificationResponseReceivedListener: (_listener: (response: any) => void) => ({ remove() {} }),
  getLastNotificationResponse: () => null,
  clearLastNotificationResponse: () => {},
  AndroidImportance: { MAX: 5 },
  SchedulableTriggerInputTypes: {
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly',
    DATE: 'date',
  },
};

(mockAsyncStorage as any).default = mockAsyncStorage;

// Web Mock Storage (localStorage & sessionStorage)
export class MockStorage {
  private store: Record<string, string> = {};
  get length(): number {
    return Object.keys(this.store).length;
  }
  key(index: number): string | null {
    return Object.keys(this.store)[index] || null;
  }
  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}

export const mockLocalStorage = new MockStorage();
export const mockSessionStorage = new MockStorage();

if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}
(globalThis as any).localStorage = mockLocalStorage;
(globalThis as any).sessionStorage = mockSessionStorage;
(globalThis as any).window.localStorage = mockLocalStorage;
(globalThis as any).window.sessionStorage = mockSessionStorage;

// Mock Tauri IPC internals for desktop test simulation
export const mockTauriState: {
  availablePort: number;
  oauthCode: string | null;
  serverStartedPort: number | null;
  openedUrls: string[];
  desktopInstallerDownloadedUrl: string | null;
  progressListeners: ((event: any) => void)[];
} = {
  availablePort: 8080,
  oauthCode: 'mock_tauri_pkce_auth_code_789',
  serverStartedPort: null,
  openedUrls: [],
  desktopInstallerDownloadedUrl: null,
  progressListeners: [],
};

export const resetMockTauriState = () => {
  mockTauriState.availablePort = 8080;
  mockTauriState.oauthCode = 'mock_tauri_pkce_auth_code_789';
  mockTauriState.serverStartedPort = null;
  mockTauriState.openedUrls = [];
  mockTauriState.desktopInstallerDownloadedUrl = null;
  mockTauriState.progressListeners = [];
};

(globalThis as any).window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener: (_event: string, _eventId: number) => {},
};

(globalThis as any).window.__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args?: any) => {
    if (cmd === 'get_available_port') return mockTauriState.availablePort;
    if (cmd === 'start_oauth_server') {
      mockTauriState.serverStartedPort = args?.port;
      return true;
    }
    if (cmd === 'poll_oauth_code') return mockTauriState.oauthCode;
    if (cmd === 'plugin:shell|open') {
      mockTauriState.openedUrls.push(args?.path);
      return null;
    }
    if (cmd === 'download_and_run_desktop_installer') {
      mockTauriState.desktopInstallerDownloadedUrl = args?.url || null;
      // Trigger progress callbacks if registered
      mockTauriState.progressListeners.forEach((listener) => {
        listener({
          event: 'desktop-update-progress',
          payload: { progress: 0.5, totalBytes: 50000000, downloadedBytes: 25000000 },
        });
        listener({
          event: 'desktop-update-progress',
          payload: { progress: 1.0, totalBytes: 50000000, downloadedBytes: 50000000 },
        });
      });
      return null;
    }
    if (cmd === 'plugin:event|listen') {
      return 1;
    }
    if (cmd === 'plugin:event|unlisten') {
      return null;
    }
    return null;
  },
  transformCallback: (callback: any) => {
    mockTauriState.progressListeners.push(callback);
    return mockTauriState.progressListeners.length;
  },
};

// Mock expo-auth-session
export let mockAuthRequestPromptResult: any = {
  type: 'success',
  params: { access_token: 'mock_access_token_from_auth_session', expires_in: '3600' },
  authentication: { accessToken: 'mock_access_token_from_auth_session', expiresIn: 3600 },
};
export function setMockAuthRequestPromptResult(result: any) {
  mockAuthRequestPromptResult = result;
}

export const mockAuthSession = {
  makeRedirectUri: (options?: any) => (options?.scheme ? `${options.scheme}://oauthredirect` : 'http://localhost:8081'),
  startAsync: async (options: any) => ({
    type: 'success',
    params: { access_token: 'mock_access_token_123', expires_in: '3600' },
  }),
  dismiss: () => {},
  getDefaultReturnUrl: () => 'http://localhost:8081',
  ResponseType: { Token: 'token', Code: 'code' },
  Prompt: { Consent: 'consent', SelectAccount: 'select_account' },
  AuthRequest: class {
    config: any;
    codeVerifier?: string;
    constructor(config: any) {
      this.config = config;
      (globalThis as any).__lastAuthRequestConfig = config;
    }
    promptAsync = async (discovery?: any) => {
      (globalThis as any).__lastAuthRequestDiscovery = discovery;
      return mockAuthRequestPromptResult;
    };
  },
};

export const mockCrypto = {
  randomUUID: () => 'mock-uuid-1234',
  digestStringAsync: async () => 'mock-digest',
  getRandomBytes: (byteCount: number) => new Uint8Array(byteCount),
  getRandomBytesAsync: async (byteCount: number) => new Uint8Array(byteCount),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
};

Module.prototype.require = function (id: string) {
  if (id === 'expo-crypto') {
    return mockCrypto;
  }
  if (id === 'expo-auth-session' || id.startsWith('expo-auth-session/')) {
    return mockAuthSession;
  }
  if (id === '@react-native-community/slider') return 'Slider';
  if (id === 'expo-linking') {
    return mockExpoLinking;
  }
  if (id === 'expo-secure-store') {
    return mockSecureStoreImpl;
  }
  if (id === '@react-native-async-storage/async-storage') {
    return mockAsyncStorage;
  }
  if (id === 'react-native') {
    return mockReactNative;
  }
  if (id === 'react-native-calendars') {
    return mockReactNativeCalendars;
  }
  if (id === 'expo-notifications') {
    return mockNotifications;
  }
  if (id === '@react-navigation/native') {
    return {
      useNavigation: () => ({
        navigate: () => {},
        goBack: () => {},
        setOptions: () => {},
        addListener: () => () => {},
      }),
      useNavigationContainerRef: () => ({
        navigate: () => {},
        isReady: () => true,
        getCurrentRoute: () => ({ name: 'Agenda' }),
      }),
      NavigationContainer: ({ children }: any) => children,
      DefaultTheme: { dark: false, colors: {} },
      DarkTheme: { dark: true, colors: {} },
      useRoute: () => ({ params: {} }),
      useIsFocused: () => true,
    };
  }
  if (id === '@react-navigation/bottom-tabs') {
    return {
      createBottomTabNavigator: () => ({
        Navigator: ({ children }: any) => children,
        Screen: ({ children }: any) => children,
      }),
    };
  }
  if (id === 'expo-haptics') {
    return {
      selectionAsync: async () => {},
      impactAsync: async () => {},
      notificationAsync: async () => {},
      ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
      NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' }
    };
  }
  if (id === 'react-native-safe-area-context') {
    return {
      SafeAreaView: 'SafeAreaView',
      useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
      SafeAreaProvider: 'SafeAreaProvider',
    };
  }
const fileSystemMock = {
  documentDirectory: 'file:///mock_sandbox_app/files/',
  cacheDirectory: 'file:///mock_sandbox_app/cache/',
  getInfoAsync: async (uri: string) => {
    if (mockFileSystemStore[uri]) {
      return { exists: true, isDirectory: mockFileSystemStore[uri].isDirectory, size: mockFileSystemStore[uri].size, uri };
    }
    return { exists: false, isDirectory: false, uri };
  },
  getFreeDiskStorageAsync: async () => mockFreeDiskStorageBytes,
  makeDirectoryAsync: async (dirUri: string) => {
    mockFileSystemStore[dirUri] = { exists: true, isDirectory: true, size: 0 };
  },
  deleteAsync: async (uri: string) => {
    delete mockFileSystemStore[uri];
  },
  createDownloadResumable: (url: string, fileUri: string, options: any, callback: any) => {
    let isPaused = false;
    let isCancelled = false;
    return {
      downloadAsync: async () => {
        if (isCancelled) throw new Error('Download cancelado');
        const totalBytes = 800000000;
        if (callback) {
          callback({ totalBytesWritten: Math.floor(totalBytes / 2), totalBytesExpectedToWrite: totalBytes });
          callback({ totalBytesWritten: totalBytes, totalBytesExpectedToWrite: totalBytes });
        }
        mockFileSystemStore[fileUri] = { exists: true, isDirectory: false, size: totalBytes };
        return { uri: fileUri, status: 200 };
      },
      pauseAsync: async () => {
        isPaused = true;
        return { url, fileUri, options, resumeData: 'mock_resume_data' };
      },
      resumeAsync: async () => {
        isPaused = false;
        return { uri: fileUri, status: 200 };
      },
      cancelAsync: async () => {
        isCancelled = true;
        delete mockFileSystemStore[fileUri];
      }
    };
  },
  getContentUriAsync: async (uri: string) => `content://com.lumen.fileprovider/files/${uri.split('/').pop()}`,
  writeAsStringAsync: async (uri: string, contents: string, options?: any) => {
    mockFileSystemStore[uri] = { exists: true, isDirectory: false, size: contents.length };
  },
  readAsStringAsync: async (uri: string, options?: any) => '',
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
};

const intentLauncherMock = {
  startActivityAsync: async (action: string, options: any) => {
    (globalThis as any).__mockIntentOptions = { action, options };
    
    if ((globalThis as any).__mockIntentThrow) {
      if (action === 'android.settings.MANAGE_UNKNOWN_APP_SOURCES') {
         return { action: 'android.intent.action.VIEW' };
      }
      throw new Error('SecurityException: UID 10123 does not have permission to install packages');
    }
    
    if (action === 'android.settings.MANAGE_UNKNOWN_APP_SOURCES') {
       return { action: 'android.intent.action.VIEW' };
    }
    return { action };
  }
};

  if (id === 'expo-file-system' || id === 'expo-file-system/legacy') {
    return fileSystemMock;
  }
  if (id === 'expo-intent-launcher') {
    return intentLauncherMock;
  }
  return origRequire.apply(this, arguments);
};
