import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
  Alert,
  Platform,
  KeyboardAvoidingView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemeType, Subject, StudySession, AttendanceRecord, AACCActivity } from '../types';
import { getThemeColors, getContrastTextColor } from '../theme';
import { StorageService } from '../services/storage';
import { generateId, getLocalDateString } from '../utils';
import * as Haptics from 'expo-haptics';

interface Props {
  visible: boolean;
  onClose: () => void;
  theme: ThemeType;
  subjects: Subject[];
  studySessions: StudySession[];
  attendances: AttendanceRecord[];
}

const CATEGORIES: ('Ensino' | 'Pesquisa' | 'Extensão' | 'Outros')[] = ['Ensino', 'Pesquisa', 'Extensão', 'Outros'];

export const AnalyticsAndAACCModal: React.FC<Props> = ({
  visible,
  onClose,
  theme,
  subjects,
  studySessions,
  attendances
}) => {
  const colors = getThemeColors(theme);
  const styles = getStyles(colors);

  const [activeTab, setActiveTab] = useState<'analytics' | 'aacc'>('analytics');

  // AACC state
  const [aaccList, setAaccList] = useState<AACCActivity[]>([]);
  const [targetHours, setTargetHours] = useState<number>(200);
  const [showAddAACC, setShowAddAACC] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<'Ensino' | 'Pesquisa' | 'Extensão' | 'Outros'>('Ensino');
  const [newHours, setNewHours] = useState('');
  const [newInstitution, setNewInstitution] = useState('');
  const [selectedFilterCategory, setSelectedFilterCategory] = useState<string>('Todas');

  useEffect(() => {
    if (visible) {
      loadAACCData();
    }
  }, [visible, subjects]);

  const loadAACCData = async () => {
    const data = await StorageService.getAACCActivities();
    setAaccList(Array.isArray(data) ? data.filter(Boolean) : []);
  };

  const handleAddAACC = async () => {
    if (!newTitle.trim() || !newHours.trim()) {
      Alert.alert('Erro', 'Preencha o título e a quantidade de horas.');
      return;
    }

    const hoursNum = parseFloat(newHours.replace(',', '.'));
    if (isNaN(hoursNum) || hoursNum <= 0) {
      Alert.alert('Erro', 'Insira uma quantidade de horas válida.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const newActivity: AACCActivity = {
      id: generateId('aacc'),
      title: newTitle.trim(),
      category: newCategory,
      hours: hoursNum,
      date: getLocalDateString(),
      institution: newInstitution.trim() || undefined,
    };

    const updated = [newActivity, ...aaccList];
    setAaccList(updated);
    await StorageService.saveAACCActivities(updated);

    // Reset form
    setNewTitle('');
    setNewHours('');
    setNewInstitution('');
    setShowAddAACC(false);
  };

  const handleDeleteAACC = (id: string) => {
    Alert.alert('Excluir Atividade', 'Deseja remover esta atividade complementar?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          const updated = aaccList.filter(a => a.id !== id);
          setAaccList(updated);
          await StorageService.saveAACCActivities(updated);
        }
      }
    ]);
  };

  const safeSubjects = Array.isArray(subjects) ? subjects.filter(Boolean) : [];
  const safeStudySessions = Array.isArray(studySessions) ? studySessions.filter(Boolean) : [];
  const safeAttendances = Array.isArray(attendances) ? attendances.filter(Boolean) : [];
  const safeAaccList = Array.isArray(aaccList) ? aaccList.filter(Boolean) : [];

  // Analytics Calculations
  const totalStudyMs = safeStudySessions.reduce((sum, s) => sum + (s?.durationMs || 0), 0);
  const totalStudyHours = (totalStudyMs / (1000 * 60 * 60)).toFixed(1);

  // Group study time by subject
  const studyBySubject: { [subjectId: string]: number } = {};
  safeStudySessions.forEach(s => {
    if (s?.subjectId) {
      studyBySubject[s.subjectId] = (studyBySubject[s.subjectId] || 0) + (s.durationMs || 0);
    }
  });

  const subjectStudyStats = safeSubjects.map(sub => {
    const ms = studyBySubject[sub.id] || 0;
    const hours = ms / (1000 * 60 * 60);
    return {
      subject: sub,
      hours,
      formattedTime: hours >= 1 ? `${hours.toFixed(1)}h` : `${Math.round(ms / (1000 * 60))}m`
    };
  }).sort((a, b) => b.hours - a.hours);

  const maxSubjectHours = Math.max(...subjectStudyStats.map(s => s.hours), 1);

  // Attendance rate calculation
  const totalAtts = safeAttendances.filter(a => a && (a.status === 'present' || a.status === 'absent'));
  const totalPresents = totalAtts.filter(a => a.status === 'present').length;
  const globalAttendanceRate = totalAtts.length > 0 ? Math.round((totalPresents / totalAtts.length) * 100) : 100;

  // AACC Calculations
  const totalAACCHours = safeAaccList.reduce((sum, a) => sum + (a?.hours || 0), 0);
  const aaccProgressPercent = Math.min(Math.round((totalAACCHours / (targetHours || 200)) * 100), 100);

  const filteredAACCList = safeAaccList.filter(a => {
    if (!a) return false;
    if (selectedFilterCategory === 'Todas') return true;
    return a.category === selectedFilterCategory;
  });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
            <Text style={{ fontSize: 15, color: colors.primary, fontWeight: '700' }}>✕ Fechar</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Desempenho & AACC</Text>
          <View style={{ width: 60 }} />
        </View>

        {/* Tab Selector */}
        <View style={styles.tabsRow}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'analytics' && { borderBottomColor: colors.primary, borderBottomWidth: 3 }]}
            onPress={() => {
              Haptics.selectionAsync();
              setActiveTab('analytics');
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, { color: activeTab === 'analytics' ? colors.primary : colors.textSecondary, fontWeight: activeTab === 'analytics' ? '800' : '600' }]}>
              📈 Estatísticas de Estudo
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeTab === 'aacc' && { borderBottomColor: colors.primary, borderBottomWidth: 3 }]}
            onPress={() => {
              Haptics.selectionAsync();
              setActiveTab('aacc');
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, { color: activeTab === 'aacc' ? colors.primary : colors.textSecondary, fontWeight: activeTab === 'aacc' ? '800' : '600' }]}>
              🎓 Horas Complementares
            </Text>
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {activeTab === 'analytics' ? (
            <>
              {/* Overview Metrics Cards */}
              <View style={styles.metricsRow}>
                <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={{ fontSize: 24 }}>⏱️</Text>
                  <Text style={[styles.metricValue, { color: colors.primary }]}>{totalStudyHours}h</Text>
                  <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Total Estudado</Text>
                </View>

                <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={{ fontSize: 24 }}>🎯</Text>
                  <Text style={[styles.metricValue, { color: colors.text }]}>{studySessions.length}</Text>
                  <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Sessões de Foco</Text>
                </View>

                <View style={[styles.metricCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={{ fontSize: 24 }}>📊</Text>
                  <Text style={[styles.metricValue, { color: globalAttendanceRate >= 75 ? colors.success : colors.danger }]}>
                    {globalAttendanceRate}%
                  </Text>
                  <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Presença Geral</Text>
                </View>
              </View>

              {/* Study Time by Subject Chart */}
              <Text style={styles.sectionTitle}>Tempo de Estudo por Matéria</Text>
              <View style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {subjectStudyStats.length === 0 ? (
                  <Text style={{ color: colors.textSecondary, textAlign: 'center', padding: 20 }}>
                    Nenhuma matéria cadastrada ainda.
                  </Text>
                ) : (
                  subjectStudyStats.map(item => {
                    const barWidthPercent = maxSubjectHours > 0 ? (item.hours / maxSubjectHours) * 100 : 0;
                    const subColor = item.subject.color || colors.primary;

                    return (
                      <View key={item.subject.id} style={styles.barRow}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 10 }}>
                            <View style={[styles.dot, { backgroundColor: subColor }]} />
                            <Text style={[styles.barLabel, { color: colors.text }]} numberOfLines={1}>
                              {item.subject.name}
                            </Text>
                          </View>
                          <Text style={[styles.barValue, { color: colors.textSecondary }]}>
                            {item.formattedTime}
                          </Text>
                        </View>

                        <View style={[styles.barTrack, { backgroundColor: colors.surfaceSubtle }]}>
                          <View
                            style={[
                              styles.barFill,
                              {
                                width: `${Math.max(barWidthPercent, 4)}%`,
                                backgroundColor: subColor
                              }
                            ]}
                          />
                        </View>
                      </View>
                    );
                  })
                )}
              </View>

              {/* Attendance Breakdown Note */}
              <View style={[styles.infoBanner, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}>
                <Text style={{ fontSize: 20, marginRight: 10 }}>💡</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 13, flex: 1, lineHeight: 18 }}>
                  Mantenha a presença sempre acima de <Text style={{ color: colors.text, fontWeight: '700' }}>75%</Text> para garantir sua aprovação sem riscos por falta.
                </Text>
              </View>
            </>
          ) : (
            <>
              {/* AACC Progress Card */}
              <View style={[styles.aaccProgressCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <View>
                    <Text style={[styles.aaccCardTitle, { color: colors.text }]}>Horas Complementares (AACC)</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 2 }}>
                      Meta do curso: {targetHours} horas
                    </Text>
                  </View>
                  <View style={[styles.percentBadge, { backgroundColor: aaccProgressPercent >= 100 ? colors.successLight : colors.primaryLight }]}>
                    <Text style={{ color: aaccProgressPercent >= 100 ? (theme === 'light' ? colors.successDark : colors.success) : (theme === 'light' ? colors.primaryDark : colors.primary), fontWeight: '800', fontSize: 14 }}>
                      {aaccProgressPercent}%
                    </Text>
                  </View>
                </View>

                {/* Progress Bar */}
                <View style={[styles.progressBarTrack, { backgroundColor: colors.surfaceSubtle }]}>
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        width: `${aaccProgressPercent}%`,
                        backgroundColor: aaccProgressPercent >= 100 ? colors.success : colors.primary
                      }
                    ]}
                  />
                </View>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                    {totalAACCHours}h cumpridas
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                    {Math.max(targetHours - totalAACCHours, 0)}h restantes
                  </Text>
                </View>
              </View>

              {/* Add Activity Button */}
              <TouchableOpacity
                style={[styles.addAaccBtn, { backgroundColor: colors.primary }]}
                onPress={() => setShowAddAACC(!showAddAACC)}
                activeOpacity={0.8}
              >
                <Text style={{ color: getContrastTextColor(colors.primary), fontWeight: '800', fontSize: 14 }}>
                  {showAddAACC ? '✕ Cancelar Cadastro' : '+ Adicionar Atividade Complementar'}
                </Text>
              </TouchableOpacity>

              {/* Add Activity Form */}
              {showAddAACC && (
                <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.primary }]}>
                  <Text style={[styles.formTitle, { color: colors.text }]}>Nova Atividade AACC</Text>

                  <Text style={styles.inputLabel}>Título da Atividade / Curso</Text>
                  <TextInput
                    style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                    placeholder="Ex: Curso de Python, Monitoria, Palestra"
                    placeholderTextColor={colors.textSecondary}
                    value={newTitle}
                    onChangeText={setNewTitle}
                  />

                  <Text style={styles.inputLabel}>Categoria</Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
                    {CATEGORIES.map(cat => {
                      const isSelected = newCategory === cat;
                      return (
                        <TouchableOpacity
                          key={cat}
                          style={[
                            styles.categoryChip,
                            {
                              backgroundColor: isSelected ? colors.primary : colors.surfaceSubtle,
                              borderColor: isSelected ? colors.primary : colors.border,
                              borderWidth: 1
                            }
                          ]}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setNewCategory(cat);
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={{ color: isSelected ? getContrastTextColor(colors.primary) : colors.text, fontWeight: '700', fontSize: 12 }}>
                            {cat}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inputLabel}>Carga Horária (h)</Text>
                      <TextInput
                        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                        placeholder="Ex: 20"
                        placeholderTextColor={colors.textSecondary}
                        keyboardType="numeric"
                        value={newHours}
                        onChangeText={setNewHours}
                      />
                    </View>
                    <View style={{ flex: 2 }}>
                      <Text style={styles.inputLabel}>Instituição / Órgão</Text>
                      <TextInput
                        style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                        placeholder="Ex: Coursera, USP, DA"
                        placeholderTextColor={colors.textSecondary}
                        value={newInstitution}
                        onChangeText={setNewInstitution}
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[styles.saveActivityBtn, { backgroundColor: colors.primary }]}
                    onPress={handleAddAACC}
                    activeOpacity={0.8}
                  >
                    <Text style={{ color: getContrastTextColor(colors.primary), fontWeight: '800', fontSize: 15 }}>
                      ✓ Salvar Atividade
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Category Filter Chips */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                {['Todas', ...CATEGORIES].map(cat => {
                  const isSelected = selectedFilterCategory === cat;
                  return (
                    <TouchableOpacity
                      key={cat}
                      style={[
                        styles.filterChip,
                        {
                          backgroundColor: isSelected ? colors.primary : colors.surface,
                          borderColor: isSelected ? colors.primary : colors.border,
                          borderWidth: 1
                        }
                      ]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setSelectedFilterCategory(cat);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={{ color: isSelected ? getContrastTextColor(colors.primary) : colors.text, fontWeight: '700', fontSize: 12 }}>
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Activities List */}
              {filteredAACCList.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={{ fontSize: 32, marginBottom: 8 }}>📜</Text>
                  <Text style={{ color: colors.textSecondary, textAlign: 'center', fontWeight: '500' }}>
                    Nenhuma atividade cadastrada nesta categoria.
                  </Text>
                </View>
              ) : (
                filteredAACCList.map(item => (
                  <View key={item.id} style={[styles.activityItemCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                        <View style={[styles.catBadge, { backgroundColor: colors.surfaceSubtle }]}>
                          <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 11 }}>{item.category}</Text>
                        </View>
                        {item.institution && (
                          <Text style={{ color: colors.textSecondary, fontSize: 12, marginLeft: 6 }}>
                            • {item.institution}
                          </Text>
                        )}
                      </View>
                      <Text style={[styles.activityTitle, { color: colors.text }]} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 4 }}>
                        📅 Cadastrado em {item.date ? item.date.split('-').reverse().join('/') : ''}
                      </Text>
                    </View>

                    <View style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
                      <View style={[styles.hoursBadge, { backgroundColor: colors.primaryLight }]}>
                        <Text style={{ color: theme === 'light' ? colors.primaryDark : colors.primary, fontWeight: '800', fontSize: 13 }}>+{item.hours}h</Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleDeleteAACC(item.id)}
                        style={styles.deleteAaccBtn}
                        activeOpacity={0.7}
                      >
                        <Text style={{ color: theme === 'light' ? colors.dangerDark : colors.danger, fontSize: 13, fontWeight: '700' }}>Excluir</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </>
          )}
          <View style={{ height: 40 }} />
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
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  closeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5,
  },
  tabsRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  tab: {
    flex: 1,
    paddingVertical: 13,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 13,
  },
  content: {
    padding: 18,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  metricCard: {
    flex: 1,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 6,
    letterSpacing: -0.5,
  },
  metricLabel: {
    fontSize: 11,
    marginTop: 2,
    fontWeight: '600',
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 12,
  },
  chartCard: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  barRow: {
    marginBottom: 14,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  barLabel: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  barValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  barTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 4,
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 20,
  },
  aaccProgressCard: {
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  aaccCardTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  percentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  progressBarTrack: {
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 5,
  },
  addAaccBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  formCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  formTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 6,
  },
  input: {
    height: 46,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    marginBottom: 12,
  },
  categoryChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveActivityBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    marginRight: 8,
  },
  emptyCard: {
    padding: 30,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
  },
  activityItemCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  catBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  hoursBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  deleteAaccBtn: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginTop: 6,
  }
});
