import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
  Switch,
  Alert,
  Platform,
  ActivityIndicator,
  StatusBar as RNStatusBar,
  Linking
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemeType, AppSettings, Semester, BackupData, AIConfig, AppUpdateInfo } from '../types';
import { getThemeColors, getContrastTextColor } from '../theme';
import { StorageService } from '../services/storage';
import { AppUpdateService } from '../services/AppUpdateService';
import { GoogleAuthService } from '../services/GoogleAuthService';
import { describeGoogleLoginError, GoogleLoginError, GoogleLoginStage, GOOGLE_LOGIN_STAGE_LABELS } from '../services/GoogleMobileAuthFlow';
import * as Google from 'expo-auth-session/providers/google';
import { generateId } from '../utils/id';
import { APP_VERSION } from '../utils/version';
import type { CloudSyncStatus } from '../services/CloudSyncEngine';
import * as Haptics from 'expo-haptics';


export interface SettingsModalProps {
  syncCloudNow?: () => Promise<{ success: boolean; message: string }>;
  cloudSyncStatus?: CloudSyncStatus;
  visible: boolean;
  onClose: () => void;
  theme: ThemeType;
  onThemeChange: (theme: ThemeType) => void;
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
  semesters?: Semester[];
  onUpdateSemesters?: (semesters: Semester[]) => void;
  aiConfig?: AIConfig;
  onUpdateAIConfig?: (config: AIConfig) => Promise<boolean>;
  onOpenGuide?: () => void;
  onRestoreSuccess?: () => void;
  onCheckUpdates?: () => void;
  onOpenUpdateModal?: (info: AppUpdateInfo) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  visible,
  onClose,
  theme,
  onThemeChange,
  settings,
  onUpdateSettings,
  semesters = [],
  onUpdateSemesters,
  aiConfig: externalAIConfig,
  onUpdateAIConfig,
  onOpenGuide,
  onRestoreSuccess,
  onCheckUpdates,
  onOpenUpdateModal,
  syncCloudNow,
  cloudSyncStatus,
}) => {
  const colors = getThemeColors(theme);
  const styles = getStyles(colors);

  const [activeSubTab, setActiveSubTab] = useState<'geral' | 'semestres' | 'ia' | 'backup'>('geral');
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const [aiConfig, setAiConfig] = useState<AIConfig>({
    provider: 'gemini',
    mode: 'cloud',
    apiKey: '',
    model: 'gemini-3.6-flash',
    enableFallbackToCloud: true
  });

  // Semester management
  const [newSemesterName, setNewSemesterName] = useState('');

  // Backup state
  const [backupJsonText, setBackupJsonText] = useState('');
  const [isExporting, setIsExporting] = useState(false);


  // Firebase Cloud Sync State
  const [firebaseUser, setFirebaseUser] = useState(() => GoogleAuthService.getCurrentUser());
  const [isSyncing, setIsSyncing] = useState(false);
  const [isConnectingCloud, setIsConnectingCloud] = useState(false);
  const [googleLoginStatus, setGoogleLoginStatus] = useState('');
  const googleLoginAttempt = useRef(0);
  const googleLoginRunning = useRef(false);

  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  // expo-auth-session Google hook (for Android/iOS)
  const [request, , promptAsync] = Google.useAuthRequest(
    { ...GoogleAuthService.getGoogleAuthConfig(), shouldAutoExchangeCode: false }
  );

  // Discard UI updates from attempts belonging to an unmounted screen.
  React.useEffect(() => {
    const unsubscribe = GoogleAuthService.onAuthChange((user) => {
      setFirebaseUser(user);
      if (user) setGoogleLoginStatus('Conta conectada.');
      else if (!googleLoginRunning.current) setGoogleLoginStatus('');
    });
    return () => { googleLoginAttempt.current++; unsubscribe(); };
  }, []);

  // Stay in sync with Firebase auth state
  React.useEffect(() => {
    if (visible) {
      setFirebaseUser(GoogleAuthService.getCurrentUser());
    }
  }, [visible]);



  // Settings local state with defensive null-coalescing
  const [fullscreen, setFullscreen] = useState(settings?.fullscreen === true);
  const [focusMin, setFocusMin] = useState((settings?.pomodoroFocusMin ?? 25).toString());
  const [breakMin, setBreakMin] = useState((settings?.pomodoroBreakMin ?? 5).toString());
  const [passGrade, setPassGrade] = useState((settings?.defaultPassGrade ?? 7.0).toString());
  const [soundEnabled, setSoundEnabled] = useState(settings?.soundEnabled ?? true);
  const [hapticsEnabled, setHapticsEnabled] = useState(settings?.hapticsEnabled ?? true);
  const [examWeekMode, setExamWeekMode] = useState(settings?.examWeekMode ?? false);

  React.useEffect(() => {
    if (visible) {
      setFullscreen(settings?.fullscreen === true);
      setFocusMin((settings?.pomodoroFocusMin ?? 25).toString());
      setBreakMin((settings?.pomodoroBreakMin ?? 5).toString());
      setPassGrade((settings?.defaultPassGrade ?? 7.0).toString());
      setSoundEnabled(settings?.soundEnabled ?? true);
      setHapticsEnabled(settings?.hapticsEnabled ?? true);
      setExamWeekMode(settings?.examWeekMode ?? false);
      setBackupJsonText('');
      if (externalAIConfig && typeof externalAIConfig.apiKey === 'string') {
        setAiConfig(externalAIConfig);
      }
      loadAIData();
    }
  }, [visible, settings, externalAIConfig]);

  const loadAIData = async () => {
    try {
      const savedAIConfig = await StorageService.getAIConfig();
      if (savedAIConfig) {
        setAiConfig(savedAIConfig);
      }
    } catch (e) {
      console.warn('Erro ao carregar dados de IA:', e);
    }
  };



  const handleSaveSettings = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    // Sanitize Pomodoro Focus Time (1 - 180 min)
    let cleanFocus = parseInt(focusMin, 10);
    if (isNaN(cleanFocus) || cleanFocus < 1) cleanFocus = 25;
    else if (cleanFocus > 180) cleanFocus = 180;

    // Sanitize Pomodoro Break Time (1 - 60 min)
    let cleanBreak = parseInt(breakMin, 10);
    if (isNaN(cleanBreak) || cleanBreak < 1) cleanBreak = 5;
    else if (cleanBreak > 60) cleanBreak = 60;

    // Sanitize Pass Grade (0 - 10)
    let cleanGrade = parseFloat(passGrade.replace(',', '.'));
    if (isNaN(cleanGrade) || cleanGrade < 0) cleanGrade = 7.0;
    else if (cleanGrade > 10) cleanGrade = 10.0;

    const updated: AppSettings = {
      ...settings,
      fullscreen,
      pomodoroFocusMin: cleanFocus,
      pomodoroBreakMin: cleanBreak,
      defaultPassGrade: cleanGrade,
      soundEnabled,
      hapticsEnabled,
      examWeekMode,
    };
    if (onUpdateSettings) {
      onUpdateSettings(updated);
    }
    await StorageService.saveSettings(updated);
    Alert.alert('Sucesso', 'Configurações salvas com sucesso!');
  };

  const safeSemesters = Array.isArray(semesters) ? semesters : [];

  const handleAddSemester = () => {
    if (!newSemesterName.trim()) return;
    Haptics.selectionAsync();
    const newSem: Semester = {
      id: generateId('sem'),
      name: newSemesterName.trim(),
      isCurrent: safeSemesters.length === 0,
      isArchived: false,
    };
    const updated = [...safeSemesters, newSem];
    if (onUpdateSemesters) {
      onUpdateSemesters(updated);
    }
    StorageService.saveSemesters(updated);
    setNewSemesterName('');
  };

  const toggleCurrentSemester = (semId: string) => {
    Haptics.selectionAsync();
    const updated = safeSemesters.map(s => ({
      ...s,
      isCurrent: s.id === semId
    }));
    if (onUpdateSemesters) {
      onUpdateSemesters(updated);
    }
    StorageService.saveSemesters(updated);
  };

  const toggleArchiveSemester = (semId: string) => {
    Haptics.selectionAsync();
    const updated = safeSemesters.map(s => s.id === semId ? { ...s, isArchived: !s.isArchived } : s);
    if (onUpdateSemesters) {
      onUpdateSemesters(updated);
    }
    StorageService.saveSemesters(updated);
  };

  const handleDeleteSemester = (semId: string) => {
    Alert.alert('Excluir Semestre', 'Deseja remover este semestre da lista?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          const updated = safeSemesters.filter(s => s.id !== semId);
          if (onUpdateSemesters) {
            onUpdateSemesters(updated);
          }
          StorageService.saveSemesters(updated);
        }
      }
    ]);
  };

  const handleExportBackup = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsExporting(true);
    try {
      const backupData = await StorageService.exportBackup();
      const json = JSON.stringify(backupData, null, 2);
      setBackupJsonText(json);
      Alert.alert('Backup Gerado!', 'Os dados foram formatados em JSON abaixo. Você pode copiá-los para guardar em segurança.');
    } catch (e: any) {
      Alert.alert('Erro ao exportar', e?.message || 'Falha na exportação.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportBackup = async () => {
    if (!backupJsonText.trim()) {
      Alert.alert('Aviso', 'Cole o JSON de backup na caixa de texto primeiro.');
      return;
    }

    try {
      const parsed: BackupData = JSON.parse(backupJsonText);
      await StorageService.importBackup(parsed);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Backup Restaurado!', 'Todos os seus eventos, matérias e dados foram restaurados com sucesso.', [
        {
          text: 'OK',
          onPress: () => {
            if (onRestoreSuccess) {
              onRestoreSuccess();
            }
            onClose();
          }
        }
      ]);
    } catch (e: any) {
      Alert.alert('Erro ao restaurar', 'JSON inválido ou corrompido: ' + (e?.message || ''));
    }
  };

  const formatRelativeSyncTime = (isoString?: string): string => {
    if (!isoString) return 'Nunca sincronizado';
    try {
      const syncDate = new Date(isoString).getTime();
      if (isNaN(syncDate)) return 'Data desconhecida';
      const diffSeconds = Math.max(0, Math.floor((Date.now() - syncDate) / 1000));
      if (diffSeconds < 60) return 'Agora mesmo';
      const diffMinutes = Math.floor(diffSeconds / 60);
      if (diffMinutes === 1) return 'Há 1 minuto';
      if (diffMinutes < 60) return `Há ${diffMinutes} minutos`;
      const diffHours = Math.floor(diffMinutes / 60);
      if (diffHours === 1) return 'Há 1 hora';
      if (diffHours < 24) return `Há ${diffHours} horas`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays === 1) return 'Há 1 dia';
      return `Há ${diffDays} dias`;
    } catch {
      return 'Data desconhecida';
    }
  };


  const handleSyncNow = async () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setIsSyncing(true);
    try {
      if (!syncCloudNow) throw new Error('A sincronização ainda não está disponível.');
      const result = await syncCloudNow();
      Alert.alert(result.success ? 'Sincronização concluída' : 'Falha na sincronização', result.message);
    } catch (error: any) {
      Alert.alert('Erro ao Sincronizar', error?.message || 'Falha na conexão com o Firebase.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleConnectGoogle = async () => {
    if (googleLoginRunning.current) return;
    googleLoginRunning.current = true;
    const attempt = ++googleLoginAttempt.current;
    setIsConnectingCloud(true);
    setGoogleLoginStatus(isTauri ? 'Preparando o login no Windows…' : 'Aguardando retorno do Google…');
    const onStage = (stage: GoogleLoginStage) => {
      if (googleLoginAttempt.current === attempt) setGoogleLoginStatus(`${GOOGLE_LOGIN_STAGE_LABELS[stage]}…`);
    };
    try {
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      if (isTauri) {
        // Desktop: PKCE loopback flow
        const user = await GoogleAuthService.signInDesktop(onStage);
        if (user) {
          setFirebaseUser(user);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert('Conta Conectada!', `Bem-vindo, ${user.displayName ?? user.email}! Seu backup está sendo sincronizado.`);
        } else {
          setGoogleLoginStatus('Não foi possível iniciar o login no Windows.');
          Alert.alert('Erro', 'Não foi possível conectar com o Google. Tente novamente.');
        }
      } else if (Platform.OS === 'web') {
        // Web: native Firebase Popup flow (handles OAuth internally, no redirect_uri mismatch!)
        const user = await GoogleAuthService.signInWeb();
        if (user) {
          setFirebaseUser(user);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert('Conta Conectada!', `Bem-vindo, ${user.displayName ?? user.email}! Seu backup está sendo sincronizado.`);
        } else setGoogleLoginStatus('A conexão não foi concluída. A janela de login pode ter sido fechada.');
      } else {
        if (!request) throw new GoogleLoginError('browser', 'request_not_ready');
        const user = await GoogleAuthService.signInMobile(request, () => promptAsync(), onStage);
        if (googleLoginAttempt.current === attempt) {
          setFirebaseUser(user);
          setGoogleLoginStatus('Conta conectada.');
          Alert.alert('Conta conectada', 'Login concluído. A sincronização dos dados será iniciada.');
        }
      }
    } catch (error: any) {
      if (googleLoginAttempt.current === attempt) {
        const message = describeGoogleLoginError(error);
        setGoogleLoginStatus(message);
        Alert.alert(`Conexão não concluída — Lumen ${APP_VERSION}`, message);
      }
    } finally {
      googleLoginRunning.current = false;
      if (googleLoginAttempt.current === attempt) setIsConnectingCloud(false);
    }
  };

  const handleDisconnectGoogle = () => {
    Alert.alert(
      'Desconectar Google',
      'Deseja desconectar sua conta? Seus dados locais permanecerão salvos no aparelho.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Desconectar',
          style: 'destructive',
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await GoogleAuthService.signOut();
            setFirebaseUser(null);
            Alert.alert('Desconectado', 'Sua conta Google foi desconectada.');
          }
        }
      ]
    );
  };



  const handleCheckForUpdates = async () => {
    Haptics.selectionAsync();
    setIsCheckingUpdate(true);
    try {
      const info = await AppUpdateService.checkForUpdates(true);
      if (info && info.hasUpdate) {
        if (onOpenUpdateModal) {
          onOpenUpdateModal(info);
        } else if (onCheckUpdates) {
          onCheckUpdates();
        }
      } else {
        const currentVer = AppUpdateService.getCurrentVersion();
        Alert.alert(
          'Lumen Atualizado!',
          `Você já está usando a versão mais recente (v${currentVer})!`
        );
      }
    } catch (error) {
      Alert.alert(
        'Erro ao verificar',
        'Não foi possível checar atualizações. Verifique sua conexão com a internet.'
      );
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
            <Text style={{ fontSize: 15, color: colors.primary, fontWeight: '700' }}>✕ Fechar</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Configurações</Text>
          <TouchableOpacity onPress={handleSaveSettings} style={styles.saveBtn} activeOpacity={0.7}>
            <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 15 }}>Salvar</Text>
          </TouchableOpacity>
        </View>

        {/* Sub tabs */}
        <View style={styles.subTabs}>
          {[
            { id: 'geral', label: '⚙️ Geral' },
            { id: 'ia', label: '✨ IA & Tutor' },
            { id: 'backup', label: '☁️ Backup & Nuvem' }
          ].map(t => {
            const isSelected = activeSubTab === t.id;
            return (
              <TouchableOpacity
                key={t.id}
                style={[
                  styles.subTab,
                  isSelected && { borderBottomColor: colors.primary, borderBottomWidth: 3 }
                ]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setActiveSubTab(t.id as any);
                }}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.subTabText,
                    {
                      color: isSelected ? colors.primary : colors.textSecondary,
                      fontWeight: isSelected ? '800' : '600',
                      fontSize: 11
                    }
                  ]}
                >
                  {t.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {activeSubTab === 'geral' ? (
            <>
              {/* Theme Picker */}
              <Text style={styles.sectionTitle}>Aparência & Tema</Text>
              <View style={styles.row}>
                {[
                  { id: 'dark', label: '🌙 Escuro' },
                  { id: 'light', label: '☀️ Claro' },
                  { id: 'amoled', label: '🖤 AMOLED' }
                ].map(th => {
                  const isSelected = theme === th.id;
                  return (
                    <TouchableOpacity
                      key={th.id}
                      style={[
                        styles.themeOption,
                        {
                          backgroundColor: isSelected ? colors.primary : colors.surface,
                          borderColor: isSelected ? colors.primary : colors.border,
                          borderWidth: 1
                        }
                      ]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        onThemeChange(th.id as ThemeType);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={{
                        color: isSelected ? getContrastTextColor(colors.primary) : colors.text,
                        fontWeight: '700',
                        fontSize: 13
                      }}>
                        {th.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Modo Tela Cheia */}
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 16 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1, marginRight: 10 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🖥️ Modo Tela Cheia</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 16 }}>
                      {fullscreen ? 'Status bar oculta (visual imersivo de borda a borda).' : 'Status bar visível (padrão com relógio e ícones do sistema).'}
                    </Text>
                  </View>
                  <Switch
                    value={fullscreen}
                    onValueChange={(val) => {
                      Haptics.selectionAsync();
                      setFullscreen(val);
                      const updated: AppSettings = { ...settings, fullscreen: val };
                      onUpdateSettings(updated);
                      StorageService.saveSettings(updated);
                    }}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor={fullscreen ? '#fff' : '#f4f3f4'}
                  />
                </View>
              </View>

              {/* Modo Semana de Provas */}
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 16 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1, marginRight: 10 }}>
                    <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15 }}>🎯 Modo Semana de Provas</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 16 }}>
                      Filtra a agenda para destacar apenas Provas e Trabalhos urgentes.
                    </Text>
                  </View>
                  <Switch
                    value={examWeekMode}
                    onValueChange={(val) => {
                      Haptics.selectionAsync();
                      setExamWeekMode(val);
                    }}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor={examWeekMode ? '#fff' : '#f4f3f4'}
                  />
                </View>
              </View>

              {/* Pomodoro settings */}
              <Text style={[styles.sectionTitle, { marginTop: 22 }]}>Preferências do Pomodoro</Text>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.settingRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>Tempo de Foco (minutos)</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>Mínimo 1m • Máximo 180m</Text>
                  </View>
                  <TextInput
                    style={[styles.smallInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                    keyboardType="numeric"
                    maxLength={3}
                    value={focusMin}
                    onChangeText={(val) => setFocusMin(val.replace(/\D/g, ''))}
                  />
                </View>

                <View style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: colors.borderSubtle }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>Pausa Curta (minutos)</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>Mínimo 1m • Máximo 60m</Text>
                  </View>
                  <TextInput
                    style={[styles.smallInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                    keyboardType="numeric"
                    maxLength={2}
                    value={breakMin}
                    onChangeText={(val) => setBreakMin(val.replace(/\D/g, ''))}
                  />
                </View>
              </View>

              {/* Sobre o Lumen & Atualizações */}
              <Text style={[styles.sectionTitle, { marginTop: 22 }]}>Sobre o Lumen</Text>
              
              <TouchableOpacity
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }]}
                onPress={handleCheckForUpdates}
                disabled={isCheckingUpdate}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 10 }}>
                  <Text style={{ fontSize: 20, marginRight: 10 }}>🔍</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>Verificar Atualizações</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 1 }}>Versão instalada: v{APP_VERSION}</Text>
                  </View>
                </View>
                <View style={{ backgroundColor: colors.primaryLight, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, minWidth: 70, alignItems: 'center', justifyContent: 'center' }}>
                  {isCheckingUpdate ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '800' }}>Checar</Text>
                  )}
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }]}
                onPress={() => {
                  Haptics.selectionAsync();
                  Linking.openURL('https://github.com/jonathancollars-ops/organiza/releases/latest');
                }}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 10 }}>
                  <Text style={{ fontSize: 20, marginRight: 10 }}>🌐</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>Baixar APK via GitHub</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 1 }}>Download direto do último instalador (Releases)</Text>
                  </View>
                </View>
                <Text style={{ color: colors.primary, fontSize: 18, fontWeight: '700' }}>↗</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}
                onPress={() => {
                  Haptics.selectionAsync();
                  onClose();
                  if (onOpenGuide) onOpenGuide();
                }}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ fontSize: 20, marginRight: 10 }}>📖</Text>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>Abrir Guia do Usuário</Text>
                </View>
                <Text style={{ color: colors.primary, fontSize: 18, fontWeight: '700' }}>›</Text>
              </TouchableOpacity>
            </>
          ) : activeSubTab === 'semestres' ? (
            <>
              <Text style={styles.sectionTitle}>Períodos Letivos / Semestres</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 14, lineHeight: 18 }}>
                Organize suas matérias por semestre letivo para arquivar períodos passados facilmente.
              </Text>

              {/* Add semester input */}
              <View style={{ flexDirection: 'row', marginBottom: 18 }}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0, marginRight: 8, color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
                  placeholder="Ex: 2026.1, 2026.2"
                  placeholderTextColor={colors.textSecondary}
                  value={newSemesterName}
                  onChangeText={setNewSemesterName}
                />
                <TouchableOpacity
                  style={[styles.addBtn, { backgroundColor: colors.primary }]}
                  onPress={handleAddSemester}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: getContrastTextColor(colors.primary), fontWeight: '800' }}>+ Adicionar</Text>
                </TouchableOpacity>
              </View>

              {/* Semester list */}
              {safeSemesters.length === 0 ? (
                <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, alignItems: 'center', padding: 25 }]}>
                  <Text style={{ fontSize: 32, marginBottom: 8 }}>🎓</Text>
                  <Text style={{ color: colors.textSecondary, textAlign: 'center', fontWeight: '500' }}>
                    Nenhum semestre cadastrado. Adicione um para organizar suas matérias.
                  </Text>
                </View>
              ) : (
                safeSemesters.map(sem => (
                  <View
                    key={sem.id}
                    style={[
                      styles.card,
                      {
                        backgroundColor: colors.surface,
                        borderColor: sem.isCurrent ? colors.primary : colors.border,
                        borderWidth: sem.isCurrent ? 2 : 1,
                        marginBottom: 10
                      }
                    ]}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>
                          {sem.name} {sem.isCurrent && <Text style={{ color: colors.primary, fontSize: 13 }}>(Atual)</Text>}
                        </Text>
                        {sem.isArchived && (
                          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>Arquivado</Text>
                        )}
                      </View>

                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {!sem.isCurrent && (
                          <TouchableOpacity
                            style={[styles.smallBtn, { borderColor: colors.primary, borderWidth: 1 }]}
                            onPress={() => toggleCurrentSemester(sem.id)}
                            activeOpacity={0.7}
                          >
                            <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>Definir Atual</Text>
                          </TouchableOpacity>
                        )}

                        <TouchableOpacity
                          style={[styles.smallBtn, { borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surfaceSubtle }]}
                          onPress={() => toggleArchiveSemester(sem.id)}
                          activeOpacity={0.7}
                        >
                          <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600' }}>
                            {sem.isArchived ? 'Desarquivar' : 'Arquivar'}
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.smallBtn, { borderColor: colors.danger, borderWidth: 1, backgroundColor: colors.dangerLight }]}
                          onPress={() => handleDeleteSemester(sem.id)}
                          activeOpacity={0.7}
                        >
                          <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '800' }}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ))
              )}
            </>
          ) : (
            <>
              {/* ======================================================= */}
              {/* SEÇÃO 1: Sincronização em Nuvem (Firebase)             */}
              {/* ======================================================= */}
              <Text style={styles.sectionTitle}>Sincronização em Nuvem (Firebase)</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 14, lineHeight: 18 }}>
                Mantenha seus dados sempre salvos e sincronizados automaticamente no Firebase. Funciona no Android e no PC.
              </Text>

              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: firebaseUser ? colors.primary : colors.border,
                    borderWidth: 1.5,
                    padding: 16,
                    borderRadius: 16,
                    marginBottom: 20,
                  }
                ]}
              >
                {firebaseUser ? (

                  <>
                    <Text accessibilityLiveRegion="polite" style={{ color: cloudSyncStatus?.state === 'error' ? colors.danger : colors.textSecondary, marginBottom: 12, lineHeight: 20 }}>
                      {cloudSyncStatus?.message ?? 'Preparando a sincronização…'}
                      {cloudSyncStatus?.lastSyncedAt ? `\nÚltima sincronização: ${new Date(cloudSyncStatus.lastSyncedAt).toLocaleTimeString()}` : ''}
                    </Text>
                    {/* Header: User Profile / Email & Disconnect */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 10 }}>
                        <View
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 22,
                            backgroundColor: colors.primaryLight,
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginRight: 12,
                          }}
                        >
                          <Text style={{ fontSize: 20 }}>👤</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 14 }} numberOfLines={1}>
                            {firebaseUser?.displayName || firebaseUser?.email || 'Conta Google Conectada'}
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                            <View
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: 4,
                                backgroundColor: colors.success,
                                marginRight: 6,
                              }}
                            />
                            <Text style={{ color: colors.success, fontSize: 12, fontWeight: '700' }}>
                              Conectado à nuvem
                            </Text>
                          </View>
                        </View>
                      </View>

                      <TouchableOpacity
                        style={[
                          styles.smallBtn,
                          {
                            borderColor: colors.danger,
                            borderWidth: 1,
                            backgroundColor: colors.dangerLight,
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                          }
                        ]}
                        onPress={handleDisconnectGoogle}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>
                          Desconectar
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* Firebase Status Badge */}
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: colors.surfaceSubtle,
                        padding: 12,
                        borderRadius: 12,
                        marginBottom: 14,
                        borderWidth: 1,
                        borderColor: colors.borderSubtle,
                      }}
                    >
                      <Text style={{ fontSize: 20, marginRight: 10 }}>🔥</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Firebase Firestore
                        </Text>
                        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '800', marginTop: 2 }}>
                          {firebaseUser?.email ?? 'Conectado'}
                        </Text>
                      </View>
                    </View>

                    {/* Sincronizar Agora Button */}
                    <TouchableOpacity
                      style={[
                        styles.backupBtn,
                        {
                          backgroundColor: colors.primary,
                          flexDirection: 'row',
                          justifyContent: 'center',
                          alignItems: 'center',
                          paddingVertical: 12,
                          opacity: isSyncing ? 0.7 : 1,
                        }
                      ]}
                      onPress={handleSyncNow}
                      disabled={isSyncing}
                      activeOpacity={0.8}
                    >
                      {isSyncing ? (
                        <>
                          <ActivityIndicator size="small" color={getContrastTextColor(colors.primary)} style={{ marginRight: 8 }} />
                          <Text style={{ color: getContrastTextColor(colors.primary), fontWeight: '800', fontSize: 14 }}>
                            Sincronizando...
                          </Text>
                        </>
                      ) : (
                        <>
                          <Text style={{ fontSize: 16, marginRight: 8 }}>🔄</Text>
                          <Text style={{ color: getContrastTextColor(colors.primary), fontWeight: '800', fontSize: 14 }}>
                            Sincronizar Agora
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    {/* Disconnected State */}
                    <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                      <View
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 28,
                          backgroundColor: colors.surfaceSubtle,
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginBottom: 12,
                        }}
                      >
                        <Text style={{ fontSize: 28 }}>☁️</Text>
                      </View>
                        <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: 6, textAlign: 'center' }}>
                          Nenhum backup em nuvem ativo
                        </Text>
                        <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 18, marginBottom: 16, paddingHorizontal: 10 }}>
                          Conecte sua conta Google para sincronizar automaticamente seus dados no Firebase. Funciona no Android e no PC sem configuração extra.
                        </Text>

                        <TouchableOpacity
                          style={[
                            styles.backupBtn,
                            {
                              backgroundColor: colors.primary,
                              width: '100%',
                              flexDirection: 'row',
                              justifyContent: 'center',
                              alignItems: 'center',
                              paddingVertical: 12,
                              opacity: isConnectingCloud ? 0.7 : 1,
                            }
                          ]}
                          onPress={handleConnectGoogle}
                          disabled={isConnectingCloud || (!isTauri && Platform.OS !== 'web' && !request)}
                          activeOpacity={0.8}
                        >
                          {isConnectingCloud ? (
                            <>
                              <ActivityIndicator size="small" color={getContrastTextColor(colors.primary)} style={{ marginRight: 8 }} />
                              <Text style={{ color: getContrastTextColor(colors.primary), fontWeight: '800', fontSize: 14 }}>
                                Conectando...
                              </Text>
                            </>
                          ) : (
                            <>
                              <Text style={{ fontSize: 16, marginRight: 8 }}>🔐</Text>
                              <Text style={{ color: getContrastTextColor(colors.primary), fontWeight: '800', fontSize: 14 }}>
                                Entrar com Google
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>
                        {googleLoginStatus ? (
                          <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary, fontSize: 13, marginTop: 12, textAlign: 'center' }}>
                            {googleLoginStatus}
                          </Text>
                        ) : null}
                      </View>
                    </>
                  )}
              </View>

              {/* Divider between Cloud and Local Backup */}
              <View style={{ height: 1, backgroundColor: colors.border, marginBottom: 20 }} />

              {/* ======================================================= */}
              {/* SEÇÃO 2: Backup Local em JSON                           */}
              {/* ======================================================= */}
              <Text style={styles.sectionTitle}>Backup Local em Arquivo JSON</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 14, lineHeight: 18 }}>
                Faça o backup de todos os seus eventos, matérias, tarefas e faltas em formato JSON seguro para transferir manualmente.
              </Text>

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
                <TouchableOpacity
                  style={[styles.backupBtn, { backgroundColor: colors.primary, flex: 1 }]}
                  onPress={handleExportBackup}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: getContrastTextColor(colors.primary), fontWeight: '800', fontSize: 13 }}>
                    📤 Gerar Backup JSON
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.backupBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.primary, borderWidth: 1.5, flex: 1 }]}
                  onPress={handleImportBackup}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 13 }}>
                    📥 Restaurar Backup
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={[styles.label, { color: colors.text }]}>Conteúdo JSON do Backup:</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    height: 160,
                    textAlignVertical: 'top',
                    backgroundColor: colors.surface,
                    color: colors.text,
                    borderColor: colors.border,
                    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
                    fontSize: 12
                  }
                ]}
                placeholder="Clique em 'Gerar Backup' ou cole o JSON para restaurar..."
                placeholderTextColor={colors.textSecondary}
                multiline
                value={backupJsonText}
                onChangeText={setBackupJsonText}
              />
            </>
          )}

          {/* ======================================================= */}
          {/* TAB: IA & API CONFIGURATION                             */}
          {/* ======================================================= */}
          {activeSubTab === 'ia' && (
            <>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Inteligência Artificial & API</Text>
              <Text style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 16, lineHeight: 18 }}>
                Configure sua chave de API para habilitar o parsing automático de mensagens e assistente de estudos.
              </Text>

              {/* Gemini Cloud Card */}
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 14 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                    <Text style={{ fontSize: 18 }}>✨</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>Google Gemini API</Text>
                    <Text style={{ fontSize: 11, color: colors.primary, fontWeight: '700' }}>Recomendado • Gratuito</Text>
                  </View>
                  <View style={{ backgroundColor: colors.successLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: colors.successDark }}>GRÁTIS</Text>
                  </View>
                </View>

                <Text style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 12, lineHeight: 17 }}>
                  Obtenha sua chave gratuita em <Text style={{ color: colors.primary, fontWeight: '700' }}>aistudio.google.com</Text> sem precisar de cartão de crédito.
                </Text>

                <Text style={[styles.label, { color: colors.text, marginBottom: 6 }]}>Chave de API (Gemini):</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', position: 'relative' }}>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        flex: 1,
                        backgroundColor: colors.surfaceSubtle,
                        color: colors.text,
                        borderColor: colors.border,
                        padding: 12,
                        paddingRight: 44,
                        fontSize: 13
                      }
                    ]}
                    value={aiConfig.apiKey}
                    onChangeText={(val) => setAiConfig({ ...aiConfig, apiKey: val.trim() })}
                    placeholder="Cole sua API Key do Google Gemini (ex: AIzaSy...)"
                    placeholderTextColor={colors.textSecondary}
                    secureTextEntry={!isKeyVisible}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={{
                      position: 'absolute',
                      right: 4,
                      top: 0,
                      bottom: 0,
                      justifyContent: 'center',
                      alignItems: 'center',
                      paddingHorizontal: 10
                    }}
                    onPress={() => setIsKeyVisible(!isKeyVisible)}
                    activeOpacity={0.7}
                    accessibilityLabel={isKeyVisible ? 'Ocultar chave' : 'Mostrar chave'}
                  >
                    <Text style={{ fontSize: 16 }}>{isKeyVisible ? '🙈' : '👁️'}</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={{ backgroundColor: colors.primary, padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 10 }}
                  onPress={async () => {
                    const targetConfig: AIConfig = {
                      ...aiConfig,
                      provider: 'gemini',
                      model: 'gemini-3.6-flash'
                    };
                    let success = false;
                    if (typeof onUpdateAIConfig === 'function') {
                      success = await onUpdateAIConfig(targetConfig);
                    } else {
                      success = await StorageService.saveAIConfig(targetConfig);
                    }
                    if (success) {
                      setAiConfig(targetConfig);
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      Alert.alert('Chave Salva!', 'A chave da API Gemini foi salva com segurança.');
                    } else {
                      Alert.alert('Erro', 'Não foi possível salvar a chave de API.');
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: getContrastTextColor(colors.primary), fontWeight: '800', fontSize: 14 }}>
                    💾 Salvar Chave do Gemini
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Information & Security Note */}
              <View style={[styles.card, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border, padding: 14 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={{ fontSize: 16, marginRight: 8 }}>🔒</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>Segurança & Privacidade</Text>
                </View>
                <Text style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 17 }}>
                  Sua chave é armazenada de forma segura e criptografada no armazenamento local do seu dispositivo e nunca é enviada a servidores de terceiros.
                </Text>
              </View>
            </>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};


const getStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    ...(Platform.OS === 'web' ? { width: '100%' as const, maxWidth: 1000, alignSelf: 'center' as const, minHeight: 0 } : {}),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  closeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  saveBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5
  },
  subTabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  subTab: {
    flex: 1,
    paddingVertical: 13,
    alignItems: 'center',
  },
  subTabText: {
    fontSize: 13,
  },
  content: {
    padding: 18,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  themeOption: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  smallInput: {
    width: 65,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    textAlign: 'center',
    fontWeight: '800',
    fontSize: 15,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 14,
  },
  addBtn: {
    paddingHorizontal: 16,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smallBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  backupBtn: {
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  }
});

