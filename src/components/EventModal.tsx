import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ScrollView, Switch, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { Calendar } from 'react-native-calendars';
import { ClockTimePickerModal } from './ClockTimePickerModal';
import { AppEvent, EventCategory, RecurrenceType, ThemeType } from '../types';
import { getThemeColors, CategoryColors, getCategoryColor, getContrastTextColor } from '../theme';
import { generateId, getLocalDateString } from '../utils';
import { SecuritySanitizer } from '../services/SecuritySanitizer';
import * as Haptics from 'expo-haptics';

interface EventModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (event: AppEvent) => void;
  onDelete?: (eventId: string) => void;
  theme: ThemeType;
  initialEvent?: AppEvent | null;
  initialDate?: string | null;
  isDateLocked?: boolean;
}

const CATEGORIES: EventCategory[] = ['Saúde/Academia', 'Faculdade/Aulas', 'Provas/Trabalhos', 'Lazer', 'Outros'];

const ALERT_OPTIONS = [
  { label: 'Na hora', value: 0 },
  { label: '15 min antes', value: 15 },
  { label: '1 hora antes', value: 60 },
  { label: '1 dia antes', value: 1440 },
  { label: '1 semana antes', value: 10080 },
];

export const EventModal: React.FC<EventModalProps> = ({ visible, onClose, onSave, onDelete, theme, initialEvent, initialDate, isDateLocked }) => {
  const colors = getThemeColors(theme);
  const styles = React.useMemo(() => getStyles(colors), [colors]);
  
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<EventCategory>('Saúde/Academia');
  const [date, setDate] = useState(initialDate || getLocalDateString());
  const [startMinutes, setStartMinutes] = useState(480);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [customAlertVal, setCustomAlertVal] = useState('');
  const [customAlertUnit, setCustomAlertUnit] = useState<number>(1); // 1=min, 60=hour, 1440=day
  const [recurrence, setRecurrence] = useState<RecurrenceType>('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState<number>(1);
  const [recurrenceMonthDay, setRecurrenceMonthDay] = useState<number>(15);
  const [alerts, setAlerts] = useState<number[]>([0]); // Default "Na hora"
  const [isImportant, setIsImportant] = useState(false);
  const [isNotified, setIsNotified] = useState(true);
  const [showCalendar, setShowCalendar] = useState(false);

  // ClockTimePickerModal state
  const [clockModalVisible, setClockModalVisible] = useState(false);
  const [clockTarget, setClockTarget] = useState<'start' | 'end'>('start');

  const parseTime = (timeStr: string) => {
    if (!timeStr || !timeStr.includes(':')) return 480;
    const [h, m] = timeStr.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const formatTime = (totalMinutes: number) => {
    const total = totalMinutes % 1440; // max 24h
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

  const openClockPicker = (target: 'start' | 'end') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setClockTarget(target);
    setClockModalVisible(true);
  };

  const handleConfirmClock = (_timeStr: string, totalMinutes: number) => {
    if (clockTarget === 'start') {
      setStartMinutes(totalMinutes);
    } else {
      let diff = totalMinutes - startMinutes;
      if (diff <= 0) diff += 1440;
      setDurationMinutes(diff);
    }
  };

  React.useEffect(() => {
    if (visible) {
      setShowCalendar(false);
      setClockModalVisible(false);
      setCustomAlertVal('');
      if (initialEvent) {
        setTitle(initialEvent.title);
        setCategory(initialEvent.category);
        setDate(initialEvent.date);
        const start = parseTime(initialEvent.startTime);
        setStartMinutes(start);
        
        if (initialEvent.endTime) {
           let end = parseTime(initialEvent.endTime);
           if (end <= start) end += 1440; // crossed midnight or a full day
           setDurationMinutes(end - start);
        } else {
           setDurationMinutes(60);
        }

        setRecurrence(initialEvent.recurrence);
        setRecurrenceInterval(initialEvent.recurrenceInterval || 1);
        if (initialEvent.recurrenceMonthDay) {
          setRecurrenceMonthDay(initialEvent.recurrenceMonthDay);
        } else if (initialEvent.date) {
          const parts = initialEvent.date.split('-');
          const d = parseInt(parts[2], 10);
          setRecurrenceMonthDay(!isNaN(d) ? d : 15);
        } else {
          setRecurrenceMonthDay(15);
        }

        setAlerts(initialEvent.alerts || [0]);
        setIsImportant(initialEvent.isImportant || false);
        setIsNotified(initialEvent.isNotified !== false);
      } else {
        setTitle('');
        setCategory('Saúde/Academia');
        setDate(initialDate || getLocalDateString());
        setStartMinutes(480);
        setDurationMinutes(60);
        setRecurrence('none');
        setRecurrenceInterval(1);
        const todayDay = new Date().getDate();
        setRecurrenceMonthDay(todayDay || 15);
        setAlerts([0]);
        setIsImportant(false);
        setIsNotified(true);
      }
    }
  }, [visible, initialEvent, initialDate]);

  const toggleAlert = (val: number) => {
    Haptics.selectionAsync();
    if (alerts.includes(val)) {
      setAlerts(alerts.filter(a => a !== val));
    } else {
      setAlerts([...alerts, val]);
    }
  };

  const addCustomAlert = () => {
    const cleanNum = SecuritySanitizer.sanitizeInteger(customAlertVal, 1, 43200, 0);
    if (cleanNum > 0) {
      const totalMin = Math.min(cleanNum * customAlertUnit, 525600); // max 1 year
      if (!alerts.includes(totalMin)) {
        setAlerts([...alerts, totalMin]);
      }
    }
    setCustomAlertVal('');
  };

  const handleSave = () => {
    const sanitizedTitle = SecuritySanitizer.sanitizeTitle(title);
    if (!sanitizedTitle || !date.trim()) {
      Alert.alert('Título Inválido', 'Por favor, informe um título válido para o compromisso.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const safeStart = SecuritySanitizer.sanitizeInteger(startMinutes, 0, 1439, 480);
    const safeDuration = SecuritySanitizer.sanitizeInteger(durationMinutes, 5, 1440, 60);

    const startTimeStr = formatTime(safeStart);
    const endTimeStr = formatTime(safeStart + safeDuration);

    const safeAlerts = Array.isArray(alerts)
      ? alerts
          .map(a => SecuritySanitizer.sanitizeInteger(a, 0, 525600, 0))
          .filter((v, i, arr) => arr.indexOf(v) === i)
      : [0];

    const safeRecurrenceInterval = recurrence === 'monthly'
      ? SecuritySanitizer.sanitizeInteger(recurrenceInterval, 1, 12, 1)
      : recurrence === 'custom_interval' ? initialEvent?.recurrenceInterval : undefined;

    const safeRecurrenceMonthDay = recurrence === 'monthly'
      ? SecuritySanitizer.sanitizeInteger(recurrenceMonthDay, 1, 31, 15)
      : recurrence === 'custom_interval' ? initialEvent?.recurrenceMonthDay : undefined;

    const newEvent: AppEvent = {
      ...initialEvent,
      id: initialEvent ? initialEvent.id : generateId('evt'),
      title: sanitizedTitle,
      category,
      date,
      startTime: startTimeStr,
      endTime: endTimeStr,
      recurrence,
      recurrenceInterval: safeRecurrenceInterval,
      recurrenceUnit: recurrence === 'monthly' ? 'months' : recurrence === 'custom_interval' ? initialEvent?.recurrenceUnit : undefined,
      recurrenceDays: recurrence === 'weekly' ? initialEvent?.recurrenceDays : undefined,
      recurrenceMonthDay: safeRecurrenceMonthDay,
      alerts: safeAlerts,
      isCompleted: initialEvent ? initialEvent.isCompleted : false,
      isImportant,
      isNotified,
    };
    onSave(newEvent);
  };

  const handleDelete = () => {
    if (!initialEvent || !onDelete) return;
    Alert.alert(
      'Excluir Compromisso',
      `Tem certeza que deseja excluir "${initialEvent.title || 'este compromisso'}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: () => {
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              onDelete(initialEvent.id);
            } catch (e) {
              console.warn('Erro ao excluir compromisso:', e);
            }
          }
        }
      ]
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', justifyContent: 'flex-end' }}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]} onPress={(e) => e.stopPropagation?.()}>
            <View style={styles.dragHandle} />
            
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[styles.title, { color: colors.text }]}>
                {initialEvent ? 'Editar Compromisso' : 'Novo Compromisso'}
              </Text>
              
              <TextInput
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceSubtle }]}
                placeholder="Título do compromisso"
                placeholderTextColor={colors.textSecondary}
                value={title}
                onChangeText={setTitle}
              />

              <Text style={[styles.label, { color: colors.text }]}>Categoria</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalScroll}>
                {CATEGORIES.map(c => {
                  const isSelected = category === c;
                  const catColor = getCategoryColor(c, theme);
                  return (
                    <TouchableOpacity
                      key={c}
                      style={[
                        styles.badge,
                        {
                          backgroundColor: isSelected ? catColor : colors.surfaceSubtle,
                          borderColor: isSelected ? catColor : colors.border,
                          borderWidth: 1
                        }
                      ]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setCategory(c);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={{ color: isSelected ? getContrastTextColor(catColor) : colors.text, fontWeight: '700' }}>{c}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <View style={styles.row}>
                <View style={{ flex: 1, marginBottom: 14 }}>
                  <Text style={[styles.label, { color: colors.text }]}>Data</Text>
                  {isDateLocked ? (
                    <View style={[styles.input, { backgroundColor: colors.surfaceSubtle, opacity: 0.7, paddingVertical: 14 }]}>
                      <Text style={{ color: colors.text, fontWeight: '600' }}>{date.split('-').reverse().join('/')} (Bloqueado)</Text>
                    </View>
                  ) : (
                    <View>
                      <TouchableOpacity 
                        style={[styles.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surfaceSubtle }]} 
                        onPress={() => {
                          Haptics.selectionAsync();
                          setShowCalendar(!showCalendar);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{date.split('-').reverse().join('/')}</Text>
                        <Text style={{ color: colors.primary, fontWeight: '700' }}>📅 Alterar</Text>
                      </TouchableOpacity>
                      
                      {showCalendar && (
                        <View style={{ marginBottom: 16, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
                          <Calendar
                            current={date}
                            onDayPress={(day: any) => {
                              Haptics.selectionAsync();
                              setDate(day.dateString);
                              setShowCalendar(false);
                            }}
                            markedDates={{
                              [date]: { selected: true, selectedColor: colors.primary, selectedTextColor: getContrastTextColor(colors.primary) }
                            }}
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
                </View>
              </View>

              {/* Horário e Duração Interativo */}
              <View style={[styles.timeCard, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                <Text style={[styles.label, { color: colors.text, marginTop: 0, marginBottom: 10 }]}>Horário e Duração</Text>

                <View style={styles.timeButtonsRow}>
                  <TouchableOpacity
                    style={[styles.timeBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    onPress={() => openClockPicker('start')}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Horário de início: ${formatTime(startMinutes)}`}
                  >
                    <Text style={[styles.timeBtnSub, { color: colors.textSecondary }]}>Início 🕒</Text>
                    <Text style={[styles.timeBtnText, { color: colors.primary }]}>{formatTime(startMinutes)}</Text>
                  </TouchableOpacity>

                  <View style={styles.timeArrowBox}>
                    <Text style={[styles.timeArrowText, { color: colors.textSecondary }]}>➔</Text>
                  </View>

                  <TouchableOpacity
                    style={[styles.timeBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    onPress={() => openClockPicker('end')}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Horário de término: ${formatTime(startMinutes + durationMinutes)}`}
                  >
                    <Text style={[styles.timeBtnSub, { color: colors.textSecondary }]}>Término 🏁</Text>
                    <Text style={[styles.timeBtnText, { color: colors.primary }]}>
                      {formatTime(startMinutes + durationMinutes)}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Duration summary and quick duration chips */}
                <View style={[styles.durationRow, { borderTopColor: colors.border }]}>
                  <Text style={[styles.durationLabel, { color: colors.textSecondary }]}>
                    Duração: <Text style={{ color: colors.text, fontWeight: '700' }}>{formatDuration(durationMinutes)}</Text>
                  </Text>

                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickDurationScroll}>
                    {[30, 45, 60, 90, 120, 180].map(mins => {
                      const isSelected = durationMinutes === mins;
                      return (
                        <TouchableOpacity
                          key={mins}
                          style={[
                            styles.durationChip,
                            {
                              backgroundColor: isSelected ? colors.primary : colors.surfaceSubtle,
                              borderColor: isSelected ? colors.primary : colors.border
                            }
                          ]}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setDurationMinutes(mins);
                          }}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.durationChipText,
                              { color: isSelected ? getContrastTextColor(colors.primary) : colors.text }
                            ]}
                          >
                            {mins < 60 ? `${mins}m` : mins === 60 ? '1h' : mins === 90 ? '1h30' : mins === 120 ? '2h' : '3h'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              </View>

              <Text style={[styles.label, { color: colors.text }]}>Recorrência</Text>
              <View style={styles.row}>
                {[
                  { id: 'none', label: 'Único' },
                  { id: 'daily', label: 'Diário' },
                  { id: 'weekly', label: 'Semanal' },
                  { id: 'monthly', label: 'Mensal' }
                ].map(r => {
                  const isSelected = recurrence === r.id;
                  return (
                    <TouchableOpacity
                      key={r.id}
                      style={[
                        styles.badge,
                        {
                          backgroundColor: isSelected ? colors.primary : colors.surfaceSubtle,
                          borderColor: isSelected ? colors.primary : colors.border,
                          borderWidth: 1
                        }
                      ]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setRecurrence(r.id as RecurrenceType);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={{ color: isSelected ? getContrastTextColor(colors.primary) : colors.text, fontWeight: '700' }}>
                        {r.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Seletor de Intervalo Customizado para Mensal */}
              {recurrence === 'monthly' && (
                <View style={[styles.monthlySettingsCard, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                  {/* Intervalo em meses */}
                  <Text style={[styles.intervalTitle, { color: colors.textSecondary }]}>
                    A cada quantos meses?
                  </Text>
                  <View style={styles.intervalChipsRow}>
                    {[1, 2, 3, 6, 12].map(num => {
                      const isSelected = recurrenceInterval === num;
                      const label = num === 1 ? '1 mês' : num === 3 ? '3 meses (trimestral)' : num === 6 ? '6 meses (semestral)' : num === 12 ? '12 meses (anual)' : `${num} meses`;
                      return (
                        <TouchableOpacity
                          key={num}
                          style={[
                            styles.intervalChip,
                            {
                              backgroundColor: isSelected ? colors.primary : colors.surface,
                              borderColor: isSelected ? colors.primary : colors.border
                            }
                          ]}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setRecurrenceInterval(num);
                          }}
                          activeOpacity={0.7}
                          accessibilityRole="button"
                          accessibilityLabel={`A cada ${label}`}
                        >
                          <Text
                            style={[
                              styles.intervalChipText,
                              { color: isSelected ? getContrastTextColor(colors.primary) : colors.text }
                            ]}
                          >
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Dia do mês fixo */}
                  <Text style={[styles.intervalTitle, { color: colors.textSecondary, marginTop: 12 }]}>
                    Qual dia do mês?
                  </Text>
                  <View style={styles.dayPickerRow}>
                    <TouchableOpacity
                      style={[styles.dayStepBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setRecurrenceMonthDay(prev => Math.max(1, prev - 1));
                      }}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Diminuir dia do mês"
                    >
                      <Text style={[styles.dayStepBtnText, { color: colors.text }]}>-</Text>
                    </TouchableOpacity>

                    <View style={[styles.dayDisplayBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.dayDisplayLabel, { color: colors.textSecondary }]}>Todo dia</Text>
                      <Text style={[styles.dayDisplayNumber, { color: colors.primary }]}>{recurrenceMonthDay}</Text>
                    </View>

                    <TouchableOpacity
                      style={[styles.dayStepBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setRecurrenceMonthDay(prev => Math.min(31, prev + 1));
                      }}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Aumentar dia do mês"
                    >
                      <Text style={[styles.dayStepBtnText, { color: colors.text }]}>+</Text>
                    </TouchableOpacity>

                    {/* Quick Day Shortcuts */}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickDaysScroll}>
                      {[1, 5, 10, 15, 20, 25, 30].map(d => {
                        const isSelected = recurrenceMonthDay === d;
                        return (
                          <TouchableOpacity
                            key={d}
                            style={[
                              styles.quickDayChip,
                              {
                                backgroundColor: isSelected ? colors.primary : colors.surfaceSubtle,
                                borderColor: isSelected ? colors.primary : colors.border
                              }
                            ]}
                            onPress={() => {
                              Haptics.selectionAsync();
                              setRecurrenceMonthDay(d);
                            }}
                            activeOpacity={0.7}
                          >
                            <Text
                              style={[
                                styles.quickDayChipText,
                                { color: isSelected ? getContrastTextColor(colors.primary) : colors.text }
                              ]}
                            >
                              dia {d}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                </View>
              )}

              <View style={[styles.switchRow, { borderColor: colors.border }]}>
                <Text style={[styles.label, { color: colors.text, marginBottom: 0, flex: 1 }]}>Destaque (Evento Importante ⭐)</Text>
                <Switch 
                  value={isImportant} 
                  onValueChange={(val) => {
                    Haptics.selectionAsync();
                    setIsImportant(val);
                  }} 
                  trackColor={{ false: colors.border, true: colors.primary }} 
                  thumbColor={isImportant ? '#fff' : '#f4f3f4'}
                />
              </View>

              <View style={[styles.switchRow, { borderColor: colors.border }]}>
                <Text style={[styles.label, { color: colors.text, marginBottom: 0, flex: 1 }]}>Ativar Notificações 🔔</Text>
                <Switch 
                  value={isNotified} 
                  onValueChange={(val) => {
                    Haptics.selectionAsync();
                    setIsNotified(val);
                  }} 
                  trackColor={{ false: colors.border, true: colors.primary }} 
                  thumbColor={isNotified ? '#fff' : '#f4f3f4'}
                />
              </View>

              {isNotified && (
                <>
                  <Text style={[styles.label, { color: colors.text, marginTop: 14 }]}>Lembretes Múltiplos</Text>
                  
                  <Text style={{ color: colors.textSecondary, marginBottom: 8, fontSize: 13, fontWeight: '600' }}>Padrões:</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.horizontalScroll, { marginBottom: 14 }]}>
                    {ALERT_OPTIONS.map(option => {
                      const isSelected = alerts.includes(option.value);
                      return (
                        <TouchableOpacity
                          key={option.value}
                          style={[
                            styles.badge,
                            { 
                              backgroundColor: isSelected ? colors.primary : colors.surfaceSubtle, 
                              borderColor: isSelected ? colors.primary : colors.border, 
                              borderWidth: 1 
                            }
                          ]}
                          onPress={() => toggleAlert(option.value)}
                          activeOpacity={0.7}
                        >
                          <Text style={{ color: isSelected ? getContrastTextColor(colors.primary) : colors.text, fontWeight: '700' }}>
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <Text style={{ color: colors.textSecondary, marginBottom: 8, fontSize: 13, fontWeight: '600' }}>Personalizado:</Text>
                  <View style={[styles.row, { marginBottom: 14, alignItems: 'center' }]}>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          width: 76,
                          minHeight: 44,
                          height: 44,
                          marginBottom: 0,
                          marginRight: 8,
                          textAlign: 'center',
                          color: colors.text,
                          borderColor: colors.border,
                          backgroundColor: colors.surfaceSubtle
                        }
                      ]}
                      placeholder="Ex: 5"
                      placeholderTextColor={colors.textSecondary}
                      keyboardType="numeric"
                      value={customAlertVal}
                      onChangeText={setCustomAlertVal}
                    />
                    <View style={{ flexDirection: 'row', gap: 6, flex: 1, marginRight: 8 }}>
                      {[
                        { unit: 1, label: 'Min' },
                        { unit: 60, label: 'Hora' },
                        { unit: 1440, label: 'Dia' }
                      ].map(u => {
                        const isSelected = customAlertUnit === u.unit;
                        return (
                          <TouchableOpacity
                            key={u.unit}
                            style={[
                              styles.customUnitChip,
                              {
                                backgroundColor: isSelected ? colors.primary : colors.surfaceSubtle,
                                borderColor: isSelected ? colors.primary : colors.border
                              }
                            ]}
                            onPress={() => {
                              Haptics.selectionAsync();
                              setCustomAlertUnit(u.unit);
                            }}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityLabel={`Unidade ${u.label}`}
                          >
                            <Text
                              style={[
                                styles.customUnitChipText,
                                { color: isSelected ? getContrastTextColor(colors.primary) : colors.text }
                              ]}
                            >
                              {u.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <TouchableOpacity 
                      style={[
                        styles.addCustomAlertBtn,
                        { backgroundColor: colors.primary }
                      ]} 
                      onPress={addCustomAlert}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel="Adicionar lembrete personalizado"
                    >
                      <Text style={[styles.addCustomAlertBtnText, { color: getContrastTextColor(colors.primary) }]}>+</Text>
                    </TouchableOpacity>
                  </View>

                  {alerts.filter(a => !ALERT_OPTIONS.find(o => o.value === a)).length > 0 && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                      {alerts.filter(a => !ALERT_OPTIONS.find(o => o.value === a)).map(val => {
                        let label = `${val} min`;
                        if (val % 1440 === 0) label = `${val/1440} dia(s)`;
                        else if (val % 60 === 0) label = `${val/60} hora(s)`;
                        return (
                          <TouchableOpacity
                            key={val}
                            style={[styles.badge, { backgroundColor: colors.dangerLight, borderColor: colors.danger, borderWidth: 1, marginRight: 8, marginBottom: 8 }]}
                            onPress={() => toggleAlert(val)}
                          >
                            <Text style={{ color: theme === 'light' ? colors.dangerDark : colors.danger, fontWeight: '700' }}>{label} ✕</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </>
              )}

              <View style={[styles.row, { marginTop: 24, gap: 8 }]}>
                {initialEvent && (
                  <TouchableOpacity
                    style={[styles.actionBtn, { backgroundColor: colors.dangerLight, borderColor: colors.danger, borderWidth: 1 }]}
                    onPress={handleDelete}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: theme === 'light' ? colors.dangerDark : colors.danger, fontWeight: '800' }}>Excluir</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border, borderWidth: 1 }]}
                  onPress={onClose}
                  activeOpacity={0.7}
                >
                  <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.primary }]}
                  onPress={handleSave}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: getContrastTextColor(colors.primary), fontWeight: '800' }}>Salvar</Text>
                </TouchableOpacity>
              </View>
              <View style={{ height: 30 }} />
            </ScrollView>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </TouchableOpacity>

      {/* Clock Time Picker Modal */}
      <ClockTimePickerModal
        visible={clockModalVisible}
        onClose={() => setClockModalVisible(false)}
        onConfirm={handleConfirmClock}
        initialTime={clockTarget === 'start' ? formatTime(startMinutes) : formatTime(startMinutes + durationMinutes)}
        title={clockTarget === 'start' ? 'Horário de Início' : 'Horário de Término'}
        theme={theme}
      />
    </Modal>
  );
};

const getStyles = (colors: ReturnType<typeof getThemeColors>) =>
  StyleSheet.create({
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.65)', justifyContent: 'flex-end' },
    modalContent: {
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      padding: 20,
      maxHeight: '90%',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border
    },
    dragHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: 'rgba(150,150,150,0.4)', alignSelf: 'center', marginBottom: 16 },
    title: { fontSize: 20, fontWeight: '800', marginBottom: 18, letterSpacing: -0.5, color: colors.text },
    input: {
      minHeight: 48,
      height: 48,
      borderWidth: 1.5,
      borderRadius: 12,
      paddingHorizontal: 15,
      marginBottom: 14,
      fontSize: 15,
      color: colors.text,
      backgroundColor: colors.surfaceSubtle,
      borderColor: colors.border
    },
    label: { fontSize: 14, marginBottom: 8, fontWeight: '700', marginTop: 8, color: colors.text },
    horizontalScroll: { flexDirection: 'row', marginBottom: 14 },
    badge: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8, marginBottom: 5 },
    row: { flexDirection: 'row', justifyContent: 'space-between' },
    sliderCard: { padding: 14, borderRadius: 16, borderWidth: 1, marginBottom: 14, backgroundColor: colors.background, borderColor: colors.border },
    timeCard: {
      padding: 14,
      borderRadius: 16,
      borderWidth: 1,
      marginBottom: 14,
    },
    timeButtonsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    timeBtn: {
      flex: 1,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: 'center',
    },
    timeBtnSub: {
      fontSize: 11,
      fontWeight: '600',
      marginBottom: 4,
    },
    timeBtnText: {
      fontSize: 18,
      fontWeight: '800',
    },
    timeArrowBox: {
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    timeArrowText: {
      fontSize: 16,
      fontWeight: '700',
    },
    durationRow: {
      borderTopWidth: 1,
      paddingTop: 10,
      flexDirection: 'column',
      gap: 8,
    },
    durationLabel: {
      fontSize: 12,
      fontWeight: '600',
    },
    quickDurationScroll: {
      flexDirection: 'row',
    },
    durationChip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 10,
      borderWidth: 1,
      marginRight: 6,
    },
    durationChipText: {
      fontSize: 11,
      fontWeight: '700',
    },
    monthlySettingsCard: {
      padding: 14,
      borderRadius: 16,
      borderWidth: 1,
      marginTop: 10,
      marginBottom: 14,
    },
    intervalTitle: {
      fontSize: 12,
      fontWeight: '700',
      marginBottom: 8,
    },
    intervalChipsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    intervalChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 10,
      borderWidth: 1,
    },
    intervalChipText: {
      fontSize: 11,
      fontWeight: '700',
    },
    dayPickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    dayStepBtn: {
      width: 38,
      height: 38,
      borderRadius: 10,
      borderWidth: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    dayStepBtnText: {
      fontSize: 18,
      fontWeight: '700',
      lineHeight: 20,
    },
    dayDisplayBox: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 10,
      borderWidth: 1,
      alignItems: 'center',
      minWidth: 70,
    },
    dayDisplayLabel: {
      fontSize: 9,
      fontWeight: '600',
    },
    dayDisplayNumber: {
      fontSize: 15,
      fontWeight: '800',
    },
    quickDaysScroll: {
      marginLeft: 4,
    },
    quickDayChip: {
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
      marginRight: 6,
    },
    quickDayChipText: {
      fontSize: 11,
      fontWeight: '700',
    },
    customUnitChip: {
      flex: 1,
      height: 44,
      borderRadius: 12,
      borderWidth: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    customUnitChipText: {
      fontSize: 13,
      fontWeight: '700',
    },
    addCustomAlertBtn: {
      width: 44,
      height: 44,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
    },
    addCustomAlertBtnText: {
      fontSize: 20,
      fontWeight: '800',
      lineHeight: 22,
    },
    switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    actionBtn: { flex: 1, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center' }
  });
