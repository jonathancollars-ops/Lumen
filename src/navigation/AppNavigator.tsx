import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, ScrollView } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, DefaultTheme, DarkTheme, useNavigationContainerRef } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../contexts/AppContext';
import { getThemeColors, getContrastTextColor } from '../theme';
import { StorageService } from '../services/storage';
import { AppUpdateService } from '../services/AppUpdateService';
import { NotificationService } from '../services/notifications';
import { AppUpdateInfo } from '../types';
import { SwipeableTabContainer } from '../components/SwipeableTabContainer';
import { useDeepLinkHandler } from '../hooks/useDeepLinkHandler';
import { useNotificationRecovery } from '../hooks/useNotificationRecovery';
import { useAutomaticAppUpdates } from '../hooks/useAutomaticAppUpdates';

// Screens
import { AgendaScreenWrapper } from '../screens/AgendaScreenWrapper';
import { StudyScreenWrapper } from '../screens/StudyScreenWrapper';
import { AcademicPerformanceScreenWrapper } from '../screens/AcademicPerformanceScreenWrapper';
import { AttendanceScreenWrapper } from '../screens/AttendanceScreenWrapper';
import { GradesScreenWrapper } from '../screens/GradesScreenWrapper';

// Modals
import { SettingsModal } from '../components/SettingsModal';
import { AnalyticsAndAACCModal } from '../components/AnalyticsAndAACCModal';
import { AchievementsModal } from '../components/AchievementsModal';
import { GroupProjectsModal } from '../components/GroupProjectsModal';
import { AppUpdateModal } from '../components/AppUpdateModal';
import { OnboardingModal } from '../components/OnboardingModal';

import { useResponsive } from '../hooks/useResponsive';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';

const Tab = createBottomTabNavigator();

