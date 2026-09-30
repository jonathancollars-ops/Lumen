import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import {
  AppEvent,
  Subject,
  AttendanceRecord,
  StudyTask,
  ThemeType,
  AppSettings,
  GamificationData
} from '../types';
import { getThemeColors, getCategoryColor, getContrastTextColor } from '../theme';
import { getLocalDateString, formatDisplayDate, calculateDaySchedule, DayScheduleSummary, ScheduleTimelineBlock } from '../utils';
import * as Haptics from 'expo-haptics';
import { format, parseISO, addDays, getDay } from 'date-fns';
import { useResponsive } from '../hooks/useResponsive';

// Configuração do Locale em Português para react-native-calendars
if (!LocaleConfig.locales['pt-br']) {
  LocaleConfig.locales['pt-br'] = {
    monthNames: ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'],
    monthNamesShort: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
    dayNames: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'],
    dayNamesShort: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
    today: 'Hoje'
  };
}
LocaleConfig.defaultLocale = 'pt-br';

export interface AgendaScreenProps {
  events: AppEvent[];
  subjects: Subject[];
  attendances: AttendanceRecord[];
  tasks: StudyTask[];
  theme: ThemeType;
  settings: AppSettings;
  gamification?: GamificationData | null;
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  onToggleEventCompletion: (eventId: string) => void;
  onToggleTaskCompletion: (taskId: string) => void;
  onEditEvent: (event: AppEvent) => void;
  onOpenStudy: (subjectId?: string) => void;
  onOpenAttendanceModal: () => void;
  onOpenExamDetails?: (event: AppEvent) => void;
  onAddNewEvent?: () => void;
  onOpenScheduleGrid?: () => void;
}

