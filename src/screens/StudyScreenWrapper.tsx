import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useApp } from '../contexts/AppContext';
import { StudyScreen } from './StudyScreen';
import { AchievementsModal } from '../components/AchievementsModal';
import { AnalyticsAndAACCModal } from '../components/AnalyticsAndAACCModal';
import { SubjectModal } from '../components/SubjectModal';
import { StorageService } from '../services/storage';
import { SwipeableTabContainer } from '../components/SwipeableTabContainer';

export const StudyScreenWrapper = () => {
  const navigation = useNavigation<any>();
  const { 
    subjects, 
    events, 
    setEvents, 
    tasks, 
    updateTasks,
    studySessions, 
    addStudySession,
    streak, 
    attendances, 
    theme, 
    settings, 
    semesters, 
    addOrUpdateSubject 
  } = useApp();

  const [achievementsVisible, setAchievementsVisible] = useState(false);
  const [analyticsVisible, setAnalyticsVisible] = useState(false);
  const [subjectModalVisible, setSubjectModalVisible] = useState(false);

  const isAnyModalOpen = achievementsVisible || analyticsVisible || subjectModalVisible;

  return (
    <SwipeableTabContainer
      currentTab="Estudos"
      onNavigateTab={(nextTab) => navigation.navigate(nextTab)}
      disabled={isAnyModalOpen}
    >
      <StudyScreen
        subjects={subjects}
        tasks={tasks}
        onUpdateTasks={updateTasks}
        sessions={studySessions}
        onAddSession={addStudySession}
        theme={theme}
        focusMinutesDefault={settings.pomodoroFocusMin}
        breakMinutesDefault={settings.pomodoroBreakMin}
        onOpenAchievements={() => setAchievementsVisible(true)}
        onOpenAnalytics={() => setAnalyticsVisible(true)}
        onAddNewSubject={() => setSubjectModalVisible(true)}
      />

      <AchievementsModal
        visible={achievementsVisible}
        onClose={() => setAchievementsVisible(false)}
        theme={theme}
        studySessions={studySessions}
        streak={streak}
        attendances={attendances}
      />

      <AnalyticsAndAACCModal
        visible={analyticsVisible}
        onClose={() => setAnalyticsVisible(false)}
        theme={theme}
        subjects={subjects}
        studySessions={studySessions}
        attendances={attendances}
      />

      <SubjectModal
        visible={subjectModalVisible}
        onClose={() => setSubjectModalVisible(false)}
        onSave={async (newSubject, newEvents) => {
          try {
            if (newSubject) {
              await addOrUpdateSubject(newSubject);
              if (newEvents && newEvents.length > 0) {
                const updatedEvents = [...events, ...newEvents];
                setEvents(updatedEvents);
                await StorageService.saveEvents(updatedEvents);
              }
            }
          } catch (e) {
            console.warn('Erro ao salvar matéria no StudyScreenWrapper:', e);
          } finally {
            setSubjectModalVisible(false);
          }
        }}
        theme={theme}
        semesters={semesters}
      />
    </SwipeableTabContainer>
  );
};