export function AppNavigator() {
  const { theme, settings, setSettings, gamification, isInitializing, handleThemeToggle, events, subjects, studySessions, attendances, streak, semesters, setSemesters, refreshData, aiConfig, updateAIConfig, syncCloudNow, cloudSyncStatus } = useApp();
  const colors = getThemeColors(theme);
  const insets = useSafeAreaInsets();
  const { isDesktop } = useResponsive();
  const navigationRef = useNavigationContainerRef<{ Agenda: undefined; Faltas: undefined }>();
  const pendingNotification = useRef<Record<string, unknown> | null>(null);
  const openNotification = () => {
    if (!navigationRef.isReady() || !pendingNotification.current) return;
    const data = pendingNotification.current;
    pendingNotification.current = null;
    navigationRef.navigate(data.type === 'attendance_reminder' ? 'Faltas' : 'Agenda');
    void refreshData();
  };

  useEffect(() => NotificationService.observeNotificationResponses(data => {
    pendingNotification.current = data;
    openNotification();
  }), [navigationRef]);

  // Interceptação de Deep Links (lumen://gemini/...) e integração nativa com Android App Actions
  useDeepLinkHandler({ onActionExecuted: refreshData });
  useNotificationRecovery(isInitializing, events, subjects, attendances);

  // Global Modals State
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [analyticsModalVisible, setAnalyticsModalVisible] = useState(false);
  const [achievementsModalVisible, setAchievementsModalVisible] = useState(false);
  const [groupProjectsModalVisible, setGroupProjectsModalVisible] = useState(false);
  const [onboardingVisible, setOnboardingVisible] = useState(false);
  
  // App Update State
  const [updateInfo, setUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [updateModalVisible, setUpdateModalVisible] = useState(false);

  const handleCloseUpdateModal = async () => {
    setUpdateModalVisible(false);
    try {
      await AppUpdateService.recordPromptDismissed(updateInfo?.latestVersion);
    } catch {
      // Ignora falhas de persistência
    }
  };
  
  useAutomaticAppUpdates(info => {
    setUpdateInfo(info);
    setUpdateModalVisible(true);
  });

  if (isInitializing) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const CustomHeader = () => (
    <View style={[
      styles.header, 
      { 
        borderBottomColor: colors.border, 
        backgroundColor: colors.surface,
        paddingTop: Platform.OS === 'web' ? 12 : insets.top > 0 ? insets.top + (insets.top >= 54 ? 4 : 8) : (Platform.OS === 'ios' ? 48 : 36),
      }
    ]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1, marginRight: 8 }}>
        <View style={[styles.logoIconBadge, { backgroundColor: colors.primaryLight }]}>
          <Text style={{ fontSize: 16 }}>🎓</Text>
        </View>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>Lumen</Text>
        {settings.examWeekMode && (
          <View style={[styles.examModeBadge, { backgroundColor: colors.dangerLight, borderColor: colors.danger }]}>
            <Text style={{ color: colors.danger, fontSize: 10, fontWeight: 'bold' }}>🎯 MODO PROVAS</Text>
          </View>
        )}
      </View>

      <View style={styles.headerRight}>
        <TouchableOpacity
          style={[styles.levelHeaderBtn, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
          onPress={() => {
            try { Haptics.selectionAsync(); } catch {}
            setAchievementsModalVisible(true);
          }}
          activeOpacity={0.7}
        >
          <Text style={{ fontSize: 12, fontWeight: '800', color: colors.primary }}>
            Nv. {gamification?.level || 1} 🎓
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.iconBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
          onPress={() => setGroupProjectsModalVisible(true)}
          activeOpacity={0.7}
        >
          <Text style={{ fontSize: 15 }}>👥</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.iconBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
          onPress={() => setAnalyticsModalVisible(true)}
          activeOpacity={0.7}
        >
          <Text style={{ fontSize: 15 }}>📈</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.iconBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
          onPress={() => setSettingsModalVisible(true)}
          activeOpacity={0.7}
        >
          <Text style={{ fontSize: 16 }}>⚙️</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.iconBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
          onPress={handleThemeToggle}
          activeOpacity={0.7}
        >
          <Text style={{ fontSize: 16 }}>
            {theme === 'dark' ? '🌙' : theme === 'amoled' ? '🖤' : '☀️'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const isDark = theme !== 'light';
  const baseTheme = isDark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...baseTheme,
    dark: isDark,
    colors: {
      ...baseTheme.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  };

  /**
   * Componente de navegação adaptativo:
   * Em telas > 1024px (desktop / Tauri Windows): renderiza Sidebar fixa e elegante à esquerda no estilo macOS Sonoma.
   * Em telas <= 1024px (mobile / tablet estreito): renderiza Floating Glass Tab Bar clássica no estilo iOS 18.
   */
  const ResponsiveTabBar: React.FC<BottomTabBarProps> = ({ state, descriptors, navigation }) => {
    if (isDesktop) {
      return (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingTop: 24, paddingBottom: 24, paddingHorizontal: 16 }}
          style={[
            styles.sidebarContainer,
            {
              backgroundColor: isDark
                ? (theme === 'amoled' ? 'rgba(0, 0, 0, 0.90)' : 'rgba(11, 15, 25, 0.85)')
                : 'rgba(248, 249, 250, 0.88)',
              borderRightColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'),
              ...(Platform.OS === 'web' ? { backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' } as any : {})
            }
          ]}
        >
          {/* Header do Menu Lateral Desktop (macOS Sonoma Style) */}
          <View style={styles.sidebarHeader}>
            <View style={[styles.logoIconBadge, { backgroundColor: colors.primaryLight, width: 40, height: 40, borderRadius: 12 }]}>
              <Text style={{ fontSize: 20 }}>🎓</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.text, fontSize: 19, letterSpacing: -0.5 }]}>Lumen</Text>
              <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '600' }}>Workspace Acadêmico</Text>
            </View>
          </View>

          {/* Badge Modo Provas */}
          {settings.examWeekMode && (
            <View style={[styles.sidebarExamBadge, { backgroundColor: colors.dangerLight, borderColor: colors.danger }]}>
              <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '800' }}>🎯 MODO PROVAS ATIVO</Text>
            </View>
          )}

          {/* Badge Sutil de Nível Acadêmico com Gradiente Lavanda Suave */}
          <TouchableOpacity
            style={[
              styles.sidebarGamificationCard,
              {
                backgroundColor: isDark ? 'rgba(139, 92, 246, 0.12)' : 'rgba(139, 92, 246, 0.08)',
                borderColor: isDark ? 'rgba(167, 139, 250, 0.25)' : 'rgba(139, 92, 246, 0.20)',
              }
            ]}
            onPress={() => {
              try { Haptics.selectionAsync(); } catch {}
              setAchievementsModalVisible(true);
            }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={[styles.sidebarLavenderDot, { backgroundColor: isDark ? '#A78BFA' : '#7C3AED' }]} />
                <Text style={{ fontSize: 13, fontWeight: '800', color: isDark ? '#C4B5FD' : '#6D28D9' }}>
                  Nv. {gamification?.level || 1} Acadêmico
                </Text>
              </View>
              <Text style={{ fontSize: 11, fontWeight: '700', color: isDark ? '#A78BFA' : '#7C3AED' }}>
                {gamification?.xp || 0} XP
              </Text>
            </View>
            <View style={[styles.sidebarXpTrack, { backgroundColor: isDark ? 'rgba(139, 92, 246, 0.18)' : 'rgba(139, 92, 246, 0.12)' }]}>
              <View
                style={[
                  styles.sidebarXpFill,
                  {
                    backgroundColor: isDark ? '#A78BFA' : '#7C3AED',
                    width: `${Math.min(100, Math.max(10, ((gamification?.xp || 0) % 100)))}%`
                  }
                ]}
              />
            </View>
          </TouchableOpacity>

          {/* Lista de Navegação Vertical com Ícones Refinados */}
          <View style={styles.sidebarNavList}>
            <Text style={[styles.sidebarSectionLabel, { color: colors.textSecondary }]}>NAVEGAÇÃO</Text>
            {state.routes.map((route, index) => {
              const isFocused = state.index === index;
              const onPress = () => {
                try { Haptics.selectionAsync(); } catch {}
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!isFocused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              };

              let icon = '📅';
              if (route.name === 'Estudos') icon = '⏱️';
              else if (route.name === 'Desempenho') icon = '🎯';
              else if (route.name === 'Faltas') icon = '📊';
              else if (route.name === 'Notas') icon = '🎓';

              return (
                <TouchableOpacity
                  key={route.key}
                  onPress={onPress}
                  activeOpacity={0.7}
                  style={[
                    styles.sidebarNavItem,
                    isFocused
                      ? {
                          backgroundColor: colors.primaryLight,
                          borderColor: colors.primary,
                        }
                      : {
                          backgroundColor: 'transparent',
                          borderColor: 'transparent',
                        }
                  ]}
                >
                  {isFocused && <View style={[styles.sidebarActiveBar, { backgroundColor: colors.primary }]} />}
                  <Text style={{ fontSize: 18, marginRight: 12 }}>{icon}</Text>
                  <Text
                    style={[
                      styles.sidebarNavLabel,
                      { color: isFocused ? colors.primary : colors.text, fontWeight: isFocused ? '800' : '600' }
                    ]}
                  >
                    {route.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Rodapé do Sidebar com Indicador Cloud Sync & Ferramentas */}
          <View style={[styles.sidebarFooter, { borderTopColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)') }]}>
            {/* Indicador Elegante de Status do Cloud Sync */}
            {(() => {
              const isCloudSyncing = Boolean(cloudSyncStatus?.isSyncing || cloudSyncStatus?.state === 'syncing');
              return (
                <TouchableOpacity
                  style={[
                    styles.sidebarCloudSyncCard,
                    {
                      backgroundColor: colors.surfaceSubtle,
                      borderColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'),
                    }
                  ]}
                  onPress={async () => {
                    try { Haptics.selectionAsync(); } catch {}
                    if (syncCloudNow) {
                      await syncCloudNow();
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontSize: 16 }}>☁️</Text>
                      <View>
                        <Text style={[styles.sidebarCloudSyncTitle, { color: colors.text }]}>Cloud Sync</Text>
                        <Text style={{ fontSize: 10, color: colors.textSecondary }}>
                          {isCloudSyncing ? 'Sincronizando...' : 'Conectado e Seguro'}
                        </Text>
                      </View>
                    </View>
                    <View style={[
                      styles.sidebarCloudSyncBadge,
                      {
                        backgroundColor: isCloudSyncing ? colors.warningLight : colors.successLight,
                        borderColor: isCloudSyncing ? colors.warning : colors.success
                      }
                    ]}>
                      <View style={[
                        styles.sidebarCloudDot,
                        { backgroundColor: isCloudSyncing ? colors.warning : colors.success }
                      ]} />
                      <Text style={[
                        styles.sidebarCloudBadgeText,
                        { color: isCloudSyncing ? colors.warningDark : colors.successDark }
                      ]}>
                        {isCloudSyncing ? 'Sync' : 'Ativo'}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })()}

            <Text style={[styles.sidebarSectionLabel, { color: colors.textSecondary, marginBottom: 8 }]}>FERRAMENTAS</Text>
            
            <TouchableOpacity
              style={[styles.sidebarActionBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)') }]}
              onPress={() => setGroupProjectsModalVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 16, marginRight: 10 }}>👥</Text>
              <Text style={[styles.sidebarActionText, { color: colors.text }]}>Projetos em Grupo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sidebarActionBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)') }]}
              onPress={() => setAnalyticsModalVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 16, marginRight: 10 }}>📈</Text>
              <Text style={[styles.sidebarActionText, { color: colors.text }]}>Análise & AACC</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sidebarActionBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)') }]}
              onPress={() => setSettingsModalVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 16, marginRight: 10 }}>⚙️</Text>
              <Text style={[styles.sidebarActionText, { color: colors.text }]}>Configurações</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sidebarActionBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)') }]}
              onPress={handleThemeToggle}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 16, marginRight: 10 }}>
                {theme === 'dark' ? '🌙' : theme === 'amoled' ? '🖤' : '☀️'}
              </Text>
              <Text style={[styles.sidebarActionText, { color: colors.text }]}>
                {theme === 'dark' ? 'Tema Escuro' : theme === 'amoled' ? 'Tema AMOLED' : 'Tema Claro'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      );
    }

    // Layout Mobile / Tablet estreito (iOS 18 Floating Glass Tab Bar)
    return (
      <View
        style={[
          styles.mobileTabBar,
          {
            bottom: insets.bottom > 0 ? insets.bottom : (Platform.OS === 'android' ? 14 : 12),
            backgroundColor: colors.glassBackground || (isDark ? (theme === 'amoled' ? 'rgba(0, 0, 0, 0.90)' : 'rgba(11, 15, 25, 0.85)') : 'rgba(255, 255, 255, 0.88)'),
            borderColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'),
            shadowOpacity: isDark ? 0.35 : 0.12,
            ...(Platform.OS === 'web' ? { backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' } as any : {})
          }
        ]}
      >
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const onPress = () => {
            try { Haptics.selectionAsync(); } catch {}
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          let icon = '';
          if (route.name === 'Agenda') icon = '📅';
          else if (route.name === 'Estudos') icon = '⏱️';
          else if (route.name === 'Desempenho') icon = '🎯';
          else if (route.name === 'Faltas') icon = '📊';
          else if (route.name === 'Notas') icon = '🎓';

          return (
            <TouchableOpacity
              key={route.key}
              onPress={onPress}
              style={[
                styles.mobileTabItem,
                isFocused && [styles.mobileTabItemActive, { backgroundColor: colors.primaryLight }]
              ]}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: isFocused ? 21 : 18, opacity: isFocused ? 1 : 0.75 }}>{icon}</Text>
              <Text
                style={[
                  styles.mobileTabLabel,
                  { color: isFocused ? colors.primary : colors.textSecondary, fontWeight: isFocused ? '800' : '600' }
                ]}
              >
                {route.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  return (
    <>
      <StatusBar style={theme === 'light' ? 'dark' : 'light'} backgroundColor="transparent" translucent />
      <NavigationContainer theme={navTheme} ref={navigationRef} onReady={openNotification}>
        <Tab.Navigator
          tabBar={props => <ResponsiveTabBar {...props} />}
          screenOptions={{
            headerShown: !isDesktop,
            header: () => <CustomHeader />,
            sceneStyle: {
              marginLeft: isDesktop ? 260 : 0,
              backgroundColor: colors.background,
            },
          }}
        >
          <Tab.Screen name="Agenda" component={AgendaScreenWrapper} />
          <Tab.Screen name="Estudos" component={StudyScreenWrapper} />
          <Tab.Screen name="Desempenho" component={AcademicPerformanceScreenWrapper} />
          <Tab.Screen name="Faltas" component={AttendanceScreenWrapper} />
          <Tab.Screen name="Notas" component={GradesScreenWrapper} />
        </Tab.Navigator>
      </NavigationContainer>

      {/* Global Modals */}
      <SettingsModal 
        syncCloudNow={syncCloudNow}
        cloudSyncStatus={cloudSyncStatus}
        visible={settingsModalVisible} 
        onClose={() => setSettingsModalVisible(false)} 
        theme={theme}
        onThemeChange={handleThemeToggle}
        settings={settings}
        onUpdateSettings={setSettings}
        semesters={semesters}
        onUpdateSemesters={setSemesters}
        aiConfig={aiConfig}
        onUpdateAIConfig={updateAIConfig}
        onOpenGuide={() => setOnboardingVisible(true)}
        onRestoreSuccess={() => refreshData()}
        onOpenUpdateModal={(info) => {
          setUpdateInfo(info);
          setUpdateModalVisible(true);
        }}
      />
      <OnboardingModal
        visible={onboardingVisible}
        onClose={() => setOnboardingVisible(false)}
        theme={theme}
      />
      <AnalyticsAndAACCModal 
        visible={analyticsModalVisible} 
        onClose={() => setAnalyticsModalVisible(false)} 
        theme={theme} 
        subjects={subjects}
        studySessions={studySessions}
        attendances={attendances}
      />
      <AchievementsModal 
        visible={achievementsModalVisible} 
        onClose={() => setAchievementsModalVisible(false)} 
        theme={theme}
        studySessions={studySessions}
        streak={streak}
        attendances={attendances}
      />
      <GroupProjectsModal 
        visible={groupProjectsModalVisible} 
        onClose={() => setGroupProjectsModalVisible(false)} 
        theme={theme} 
        subjects={subjects}
      />
      <AppUpdateModal 
        visible={updateModalVisible} 
        updateInfo={updateInfo} 
        theme={theme} 
        onClose={handleCloseUpdateModal} 
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  examModeBadge: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  levelHeaderBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Desktop Sidebar Styles
  sidebarContainer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 260,
    borderRightWidth: StyleSheet.hairlineWidth,
    zIndex: 100,
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  sidebarExamBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
    alignItems: 'center',
  },
  sidebarGamificationCard: {
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 20,
  },
  sidebarLavenderDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  sidebarXpTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  sidebarXpFill: {
    height: '100%',
    borderRadius: 3,
  },
  sidebarNavList: {
    flex: 1,
    gap: 4,
  },
  sidebarSectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingHorizontal: 6,
  },
  sidebarNavItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  sidebarActiveBar: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 3.5,
    borderRadius: 2,
  },
  sidebarNavLabel: {
    fontSize: 14,
    letterSpacing: 0.2,
  },
  sidebarFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
    gap: 6,
  },
  sidebarCloudSyncCard: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  sidebarCloudSyncTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  sidebarCloudSyncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sidebarCloudDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sidebarCloudBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  sidebarActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sidebarActionText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // Mobile Bottom Tab Bar Styles
  mobileTabBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 62,
    borderRadius: 26,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingBottom: Platform.OS === 'ios' ? 8 : 4,
    paddingTop: 6,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 14,
    zIndex: 50,
  },
  mobileTabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 16,
  },
  mobileTabItemActive: {
    borderRadius: 16,
  },
  mobileTabLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.1,
    marginTop: 2,
  },
});
