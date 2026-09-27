import React, { useState } from 'react';
import { View, Modal, StyleSheet, TouchableOpacity, Text, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';

import { useApp } from '../contexts/AppContext';
import { AgendaScreen } from './AgendaScreen';
import { ScheduleGridScreen } from './ScheduleGridScreen';
import { EventTypeModal } from '../components/EventTypeModal';
import { SubjectModal } from '../components/SubjectModal';
import { ExamModal } from '../components/ExamModal';
import { EventModal } from '../components/EventModal';
import { PendingAttendanceModal } from '../components/PendingAttendanceModal';
import { AppEvent, Subject } from '../types';
import { getThemeColors } from '../theme';
import { StorageService } from '../services/storage';
import { SwipeableTabContainer } from '../components/SwipeableTabContainer';

export const AgendaScreenWrapper = ({ onFabPress }: { onFabPress?: () => void }) => {
  const navigation = useNavigation<any>();
  const { 
    events, setEvents, 
    subjects, setSubjects, 
    attendances, setAttendances, 
    tasks, setTasks, 
    theme, settings, gamification, semesters,
    toggleEventCompletion,
    toggleTaskCompletion,
    deleteEvent,
    addOrUpdateEvent,
    addOrUpdateSubject
  } = useApp();

  const colors = getThemeColors(theme);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  
  // Modals state
  const [eventTypeVisible, setEventTypeVisible] = useState(false);
  const [subjectVisible, setSubjectVisible] = useState(false);
  const [examVisible, setExamVisible] = useState(false);
  const [eventModalVisible, setEventModalVisible] = useState(false);
  const [attendanceModalVisible, setAttendanceModalVisible] = useState(false);
  const [scheduleGridVisible, setScheduleGridVisible] = useState(false);
  
  const [editingEvent, setEditingEvent] = useState<AppEvent | null>(null);

  const handleSaveEvent = async (event: AppEvent) => {
    try {
      if (event) {
        await addOrUpdateEvent(event);
      }
      setEventModalVisible(false);
      setExamVisible(false);
      setEditingEvent(null);
    } catch (e) {
      console.warn('Erro ao salvar evento:', e);
      Alert.alert('Não foi possível salvar', 'Seus dados continuam no formulário. Tente novamente.');
    }
  };

  const handleSaveSubject = async (subject: Subject, newEvents: AppEvent[]) => {
    try {
      if (subject) {
        await addOrUpdateSubject(subject);
        if (newEvents && newEvents.length > 0) {
          const updatedEvents = [...events, ...newEvents];
          setEvents(updatedEvents);
          await StorageService.saveEvents(updatedEvents);
        }
      }
    } catch (e) {
      console.warn('Erro ao salvar matéria/aulas:', e);
    } finally {
      setSubjectVisible(false);
    }
  };

  const isAnyModalOpen =
    eventTypeVisible ||
    subjectVisible ||
    examVisible ||
    eventModalVisible ||
    attendanceModalVisible ||
    scheduleGridVisible;

  return (
    <SwipeableTabContainer
      currentTab="Agenda"
      onNavigateTab={(nextTab) => navigation.navigate(nextTab)}
      disabled={isAnyModalOpen}
    >
      <AgendaScreen
        events={events}
        subjects={subjects}
        attendances={attendances}
        tasks={tasks}
        theme={theme}
        settings={settings}
        gamification={gamification}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        onToggleEventCompletion={toggleEventCompletion}
        onToggleTaskCompletion={toggleTaskCompletion}
        onEditEvent={(event) => {
          setEditingEvent(event);
          setEventModalVisible(true);
        }}
        onOpenStudy={(subjectId) => {
          navigation.navigate('Estudos', { subjectId });
        }}
        onOpenAttendanceModal={() => setAttendanceModalVisible(true)}
        onOpenExamDetails={(examEvent) => {
          setEditingEvent(examEvent);
          setEventModalVisible(true);
        }}
        onAddNewEvent={() => {
          setEditingEvent(null);
          setEventTypeVisible(true);
        }}
        onOpenScheduleGrid={() => setScheduleGridVisible(true)}
      />
      
      {/* Event Type Selector Modal */}
      <EventTypeModal
        visible={eventTypeVisible}
        onClose={() => setEventTypeVisible(false)}
        theme={theme}
        onSelect={(type) => {
          setEventTypeVisible(false);
          if (type === 'aula') {
            setSubjectVisible(true);
          } else if (type === 'prova') {
            setExamVisible(true);
          } else {
            setEditingEvent(null);
            setEventModalVisible(true);
          }
        }}
      />

      {/* Subject Class Creation Modal */}
      <SubjectModal
        visible={subjectVisible}
        onClose={() => setSubjectVisible(false)}
        onSave={handleSaveSubject}
        theme={theme}
        semesters={semesters}
      />

      {/* Exam / Assessment Modal */}
      <ExamModal
        visible={examVisible}
        onClose={() => setExamVisible(false)}
        onSave={handleSaveEvent}
        subjects={subjects}
        events={events}
        theme={theme}
        initialDate={selectedDate || undefined}
        isDateLocked={!!selectedDate}
      />

      {/* Generic / Custom Event Modal */}
      <EventModal
        visible={eventModalVisible}
        onClose={() => {
          setEventModalVisible(false);
          setEditingEvent(null);
        }}
        onSave={handleSaveEvent}
        onDelete={async (id) => {
          try {
            if (id) {
              await deleteEvent(id);
            }
          } catch (e) {
            console.warn('Erro ao excluir evento:', e);
          } finally {
            setEventModalVisible(false);
            setEditingEvent(null);
          }
        }}
        theme={theme}
        initialEvent={editingEvent}
        initialDate={selectedDate || undefined}
        isDateLocked={!!selectedDate && !editingEvent}
      />

      {/* Pending Attendance Modal */}
      <PendingAttendanceModal
        visible={attendanceModalVisible}
        onClose={() => setAttendanceModalVisible(false)}
        pendingAttendances={attendances.filter(a => a && a.status === 'pending')}
        subjects={subjects}
        events={events}
        theme={theme}
        onUpdateStatus={async (id, status) => {
          try {
            const updated = attendances.map(a => a && a.id === id ? { ...a, status } : a);
            setAttendances(updated);
            await StorageService.saveAttendances(updated);
            if (updated.filter(a => a && a.status === 'pending').length === 0) {
              setAttendanceModalVisible(false);
            }
          } catch (e) {
            console.warn('Erro ao atualizar presença pendente:', e);
          }
        }}
      />

      {/* Weekly Schedule Grid Modal */}
      <Modal
        visible={scheduleGridVisible}
        animationType="slide"
        onRequestClose={() => setScheduleGridVisible(false)}
      >
        <SafeAreaView style={[styles.gridModalContainer, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
          <View style={[styles.gridModalHeader, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                setScheduleGridVisible(false);
              }}
              style={styles.gridCloseBtn}
              activeOpacity={0.7}
            >
              <Text style={[styles.gridCloseBtnText, { color: colors.primary }]}>✕ Fechar</Text>
            </TouchableOpacity>
            <Text style={[styles.gridModalTitle, { color: colors.text }]}>Grade Semanal</Text>
            <View style={{ width: 60 }} />
          </View>
          <ScheduleGridScreen
            subjects={subjects}
            events={events}
            theme={theme}
            semesters={semesters}
          />
        </SafeAreaView>
      </Modal>
    </SwipeableTabContainer>
  );
};

const styles = StyleSheet.create({
  gridModalContainer: {
    flex: 1,
  },
  gridModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  gridCloseBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  gridCloseBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  gridModalTitle: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
});