export const AgendaScreen: React.FC<AgendaScreenProps> = ({
  events,
  subjects,
  attendances,
  tasks,
  theme,
  settings,
  gamification,
  selectedDate,
  onSelectDate,
  onToggleEventCompletion,
  onToggleTaskCompletion,
  onEditEvent,
  onOpenStudy,
  onOpenAttendanceModal,
  onOpenExamDetails,
  onAddNewEvent,
  onOpenScheduleGrid
}) => {
  const colors = getThemeColors(theme);
  const styles = useMemo(() => getStyles(colors, theme), [colors, theme]);
  const { isDesktop, hasWideContent } = useResponsive();

  // View mode toggle: 'checklist' vs 'timeline'
  const [viewMode, setViewMode] = useState<'checklist' | 'timeline'>('checklist');

  // Month Calendar collapsible state (default false, accessible on demand)
  const [isMonthCalendarExpanded, setIsMonthCalendarExpanded] = useState(false);

  const todayStr = getLocalDateString();
  const targetDate = selectedDate || todayStr;
  const isToday = targetDate === todayStr;

  // Current time representation
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Formatted date string for the Apple HIG large title pill: "Quinta-feira, 10 de Setembro"
  const formattedDateHeader = useMemo(() => {
    try {
      const d = parseISO(targetDate);
      const dayOfWeekNames = [
        'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira',
        'Quinta-feira', 'Sexta-feira', 'Sábado'
      ];
      const monthNames = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
      ];
      const dayName = dayOfWeekNames[d.getDay()];
      const dayNum = d.getDate();
      const monthName = monthNames[d.getMonth()];
      return `${dayName}, ${dayNum} de ${monthName}`;
    } catch {
      return targetDate;
    }
  }, [targetDate]);

  // Weekly strip calculation (7 days: DOM, SEG, TER, QUA, QUI, SEX, SÁB)
  const weekDays = useMemo(() => {
    try {
      const baseDate = parseISO(targetDate);
      const dayOfWeek = getDay(baseDate); // 0 = Sun ... 6 = Sat
      const startSunday = addDays(baseDate, -dayOfWeek);
      const abbreviations = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

      return Array.from({ length: 7 }, (_, i) => {
        const d = addDays(startSunday, i);
        const dateStr = format(d, 'yyyy-MM-dd');
        return {
          dateStr,
          dayNumber: d.getDate(),
          abbreviation: abbreviations[i],
          isTarget: dateStr === targetDate,
          isRealToday: dateStr === todayStr,
        };
      });
    } catch {
      return [];
    }
  }, [targetDate, todayStr]);

  // Pending absences count
  const pendingAttendancesCount = useMemo(() => {
    return attendances.filter(a => a.status === 'pending').length;
  }, [attendances]);

  // Filter events for targetDate
  const todaysEvents = useMemo(() => {
    return events.filter(e => {
      // Filter if exam week mode is active
      if (settings.examWeekMode && e.category !== 'Provas/Trabalhos' && e.category !== 'Faculdade/Aulas') {
        return false;
      }

      // Filter archived subjects
      if (e.subjectId) {
        const subject = subjects.find(s => s.id === e.subjectId);
        if (subject?.isArchived) return false;
      }

      // Filter cancelled classes
      if (e.category === 'Faculdade/Aulas' && e.recurrence === 'weekly') {
        const isCancelled = attendances.some(a => a.eventId === e.id && a.date === targetDate && a.status === 'cancelled');
        if (isCancelled) return false;
      }

      const startDateClean = e.date.split('T')[0];
      const targetDateClean = targetDate.split('T')[0];

      if (targetDateClean < startDateClean) return false;
      if (e.recurrence === 'daily') return true;
      if (e.recurrence === 'weekly') {
        if (e.recurrenceDays && e.recurrenceDays.length > 0) {
          const currentDay = getDay(parseISO(targetDateClean));
          return e.recurrenceDays.includes(currentDay);
        }
        const startDay = getDay(parseISO(startDateClean));
        const currentDay = getDay(parseISO(targetDateClean));
        return startDay === currentDay;
      }
      if (e.recurrence === 'monthly' || e.recurrence === 'custom_interval') {
        const [startYear, startMonth, startDay] = startDateClean.split('-').map(Number);
        const [targetYear, targetMonth, targetDay] = targetDateClean.split('-').map(Number);

        const expectedDay = e.recurrenceMonthDay || startDay;
        const daysInTargetMonth = new Date(targetYear, targetMonth, 0).getDate();
        const effectiveDay = Math.min(expectedDay, daysInTargetMonth);
        if (targetDay !== effectiveDay && targetDay !== expectedDay) return false;

        const interval = (e.recurrenceInterval && e.recurrenceInterval > 0) ? e.recurrenceInterval : 1;
        if (interval > 1) {
          const monthDiff = (targetYear - startYear) * 12 + (targetMonth - startMonth);
          if (monthDiff < 0 || monthDiff % interval !== 0) return false;
        }
        return true;
      }
      return startDateClean === targetDateClean;
    }).sort((a, b) => (a.startTime || '00:00').localeCompare(b.startTime || '00:00'));
  }, [events, targetDate, subjects, attendances, settings.examWeekMode]);

  // Day Schedule Calculation: Busy Blocks and Free Windows (07:00 to 22:00)
  const daySchedule = useMemo(() => {
    return calculateDaySchedule(todaysEvents);
  }, [todaysEvents]);

  // Filter tasks for targetDate
  const todaysTasks = useMemo(() => {
    return tasks.filter(t => {
      if (t.dueDate) {
        return t.dueDate === targetDate;
      }
      // If no due date, show on today's view
      return isToday;
    });
  }, [tasks, targetDate, isToday]);

  // Highlight Card: Find active or imminent upcoming activity
  const highlightInfo = useMemo(() => {
    let activeEvent: AppEvent | null = null;
    let nextEvent: AppEvent | null = null;
    let minutesUntilNext: number | null = null;

    for (const evt of todaysEvents) {
      const [sh, sm] = (evt.startTime || '00:00').split(':').map(Number);
      const [eh, em] = (evt.endTime || '23:59').split(':').map(Number);
      const startMins = (sh || 0) * 60 + (sm || 0);
      let endMins = (eh || 0) * 60 + (em || 0);
      if (endMins < startMins) endMins += 24 * 60;

      if (isToday) {
        if (currentMinutes >= startMins && currentMinutes <= endMins) {
          activeEvent = evt;
          break;
        } else if (currentMinutes < startMins && !nextEvent) {
          nextEvent = evt;
          minutesUntilNext = startMins - currentMinutes;
        }
      } else {
        if (!nextEvent) {
          nextEvent = evt;
        }
      }
    }

    const featured = activeEvent || nextEvent;
    const featuredSubject = featured?.subjectId ? subjects.find(s => s.id === featured.subjectId) : null;

    return {
      activeEvent,
      nextEvent,
      minutesUntilNext,
      featured,
      featuredSubject
    };
  }, [todaysEvents, isToday, currentMinutes, subjects]);

  // Find urgent exams in the next 7 days
  const upcomingExams = useMemo(() => {
    const safeEvents = Array.isArray(events) ? events.filter(Boolean) : [];
    return safeEvents.filter(e => {
      if (!e || e.category !== 'Provas/Trabalhos' || !e.date) return false;
      const evtDate = new Date(e.date + 'T12:00:00');
      const todayDate = new Date(todayStr + 'T12:00:00');
      const diffDays = (evtDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= 7;
    }).sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));
  }, [events, todayStr]);

  const nextUrgentExam = upcomingExams[0];

  const examDaysDiff = useMemo(() => {
    if (!nextUrgentExam?.date) return 0;
    const evtDate = new Date(nextUrgentExam.date + 'T12:00:00');
    const todayDate = new Date(todayStr + 'T12:00:00');
    return Math.max(0, Math.round((evtDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24)));
  }, [nextUrgentExam, todayStr]);

  // Subject attendance status calculation for "Próxima Aula"
  const subjectAttendanceSummary = useMemo(() => {
    if (!highlightInfo.featuredSubject) return 'Frequência: regular';
    const subAtts = attendances.filter(a => a.subjectId === highlightInfo.featuredSubject?.id);
    if (subAtts.length === 0) return 'Frequência: regular';
    const presents = subAtts.filter(a => a.status === 'present').length;
    const rate = Math.round((presents / subAtts.length) * 100);
    return rate >= 75 ? `Frequência: ${rate}% (regular)` : `Frequência: ${rate}% (atenção)`;
  }, [highlightInfo.featuredSubject, attendances]);

  // Calendar Marked Dates
  const markedDates = useMemo(() => {
    const marks: Record<string, any> = {};

    events.forEach(e => {
      if (e.subjectId) {
        const subject = subjects.find(s => s.id === e.subjectId);
        if (subject?.isArchived) return;
      }

      const subject = e.subjectId ? subjects.find(s => s.id === e.subjectId) : null;
      const dotColor = subject?.color || getCategoryColor(e.category, theme) || colors.primary;

      const startDateClean = e.date.split('T')[0];

      if (e.recurrence === 'none') {
        if (!marks[startDateClean]) marks[startDateClean] = { dots: [] };
        if (marks[startDateClean].dots && marks[startDateClean].dots.length < 3) {
          marks[startDateClean].dots.push({ color: dotColor, key: `${e.id}_${marks[startDateClean].dots.length}` });
        }
      } else if (e.recurrence === 'monthly' || e.recurrence === 'custom_interval') {
        const [startYear, startMonth, startDay] = startDateClean.split('-').map(Number);
        if (!startYear || !startMonth || !startDay) return;

        const expectedDay = e.recurrenceMonthDay || startDay;
        const interval = (e.recurrenceInterval && e.recurrenceInterval > 0) ? e.recurrenceInterval : 1;
        const maxOccurrences = 12;

        for (let i = 0; i < maxOccurrences; i++) {
          const totalMonths = (startMonth - 1) + (i * interval);
          const occurrenceYear = startYear + Math.floor(totalMonths / 12);
          const occurrenceMonth = (totalMonths % 12) + 1;
          const daysInMonth = new Date(occurrenceYear, occurrenceMonth, 0).getDate();
          const actualDay = Math.min(expectedDay, daysInMonth);
          const dateStr = `${occurrenceYear}-${String(occurrenceMonth).padStart(2, '0')}-${String(actualDay).padStart(2, '0')}`;

          if (dateStr >= startDateClean) {
            if (!marks[dateStr]) marks[dateStr] = { dots: [] };
            if (marks[dateStr].dots && marks[dateStr].dots.length < 3) {
              marks[dateStr].dots.push({ color: dotColor, key: `${e.id}_${dateStr}_${marks[dateStr].dots.length}` });
            }
          }
        }
      } else {
        let currentDate = parseISO(startDateClean);
        if (isNaN(currentDate.getTime())) return;

        const maxSteps = e.recurrence === 'daily' ? 180 : 30;
        for (let i = 0; i < maxSteps; i++) {
          const dateStr = format(currentDate, 'yyyy-MM-dd');
          if (!marks[dateStr]) marks[dateStr] = { dots: [] };
          if (marks[dateStr].dots && marks[dateStr].dots.length < 3) {
            marks[dateStr].dots.push({ color: dotColor, key: `${e.id}_${dateStr}_${marks[dateStr].dots.length}` });
          }
          currentDate = addDays(currentDate, e.recurrence === 'daily' ? 1 : 7);
        }
      }
    });

    // Mark selected date
    if (targetDate) {
      marks[targetDate] = {
        ...(marks[targetDate] || {}),
        selected: true,
        selectedColor: colors.primary,
        selectedTextColor: getContrastTextColor(colors.primary)
      };
    }

    return marks;
  }, [events, targetDate, colors.primary, subjects, theme]);

  const renderWeeklyStrip = () => (
    <View style={styles.weeklyStripContainer}>
      <View style={styles.weeklyStripRow}>
        {weekDays.map(day => {
          const isSelected = day.isTarget;
          const pillBg = isSelected ? colors.primary : colors.surfaceSubtle;
          const nameColor = isSelected ? getContrastTextColor(colors.primary) : colors.textSecondary;
          const numColor = isSelected ? getContrastTextColor(colors.primary) : colors.text;

          return (
            <TouchableOpacity
              key={day.dateStr}
              style={[
                styles.dayPill,
                {
                  backgroundColor: pillBg,
                  borderColor: isSelected ? colors.primary : colors.borderSubtle,
                  borderWidth: isSelected ? 1.5 : StyleSheet.hairlineWidth
                }
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                onSelectDate(day.dateStr);
              }}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`${day.abbreviation}, ${day.dayNumber}`}
            >
              <Text style={[styles.dayPillName, { color: nameColor }]}>
                {day.abbreviation}
              </Text>
              <Text style={[styles.dayPillNum, { color: numColor }]}>
                {day.dayNumber}
              </Text>
              {day.isRealToday && !isSelected && (
                <View style={[styles.todayIndicatorDot, { backgroundColor: colors.primary }]} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Toggle Month Calendar Button */}
      <TouchableOpacity
        style={styles.monthToggleBtn}
        onPress={() => {
          Haptics.selectionAsync();
          setIsMonthCalendarExpanded(prev => !prev);
        }}
        activeOpacity={0.7}
      >
        <Text style={[styles.monthToggleBtnText, { color: colors.primary }]}>
          {isMonthCalendarExpanded ? '▲ Recolher mês' : '▼ Ver mês completo'}
        </Text>
      </TouchableOpacity>

      {/* Collapsible Monthly Calendar */}
      {(isDesktop || isMonthCalendarExpanded) && (
        <View style={[styles.calendarCard, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 10 }]}>
          <Calendar
            current={targetDate}
            onDayPress={(day: any) => {
              Haptics.selectionAsync();
              onSelectDate(day.dateString);
            }}
            markingType={'multi-dot'}
            markedDates={markedDates}
            enableSwipeMonths={true}
            hideArrows={false}
            theme={{
              calendarBackground: 'transparent',
              textSectionTitleColor: colors.textSecondary,
              selectedDayBackgroundColor: colors.primary,
              selectedDayTextColor: getContrastTextColor(colors.primary),
              todayTextColor: colors.primary,
              todayBackgroundColor: 'transparent',
              dayTextColor: colors.text,
              textDisabledColor: colors.textMuted,
              monthTextColor: colors.text,
              arrowColor: colors.primary,
              textMonthFontWeight: 'bold',
              textDayFontSize: 14,
              textMonthFontSize: 16,
            }}
          />
        </View>
      )}
    </View>
  );

  const renderNextClassCard = () => (
    <View style={[styles.insetCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 16, marginRight: 6 }}>🎓</Text>
          <Text style={[styles.cardHeaderTitle, { color: colors.text }]}>Próxima Aula</Text>
        </View>
        <Text style={[styles.cardHeaderChevron, { color: colors.textSecondary }]}>›</Text>
      </View>

      {highlightInfo.featured ? (
        <View style={[styles.insetCardInner, { backgroundColor: colors.surfaceSubtle }]}>
          <View style={styles.nextClassTopRow}>
            <View style={[styles.subjectBadge, { backgroundColor: colors.surfaceSubtle }]}>
              <Text style={[styles.nextClassSubject, { color: colors.text }]} numberOfLines={1}>
                {highlightInfo.featuredSubject?.name || highlightInfo.featured.title}
              </Text>
            </View>

            <View style={[styles.timeChip, { backgroundColor: colors.primaryLight }]}>
              <Text style={[styles.timeChipText, { color: colors.primary }]} numberOfLines={1}>
                {highlightInfo.minutesUntilNext !== null
                  ? `em ${highlightInfo.minutesUntilNext} min`
                  : highlightInfo.activeEvent
                  ? 'Agora'
                  : highlightInfo.featured.startTime}
              </Text>
            </View>
          </View>

          <View style={styles.nextClassMetaRow}>
            <Text style={[styles.nextClassMetaText, { color: colors.textSecondary }]}>
              📍 {highlightInfo.featuredSubject?.notes || 'Sala B-204'}
            </Text>
            <Text style={[styles.nextClassMetaText, { color: colors.textSecondary }]}>
              • {subjectAttendanceSummary}
            </Text>
          </View>

          <View style={styles.highlightActionsRow}>
            <TouchableOpacity
              style={[styles.quickStudyBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onOpenStudy(highlightInfo.featured?.subjectId);
              }}
              activeOpacity={0.8}
            >
              <Text style={[styles.quickStudyBtnText, { color: getContrastTextColor(colors.primary) }]}>
                ⏱️ Estudar
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.quickCheckBtn,
                {
                  backgroundColor: colors.surface,
                  borderColor: highlightInfo.featured.isCompleted ? colors.success : colors.border
                }
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (highlightInfo.featured) {
                  onToggleEventCompletion(highlightInfo.featured.id);
                }
              }}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: highlightInfo.featured.isCompleted ? colors.success : colors.textSecondary }}>
                {highlightInfo.featured.isCompleted ? '✓ Concluído' : 'Marcar Concluído'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={[styles.insetCardInner, { backgroundColor: colors.surfaceSubtle }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 24, marginRight: 10 }}>✨</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.fallbackTitle, { color: colors.text }]}>Tudo em dia por hoje!</Text>
              <Text style={[styles.fallbackSubtitle, { color: colors.textSecondary }]}>
                Nenhuma aula ou tarefa pendente para este momento.
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.fallbackStudyBtn, { backgroundColor: colors.primaryLight }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onOpenStudy();
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.fallbackStudyBtnText, { color: colors.primary }]}>
                Estudos ›
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );

  const renderUrgentExamsCard = () => (
    <View style={[styles.insetCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={() => {
          if (nextUrgentExam) {
            Haptics.selectionAsync();
            if (onOpenExamDetails) {
              onOpenExamDetails(nextUrgentExam);
            } else {
              onEditEvent(nextUrgentExam);
            }
          }
        }}
        activeOpacity={nextUrgentExam ? 0.7 : 1}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 16, marginRight: 6 }}>📝</Text>
          <Text style={[styles.cardHeaderTitle, { color: colors.text }]}>Provas & Entregas</Text>
        </View>
        <Text style={[styles.cardHeaderChevron, { color: colors.textSecondary }]}>›</Text>
      </TouchableOpacity>

      {nextUrgentExam ? (
        <TouchableOpacity
          style={[
            styles.urgentExamPill,
            {
              backgroundColor: colors.dangerLight,
              borderColor: colors.danger
            }
          ]}
          onPress={() => {
            Haptics.selectionAsync();
            if (onOpenExamDetails) {
              onOpenExamDetails(nextUrgentExam);
            } else {
              onEditEvent(nextUrgentExam);
            }
          }}
          activeOpacity={0.8}
        >
          <Text style={{ fontSize: 16 }}>⚠️</Text>
          <Text
            style={[
              styles.urgentExamText,
              { color: theme === 'light' ? colors.dangerDark : colors.danger }
            ]}
            numberOfLines={1}
          >
            {nextUrgentExam.title} em {examDaysDiff === 0 ? 'hoje' : examDaysDiff === 1 ? '1 dia' : `${examDaysDiff} dias`}
          </Text>
          <Text style={{ fontSize: 12, fontWeight: '800', color: theme === 'light' ? colors.dangerDark : colors.danger }}>
            Ver ›
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.insetCardInner, { backgroundColor: colors.surfaceSubtle }]}>
          <Text style={{ fontSize: 13, color: colors.textSecondary, fontStyle: 'italic' }}>
            Nenhuma prova ou entrega crítica agendada para os próximos 7 dias.
          </Text>
        </View>
      )}
    </View>
  );

  const renderPomodoroCard = () => (
    <View style={[styles.insetCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <TouchableOpacity
        style={styles.cardHeader}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onOpenStudy();
        }}
        activeOpacity={0.7}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 16, marginRight: 6 }}>⏱️</Text>
          <Text style={[styles.cardHeaderTitle, { color: colors.text }]}>Focus Pomodoro</Text>
        </View>
        <Text style={[styles.cardHeaderChevron, { color: colors.textSecondary }]}>›</Text>
      </TouchableOpacity>

      <View style={[styles.pomodoroCardInner, { backgroundColor: colors.surfaceSubtle }]}>
        <View style={[styles.activityRingWrapper, { borderColor: colors.primary }]}>
          <Text style={[styles.activityRingText, { color: colors.primary }]}>90%</Text>
        </View>

        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={[styles.pomodoroTitle, { color: colors.text }]}>
            Meta Diária de Foco
          </Text>
          <Text style={[styles.pomodoroSubtitle, { color: colors.textSecondary }]}>
            Excelente consistência acadêmica hoje!
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.pomodoroOpenBtn, { backgroundColor: colors.primary }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onOpenStudy();
          }}
          activeOpacity={0.8}
        >
          <Text style={[styles.pomodoroOpenBtnText, { color: getContrastTextColor(colors.primary) }]}>
            Estudar
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const totalItemsCount = todaysEvents.length + todaysTasks.length;

  const renderDayScheduleCard = () => (
    <View style={[styles.insetCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.scheduleHeaderContainer}>
        <View style={styles.scheduleHeaderTopRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 16, marginRight: 6 }}>🗓️</Text>
            <Text style={[styles.cardHeaderTitle, { color: colors.text }]}>Cronograma do Dia</Text>
          </View>
        </View>

        <View style={styles.scheduleCapsulesRow}>
          <View style={[styles.scheduleCapsule, { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderSubtle }]}>
            <Text style={[styles.scheduleCapsuleText, { color: colors.textSecondary }]}>
              🕒 {daySchedule.totalOccupiedFormatted} ocupadas
            </Text>
          </View>
          <View style={[styles.scheduleCapsule, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}>
            <Text style={[styles.scheduleCapsuleText, { color: colors.primary }]}>
              🟢 {daySchedule.totalFreeFormatted} livres hoje
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.dayScheduleTimelineContainer}>
        {daySchedule.blocks.map(block => {
          if (block.type === 'busy') {
            const subject = block.subjectId ? subjects.find(s => s.id === block.subjectId) : null;
            const blockColor = subject?.color || (block.category ? getCategoryColor(block.category as any, theme) : colors.primary);
            const attRecord = attendances.find(a => a.eventId === block.eventId && a.date === targetDate);

            let attendanceBadgeText = '🎓 Aula';
            let attendanceBadgeBg = colors.surfaceSubtle;
            let attendanceBadgeColor = colors.textSecondary;

            if (attRecord) {
              if (attRecord.status === 'present') {
                attendanceBadgeText = '✓ Presente';
                attendanceBadgeBg = colors.successLight;
                attendanceBadgeColor = colors.successDark;
              } else if (attRecord.status === 'absent') {
                attendanceBadgeText = '✗ Falta';
                attendanceBadgeBg = colors.dangerLight;
                attendanceBadgeColor = colors.dangerDark;
              } else if (attRecord.status === 'cancelled') {
                attendanceBadgeText = '🚫 Cancelada';
                attendanceBadgeBg = colors.surfaceSubtle;
                attendanceBadgeColor = colors.textMuted;
              } else if (attRecord.status === 'pending') {
                attendanceBadgeText = '⏳ Pendente';
                attendanceBadgeBg = colors.warningLight;
                attendanceBadgeColor = colors.warningDark;
              }
            }

            return (
              <TouchableOpacity
                key={block.id}
                style={[
                  styles.busyBlockCard,
                  {
                    backgroundColor: colors.surfaceSubtle,
                    borderColor: colors.borderSubtle,
                    borderLeftColor: blockColor,
                    borderLeftWidth: 4,
                  }
                ]}
                onPress={() => {
                  if (block.event) {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onToggleEventCompletion(block.event.id);
                  }
                }}
                onLongPress={() => {
                  if (block.event) {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    onEditEvent(block.event);
                  }
                }}
                activeOpacity={0.8}
              >
                <View style={styles.busyBlockHeaderRow}>
                  <View style={[styles.busyTimeBadge, { backgroundColor: colors.surface }]}>
                    <Text style={[styles.busyTimeBadgeText, { color: colors.text }]}>
                      ⏰ {block.startTime} - {block.endTime}
                    </Text>
                  </View>
                  <View style={[styles.busyAttBadge, { backgroundColor: attendanceBadgeBg }]}>
                    <Text style={[styles.busyAttBadgeText, { color: attendanceBadgeColor }]}>
                      {attendanceBadgeText}
                    </Text>
                  </View>
                </View>

                <Text style={[styles.busyBlockTitle, { color: colors.text }]} numberOfLines={1}>
                  {subject?.name || block.title}
                </Text>

                <View style={styles.busyBlockMetaRow}>
                  <Text style={[styles.busyBlockLocation, { color: colors.textSecondary }]} numberOfLines={1}>
                    📍 {block.location || subject?.notes || 'Campus / Sala a definir'}
                  </Text>
                  {block.isCompleted && (
                    <Text style={[styles.busyBlockCompleted, { color: colors.success }]}>
                      ✓ Concluído
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          }

          // Free time block
          return (
            <TouchableOpacity
              key={block.id}
              style={[
                styles.freeBlockPill,
                {
                  backgroundColor: theme === 'light' ? 'rgba(5, 150, 105, 0.08)' : 'rgba(0, 255, 170, 0.08)',
                  borderColor: theme === 'light' ? 'rgba(5, 150, 105, 0.25)' : 'rgba(0, 255, 170, 0.25)',
                }
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onOpenStudy(block.suggestedSubjectId);
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Focar na janela livre de ${block.durationFormatted}`}
            >
              <View style={{ flex: 1, marginRight: 10 }}>
                <View style={styles.freeBlockTimeRow}>
                  <Text style={[styles.freeBlockTimeText, { color: colors.primary }]}>
                    🟢 {block.startTime} - {block.endTime} • {block.durationFormatted} livres
                  </Text>
                </View>
                <Text style={[styles.freeBlockSubtitle, { color: colors.textSecondary }]}>
                  Janela para descanso ou estudo focado
                </Text>
              </View>

              <View
                style={[styles.freeBlockFocusBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.freeBlockFocusBtnText, { color: getContrastTextColor(colors.primary) }]}>
                  ⏱️ Focar
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const renderActivitiesCard = () => (
    <View style={[styles.insetCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={[styles.cardHeaderTitle, { color: colors.text }]}>
            {isToday ? 'Atividades de Hoje' : `Dia ${formatDisplayDate(targetDate)}`}
          </Text>
          <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 1 }}>
            {totalItemsCount} {totalItemsCount === 1 ? 'item' : 'itens'} agendado{totalItemsCount !== 1 ? 's' : ''}
          </Text>
        </View>

        {/* View mode toggle: Checklist vs Timeline */}
        <View style={[styles.viewModeToggleWrap, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[
              styles.viewModeBtn,
              viewMode === 'checklist' && { backgroundColor: colors.primary }
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              setViewMode('checklist');
            }}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.viewModeBtnText,
                { color: viewMode === 'checklist' ? getContrastTextColor(colors.primary) : colors.textSecondary }
              ]}
            >
              📋 Lista
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.viewModeBtn,
              viewMode === 'timeline' && { backgroundColor: colors.primary }
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              setViewMode('timeline');
            }}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.viewModeBtnText,
                { color: viewMode === 'timeline' ? getContrastTextColor(colors.primary) : colors.textSecondary }
              ]}
            >
              ⏱️ 24h
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* View Mode Content */}
      {viewMode === 'checklist' ? (
        <View style={styles.checklistContainer}>
          {/* 1. AppEvents Checklist Items */}
          {todaysEvents.map(event => {
            const categoryColor = getCategoryColor(event.category, theme) || colors.primary;
            const subject = event.subjectId ? subjects.find(s => s.id === event.subjectId) : null;

            return (
              <TouchableOpacity
                key={event.id}
                style={[
                  styles.checklistItemCard,
                  {
                    borderBottomColor: colors.borderSubtle,
                    opacity: event.isCompleted ? 0.6 : 1
                  }
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onToggleEventCompletion(event.id);
                }}
                onLongPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  onEditEvent(event);
                }}
                activeOpacity={0.8}
              >
                {/* Interactive Circular Checkbox */}
                <TouchableOpacity
                  style={[
                    styles.circularCheckbox,
                    {
                      backgroundColor: event.isCompleted ? colors.primary : 'transparent',
                      borderColor: event.isCompleted ? colors.primary : colors.textSecondary
                    }
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onToggleEventCompletion(event.id);
                  }}
                  activeOpacity={0.7}
                >
                  {event.isCompleted && (
                    <Text style={[styles.checkboxCheckmark, { color: getContrastTextColor(colors.primary) }]}>
                      ✓
                    </Text>
                  )}
                </TouchableOpacity>

                {/* Item Content */}
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={styles.checklistItemHeader}>
                    <Text
                      style={[
                        styles.checklistTitle,
                        {
                          color: colors.text,
                          textDecorationLine: event.isCompleted ? 'line-through' : 'none'
                        }
                      ]}
                      numberOfLines={1}
                    >
                      {event.title}
                    </Text>
                    <View
                      style={[
                        styles.miniCategoryBadge,
                        { backgroundColor: `${categoryColor}20` }
                      ]}
                    >
                      <View
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 3,
                          backgroundColor: categoryColor,
                          marginRight: 4
                        }}
                      />
                      <Text style={[styles.miniCategoryText, { color: categoryColor }]}>
                        {event.category}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.checklistMetaRow}>
                    <Text style={[styles.checklistTime, { color: colors.textSecondary }]}>
                      ⏰ {event.startTime} - {event.endTime}
                    </Text>

                    {subject && (
                      <View
                        style={[
                          styles.miniSubjectBadge,
                          {
                            backgroundColor: colors.surfaceSubtle,
                            borderColor: colors.border,
                            borderWidth: 1
                          }
                        ]}
                      >
                        <View
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: subject.color || colors.primary,
                            marginRight: 4
                          }}
                        />
                        <Text style={[styles.miniSubjectText, { color: colors.textSecondary }]} numberOfLines={1}>
                          {subject.name}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}

          {/* 2. Tasks Checklist Items */}
          {todaysTasks.map(task => {
            const subject = task.subjectId ? subjects.find(s => s.id === task.subjectId) : null;
            const priorityColor =
              task.priority === 'high' ? colors.danger :
              task.priority === 'medium' ? colors.warning : colors.info;

            return (
              <TouchableOpacity
                key={task.id}
                style={[
                  styles.checklistItemCard,
                  {
                    borderBottomColor: colors.borderSubtle,
                    opacity: task.isCompleted ? 0.6 : 1
                  }
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onToggleTaskCompletion(task.id);
                }}
                activeOpacity={0.8}
              >
                {/* Interactive Circular Checkbox */}
                <TouchableOpacity
                  style={[
                    styles.circularCheckbox,
                    {
                      backgroundColor: task.isCompleted ? colors.primary : 'transparent',
                      borderColor: task.isCompleted ? colors.primary : colors.textSecondary
                    }
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onToggleTaskCompletion(task.id);
                  }}
                  activeOpacity={0.7}
                >
                  {task.isCompleted && (
                    <Text style={[styles.checkboxCheckmark, { color: getContrastTextColor(colors.primary) }]}>
                      ✓
                    </Text>
                  )}
                </TouchableOpacity>

                {/* Task Content */}
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={styles.checklistItemHeader}>
                    <Text
                      style={[
                        styles.checklistTitle,
                        {
                          color: colors.text,
                          textDecorationLine: task.isCompleted ? 'line-through' : 'none'
                        }
                      ]}
                      numberOfLines={1}
                    >
                      {task.title}
                    </Text>
                    {task.priority && (
                      <View
                        style={[
                          styles.miniCategoryBadge,
                          { backgroundColor: `${priorityColor}20` }
                        ]}
                      >
                        <View
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: priorityColor,
                            marginRight: 4
                          }}
                        />
                        <Text style={[styles.miniCategoryText, { color: colors.textSecondary }]}>
                          {task.priority === 'high' ? 'Alta' : task.priority === 'medium' ? 'Média' : 'Baixa'}
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.checklistMetaRow}>
                    <Text style={[styles.checklistTime, { color: colors.textSecondary }]}>
                      📝 Tarefa de Estudo
                    </Text>

                    {subject && (
                      <View
                        style={[
                          styles.miniSubjectBadge,
                          {
                            backgroundColor: colors.surfaceSubtle,
                            borderColor: colors.border,
                            borderWidth: 1
                          }
                        ]}
                      >
                        <View
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: subject.color || colors.primary,
                            marginRight: 4
                          }}
                        />
                        <Text style={[styles.miniSubjectText, { color: colors.textSecondary }]} numberOfLines={1}>
                          {subject.name}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}

          {/* Empty Checklist Fallback */}
          {totalItemsCount === 0 && (
            <View style={[styles.emptyChecklistCard, { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderSubtle }]}>
              <View style={[styles.emptyIconCircle, { backgroundColor: colors.surface }]}>
                <Text style={{ fontSize: 24 }}>✨</Text>
              </View>
              <Text style={[styles.emptyChecklistTitle, { color: colors.text }]}>
                {isToday ? 'Dia livre de compromissos!' : `Nenhuma atividade em ${formatDisplayDate(targetDate)}`}
              </Text>
              <Text style={[styles.emptyChecklistSubtitle, { color: colors.textSecondary }]}>
                {isToday
                  ? 'Nenhum evento, aula ou tarefa agendada para hoje. Aproveite para descansar, revisar matérias ou planejar suas metas.'
                  : 'Nenhum compromisso agendado para esta data. Toque abaixo para planejar suas atividades com antecedência.'}
              </Text>
              {onAddNewEvent && (
                <TouchableOpacity
                  style={[styles.addEventBtn, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onAddNewEvent();
                  }}
                  activeOpacity={0.8}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel="Adicionar nova atividade na agenda"
                  accessibilityHint="Abre o formulário de cadastro de aula, compromisso ou evento"
                >
                  <Text style={[styles.addEventBtnText, { color: getContrastTextColor(colors.primary) }]}>
                    + Agendar Nova Atividade
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      ) : (
        /* Mode B: 24h Hourly Timeline */
        <View style={[styles.timelineWrapper, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ height: 24 * 72, position: 'relative' }}>
            {/* Hour Lines */}
            {Array.from({ length: 24 }).map((_, hour) => (
              <View
                key={hour}
                style={[
                  styles.timelineHourRow,
                  {
                    top: hour * 72,
                    borderBottomColor: colors.borderSubtle
                  }
                ]}
              >
                <Text style={[styles.timelineTimeLabel, { color: colors.textSecondary }]}>
                  {`${hour.toString().padStart(2, '0')}:00`}
                </Text>
                <View style={styles.timelineHourDivider} />
              </View>
            ))}

            {/* Current Time Indicator on today */}
            {isToday && (
              <View
                style={{
                  position: 'absolute',
                  left: 55,
                  right: 0,
                  top: (now.getHours() + now.getMinutes() / 60) * 72,
                  height: 2,
                  backgroundColor: colors.danger,
                  zIndex: 10,
                  flexDirection: 'row',
                  alignItems: 'center'
                }}
              >
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger, marginLeft: -4 }} />
              </View>
            )}

            {/* Event Blocks on Timeline */}
            {todaysEvents.map(event => {
              const [startH, startM] = (event.startTime || '08:00').split(':').map(Number);
              const topOffset = ((startH || 0) + (startM || 0) / 60) * 72;

              let durationHours = 1;
              if (event.endTime) {
                const [endH, endM] = event.endTime.split(':').map(Number);
                durationHours = ((endH || 0) + (endM || 0) / 60) - ((startH || 0) + (startM || 0) / 60);
                if (durationHours <= 0) durationHours = 1;
              }

              const height = Math.max(durationHours * 72 - 4, 32);
              const subject = event.subjectId ? subjects.find(s => s.id === event.subjectId) : null;
              const bg = subject?.color || getCategoryColor(event.category, theme) || colors.primary;
              const contrastColor = getContrastTextColor(bg);

              return (
                <TouchableOpacity
                  key={event.id}
                  style={[
                    styles.timelineEventCard,
                    {
                      top: topOffset,
                      height,
                      backgroundColor: bg,
                      opacity: event.isCompleted ? 0.65 : 0.95
                    }
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onToggleEventCompletion(event.id);
                  }}
                  onLongPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    onEditEvent(event);
                  }}
                  activeOpacity={0.85}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.timelineEventTitle,
                        {
                          color: contrastColor,
                          textDecorationLine: event.isCompleted ? 'line-through' : 'none'
                        }
                      ]}
                      numberOfLines={1}
                    >
                      {event.isCompleted ? '✓ ' : ''}{event.title}
                    </Text>
                    {height >= 44 && (
                      <Text style={[styles.timelineEventTime, { color: contrastColor }]} numberOfLines={1}>
                        {event.startTime} - {event.endTime} • {event.category}
                      </Text>
                    )}
                  </View>
                  {event.isImportant && <Text style={{ fontSize: 14 }}>⭐</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.scrollContent, isDesktop && styles.desktopContainer]}
        showsVerticalScrollIndicator={false}
      >
        {/* 0. Pending Absences Alert Banner */}
        {pendingAttendancesCount > 0 && (
          <TouchableOpacity
            style={[styles.pendingBanner, { backgroundColor: colors.danger }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onOpenAttendanceModal();
            }}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Faltas pendentes de confirmação"
          >
            <Text style={{ fontSize: 20, marginRight: 10 }}>⚠️</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.pendingBannerTitle, { color: getContrastTextColor(colors.danger) }]}>
                Faltas Pendentes de Confirmação
              </Text>
              <Text style={[styles.pendingBannerSubtitle, { color: getContrastTextColor(colors.danger) }]}>
                Você tem {pendingAttendancesCount} aula(s) aguardando confirmação.
              </Text>
            </View>
            <Text style={[styles.pendingBannerChevron, { color: getContrastTextColor(colors.danger) }]}>›</Text>
          </TouchableOpacity>
        )}

        {/* ========================================================= */}
        {/* 1. APPLE HIG: Large Title Header & Quick Actions */}
        {/* ========================================================= */}
        <View style={styles.largeHeaderContainer}>
          <View style={styles.largeHeaderTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.largeTitle, { color: colors.text }]}>Agenda</Text>
              <View style={[styles.datePill, { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderSubtle }]}>
                <Text style={[styles.datePillText, { color: colors.textSecondary }]}>
                  {formattedDateHeader}
                </Text>
              </View>
            </View>

            <View style={styles.largeHeaderActions}>
              {onOpenScheduleGrid && (
                <TouchableOpacity
                  style={[styles.circularActionBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.borderSubtle }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onOpenScheduleGrid();
                  }}
                  activeOpacity={0.7}
                  accessibilityLabel="Abrir Grade Semanal"
                  accessibilityRole="button"
                >
                  <Text style={{ fontSize: 18 }}>🗓️</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[
                  styles.circularActionBtn,
                  {
                    backgroundColor: isMonthCalendarExpanded ? colors.primary : colors.surfaceSubtle,
                    borderColor: isMonthCalendarExpanded ? colors.primary : colors.borderSubtle
                  }
                ]}
                onPress={() => {
                  Haptics.selectionAsync();
                  setIsMonthCalendarExpanded(prev => !prev);
                }}
                activeOpacity={0.7}
                accessibilityLabel={isMonthCalendarExpanded ? "Recolher calendário mensal" : "Expandir calendário mensal"}
                accessibilityRole="button"
              >
                <Text style={{ fontSize: 18 }}>
                  {isMonthCalendarExpanded ? '📅' : '📆'}
                </Text>
              </TouchableOpacity>

              {onAddNewEvent && (
                <TouchableOpacity
                  style={[
                    styles.circularActionBtn,
                    {
                      backgroundColor: colors.primary,
                      borderColor: colors.primary,
                    }
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    onAddNewEvent();
                  }}
                  activeOpacity={0.8}
                  accessibilityLabel="Adicionar novo compromisso"
                  accessibilityRole="button"
                >
                  <Text style={{ fontSize: 20, fontWeight: '700', color: getContrastTextColor(colors.primary), marginTop: -2 }}>
                    +
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        {hasWideContent ? (
          <View style={styles.desktopColumnsContainer}>
            <View style={styles.desktopLeftColumn}>
              {renderWeeklyStrip()}
              {renderDayScheduleCard()}
              {renderUrgentExamsCard()}
              {renderPomodoroCard()}
            </View>

            <View style={styles.desktopRightColumn}>
              {renderNextClassCard()}
              {renderActivitiesCard()}
            </View>
          </View>
        ) : (
          <>
            {renderWeeklyStrip()}
            {renderNextClassCard()}
            {renderDayScheduleCard()}
            {renderUrgentExamsCard()}
            {renderPomodoroCard()}
            {renderActivitiesCard()}
          </>
        )}

        {/* Scroll clearance over floating Liquid Glass tab bar & FAB */}
        <View style={{ height: isDesktop ? 60 : 160 }} />
      </ScrollView>

      {/* Floating Action Button (FAB) Permanente no Mobile */}
      {!isDesktop && (
        <TouchableOpacity
          style={[
            styles.fab,
            {
              backgroundColor: colors.primary,
              shadowColor: colors.primary
            }
          ]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            if (onAddNewEvent) {
              onAddNewEvent();
            }
          }}
          accessibilityLabel="Adicionar novo compromisso"
          accessibilityRole="button"
          activeOpacity={0.85}
        >
          <Text
            style={[
              styles.fabIcon,
              { color: getContrastTextColor(colors.primary) }
            ]}
          >
            +
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const getStyles = (colors: any, theme: ThemeType) => StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 120,
  },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    marginBottom: 14,
  },
  pendingBannerTitle: {
    fontWeight: 'bold',
    fontSize: 13,
  },
  pendingBannerSubtitle: {
    fontSize: 11,
    opacity: 0.9,
    marginTop: 1,
  },
  pendingBannerChevron: {
    fontWeight: 'bold',
    fontSize: 18,
  },

  // 1. Large Title Header
  largeHeaderContainer: {
    marginBottom: 16,
    paddingTop: 4,
  },
  largeHeaderTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: 'bold',
    letterSpacing: 0.37,
  },
  datePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 6,
  },
  datePillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  largeHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  levelPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  levelPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  circularActionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // 2. Weekly Strip
  weeklyStripContainer: {
    marginBottom: 18,
  },
  weeklyStripRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 6,
  },
  dayPill: {
    flex: 1,
    minHeight: 64,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    position: 'relative',
  },
  dayPillName: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
  },
  dayPillNum: {
    fontSize: 16,
    fontWeight: '800',
  },
  todayIndicatorDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    position: 'absolute',
    bottom: 4,
  },
  monthToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginTop: 6,
  },
  monthToggleBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  calendarCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 8,
    overflow: 'hidden',
  },

  // Inset Grouped Patterns
  insetCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
  },
  cardHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  cardHeaderChevron: {
    fontSize: 20,
    fontWeight: '600',
  },
  insetCardInner: {
    padding: 14,
    borderRadius: 14,
    marginHorizontal: 14,
    marginBottom: 14,
  },

  // Card 1: Próxima Aula
  nextClassTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  nextClassSubjectContainer: {
    flex: 1,
    minWidth: 0,
    marginRight: 6,
  },
  nextClassSubject: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  timeChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    flexShrink: 0,
    alignSelf: 'center',
  },
  timeChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  nextClassMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  nextClassMetaText: {
    fontSize: 12,
    fontWeight: '500',
  },
  highlightActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  quickStudyBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickStudyBtnText: {
    fontWeight: '800',
    fontSize: 13,
  },
  quickCheckBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  fallbackSubtitle: {
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
  },
  fallbackStudyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginLeft: 8,
  },
  fallbackStudyBtnText: {
    fontSize: 11,
    fontWeight: '800',
  },

  // Card 2: Provas & Entregas
  urgentExamPill: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    marginHorizontal: 14,
    marginBottom: 14,
    borderWidth: 1,
  },
  urgentExamText: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
    marginLeft: 8,
  },

  // Card 3: Focus Pomodoro
  pomodoroCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    marginHorizontal: 14,
    marginBottom: 14,
  },
  activityRingWrapper: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activityRingText: {
    fontSize: 12,
    fontWeight: '800',
  },
  pomodoroTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  pomodoroSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  pomodoroOpenBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  pomodoroOpenBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },

  // View Mode Switcher
  viewModeToggleWrap: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 2,
  },
  viewModeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  viewModeBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // Checklist Items & Dividers
  checklistContainer: {
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  checklistItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  circularCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxCheckmark: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  checklistItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  checklistTitle: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    marginRight: 6,
  },
  importantBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  importantBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  checklistMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  checklistTime: {
    fontSize: 11,
    fontWeight: '500',
  },
  miniCategoryBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  miniCategoryText: {
    fontSize: 10,
    fontWeight: '700',
  },
  miniSubjectBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    maxWidth: 120,
    flexDirection: 'row',
    alignItems: 'center',
  },
  miniSubjectText: {
    fontSize: 10,
    fontWeight: '700',
  },

  // Preserved for backwards compatibility with tests
  subjectBadge: {
    flex: 1,
    minWidth: 0,
    marginRight: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
  },
  subjectBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },

  // Empty Checklist Fallback Card
  emptyIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyChecklistCard: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginVertical: 8,
  },
  emptyChecklistTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyChecklistSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
    maxWidth: 290,
  },
  addEventBtn: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addEventBtnText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  // 24h Timeline
  timelineWrapper: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 10,
    overflow: 'hidden',
    marginHorizontal: 14,
    marginBottom: 14,
  },
  timelineHourRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 72,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  timelineTimeLabel: {
    width: 48,
    fontSize: 10,
    fontWeight: '600',
  },
  timelineHourDivider: {
    flex: 1,
  },
  timelineEventCard: {
    position: 'absolute',
    left: 55,
    right: 10,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 5,
    overflow: 'hidden',
  },
  timelineEventTitle: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 16,
  },
  timelineEventTime: {
    fontSize: 10,
    fontWeight: '600',
    opacity: 0.95,
    marginTop: 2,
    lineHeight: 13,
  },

  // Cronograma do Dia (Busy & Free Schedule Blocks)
  scheduleHeaderContainer: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 8,
  },
  scheduleHeaderTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scheduleCapsulesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  scheduleCapsule: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scheduleCapsuleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  dayScheduleTimelineContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  busyBlockCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginVertical: 4,
  },
  busyBlockHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  busyTimeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  busyTimeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  busyAttBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  busyAttBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  busyBlockTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  busyBlockMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  busyBlockLocation: {
    fontSize: 12,
    flex: 1,
  },
  busyBlockCompleted: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 8,
  },
  freeBlockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginVertical: 4,
  },
  freeBlockTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  freeBlockTimeText: {
    fontSize: 13,
    fontWeight: '700',
  },
  freeBlockSubtitle: {
    fontSize: 11,
  },
  freeBlockFocusBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    minHeight: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  freeBlockFocusBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },

  // Floating Action Button
  fab: {
    position: 'absolute',
    bottom: 90,
    right: 20,
    width: 58,
    height: 58,
    borderRadius: 29,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    zIndex: 999,
  },
  fabIcon: {
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: -2,
  },
  desktopContainer: {
    maxWidth: 1200,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 20,
  },
  desktopColumnsContainer: {
    flexDirection: 'row',
    gap: 20,
    alignItems: 'flex-start',
    width: '100%',
  },
  desktopLeftColumn: {
    flex: 1,
    minWidth: 0,
  },
  desktopRightColumn: {
    flex: 1.3,
    minWidth: 0,
  },
});
