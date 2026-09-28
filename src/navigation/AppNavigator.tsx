import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
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
  const { theme, settings, setSettings, gamification, isInitializing, handleThemeToggle, events, subjects, studySessions, attendances, streak, semesters, setSemesters, refreshData, aiConfig, updateAIConfig } = useApp();
  const colors = getThemeColors(theme);
  const insets = useSafeAreaInsets();
  const { isDesktop } = useResponsive();

  // Interceptação de Deep Links (lumen://gemini/...) e integração nativa com Android App Actions
  useDeepLinkHandler({ onActionExecuted: refreshData });

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
      await AppUpdateService.recordPromptDismissed();
    } catch {
      // Ignora falhas de persistência
    }
  };
  
  useEffect(() => {
    const check = async () => {
      try {
        // Cooldown de 24 horas: se o usuário já visualizou ou cancelou o modal hoje, não reabre automaticamente
        const shouldShow = await AppUpdateService.shouldShowAutomaticPrompt();
        if (!shouldShow) {
          return;
        }

        const info = await AppUpdateService.checkForUpdates(false);
        if (info && info.hasUpdate) {
          setUpdateInfo(info);
          setUpdateModalVisible(true);
          // Marca visualização para iniciar o cooldown mesmo se o app for encerrado
          await AppUpdateService.recordPromptDismissed();
        }
      } catch {
        // Falhas na verificação em segundo plano são tratadas silenciosamente
      }
    };
    check();
  }, []);

  useEffect(() => {
    const reconcileNotifications = async () => {
      try {
        if (!isInitializing) {
          await NotificationService.reconcileAndPurgeOrphanNotifications(events, subjects);
        }
      } catch (notifErr) {
        console.warn('Erro ao reconciliar notificações na inicialização do AppNavigator:', notifErr);
      }
    };
    reconcileNotifications();
  }, [isInitializing]);
  
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
        paddingTop: insets.top > 0 ? insets.top + (insets.top >= 54 ? 4 : 8) : (Platform.OS === 'ios' ? 48 : 36),
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
   * Em telas > 1024px (desktop / Tauri Windows): renderiza Sidebar fixa e elegante à esquerda.
   * Em telas <= 1024px (mobile / tablet estreito): renderiza Bottom Tabs suspensa clássica.
   */
  const ResponsiveTabBar: React.FC<BottomTabBarProps> = ({ state, descriptors, navigation }) => {
    if (isDesktop) {
      return (
        <View style={[styles.sidebarContainer, { backgroundColor: colors.surface, borderRightColor: colors.border }]}>
          {/* Header do Menu Lateral Desktop */}
          <View style={styles.sidebarHeader}>
            <View style={[styles.logoIconBadge, { backgroundColor: colors.primaryLight, width: 38, height: 38, borderRadius: 12 }]}>
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

          {/* Card Gamificação / Nível no Sidebar */}
          <TouchableOpacity
            style={[styles.sidebarGamificationCard, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
            onPress={() => {
              try { Haptics.selectionAsync(); } catch {}
              setAchievementsModalVisible(true);
            }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: colors.primary }}>
                Nv. {gamification?.level || 1} 🎓
              </Text>
              <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textSecondary }}>
                {gamification?.xp || 0} XP
              </Text>
            </View>
            <View style={[styles.sidebarXpTrack, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }]}>
              <View
                style={[
                  styles.sidebarXpFill,
                  {
                    backgroundColor: colors.primary,
                    width: `${Math.min(100, Math.max(10, ((gamification?.xp || 0) % 100)))}%`
                  }
                ]}
              />
            </View>
          </TouchableOpacity>

          {/* Lista de Navegação Vertical */}
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
                      ? { backgroundColor: colors.primaryLight, borderColor: colors.primary }
                      : { backgroundColor: 'transparent', borderColor: 'transparent' }
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

          {/* Rodapé do Sidebar com Ações e Ajustes */}
          <View style={[styles.sidebarFooter, { borderTopColor: colors.border }]}>
            <Text style={[styles.sidebarSectionLabel, { color: colors.textSecondary, marginBottom: 8 }]}>FERRAMENTAS</Text>
            
            <TouchableOpacity
              style={[styles.sidebarActionBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
              onPress={() => setGroupProjectsModalVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 16, marginRight: 10 }}>👥</Text>
              <Text style={[styles.sidebarActionText, { color: colors.text }]}>Projetos em Grupo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sidebarActionBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
              onPress={() => setAnalyticsModalVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 16, marginRight: 10 }}>📈</Text>
              <Text style={[styles.sidebarActionText, { color: colors.text }]}>Análise & AACC</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sidebarActionBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
              onPress={() => setSettingsModalVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 16, marginRight: 10 }}>⚙️</Text>
              <Text style={[styles.sidebarActionText, { color: colors.text }]}>Configurações</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sidebarActionBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
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
        </View>
      );
    }

    // Layout Mobile / Tablet estreito (Bottom Tabs)
    return (
      <View
        style={[
          styles.mobileTabBar,
          {
            bottom: insets.bottom > 0 ? insets.bottom : (Platform.OS === 'android' ? 14 : 12),
            backgroundColor: colors.glassBackground || (isDark ? 'rgba(24, 27, 32, 0.92)' : 'rgba(255, 255, 255, 0.94)'),
            borderTopColor: colors.specularBorder || (isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)'),
            borderColor: colors.hairlineBorder || (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'),
            shadowOpacity: isDark ? 0.35 : 0.12,
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
              style={styles.mobileTabItem}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: isFocused ? 22 : 19, opacity: isFocused ? 1 : 0.8 }}>{icon}</Text>
              <Text
                style={[
                  styles.mobileTabLabel,
                  { color: isFocused ? colors.primary : colors.textSecondary }
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
      <NavigationContainer theme={navTheme}>
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
    paddingTop: 24,
    paddingBottom: 20,
    paddingHorizontal: 16,
    zIndex: 100,
    justifyContent: 'space-between',
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
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 20,
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
    borderRadius: 12,
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
  sidebarActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
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
  },
  mobileTabLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.1,
    marginTop: 2,
  },
});
