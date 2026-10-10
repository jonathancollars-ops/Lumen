import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, ScrollView, Animated } from 'react-native';
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

interface SidebarNavItemProps {
  routeKey: string;
  name: string;
  icon: string;
  isFocused: boolean;
  onPress: () => void;
  colors: ReturnType<typeof getThemeColors>;
  isDark: boolean;
}

const SidebarNavItem: React.FC<SidebarNavItemProps> = ({
  name,
  icon,
  isFocused,
  onPress,
  colors,
  isDark,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <TouchableOpacity
      onPress={onPress}
      // @ts-ignore
      onMouseEnter={() => setIsHovered(true)}
      // @ts-ignore
      onMouseLeave={() => setIsHovered(false)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected: isFocused }}
      style={[
        styles.sidebarNavItem,
        isFocused
          ? {
              backgroundColor: colors.primaryLight,
            }
          : {
              backgroundColor: isHovered
                ? (isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.035)')
                : 'transparent',
            },
        Platform.OS === 'web' && ({
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'background-color 0.15s ease, opacity 0.15s ease',
        } as any),
      ]}
    >
      <View style={styles.sidebarNavIconWrap}>
        <Text style={{ fontSize: 16 }}>{icon}</Text>
      </View>
      <Text
        style={[
          styles.sidebarNavLabel,
          {
            color: isFocused ? colors.primary : (isHovered ? colors.text : colors.textSecondary),
            fontWeight: isFocused ? '600' : '500',
          }
        ]}
      >
        {name}
      </Text>
    </TouchableOpacity>
  );
};

interface SidebarDockBtnProps {
  icon: string;
  title: string;
  onPress: () => void;
  colors: ReturnType<typeof getThemeColors>;
  isDark: boolean;
}

