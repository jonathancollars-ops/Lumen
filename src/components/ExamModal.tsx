import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, TextInput, Alert, Switch, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import { AppEvent, ThemeType, Subject } from '../types';
import { getThemeColors, getContrastTextColor } from '../theme';
import { generateId, getLocalDateString } from '../utils';
import { SecuritySanitizer } from '../services/SecuritySanitizer';
import * as Haptics from 'expo-haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (event: AppEvent) => void;
  subjects: Subject[];
  events: AppEvent[];
  theme: ThemeType;
  initialDate?: string;
  isDateLocked?: boolean;
}

const ALERT_OPTIONS = [
  { label: 'Na hora', value: 0 },
  { label: '15 min antes', value: 15 },
  { label: '1 hora antes', value: 60 },
  { label: '1 dia antes', value: 1440 },
  { label: '1 semana antes', value: 10080 },
];

export const ExamModal: React.FC<Props> = ({ visible, onClose, onSave, subjects, events, theme, initialDate, isDateLocked }) => {
  const colors = getThemeColors(theme);
  const styles = getStyles(colors);

  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [examType, setExamType] = useState<'Prova' | 'Trabalho'>('Prova');
  const [date, setDate] = useState('');
  const [showCalendar, setShowCalendar] = useState(false);
  
  const [startMinutes, setStartMinutes] = useState(480);
  const [durationMinutes, setDurationMinutes] = useState(60);
  
  const [alerts, setAlerts] = useState<number[]>([1440, 10080]); // Default 1 day and 1 week before
  const [customAlertVal, setCustomAlertVal] = useState('');
  const [customAlertUnit, setCustomAlertUnit] = useState<number>(1);

  // Grade Engine
  const [weight, setWeight] = useState('1');
  const [maxGrade, setMaxGrade] = useState('10');
  const [isExtraPoint, setIsExtraPoint] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const selectedSubject = useMemo(() => subjects.find(s => s.id === selectedSubjectId), [subjects, selectedSubjectId]);

  // Find all weekly class events for the selected subject
  const classEvents = useMemo(() => {
    if (!selectedSubjectId) return [];
    return events.filter(e => 
      e.subjectId === selectedSubjectId && 
      e.category === 'Faculdade/Aulas'
    );
  }, [events, selectedSubjectId]);

  // Extract valid days of week (0 = Sun, 1 = Mon ... 6 = Sat)
  const validDaysOfWeek = useMemo(() => {
    const days = new Set<number>();
    classEvents.forEach((e: AppEvent) => {
      if (e.recurrenceDays && e.recurrenceDays.length > 0) {
        e.recurrenceDays.forEach((d: number) => days.add(d));
      } else if (e.date) {
        const d = new Date(e.date + 'T12:00:00').getDay();
        days.add(d);
      }
    });
    return Array.from(days).sort();
  }, [classEvents]);

  const DAY_NAMES = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const DAY_SHORT_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  const validDayNamesStr = useMemo(() => {
    if (validDaysOfWeek.length === 0) return 'Qualquer dia';
    return validDaysOfWeek.map((d: number) => DAY_NAMES[d]).join(' e ');
  }, [validDaysOfWeek]);

  // Generate the next 10 upcoming class dates from today onwards
  const upcomingClassDates = useMemo(() => {
    if (validDaysOfWeek.length === 0) return [];
    const list: { dateStr: string; label: string; weekday: string }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 90 && list.length < 10; i++) {
      const cursor = new Date(today);
      cursor.setDate(today.getDate() + i);
      const dayOfWeek = cursor.getDay();
      if (validDaysOfWeek.includes(dayOfWeek)) {
        const dateStr = getLocalDateString(cursor);
        const dayNum = cursor.getDate().toString().padStart(2, '0');
        const monthNum = (cursor.getMonth() + 1).toString().padStart(2, '0');
        const weekdayShort = DAY_SHORT_NAMES[dayOfWeek];
        list.push({
          dateStr,
          label: `${dayNum}/${monthNum}`,
          weekday: weekdayShort
        });
      }
    }
    return list;
  }, [validDaysOfWeek]);

  // Automatically select the first upcoming class day when subject changes
  useEffect(() => {
    if (visible && !isDateLocked && upcomingClassDates.length > 0) {
      // If current date is not in valid class days or empty, select first upcoming
      const currentDayOfWeek = date ? new Date(date + 'T12:00:00').getDay() : -1;
      if (!date || !validDaysOfWeek.includes(currentDayOfWeek)) {
        setDate(upcomingClassDates[0].dateStr);
      }
    }
  }, [selectedSubjectId, upcomingClassDates, visible, isDateLocked]);

  useEffect(() => {
    if (visible) {
      if (subjects.length > 0) {
        setSelectedSubjectId(subjects[0].id);
      }
      setDate(initialDate || getLocalDateString());
      setStartMinutes(480);
      setDurationMinutes(60);
      setExamType('Prova');
      setAlerts([1440, 10080]);
      setCustomAlertVal('');
      setCustomAlertUnit(1);
      setShowCalendar(false);
      setWeight('1');
      setMaxGrade('10');
      setIsExtraPoint(false);
      setShowAdvanced(false);
    }
  }, [visible, initialDate, subjects]);

  // Herança de horário da matéria
  useEffect(() => {
    if (!visible || !date || !selectedSubjectId) return;
    
    const targetDay = new Date(date + 'T12:00:00').getDay();
    const classEvent = events.find(e => 
      e.subjectId === selectedSubjectId && 
      e.recurrence === 'weekly' && 
      new Date(e.date + 'T12:00:00').getDay() === targetDay
    );

    if (classEvent) {
      const [h, m] = (classEvent.startTime || '08:00').split(':').map(Number);
      setStartMinutes((h || 0) * 60 + (m || 0));
      
      const [eh, em] = (classEvent.endTime || '10:00').split(':').map(Number);
      const diff = ((eh || 0) * 60 + (em || 0)) - ((h || 0) * 60 + (m || 0));
      if (diff > 0) {
        setDurationMinutes(diff);
      }
    }
  }, [date, selectedSubjectId, visible, events]);

  const formatTime = (totalMinutes: number) => {
    const total = totalMinutes % 1440;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  const formatDuration = (totalMinutes: number) => {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h} hora${h > 1 ? 's' : ''}`;
    return `${m} minutos`;
  };

  const toggleAlert = (val: number) => {
    Haptics.selectionAsync();
    if (alerts.includes(val)) {
      setAlerts(alerts.filter(a => a !== val));
    } else {
      setAlerts([...alerts, val]);
    }
  };

  const handleCalendarDayPress = (day: any) => {
    const dayOfWeek = new Date(day.dateString + 'T12:00:00').getDay();
    if (validDaysOfWeek.length > 0 && !validDaysOfWeek.includes(dayOfWeek)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        'Dia sem Aula',
        `A matéria "${selectedSubject?.name || 'selecionada'}" possui aulas apenas em: ${validDayNamesStr}.\n\nSelecione um dos dias de aula para marcar a ${examType.toLowerCase()}.`
      );
      return;
    }

    Haptics.selectionAsync();
    setDate(day.dateString);
    setShowCalendar(false);
  };

  const handleSave = () => {
    if (!selectedSubjectId || !date) return;

    // Validate that the selected date is a valid class day
    if (validDaysOfWeek.length > 0) {
      const selectedDayOfWeek = new Date(date + 'T12:00:00').getDay();
      if (!validDaysOfWeek.includes(selectedDayOfWeek)) {
        Alert.alert(
          'Dia sem Aula',
          `A matéria "${selectedSubject?.name || 'selecionada'}" só tem aulas em: ${validDayNamesStr}.\n\nEscolha um dia em que você tenha aula desta disciplina.`
        );
        return;
      }
    }

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const subject = subjects.find(s => s && s.id === selectedSubjectId);
      if (!subject) return;

      let nextNum = 1;
      const prefix = examType === 'Prova' ? 'P' : 'T';
      
      const safeEvents = Array.isArray(events) ? events.filter(Boolean) : [];
      safeEvents.forEach(e => {
        if (e && e.subjectId === selectedSubjectId && e.category === 'Provas/Trabalhos' && typeof e.title === 'string') {
          const match = e.title.match(new RegExp(`^${prefix}(\\d+)`));
          if (match) {
            const num = parseInt(match[1]);
            if (num >= nextNum) nextNum = num + 1;
          }
        }
      });

      const autoTitle = `${prefix}${nextNum} - ${subject.name || 'Avaliação'}`;
      const safeTitle = SecuritySanitizer.sanitizeTitle(autoTitle);
      const safeWeight = SecuritySanitizer.sanitizeNumber(weight, 0.1, 100, 1);
      const safeMaxGrade = SecuritySanitizer.sanitizeNumber(maxGrade, 1, 100, 10);
      const safeAlerts = alerts.map(a => SecuritySanitizer.sanitizeInteger(a, 0, 525600, 0));

      const newEvent: AppEvent = {
        id: generateId('evt_eval'),
        title: safeTitle,
        category: 'Provas/Trabalhos',
        date,
        startTime: formatTime(startMinutes),
        endTime: formatTime(startMinutes + durationMinutes),
        recurrence: 'none',
        alerts: safeAlerts,
        isCompleted: false,
        isImportant: true,
        isNotified: safeAlerts.length > 0,
        subjectId: subject.id,
        weight: safeWeight,
        maxGrade: safeMaxGrade,
        isExtraPoint,
      };

      onSave(newEvent);
    } catch (e) {
      console.warn('Erro ao salvar avaliação em ExamModal:', e);
    }
  };

  // Calendar markings for all valid class days
  const calendarMarks = useMemo(() => {
    const marks: Record<string, any> = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (validDaysOfWeek.length > 0) {
      for (let i = 0; i < 90; i++) {
        const cursor = new Date(today);
        cursor.setDate(today.getDate() + i);
        if (validDaysOfWeek.includes(cursor.getDay())) {
          const dStr = getLocalDateString(cursor);
          marks[dStr] = {
            marked: true,
            dotColor: selectedSubject?.color || colors.primary
          };
        }
      }
    }

    if (date) {
      marks[date] = {
        ...marks[date],
        selected: true,
        selectedColor: selectedSubject?.color || colors.primary,
        selectedTextColor: getContrastTextColor(selectedSubject?.color || colors.primary)
      };
    }
    return marks;
  }, [validDaysOfWeek, date, selectedSubject, colors.primary]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerActionBtn} activeOpacity={0.7}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Nova Avaliação</Text>
          <TouchableOpacity
            onPress={handleSave}
            style={[styles.headerActionBtn, { opacity: (!selectedSubjectId || !date) ? 0.4 : 1 }]}
            activeOpacity={0.7}
            disabled={!selectedSubjectId || !date}
          >
            <Text style={styles.saveText}>Salvar</Text>
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {subjects.length === 0 ? (
            <View style={{ padding: 30, alignItems: 'center' }}>
              <Text style={{ fontSize: 36, marginBottom: 12 }}>📚</Text>
              <Text style={{ color: colors.textSecondary, textAlign: 'center', fontSize: 15, lineHeight: 22 }}>
                Você precisa cadastrar uma Matéria/Aula primeiro antes de agendar provas ou trabalhos.
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.label}>Matéria</Text>
              <View style={styles.filterContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScrollContent}>
                  {subjects.map(sub => {
                    const isSelected = selectedSubjectId === sub.id;
                    const chipColor = sub.color || colors.primary;
                    return (
                      <TouchableOpacity
                        key={sub.id}
                        style={[
                          styles.subjectBadge,
                          { 
                            backgroundColor: isSelected ? chipColor : colors.surfaceSubtle, 
                            borderColor: isSelected ? chipColor : colors.border, 
                          }
                        ]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setSelectedSubjectId(sub.id);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={{
                          color: isSelected ? getContrastTextColor(chipColor) : colors.text,
                          fontWeight: '700',
                          fontSize: 12
                        }}>
                          {sub.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Informative banner showing class days */}
              {validDaysOfWeek.length > 0 && (
                <View style={[styles.infoBanner, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                  <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                    🗓️ <Text style={{ fontWeight: '700', color: colors.text }}>Dias de aula:</Text> {validDayNamesStr}
                  </Text>
                </View>
              )}

              <Text style={styles.label}>Tipo de Avaliação</Text>
              <View style={[styles.row, { marginBottom: 16 }]}>
                {['Prova', 'Trabalho'].map(type => {
                  const isSelected = examType === type;
                  return (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.typeBadge,
                        { 
                          backgroundColor: isSelected ? colors.primary : colors.surfaceSubtle, 
                          borderColor: isSelected ? colors.primary : colors.border, 
                        }
                      ]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setExamType(type as any);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={{
                        color: isSelected ? getContrastTextColor(colors.primary) : colors.text,
                        fontWeight: '700',
                        fontSize: 13
                      }}>
                        {type === 'Prova' ? '📝 Prova' : '📁 Trabalho'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Quick Future Class Dates Carousel */}
              {upcomingClassDates.length > 0 && (
                <>
                  <Text style={styles.label}>Próximas Aulas desta Matéria</Text>
                  <View style={styles.filterContainer}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScrollContent}>
                      {upcomingClassDates.map((item: { dateStr: string; label: string; weekday: string }, idx: number) => {
                        const isSelected = date === item.dateStr;
                        return (
                          <TouchableOpacity
                            key={`${item.dateStr}-${idx}`}
                            style={[
                              styles.dateChip,
                              {
                                backgroundColor: isSelected ? (selectedSubject?.color || colors.primary) : colors.surface,
                                borderColor: isSelected ? (selectedSubject?.color || colors.primary) : colors.border
                              }
                            ]}
                            onPress={() => {
                              Haptics.selectionAsync();
                              setDate(item.dateStr);
                              setShowCalendar(false);
                            }}
                            activeOpacity={0.7}
                          >
                            <Text style={{
                              fontSize: 10,
                              fontWeight: '700',
                              color: isSelected ? getContrastTextColor(selectedSubject?.color || colors.primary) : colors.textSecondary
                            }}>
                              {item.weekday}
                            </Text>
                            <Text style={{
                              fontSize: 13,
                              fontWeight: '800',
                              color: isSelected ? getContrastTextColor(selectedSubject?.color || colors.primary) : colors.text
                            }}>
                              {item.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                </>
              )}

              <Text style={styles.label}>Data Selecionada</Text>
              {isDateLocked ? (
                <View style={[styles.input, { backgroundColor: colors.surfaceSubtle, opacity: 0.8 }]}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{date.split('-').reverse().join('/')} (Bloqueado nesta visão)</Text>
                </View>
              ) : (
                <View>
                  <TouchableOpacity 
                    style={[styles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]} 
                    onPress={() => {
                      Haptics.selectionAsync();
                      setShowCalendar(!showCalendar);
                    }}
                    activeOpacity={0.7}
                  >
                    <View>
                      <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>
                        {date ? `${date.split('-').reverse().join('/')} (${DAY_SHORT_NAMES[new Date(date + 'T12:00:00').getDay()]})` : 'Selecione uma data'}
                      </Text>
                    </View>
                    <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>
                      {showCalendar ? '▲ Fechar' : '📅 Outra data no calendário'}
                    </Text>
                  </TouchableOpacity>
                  
                  {showCalendar && (
                    <View style={{ marginBottom: 16, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
                      <Calendar
                        current={date || getLocalDateString()}
                        onDayPress={handleCalendarDayPress}
                        markedDates={calendarMarks}
                        theme={{
                          calendarBackground: colors.surface,
                          textSectionTitleColor: colors.textSecondary,
                          dayTextColor: colors.text,
                          monthTextColor: colors.text,
                          arrowColor: colors.primary,
                        }}
                      />
                    </View>
                  )}
                </View>
              )}

              <TouchableOpacity 
                style={{ marginBottom: 14, paddingVertical: 6 }} 
                onPress={() => {
                  Haptics.selectionAsync();
                  setShowAdvanced(!showAdvanced);
                }}
                activeOpacity={0.7}
              >
                <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 13 }}>
                  {showAdvanced ? '▲ Ocultar Opções Avançadas' : '⚙️ Opções Avançadas de Notas'}
                </Text>
              </TouchableOpacity>

              {showAdvanced && (
                <View style={[styles.advancedBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={[styles.row, { justifyContent: 'space-between' }]}>
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <Text style={{ color: colors.textSecondary, marginBottom: 6, fontWeight: '600', fontSize: 13 }}>Peso</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="numeric"
                        value={weight}
                        onChangeText={setWeight}
                        placeholder="1"
                        placeholderTextColor={colors.textSecondary}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.textSecondary, marginBottom: 6, fontWeight: '600', fontSize: 13 }}>Nota Máxima</Text>
                      <TextInput
                        style={styles.input}
                        keyboardType="numeric"
                        value={maxGrade}
                        onChangeText={setMaxGrade}
                        placeholder="10"
                        placeholderTextColor={colors.textSecondary}
                      />
                    </View>
                  </View>
                  
                  <View style={[styles.row, { alignItems: 'center', marginTop: 6 }]}>
                    <Switch
                      value={isExtraPoint}
                      onValueChange={(val) => {
                        Haptics.selectionAsync();
                        setIsExtraPoint(val);
                      }}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor={isExtraPoint ? '#fff' : '#f4f3f4'}
                    />
                    <Text style={{ color: colors.text, marginLeft: 10, flex: 1, fontWeight: '700', fontSize: 13 }}>
                      Ponto Extra (Soma direto na média)
                    </Text>
                  </View>
                </View>
              )}

              <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 16, padding: 14, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border }]}>
                <View>
                  <Text style={[styles.label, { marginBottom: 2, marginTop: 0 }]}>Horário Herdado</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 11 }}>Baseado no horário da matéria</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 16 }}>
                    {formatTime(startMinutes)}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>
                    Duração: {formatDuration(durationMinutes)}
                  </Text>
                </View>
              </View>

              <Text style={styles.label}>Notificações & Lembretes</Text>
              <View style={styles.filterContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScrollContent}>
                  {ALERT_OPTIONS.map(option => {
                    const isSelected = alerts.includes(option.value);
                    return (
                      <TouchableOpacity
                        key={option.value}
                        style={[
                          styles.alertBadge,
                          { 
                            backgroundColor: isSelected ? colors.primary : colors.surfaceSubtle, 
                            borderColor: isSelected ? colors.primary : colors.border, 
                          }
                        ]}
                        onPress={() => toggleAlert(option.value)}
                        activeOpacity={0.7}
                      >
                        <Text style={{
                          color: isSelected ? getContrastTextColor(colors.primary) : colors.text,
                          fontWeight: '700',
                          fontSize: 11
                        }}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={{ height: 40 }} />
            </>
          )}
        </ScrollView>
        </KeyboardAvoidingView>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerActionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5
  },
  cancelText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '700',
  },
  saveText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
  },
  content: {
    padding: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: colors.text,
    marginBottom: 12,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
  },
  filterContainer: {
    height: 38,
    marginBottom: 12,
  },
  filterScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subjectBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    marginRight: 6,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typeBadge: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  dateChip: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 6,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 60,
  },
  alertBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 6,
    height: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoBanner: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
  },
  advancedBox: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 14,
  }
});

