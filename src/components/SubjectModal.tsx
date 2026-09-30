import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ScrollView, Platform, KeyboardAvoidingView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { Subject, AppEvent, ThemeType, Semester } from '../types';
import { getThemeColors, getContrastTextColor } from '../theme';
import { generateId, getLocalDateString } from '../utils';
import { SecuritySanitizer } from '../services/SecuritySanitizer';
import * as Haptics from 'expo-haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (subject: Subject, events: AppEvent[]) => void;
  theme: ThemeType;
  semesters?: Semester[];
  currentSemesterId?: string;
}

const DAYS = [
  { id: 1, label: 'Seg' },
  { id: 2, label: 'Ter' },
  { id: 3, label: 'Qua' },
  { id: 4, label: 'Qui' },
  { id: 5, label: 'Sex' },
  { id: 6, label: 'Sáb' },
  { id: 0, label: 'Dom' },
];

const ALERT_OPTIONS = [
  { label: 'Na hora', value: 0 },
  { label: '15 min antes', value: 15 },
  { label: '1 hora antes', value: 60 },
  { label: '1 dia antes', value: 1440 },
  { label: '1 semana antes', value: 10080 },
];

export const SubjectModal: React.FC<Props> = ({ visible, onClose, onSave, theme, semesters = [], currentSemesterId }) => {
  const colors = getThemeColors(theme);
  const styles = getStyles(colors);

  const [name, setName] = useState('');
  const [classDuration, setClassDuration] = useState(50);
  const [classCount, setClassCount] = useState(2);
  const [selectedDays, setSelectedDays] = useState<{ [dayId: number]: { h: number; m: number } }>({});
  const [selectedSemesterId, setSelectedSemesterId] = useState<string | undefined>(currentSemesterId);
  
  const [alerts, setAlerts] = useState<number[]>([0]);
  const [customAlertVal, setCustomAlertVal] = useState('');
  const [customAlertUnit, setCustomAlertUnit] = useState<number>(1);
  const [passGrade, setPassGrade] = useState(7.0);

  const weeklyClasses = classCount * Object.keys(selectedDays).length;
  const maxAbsences = weeklyClasses * 5; // Assumindo semestre de 20 semanas (25% = 5)

  React.useEffect(() => {
    if (visible) {
      setName('');
      setClassDuration(50);
      setClassCount(2);
      setSelectedDays({});
      setSelectedSemesterId(currentSemesterId);
      setAlerts([0]);
      setCustomAlertVal('');
      setCustomAlertUnit(1);
      setPassGrade(7.0);
    }
  }, [visible, currentSemesterId]);

  const toggleDay = (dayId: number) => {
    Haptics.selectionAsync();
    const newDays = { ...selectedDays };
    if (newDays[dayId] !== undefined) {
      delete newDays[dayId];
    } else {
      newDays[dayId] = { h: 8, m: 0 };
    }
    setSelectedDays(newDays);
  };

  const updateDayTime = (dayId: number, field: 'h' | 'm', value: number) => {
    setSelectedDays({
      ...selectedDays,
      [dayId]: { ...selectedDays[dayId], [field]: value }
    });
  };

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
      const totalMin = Math.min(cleanNum * customAlertUnit, 525600);
      if (!alerts.includes(totalMin)) {
        setAlerts([...alerts, totalMin]);
      }
    }
    setCustomAlertVal('');
  };

  const handleSave = () => {
    const sanitizedName = SecuritySanitizer.sanitizeTitle(name);
    if (!sanitizedName) {
      Alert.alert('Nome Inválido', 'Por favor, informe um nome válido para a matéria.');
      return;
    }
    if (Object.keys(selectedDays).length === 0) {
      Alert.alert('Dias da Semana', 'Selecione ao menos um dia de aula para a matéria.');
      return;
    }

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const safePassGrade = SecuritySanitizer.sanitizeNumber(passGrade, 0, 10, 7.0);
      const safeMaxAbsences = SecuritySanitizer.sanitizeInteger(maxAbsences, 0, 1000, 15);
      const safeWeeklyClasses = SecuritySanitizer.sanitizeInteger(weeklyClasses, 1, 100, 2);

      // Generate vibrant distinct HSL color
      const randomColor = `hsl(${Math.floor(Math.random() * 360)}, 75%, 60%)`;

      const subjectId = generateId('subj');

      const subject: Subject = {
        id: subjectId,
        name: sanitizedName,
        color: randomColor,
        passGrade: safePassGrade,
        workloadHours: safeWeeklyClasses,
        maxAbsences: safeMaxAbsences,
        semesterId: selectedSemesterId,
        gradeGroups: [{
          id: generateId('group'),
          name: 'Avaliações',
          weight: 1,
          items: []
        }]
      };

      const events: AppEvent[] = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const safeDuration = SecuritySanitizer.sanitizeInteger(classDuration, 10, 360, 50);
      const safeCount = SecuritySanitizer.sanitizeInteger(classCount, 1, 12, 2);
      const totalDurationMinutes = safeDuration * safeCount;

      const safeAlerts = Array.isArray(alerts)
        ? alerts
            .map(a => SecuritySanitizer.sanitizeInteger(a, 0, 525600, 0))
            .filter((v, i, arr) => arr.indexOf(v) === i)
        : [0];

      Object.entries(selectedDays).forEach(([dayStr, timeObj]) => {
        const dayId = parseInt(dayStr, 10);
        
        let dateCursor = new Date(today);
        while (dateCursor.getDay() !== dayId) {
          dateCursor.setDate(dateCursor.getDate() + 1);
        }
        const dateStr = getLocalDateString(dateCursor);

        const safeH = SecuritySanitizer.sanitizeInteger(timeObj.h, 0, 23, 8);
        const safeM = SecuritySanitizer.sanitizeInteger(timeObj.m, 0, 59, 0);
        const startMinutes = safeH * 60 + safeM;
        const endMinutes = startMinutes + totalDurationMinutes;

        const formatTime = (mins: number) => {
          const h = Math.floor((mins % 1440) / 60);
          const m = (mins % 1440) % 60;
          return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        };

        events.push({
          id: generateId('evt_class'),
          title: sanitizedName,
          category: 'Faculdade/Aulas',
          date: dateStr,
          startTime: formatTime(startMinutes),
          endTime: formatTime(endMinutes),
          recurrence: 'weekly',
          recurrenceDays: [dayId],
          alerts: safeAlerts,
          isCompleted: false,
          isImportant: false,
          isNotified: safeAlerts.length > 0,
          subjectId: subject.id,
        });
      });

      onSave(subject, events);
    } catch (e) {
      console.warn('Erro ao salvar nova matéria e aulas em SubjectModal:', e);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerActionBtn} activeOpacity={0.7}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Nova Matéria</Text>
          <TouchableOpacity onPress={handleSave} style={styles.headerActionBtn} activeOpacity={0.8}>
            <Text style={styles.saveText}>Salvar</Text>
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Nome da Matéria</Text>
          <TextInput
            style={styles.input}
            placeholder="Ex: Cálculo I"
            placeholderTextColor={colors.textSecondary}
            value={name}
            onChangeText={setName}
            autoFocus
          />

          {semesters.length > 0 && (
            <View style={{ marginBottom: 15 }}>
              <Text style={styles.label}>Semestre</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {semesters.map(sem => {
                  const isSelected = selectedSemesterId === sem.id;
                  return (
                    <TouchableOpacity
                      key={sem.id}
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
                        setSelectedSemesterId(sem.id);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={{
                        color: isSelected ? getContrastTextColor(colors.primary) : colors.text,
                        fontWeight: '700'
                      }}>
                        {sem.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: 10 }}>
              <Text style={styles.label}>Carga Horária (Semana)</Text>
              <View style={[styles.input, { paddingVertical: 0, justifyContent: 'center' }]}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17, textAlign: 'center' }}>
                  {weeklyClasses} {weeklyClasses === 1 ? 'tempo' : 'tempos'}
                </Text>
              </View>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: -10 }}>
                Máx. de faltas: {maxAbsences} (25%)
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Média para Passar</Text>
              <View style={[styles.input, { paddingVertical: 0, justifyContent: 'center' }]}>
                <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 17, textAlign: 'center' }}>
                  {passGrade.toFixed(1)}
                </Text>
              </View>
            </View>
          </View>
          
          <View style={{ marginBottom: 20 }}>
            <Slider
              style={{ width: '100%', height: 40 }}
              minimumValue={5}
              maximumValue={10}
              step={0.1}
              value={passGrade}
              onValueChange={setPassGrade}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.primary}
            />
          </View>

          <View style={[styles.sliderCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 6 }]}>
              <Text style={[styles.label, { marginBottom: 0, marginTop: 0 }]}>Duração de cada tempo</Text>
              <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 16 }}>
                {classDuration} min
              </Text>
            </View>
            <Slider
              style={{ width: '100%', height: 40 }}
              minimumValue={30}
              maximumValue={120}
              step={5}
              value={classDuration}
              onValueChange={setClassDuration}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.primary}
            />
          </View>

          <View style={[styles.sliderCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 6 }]}>
              <Text style={[styles.label, { marginBottom: 0, marginTop: 0 }]}>Quantidade de tempos</Text>
              <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 16 }}>
                {classCount}
              </Text>
            </View>
            <Slider
              style={{ width: '100%', height: 40 }}
              minimumValue={1}
              maximumValue={6}
              step={1}
              value={classCount}
              onValueChange={setClassCount}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.primary}
            />
            <Text style={{ color: colors.textSecondary, marginTop: 4, fontSize: 12, fontWeight: '500' }}>
              Duração total da aula: {(classDuration * classCount) / 60 >= 1 ? `${Math.floor((classDuration * classCount) / 60)}h ` : ''}{(classDuration * classCount) % 60}m
            </Text>
          </View>

          <Text style={styles.label}>Dias da Semana</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
            {DAYS.map(day => {
              const isSelected = selectedDays[day.id] !== undefined;
              return (
                <TouchableOpacity
                  key={day.id}
                  style={[
                    styles.badge,
                    { 
                      backgroundColor: isSelected ? colors.primary : colors.surfaceSubtle, 
                      borderColor: isSelected ? colors.primary : colors.border, 
                      borderWidth: 1 
                    }
                  ]}
                  onPress={() => toggleDay(day.id)}
                  activeOpacity={0.7}
                >
                  <Text style={{ color: isSelected ? getContrastTextColor(colors.primary) : colors.text, fontWeight: '700' }}>{day.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {Object.entries(selectedDays).map(([dayStr, timeObj]) => {
            const dayId = parseInt(dayStr, 10);
            const dayLabel = DAYS.find(d => d.id === dayId)?.label;
            return (
              <View key={dayId} style={[styles.timePickerCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ color: colors.text, fontWeight: '800', fontSize: 15, marginBottom: 12 }}>
                  Horário ({dayLabel})
                </Text>
                
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <Text style={{ color: colors.textSecondary, width: 40, fontWeight: '600', fontSize: 13 }}>Hora</Text>
                  <Slider
                    style={{ flex: 1, height: 40 }}
                    minimumValue={0}
                    maximumValue={23}
                    step={1}
                    value={timeObj.h}
                    onValueChange={(val) => updateDayTime(dayId, 'h', val)}
                    minimumTrackTintColor={colors.primary}
                    maximumTrackTintColor={colors.border}
                    thumbTintColor={colors.primary}
                  />
                  <Text style={{ color: colors.primary, fontWeight: '800', width: 40, textAlign: 'right', fontSize: 16 }}>
                    {timeObj.h.toString().padStart(2, '0')}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ color: colors.textSecondary, width: 40, fontWeight: '600', fontSize: 13 }}>Min</Text>
                  <Slider
                    style={{ flex: 1, height: 40 }}
                    minimumValue={0}
                    maximumValue={59}
                    step={1}
                    value={timeObj.m}
                    onValueChange={(val) => updateDayTime(dayId, 'm', val)}
                    minimumTrackTintColor={colors.primary}
                    maximumTrackTintColor={colors.border}
                    thumbTintColor={colors.primary}
                  />
                  <Text style={{ color: colors.primary, fontWeight: '800', width: 40, textAlign: 'right', fontSize: 16 }}>
                    {timeObj.m.toString().padStart(2, '0')}
                  </Text>
                </View>
              </View>
            );
          })}

          <Text style={styles.label}>Notificações</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.horizontalScroll, { marginBottom: 15 }]}>
            {ALERT_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.badge,
                  { 
                    backgroundColor: alerts.includes(option.value) ? colors.primary : colors.surfaceSubtle, 
                    borderColor: alerts.includes(option.value) ? colors.primary : colors.border, 
                    borderWidth: 1 
                  }
                ]}
                onPress={() => toggleAlert(option.value)}
                activeOpacity={0.7}
              >
                <Text style={{ color: alerts.includes(option.value) ? getContrastTextColor(colors.primary) : colors.text, fontWeight: '700' }}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={{ color: colors.textSecondary, marginBottom: 8, fontSize: 13, fontWeight: '600' }}>Personalizado:</Text>
          <View style={[styles.row, { marginBottom: 15, alignItems: 'center' }]}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0, marginRight: 8, color: colors.text, borderColor: colors.border }]}
              placeholder="Ex: 5"
              placeholderTextColor={colors.textSecondary}
              keyboardType="numeric"
              value={customAlertVal}
              onChangeText={setCustomAlertVal}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1, marginRight: 8 }}>
              <TouchableOpacity 
                style={[styles.badge, { backgroundColor: customAlertUnit === 1 ? colors.primary : colors.surfaceSubtle, borderWidth: 1, borderColor: customAlertUnit === 1 ? colors.primary : colors.border }]}
                onPress={() => setCustomAlertUnit(1)}
              >
                <Text style={{ color: customAlertUnit === 1 ? getContrastTextColor(colors.primary) : colors.text, fontWeight: '700' }}>Min</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.badge, { backgroundColor: customAlertUnit === 60 ? colors.primary : colors.surfaceSubtle, borderWidth: 1, borderColor: customAlertUnit === 60 ? colors.primary : colors.border }]}
                onPress={() => setCustomAlertUnit(60)}
              >
                <Text style={{ color: customAlertUnit === 60 ? getContrastTextColor(colors.primary) : colors.text, fontWeight: '700' }}>Hora</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.badge, { backgroundColor: customAlertUnit === 1440 ? colors.primary : colors.surfaceSubtle, borderWidth: 1, borderColor: customAlertUnit === 1440 ? colors.primary : colors.border }]}
                onPress={() => setCustomAlertUnit(1440)}
              >
                <Text style={{ color: customAlertUnit === 1440 ? getContrastTextColor(colors.primary) : colors.text, fontWeight: '700' }}>Dia</Text>
              </TouchableOpacity>
            </ScrollView>
            <TouchableOpacity 
              style={[styles.badge, { backgroundColor: colors.primary, justifyContent: 'center', height: 44, borderRadius: 12, marginRight: 0 }]} 
              onPress={addCustomAlert}
            >
              <Text style={{ color: getContrastTextColor(colors.primary), fontWeight: '800', fontSize: 16 }}>+</Text>
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

          <View style={{ height: 40 }} />
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      </View>
    </Modal>
  );
};

const getStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    ...(Platform.OS === 'web' ? { width: '100%' as const, maxWidth: 900, alignSelf: 'center' as const, minHeight: 0 } : {}),
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
  headerActionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5
  },
  cancelText: {
    fontSize: 15,
    color: colors.primary,
    fontWeight: '700',
  },
  saveText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.primary,
  },
  content: {
    padding: 18,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
    marginTop: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: colors.text,
    marginBottom: 14,
    backgroundColor: colors.surface,
  },
  sliderCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 14,
  },
  timePickerCard: {
    marginBottom: 14,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
  },
  badge: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
  },
  horizontalScroll: {
    flexDirection: 'row',
  }
});