const SidebarDockBtn: React.FC<SidebarDockBtnProps> = ({
  icon,
  title,
  onPress,
  colors,
  isDark,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <TouchableOpacity
      onPress={() => {
        try { Haptics.selectionAsync(); } catch {}
        onPress();
      }}
      // @ts-ignore
      onMouseEnter={() => setIsHovered(true)}
      // @ts-ignore
      onMouseLeave={() => setIsHovered(false)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={title}
      // @ts-ignore
      title={title}
      style={[
        styles.sidebarDockBtn,
        {
          backgroundColor: isHovered
            ? (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)')
            : (isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)'),
          borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
        },
        Platform.OS === 'web' && ({
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'all 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
          transform: isHovered ? 'scale(1.05)' : 'scale(1)',
        } as any),
      ]}
    >
      <Text style={{ fontSize: 16 }}>{icon}</Text>
    </TouchableOpacity>
  );
};

export function AppNavigator() {
  const { theme, settings, setSettings, gamification, isInitializing, handleThemeToggle, events, subjects, studySessions, attendances, streak, semesters, setSemesters, refreshData, aiConfig, updateAIConfig, syncCloudNow, cloudSyncStatus } = useApp();
  const colors = getThemeColors(theme);
  const insets = useSafeAreaInsets();
  const { isDesktop } = useResponsive();
  const navigationRef = useNavigationContainerRef<{ Agenda: undefined; Faltas: undefined }>();
  const pendingNotification = useRef<Record<string, unknown> | null>(null);
  const notificationRelations = useRef({ events, subjects });
  notificationRelations.current = { events, subjects };
  const openNotification = () => {
    if (!navigationRef.isReady() || !pendingNotification.current) return;
    const data = pendingNotification.current;
    pendingNotification.current = null;
    const current = notificationRelations.current;
    const event = current.events.find(event => event.id === data.eventId);
    if (data.eventId && !event) return;
    const subjectId = data.subjectId || event?.subjectId;
    if (subjectId && !current.subjects.some(subject => subject.id === subjectId && !subject.isArchived)) return;
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
    const pulseAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.35,
            duration: 900,
            useNativeDriver: false,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 900,
            useNativeDriver: false,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }, [pulseAnim]);

    if (isDesktop) {
      const isCloudSyncing = Boolean(cloudSyncStatus?.isSyncing || cloudSyncStatus?.state === 'syncing');

      return (
        <View
          style={[
            styles.sidebarContainer,
            {
              backgroundColor: isDark
                ? (theme === 'amoled' ? 'rgba(0, 0, 0, 0.92)' : 'rgba(15, 17, 23, 0.82)')
                : 'rgba(248, 249, 250, 0.82)',
              borderRightColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'),
              ...(Platform.OS === 'web' ? { backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)' } as any : {})
            }
          ]}
        >
          {/* Header Minimalista (macOS Sonoma / Apple HIG) */}
          <View style={styles.sidebarHeader}>
            <View style={styles.sidebarLogoWrap}>
              <View style={[styles.sidebarLogoIconBadge, { backgroundColor: colors.primaryLight }]}>
                <Text style={{ fontSize: 14 }}>🎓</Text>
              </View>
              <Text style={[styles.sidebarAppTitle, { color: colors.text }]}>Lumen</Text>
            </View>

            {settings.examWeekMode && (
              <View
                style={[
                  styles.sidebarExamMiniBadge,
                  {
                    backgroundColor: isDark ? 'rgba(239, 68, 68, 0.14)' : colors.dangerLight,
                    borderColor: isDark ? 'rgba(239, 68, 68, 0.3)' : 'rgba(239, 68, 68, 0.25)',
                  }
                ]}
                accessibilityLabel="Modo Provas Ativo"
                // @ts-ignore
                title="Modo Provas Ativo"
              >
                <View style={[styles.sidebarExamMiniDot, { backgroundColor: colors.danger }]} />
                <Text style={[styles.sidebarExamMiniText, { color: colors.danger }]}>Provas</Text>
              </View>
            )}
          </View>

          {/* Lista de Navegação (Navigation Items) */}
          <ScrollView
            style={styles.sidebarNavScroll}
            contentContainerStyle={styles.sidebarNavScrollContent}
            showsVerticalScrollIndicator={false}
          >
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
                <SidebarNavItem
                  key={route.key}
                  routeKey={route.key}
                  name={route.name}
                  icon={icon}
                  isFocused={isFocused}
                  onPress={onPress}
                  colors={colors}
                  isDark={isDark}
                />
              );
            })}
          </ScrollView>

          {/* Rodapé Utilitário Integrado (Cloud Sync, Gamificação & Icon Utility Dock) */}
          <View style={[styles.sidebarFooter, { borderTopColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)') }]}>
            {/* Status Compacto: Nível / XP + Cloud Sync */}
            <View
              style={[
                styles.sidebarStatusPill,
                {
                  backgroundColor: colors.surfaceSubtle,
                  borderColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'),
                }
              ]}
            >
              <TouchableOpacity
                style={styles.sidebarStatusLevelSector}
                onPress={() => {
                  try { Haptics.selectionAsync(); } catch {}
                  setAchievementsModalVisible(true);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Nível ${gamification?.level || 1}, ${gamification?.xp || 0} XP. Abrir Conquistas.`}
                // @ts-ignore
                title="Conquistas e Nível Acadêmico"
              >
                <View style={[styles.sidebarLevelMiniDot, { backgroundColor: isDark ? '#A78BFA' : '#7C3AED' }]} />
                <Text style={[styles.sidebarStatusLevelText, { color: isDark ? '#DDD6FE' : '#6D28D9' }]}>
                  Nv. {gamification?.level || 1}
                </Text>
                <Text style={[styles.sidebarStatusXpText, { color: colors.textSecondary }]}>
                  • {gamification?.xp || 0} XP
                </Text>
              </TouchableOpacity>

              <View style={[styles.sidebarStatusDivider, { backgroundColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)') }]} />

              <TouchableOpacity
                style={styles.sidebarStatusSyncSector}
                onPress={async () => {
                  try { Haptics.selectionAsync(); } catch {}
                  if (syncCloudNow) {
                    await syncCloudNow();
                  }
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={isCloudSyncing ? 'Sincronizando com a nuvem...' : 'Cloud Sync Conectado'}
                // @ts-ignore
                title={isCloudSyncing ? 'Sincronizando com a nuvem...' : 'Cloud Sync Conectado (Clique para sincronizar)'}
              >
                <Text style={{ fontSize: 13 }}>☁️</Text>
                <Animated.View
                  style={[
                    styles.sidebarSyncDot,
                    {
                      backgroundColor: isCloudSyncing ? colors.warning : colors.success,
                      opacity: pulseAnim,
                    }
                  ]}
                />
              </TouchableOpacity>
            </View>

            {/* Barra de Ações Rápidas (Icon Utility Dock) */}
            <View style={styles.sidebarDock}>
              <SidebarDockBtn
                icon="👥"
                title="Projetos em Grupo"
                onPress={() => setGroupProjectsModalVisible(true)}
                colors={colors}
                isDark={isDark}
              />
              <SidebarDockBtn
                icon="📈"
                title="Análise & AACC"
                onPress={() => setAnalyticsModalVisible(true)}
                colors={colors}
                isDark={isDark}
              />
              <SidebarDockBtn
                icon="⚙️"
                title="Configurações"
                onPress={() => setSettingsModalVisible(true)}
                colors={colors}
                isDark={isDark}
              />
              <SidebarDockBtn
                icon={theme === 'dark' ? '🌙' : theme === 'amoled' ? '🖤' : '☀️'}
                title={theme === 'dark' ? 'Tema Escuro (Clique para alterar)' : theme === 'amoled' ? 'Tema AMOLED (Clique para alterar)' : 'Tema Claro (Clique para alterar)'}
                onPress={handleThemeToggle}
                colors={colors}
                isDark={isDark}
              />
            </View>
          </View>
        </View>
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
  // Desktop Sidebar Styles (macOS Sonoma / Apple HIG & Impeccable)
  sidebarContainer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 260,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 18,
    paddingBottom: 16,
    flexDirection: 'column',
    justifyContent: 'space-between',
    zIndex: 100,
  },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 14,
  },
  sidebarLogoWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  sidebarLogoIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sidebarAppTitle: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  sidebarExamMiniBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4.5,
    paddingHorizontal: 6.5,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sidebarExamMiniDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  sidebarExamMiniText: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  sidebarNavScroll: {
    flex: 1,
    marginHorizontal: -4,
    paddingHorizontal: 4,
  },
  sidebarNavScrollContent: {
    paddingVertical: 4,
  },
  sidebarSectionLabel: {
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: 8,
    marginBottom: 6,
    opacity: 0.7,
  },
  sidebarNavItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7.5,
    paddingHorizontal: 9,
    borderRadius: 8,
    marginVertical: 1,
  },
  sidebarNavIconWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },
  sidebarNavLabel: {
    fontSize: 13.5,
    letterSpacing: -0.2,
  },
  sidebarFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    gap: 8,
  },
  sidebarStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sidebarStatusLevelSector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5.5,
    flex: 1,
    ...(Platform.OS === 'web' ? ({
      cursor: 'pointer',
      userSelect: 'none',
    } as any) : {}),
  },
  sidebarLevelMiniDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sidebarStatusLevelText: {
    fontSize: 11.5,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  sidebarStatusXpText: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  sidebarStatusDivider: {
    width: 1,
    height: 14,
    marginHorizontal: 8,
  },
  sidebarStatusSyncSector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 2,
    ...(Platform.OS === 'web' ? ({
      cursor: 'pointer',
      userSelect: 'none',
    } as any) : {}),
  },
  sidebarSyncDot: {
    width: 6.5,
    height: 6.5,
    borderRadius: 3.5,
  },
  sidebarDock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  sidebarDockBtn: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
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
