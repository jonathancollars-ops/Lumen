import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AttendanceRecord, Subject, AppEvent, ThemeType } from '../types';
import { getThemeColors, getContrastTextColor } from '../theme';
import * as Haptics from 'expo-haptics';
import { filterValidAttendances } from '../utils/attendanceValidity';

interface Props {
  visible: boolean;
  onClose: () => void;
  pendingAttendances: AttendanceRecord[];
  subjects: Subject[];
  events: AppEvent[];
  onUpdateStatus: (id: string, status: 'present' | 'absent' | 'cancelled') => void;
  theme: ThemeType;
}

export const PendingAttendanceModal: React.FC<Props> = ({ visible, onClose, pendingAttendances, subjects, events, onUpdateStatus, theme }) => {
  const colors = getThemeColors(theme);
  const styles = getStyles(colors);

  const handleUpdateStatus = (id: string, status: 'present' | 'absent' | 'cancelled') => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onUpdateStatus(id, status);
    } catch (e) {
      console.warn('Erro ao atualizar status de presença pendente:', e);
    }
  };

  const safeSubjects = Array.isArray(subjects) ? subjects.filter(Boolean) : [];
  const safeEvents = Array.isArray(events) ? events.filter(Boolean) : [];
  const safePending = filterValidAttendances(Array.isArray(pendingAttendances) ? pendingAttendances : [], safeSubjects, safeEvents)
    .filter(record => record.status === 'pending');

  if (!visible && safePending.length === 0) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Faltas Pendentes</Text>
          <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={styles.closeBtn}>
            <Text style={styles.closeText}>✕ Fechar</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {safePending.length === 0 ? (
            <View style={{ alignItems: 'center', padding: 24, marginTop: 40 }}>
              <Text style={{ fontSize: 36, marginBottom: 12 }}>🎉</Text>
              <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16, textAlign: 'center' }}>
                Nenhuma presença pendente!
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 18 }}>
                Todas as presenças de aulas passadas estão devidamente registradas.
              </Text>
            </View>
          ) : (
            <>
              <Text style={{ color: colors.textSecondary, marginBottom: 18, fontSize: 14, lineHeight: 20 }}>
                Você tem aulas passadas sem registro de presença. Atualize seu status para manter o histórico preciso:
              </Text>

              {safePending.map(att => {
                const subject = safeSubjects.find(s => s.id === att.subjectId)!;
                const event = safeEvents.find(e => e && e.id === att.eventId);

                return (
                  <View key={att.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={{ marginBottom: 15 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                        <View style={[styles.subjectDot, { backgroundColor: subject.color || colors.primary }]} />
                        <Text style={[styles.subjectName, { color: colors.text }]} numberOfLines={1}>
                          {subject.name}
                        </Text>
                      </View>
                      <View style={[styles.dateBadge, { backgroundColor: colors.surfaceSubtle }]}>
                        <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>
                          📅 {att.date ? att.date.split('-').reverse().join('/') : ''} {event?.startTime ? `• ${event.startTime} - ${event.endTime || ''}` : ''}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.buttonRow}>
                      <TouchableOpacity 
                        style={[styles.actionBtn, { backgroundColor: colors.successLight, borderColor: colors.success }]}
                        onPress={() => handleUpdateStatus(att.id, 'present')}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.btnText, { color: theme === 'light' ? colors.successDark : colors.success }]}>✓ Presente</Text>
                      </TouchableOpacity>
                      
                      <TouchableOpacity 
                        style={[styles.actionBtn, { backgroundColor: colors.dangerLight, borderColor: colors.danger }]}
                        onPress={() => handleUpdateStatus(att.id, 'absent')}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.btnText, { color: theme === 'light' ? colors.dangerDark : colors.danger }]}>✕ Faltei</Text>
                      </TouchableOpacity>

                      <TouchableOpacity 
                        style={[styles.actionBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                        onPress={() => handleUpdateStatus(att.id, 'cancelled')}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.btnText, { color: colors.textSecondary }]}>Cancelada</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
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
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.danger,
    letterSpacing: -0.5
  },
  closeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  closeText: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: '700',
  },
  content: {
    padding: 18,
  },
  card: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2
  },
  subjectDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  subjectName: {
    fontSize: 17,
    fontWeight: '700',
    flex: 1
  },
  dateBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 4,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  btnText: {
    fontWeight: '700',
    fontSize: 13,
  }
});

