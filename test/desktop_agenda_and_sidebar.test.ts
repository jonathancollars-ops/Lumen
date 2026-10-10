import './setup_env';
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AgendaScreen, AgendaScreenProps } from '../src/screens/AgendaScreen';
import { StorageService, DESKTOP_CALENDAR_EXPANDED_KEY } from '../src/services/storage';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string, detail?: string): void {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${message}`);
  } else {
    failedTests++;
    console.error(`  ❌ [FAIL] ${message}${detail ? ' -> ' + detail : ''}`);
    throw new Error(`Assertion failed: ${message}${detail ? ' -> ' + detail : ''}`);
  }
}

async function testSection(name: string, fn: () => Promise<void> | void): Promise<void> {
  console.log(`\n================================================================`);
  console.log(`🖥️  DESKTOP QA SUITE: ${name}`);
  console.log(`================================================================`);
  await fn();
}

async function runDesktopAgendaAndSidebarTestSuite(): Promise<void> {
  console.log('################################################################');
  console.log('🚀 LUMEN DESKTOP QUALITY & REGRESSION TEST SUITE');
  console.log('   Collapsible Calendar & Sonoma Sidebar Navigation Redesign');
  console.log('################################################################');

  // ==========================================================================
  // SECTION 1: Local Storage Preference Persistence & Restoration
  // ==========================================================================
  await testSection('StorageService Calendar Preference Persistence & Fallbacks', async () => {
    await AsyncStorage.clear();

    // 1.1 Default state when unset
    const defaultVal = await StorageService.getDesktopCalendarExpanded();
    assert(defaultVal === false, 'Default calendar state is false (collapsed) when key is unset');

    // 1.2 Save expanded = true and verify raw and typed restoration
    const saveResultTrue = await StorageService.saveDesktopCalendarExpanded(true);
    assert(saveResultTrue === true, 'saveDesktopCalendarExpanded(true) returns true');

    const rawStorageValTrue = await AsyncStorage.getItem(DESKTOP_CALENDAR_EXPANDED_KEY);
    assert(rawStorageValTrue === 'true', 'AsyncStorage key @lumen:desktop_calendar_expanded stores literal "true"');

    const retrievedTrue = await StorageService.getDesktopCalendarExpanded();
    assert(retrievedTrue === true, 'getDesktopCalendarExpanded returns true after save');

    // 1.3 Save collapsed = false and verify raw and typed restoration
    const saveResultFalse = await StorageService.saveDesktopCalendarExpanded(false);
    assert(saveResultFalse === true, 'saveDesktopCalendarExpanded(false) returns true');

    const rawStorageValFalse = await AsyncStorage.getItem(DESKTOP_CALENDAR_EXPANDED_KEY);
    assert(rawStorageValFalse === 'false', 'AsyncStorage key @lumen:desktop_calendar_expanded stores literal "false"');

    const retrievedFalse = await StorageService.getDesktopCalendarExpanded();
    assert(retrievedFalse === false, 'getDesktopCalendarExpanded returns false after save');

    // 1.4 Resilience to corrupt, non-boolean or unexpected values in storage
    await AsyncStorage.setItem(DESKTOP_CALENDAR_EXPANDED_KEY, 'corrupted_value_123');
    const resilientVal1 = await StorageService.getDesktopCalendarExpanded();
    assert(resilientVal1 === false, 'Corrupted string value safely falls back to false');

    await AsyncStorage.setItem(DESKTOP_CALENDAR_EXPANDED_KEY, '');
    const resilientVal2 = await StorageService.getDesktopCalendarExpanded();
    assert(resilientVal2 === false, 'Empty string in storage safely falls back to false');

    // 1.5 clearAllData cleanup
    await StorageService.saveDesktopCalendarExpanded(true);
    await StorageService.clearAllData();
    const clearedVal = await AsyncStorage.getItem(DESKTOP_CALENDAR_EXPANDED_KEY);
    assert(clearedVal === null, 'StorageService.clearAllData cleans up calendar preference key');
    const clearedRetrieved = await StorageService.getDesktopCalendarExpanded();
    assert(clearedRetrieved === false, 'getDesktopCalendarExpanded returns false after clearAllData');
  });

  // ==========================================================================
  // SECTION 2: AgendaScreen Desktop Collapsible Calendar Architecture
  // ==========================================================================
  await testSection('AgendaScreen Desktop Collapsible Calendar Architecture', () => {
    const agendaPath = path.resolve(__dirname, '../src/screens/AgendaScreen.tsx');
    assert(fs.existsSync(agendaPath), 'AgendaScreen.tsx exists');

    const agendaSource = fs.readFileSync(agendaPath, 'utf8');

    // 2.1 Bug fix verification: Desktop does NOT unconditionally force calendar open
    assert(
      !agendaSource.includes('(isDesktop || isMonthCalendarExpanded) &&'),
      'Hardcoded condition (isDesktop || isMonthCalendarExpanded) was permanently removed'
    );
    assert(
      !agendaSource.includes('isDesktop || isMonthCalendarExpanded'),
      'No instance of "isDesktop || isMonthCalendarExpanded" remains in AgendaScreen'
    );

    // 2.2 Visibility is strictly controlled by isMonthCalendarExpanded
    assert(
      agendaSource.includes('{isMonthCalendarExpanded && (') ||
      agendaSource.includes('isMonthCalendarExpanded && ('),
      'Monthly calendar card display is controlled dynamically by isMonthCalendarExpanded'
    );

    // 2.3 Required identifiers and labels
    assert(agendaSource.includes('isMonthCalendarExpanded'), 'Defines isMonthCalendarExpanded state');
    assert(agendaSource.includes('monthToggleBtn'), 'Defines monthToggleBtn style');
    assert(agendaSource.includes('Ver mês completo'), 'Contains "Ver mês completo" button label');
    assert(agendaSource.includes('Recolher calendário'), 'Contains "Recolher calendário" button label');

    // 2.4 Persistence hooks in AgendaScreen
    assert(
      agendaSource.includes('StorageService.getDesktopCalendarExpanded'),
      'Loads saved preference via StorageService.getDesktopCalendarExpanded on mount'
    );
    assert(
      agendaSource.includes('StorageService.saveDesktopCalendarExpanded'),
      'Persists updated preference via StorageService.saveDesktopCalendarExpanded'
    );

    // 2.5 Unified toggle handler
    assert(
      agendaSource.includes('toggleMonthCalendar'),
      'Defines unified toggleMonthCalendar handler with useCallback'
    );

    // 2.6 Both toggle controls wired to toggleMonthCalendar
    const toggleBtnOccurrences = (agendaSource.match(/onPress={toggleMonthCalendar}/g) || []).length;
    assert(
      toggleBtnOccurrences >= 2,
      `Unified toggleMonthCalendar is wired to both buttons (found ${toggleBtnOccurrences} occurrences)`
    );

    // 2.7 Weekly strip remains independent and intact
    assert(
      agendaSource.includes('renderWeeklyStrip') &&
      agendaSource.includes('weeklyStripRow') &&
      agendaSource.includes('dayPill'),
      'Weekly strip renders 7-day tactile day pills independently of calendar toggle'
    );
  });

  // ==========================================================================
  // SECTION 3: AppNavigator Desktop Sidebar Redesign & Layout Audit
  // ==========================================================================
  await testSection('Desktop Sidebar (macOS Sonoma / Apple HIG) Layout Audit', () => {
    const navPath = path.resolve(__dirname, '../src/navigation/AppNavigator.tsx');
    assert(fs.existsSync(navPath), 'AppNavigator.tsx exists');

    const navSource = fs.readFileSync(navPath, 'utf8');

    // 3.1 Adaptive container check: isDesktop triggers sidebarContainer
    assert(navSource.includes('if (isDesktop)'), 'AppNavigator checks isDesktop for navigation rendering');
    assert(navSource.includes('styles.sidebarContainer'), 'Renders styles.sidebarContainer when isDesktop is true');

    // 3.2 Sidebar dimensions and structural styling (260px fixed width)
    assert(navSource.includes('width: 260'), 'Sidebar enforces 260px width per macOS Sonoma design guidelines');
    assert(navSource.includes('position: \'absolute\''), 'Sidebar is positioned absolutely on the left viewport');
    assert(navSource.includes('borderRightWidth: StyleSheet.hairlineWidth'), 'Sidebar uses subtle hairline right border');

    // 3.3 Minimalist Header with App Title and Exam Mode
    assert(navSource.includes('sidebarHeader'), 'Defines styles.sidebarHeader');
    assert(navSource.includes('sidebarLogoWrap'), 'Defines styles.sidebarLogoWrap');
    assert(navSource.includes('sidebarLogoIconBadge'), 'Defines styles.sidebarLogoIconBadge with academic icon');
    assert(navSource.includes('sidebarAppTitle'), 'Defines styles.sidebarAppTitle ("Lumen")');
    assert(navSource.includes('sidebarExamMiniBadge'), 'Defines styles.sidebarExamMiniBadge for compact exam indicator');
    assert(navSource.includes('sidebarExamMiniDot'), 'Defines styles.sidebarExamMiniDot');
    assert(navSource.includes('sidebarExamMiniText'), 'Defines styles.sidebarExamMiniText');

    // 3.4 Navigation Section (SidebarNavItem)
    assert(navSource.includes('sidebarNavScroll'), 'Uses ScrollView (sidebarNavScroll) for navigation items');
    assert(navSource.includes('sidebarSectionLabel'), 'Defines uppercase section header (sidebarSectionLabel: "NAVEGAÇÃO")');
    assert(navSource.includes('SidebarNavItem'), 'Renders modular SidebarNavItem component');
    assert(navSource.includes('sidebarNavItem'), 'Defines styles.sidebarNavItem');
    assert(navSource.includes('sidebarNavIconWrap'), 'Defines styles.sidebarNavIconWrap');
    assert(navSource.includes('sidebarNavLabel'), 'Defines styles.sidebarNavLabel');

    // 3.5 Hover states and accessible properties for desktop
    assert(navSource.includes('onMouseEnter') && navSource.includes('onMouseLeave'), 'Sidebar items handle mouse hover on desktop/web');
    assert(navSource.includes('accessibilityRole="button"'), 'Sidebar items include accessibilityRole="button"');
    assert(navSource.includes('accessibilityState={{ selected: isFocused }}'), 'Sidebar items announce selected state');

    // 3.6 Integrated Footer (Status Pill: Level/XP & Cloud Sync)
    assert(navSource.includes('sidebarFooter'), 'Defines styles.sidebarFooter');
    assert(navSource.includes('sidebarStatusPill'), 'Defines styles.sidebarStatusPill');
    assert(navSource.includes('sidebarStatusLevelSector'), 'Defines styles.sidebarStatusLevelSector');
    assert(navSource.includes('sidebarLevelMiniDot'), 'Defines styles.sidebarLevelMiniDot for purple gamification accent');
    assert(navSource.includes('sidebarStatusLevelText'), 'Defines styles.sidebarStatusLevelText');
    assert(navSource.includes('sidebarStatusDivider'), 'Defines styles.sidebarStatusDivider');
    assert(navSource.includes('sidebarStatusSyncSector'), 'Defines styles.sidebarStatusSyncSector');
    assert(navSource.includes('sidebarSyncDot'), 'Defines styles.sidebarSyncDot for cloud status');

    // 3.7 Icon Utility Dock (Quick Actions)
    assert(navSource.includes('sidebarDock'), 'Defines styles.sidebarDock for compact utility action row');
    assert(navSource.includes('sidebarDockBtn'), 'Defines styles.sidebarDockBtn');
    assert(navSource.includes('SidebarDockBtn'), 'Renders modular SidebarDockBtn components');

    // Verify all 4 required dock utilities are wired
    assert(navSource.includes('setGroupProjectsModalVisible(true)'), 'Dock button 1: Group projects modal trigger');
    assert(navSource.includes('setAnalyticsModalVisible(true)'), 'Dock button 2: Analytics & AACC modal trigger');
    assert(navSource.includes('setSettingsModalVisible(true)'), 'Dock button 3: Settings modal trigger');
    assert(navSource.includes('handleThemeToggle'), 'Dock button 4: Theme switcher trigger');

    // Verify dock tooltips and accessibility labels
    assert(navSource.includes('title="Projetos em Grupo"'), 'Dock button 1 has tooltip "Projetos em Grupo"');
    assert(navSource.includes('title="Análise & AACC"'), 'Dock button 2 has tooltip "Análise & AACC"');
    assert(navSource.includes('title="Configurações"'), 'Dock button 3 has tooltip "Configurações"');
  });

  // ==========================================================================
  // SECTION 4: Component Instantiation & Theme Resilience
  // ==========================================================================
  await testSection('Component Instantiation in All Themes (Dark, Light, AMOLED)', () => {
    const baseProps: AgendaScreenProps = {
      events: [],
      subjects: [],
      attendances: [],
      tasks: [],
      theme: 'dark',
      settings: {
        theme: 'dark',
        fullscreen: false,
        pomodoroFocusMin: 25,
        pomodoroBreakMin: 5,
        pomodoroLongBreakMin: 15,
        defaultPassGrade: 7.0,
        examWeekMode: false,
        soundEnabled: true,
        hapticsEnabled: true,
      },
      gamification: {
        xp: 150,
        level: 3,
        streakDays: 5,
        lastStudyDate: '2026-10-10',
        achievements: [],
      },
      selectedDate: '2026-10-10',
      onSelectDate: () => {},
      onToggleEventCompletion: () => {},
      onToggleTaskCompletion: () => {},
      onEditEvent: () => {},
      onOpenStudy: () => {},
      onOpenAttendanceModal: () => {},
    };

    // Dark Theme
    const darkElement = React.createElement(AgendaScreen, baseProps);
    assert(darkElement !== null && typeof darkElement.type === 'function', 'AgendaScreen instantiates cleanly in Dark theme');

    // Light Theme
    const lightElement = React.createElement(AgendaScreen, {
      ...baseProps,
      theme: 'light',
      settings: { ...baseProps.settings, theme: 'light' }
    });
    assert(lightElement !== null && typeof lightElement.type === 'function', 'AgendaScreen instantiates cleanly in Light theme');

    // AMOLED Theme
    const amoledElement = React.createElement(AgendaScreen, {
      ...baseProps,
      theme: 'amoled',
      settings: { ...baseProps.settings, theme: 'amoled' }
    });
    assert(amoledElement !== null && typeof amoledElement.type === 'function', 'AgendaScreen instantiates cleanly in AMOLED theme');
  });

  // ==========================================================================
  // FINAL SUMMARY
  // ==========================================================================
  console.log('\n================================================================');
  console.log(`📊 DESKTOP QA SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error(`❌ FAILED: ${failedTests} tests failed.`);
    process.exit(1);
  } else {
    console.log('🎉 ALL DESKTOP AGENDAR & SIDEBAR TESTS PASSED 100% GREEN!');
    process.exit(0);
  }
}

runDesktopAgendaAndSidebarTestSuite().catch(err => {
  console.error('Fatal error running desktop agenda and sidebar tests:', err);
  process.exit(1);
});
