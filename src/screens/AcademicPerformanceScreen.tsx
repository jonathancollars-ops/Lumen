import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { getThemeColors, getContrastTextColor } from '../theme';
import { Subject, CourseProgressData, ThemeType } from '../types';
import { CourseCRService, DEFAULT_CURRICULUM_TEMPLATE } from '../services/CourseCRService';
import { SecuritySanitizer } from '../services/SecuritySanitizer';
import { AIParsingService, resolveDocumentMimeType } from '../services/AIParsingService';
import { StorageService } from '../services/storage';
import { useApp } from '../contexts/AppContext';
import { getCurrentSemesterId } from '../utils';

interface AcademicPerformanceScreenProps {
  subjects: Subject[];
  theme?: ThemeType;
}

type PerformanceTab = 'cr_sim' | 'curriculum';

/**
 * AcademicPerformanceScreen - Lumen Academic Performance & Degree Flowchart
 * 100% Offline CR Tracker, What-If Simulation Engine & Degree Matrix.
 */
export const AcademicPerformanceScreen: React.FC<AcademicPerformanceScreenProps> = ({
  subjects = [],
  theme = 'dark',
}) => {
  const colors = getThemeColors(theme);
  const styles = useMemo(() => createStyles(colors, theme), [colors, theme]);

  let appContext: ReturnType<typeof useApp> | null = null;
  try {
    appContext = useApp();
  } catch {
    // Outside AppProvider in isolated tests
  }

  const [activeTab, setActiveTab] = useState<PerformanceTab>('cr_sim');
  const [courseData, setCourseData] = useState<CourseProgressData>(DEFAULT_CURRICULUM_TEMPLATE);
  const [selectedSemesterIndex, setSelectedSemesterIndex] = useState<number>(0);

  // Modals
  const [isImportModalVisible, setIsImportModalVisible] = useState(false);
  const [importMode, setImportMode] = useState<'transcript' | 'curriculum'>('transcript');
  const [importInputText, setImportInputText] = useState('');
  const [isProcessingDocument, setIsProcessingDocument] = useState(false);
  
  const [isTargetModalVisible, setIsTargetModalVisible] = useState(false);
  const [targetInput, setTargetInput] = useState('8.5');

  const [isAddSubjectModalVisible, setIsAddSubjectModalVisible] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectCredits, setNewSubjectCredits] = useState('4');

  // Load data on mount or when active subjects change
  useEffect(() => {
    loadData();
  }, [subjects]);

  const loadData = async () => {
    try {
      const data = await CourseCRService.loadCourseProgress();
      if (data && Array.isArray(data.semesters) && data.semesters.length > 0) {
        setCourseData(data);
        if (data.targetCR) {
          setTargetInput(data.targetCR.toString());
        }
      } else {
        setCourseData(DEFAULT_CURRICULUM_TEMPLATE);
      }
    } catch (e) {
      console.warn('Erro ao carregar dados de desempenho:', e);
      setCourseData(DEFAULT_CURRICULUM_TEMPLATE);
    }
  };

  // Calculations with complete defensive fallbacks
  const historicalCR = useMemo(() => {
    try {
      return CourseCRService.calculateHistoricalCR(courseData);
    } catch {
      return courseData?.baselineCR || 8.0;
    }
  }, [courseData]);

  const degreeProgress = useMemo(() => {
    try {
      return CourseCRService.calculateDegreeProgress(courseData);
    } catch {
      return {
        completedCredits: 0,
        totalRequiredCredits: 200,
        completionPercentage: 0,
        completedSubjectsCount: 0,
        totalSubjectsCount: 0
      };
    }
  }, [courseData]);

  const crSimulations = useMemo(() => {
    try {
      return CourseCRService.simulateCRScenarios(courseData, subjects || []);
    } catch {
      return {
        currentCR: historicalCR,
        scenarios: []
      };
    }
  }, [courseData, subjects, historicalCR]);

  // Current Semester Data
  const currentSemester = useMemo(() => {
    const sems = courseData?.semesters;
    if (!sems || !Array.isArray(sems) || sems.length === 0) return null;
    const safeIndex = Math.min(Math.max(selectedSemesterIndex, 0), sems.length - 1);
    return sems[safeIndex] || null;
  }, [courseData, selectedSemesterIndex]);

  // Handlers
  const handleToggleSubject = async (subjectId: string) => {
    try {
      Haptics.selectionAsync();
      const updated = CourseCRService.toggleSubjectCompletion(courseData, subjectId);
      setCourseData(updated);
      await CourseCRService.saveCourseProgress(updated);
    } catch (e) {
      console.warn('Erro ao alternar status da matéria:', e);
    }
  };

  const handleSaveTargetCR = async () => {
    const parsed = parseFloat(targetInput.replace(',', '.'));
    if (isNaN(parsed) || parsed < 0 || parsed > 10) {
      Alert.alert('Valor Inválido', 'Insira uma meta de CR entre 0.0 e 10.0');
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const updated = { ...courseData, targetCR: parsed };
    setCourseData(updated);
    await CourseCRService.saveCourseProgress(updated);
    setIsTargetModalVisible(false);
  };

  const handleExecuteImport = async () => {
    const raw = importInputText.trim();
    if (!raw) {
      Alert.alert('Texto Vazio', 'Cole o texto ou conteúdo do arquivo para processar.');
      return;
    }

    const sanitized = SecuritySanitizer.sanitizeText(raw);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    let updated: CourseProgressData;
    if (importMode === 'transcript') {
      updated = CourseCRService.parseHistoryText(sanitized, courseData);
      Alert.alert('Histórico Importado!', 'As matérias concluídas e o CR acumulado foram atualizados.');
    } else {
      updated = CourseCRService.parseCurriculumMatrixText(sanitized, courseData);
      Alert.alert('Fluxograma Atualizado!', 'A grade por semestres e o percentual do curso foram reestruturados.');
    }

    setCourseData(updated);
    await CourseCRService.saveCourseProgress(updated);
    setImportInputText('');
    setIsImportModalVisible(false);
  };

  const handleDocumentUpload = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
        copyToCacheDirectory: true
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const aiConfig = await StorageService.getAIConfig();
      if (!aiConfig || !aiConfig.apiKey || aiConfig.apiKey.trim() === '') {
        Alert.alert(
          'Lumen AI Requerido', 
          'A extração inteligente de PDFs e imagens exige que a API do Gemini esteja configurada na aba Lumen AI.'
        );
        return;
      }

      setIsProcessingDocument(true);
      const asset = result.assets[0];
      const fileUri = asset.uri;
      const fileName = asset.name || fileUri;
      const mimeType = resolveDocumentMimeType(fileName, asset.mimeType);

      // Validação e leitura resiliente de arquivos locais e cache no Android / Web
      let base64Data = '';
      if (Platform.OS === 'web') {
        try {
          const webFile = (asset as any).file;
          if (webFile) {
            base64Data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const res = (reader.result as string) || '';
                resolve(res.includes(',') ? res.split(',')[1] : res);
              };
              reader.onerror = reject;
              reader.readAsDataURL(webFile);
            });
          } else {
            const resp = await fetch(fileUri);
            const blob = await resp.blob();
            base64Data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const res = (reader.result as string) || '';
                resolve(res.includes(',') ? res.split(',')[1] : res);
              };
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          }
        } catch (webErr: any) {
          throw new Error(`Falha ao ler o arquivo no navegador: ${webErr?.message || 'Arquivo inacessível.'}`);
        }
      } else {
        try {
          try {
            const fileInfo = await FileSystem.getInfoAsync(fileUri);
            if (!fileInfo.exists) {
              console.warn('fileInfo.exists reported false, attempting read directly');
            }
          } catch (infoErr) {
            console.warn('getInfoAsync warning (continuing with read):', infoErr);
          }

          base64Data = await FileSystem.readAsStringAsync(fileUri, {
            encoding: FileSystem.EncodingType.Base64
          });
        } catch (readErr: any) {
          console.warn('First base64 read attempt failed, retrying with raw string fallback:', readErr);
          try {
            base64Data = await FileSystem.readAsStringAsync(fileUri, {
              encoding: 'base64' as any
            });
          } catch (retryErr: any) {
            throw new Error(`Falha ao ler o conteúdo do arquivo: ${retryErr?.message || readErr?.message || 'Arquivo inacessível ou sem permissão.'}`);
          }
        }
      }

      if (!base64Data || base64Data.trim() === '') {
        throw new Error('O arquivo selecionado está vazio ou não pôde ser codificado.');
      }

      const parsedJSON = await AIParsingService.parseAcademicDocument(base64Data, mimeType, importMode, aiConfig);

      let updated: CourseProgressData;
      if (importMode === 'transcript') {
        updated = CourseCRService.applyAIParsedTranscript(parsedJSON, courseData);
        Alert.alert('Histórico Processado pela IA!', 'Seu CR e todas as disciplinas do histórico foram extraídos e consolidados com sucesso.');
      } else {
        updated = CourseCRService.applyAIParsedCurriculum(parsedJSON, courseData);
        Alert.alert('Fluxograma Estruturado!', 'A Inteligência Artificial mapeou todos os semestres e matérias da matriz.');
      }

      setCourseData(updated);
      await CourseCRService.saveCourseProgress(updated);
      setIsImportModalVisible(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    } catch (error: any) {
      console.warn('Erro ao processar documento com IA:', error);
      Alert.alert(
        'Falha na Leitura do Documento',
        `${error.message || 'Não foi possível extrair os dados do arquivo via IA.'}\n\nDica: Você também pode copiar o texto do seu documento no portal da faculdade (SIGAA, Sophia, etc.) e colar diretamente na caixa de texto para importação imediata.`,
        [{ text: 'OK', style: 'default' }]
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsProcessingDocument(false);
    }
  };

  const handleDeleteCurriculumSubject = (subjectId: string, subjectName: string) => {
    Haptics.selectionAsync();
    Alert.alert(
      'Excluir Disciplina',
      `Deseja remover "${subjectName}" do seu fluxograma de desempenho?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            const updated = CourseCRService.removeSubjectFromCurriculum(courseData, subjectId, subjectName);
            setCourseData(updated);
            await CourseCRService.saveCourseProgress(updated);
          }
        }
      ]
    );
  };

  const handleCloseSemesterPress = () => {
    if (!safeSubjects || safeSubjects.length === 0) {
      Alert.alert(
        'Nenhuma Matéria Ativa',
        'Não há matérias ativas cadastradas no período letivo atual para fechar o semestre. Cadastre matérias na aba Notas antes de consolidar.'
      );
      return;
    }

    const currentPeriodId = getCurrentSemesterId();

    Alert.alert(
      '🎓 Fechar Semestre',
      `Deseja consolidar o semestre atual (${currentPeriodId}) com as notas finais calculadas de ${safeSubjects.length} matérias?\n\nAs disciplinas serão consolidadas no histórico definitivo do fluxograma e arquivadas no aplicativo.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Fechar Semestre',
          style: 'default',
          onPress: async () => {
            try {
              const passGrade = 7.0;
              const updated = CourseCRService.closeActiveSemester(
                courseData,
                safeSubjects,
                currentPeriodId,
                passGrade
              );

              setCourseData(updated);
              await CourseCRService.saveCourseProgress(updated);

              // Arquiva as matérias no AppContext se disponível
              const activeSubjectIds = safeSubjects.map(s => s.id);
              if (appContext?.archiveSubjects) {
                await appContext.archiveSubjects(activeSubjectIds);
              } else if (appContext?.archiveSubject) {
                for (const id of activeSubjectIds) {
                  await appContext.archiveSubject(id);
                }
              }

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert(
                'Semestre Consolidado!',
                `O período ${currentPeriodId} foi fechado com sucesso! Seu novo CR Oficial Acumulado é ${updated.baselineCR?.toFixed(2) || '0.00'}.`
              );
            } catch (err: any) {
              console.error('Erro ao fechar semestre:', err);
              Alert.alert('Erro', 'Não foi possível fechar o semestre. Tente novamente.');
            }
          }
        }
      ]
    );
  };

  const handleAddSubject = async () => {
    const name = newSubjectName.trim();
    const credits = parseInt(newSubjectCredits, 10);
    if (!name || isNaN(credits) || credits <= 0) {
      Alert.alert('Campos Inválidos', 'Preencha o nome e a quantidade de créditos da matéria.');
      return;
    }

    const semNumber = currentSemester?.semesterNumber || 1;
    const updated = CourseCRService.addSubjectToSemester(courseData, semNumber, {
      name,
      credits,
      isCompleted: false
    });

    setCourseData(updated);
    await CourseCRService.saveCourseProgress(updated);
    setNewSubjectName('');
    setNewSubjectCredits('4');
    setIsAddSubjectModalVisible(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleResetToTemplate = () => {
    Alert.alert(
      'Restaurar Padrão',
      'Deseja redefinir a grade para o modelo padrão da graduação?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Restaurar',
          style: 'destructive',
          onPress: async () => {
            setCourseData(DEFAULT_CURRICULUM_TEMPLATE);
            await CourseCRService.saveCourseProgress(DEFAULT_CURRICULUM_TEMPLATE);
            setIsImportModalVisible(false);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          }
        }
      ]
    );
  };

  const handleSyncCurriculum = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const activeIds = (subjects || []).map(s => s.id);
      const updated = CourseCRService.reconcileWithActiveSubjects(courseData, activeIds);
      setCourseData(updated);
      await CourseCRService.saveCourseProgress(updated);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Grade Sincronizada!',
        'Disciplinas excluídas e matérias fantasmas foram removidas. Seu histórico de matérias concluídas e CR oficial foram rigorosamente preservados.'
      );
    } catch (err) {
      console.warn('Erro ao sincronizar grade:', err);
      Alert.alert('Erro', 'Não foi possível sincronizar a grade curricular.');
    }
  };

  const safeSemesters = Array.isArray(courseData?.semesters) ? courseData.semesters : [];
  const safeSubjects = Array.isArray(subjects) ? subjects : [];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header Actions - Apple HIG Header with Full-Width Title & Tactile Action Toolbar */}
      <View style={styles.header}>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail">
            🎯 Desempenho & Curso
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1} ellipsizeMode="tail">
            CR Acumulado • Integralização • Prova Final
          </Text>
        </View>

        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={handleSyncCurriculum}
            accessibilityRole="button"
            accessibilityLabel="Sincronizar Grade"
            activeOpacity={0.7}
          >
            <Text style={styles.headerBtnText}>🔄 Sincronizar</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.headerBtn, styles.headerBtnPrimary]}
            onPress={() => setIsImportModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Importar Histórico ou Fluxograma"
            activeOpacity={0.7}
          >
            <Text style={styles.headerBtnPrimaryText}>📥 Importar</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Tab Switcher */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'cr_sim' && styles.tabButtonActive]}
          onPress={() => {
            Haptics.selectionAsync();
            setActiveTab('cr_sim');
          }}
        >
          <Text
            style={[styles.tabButtonText, activeTab === 'cr_sim' && styles.tabButtonTextActive]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            📈 Meu CR & Simulador
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'curriculum' && styles.tabButtonActive]}
          onPress={() => {
            Haptics.selectionAsync();
            setActiveTab('curriculum');
          }}
        >
          <Text
            style={[styles.tabButtonText, activeTab === 'curriculum' && styles.tabButtonTextActive]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            🎓 Fluxograma & {(degreeProgress?.completionPercentage ?? 0).toFixed(0)}% Curso
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tab Content */}
      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={styles.scrollContentContainer}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'cr_sim' ? (
          /* =========================================================================
             TAB 1: MEU CR & SIMULADOR DE CENÁRIOS WHAT-IF
             ========================================================================= */
          <View style={styles.tabSection}>
            {/* Hero CR Card */}
            <View style={styles.heroCard}>
              <View style={styles.heroRow}>
                <View style={styles.heroMetric}>
                  <Text style={styles.heroLabel}>CR OFICIAL ACUMULADO</Text>
                  <Text style={styles.heroValue}>{historicalCR.toFixed(2)}</Text>
                  <Text style={styles.heroSubtext}>
                    Baseado em {degreeProgress.completedCredits} créditos concluídos
                  </Text>
                </View>

                <View style={styles.heroDivider} />

                <View style={styles.heroMetric}>
                  <Text style={styles.heroLabel}>META DESEJADA</Text>
                  <Text style={[styles.heroValue, { color: colors.primary }]}>
                    {(courseData?.targetCR || 8.5).toFixed(2)}
                  </Text>
                  <TouchableOpacity
                    style={styles.heroEditBtn}
                    onPress={() => setIsTargetModalVisible(true)}
                  >
                    <Text style={styles.heroEditText}>Alterar Meta</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Fechar Semestre Action Banner */}
            {safeSubjects.length > 0 && (
              <View style={styles.closeSemesterBanner}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.closeSemesterTitle}>🎓 Finalizar Período Letivo?</Text>
                  <Text style={styles.closeSemesterDesc}>
                    Consolide as médias de {safeSubjects.length} disciplinas ativas no CR oficial e arquive o período.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.closeSemesterBannerBtn}
                  onPress={handleCloseSemesterPress}
                  accessibilityLabel="Fechar Semestre Agora"
                >
                  <Text style={styles.closeSemesterBannerBtnText}>Fechar Semestre</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* What-If Scenarios Section */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>🔮 Simulação de Cenários (What-If)</Text>
              <Text style={styles.sectionBadge}>
                {safeSubjects.length} Matérias em Andamento
              </Text>
            </View>

            {(crSimulations.scenarios || []).map((scen, idx) => (
              <View key={idx} style={[styles.scenarioCard, { borderLeftColor: scen.badgeColor }]}>
                <View style={styles.scenarioHeader}>
                  <Text style={styles.scenarioTitle}>{scen.title}</Text>
                  <View style={[styles.scenarioCRBadge, { backgroundColor: scen.badgeColor + '20' }]}>
                    <Text style={[styles.scenarioCRValue, { color: scen.badgeColor }]}>
                      CR {scen.projectedCR.toFixed(2)}
                    </Text>
                  </View>
                </View>

                <Text style={styles.scenarioDesc}>{scen.description}</Text>

                <View style={styles.scenarioFooter}>
                  <Text style={styles.scenarioDiff}>
                    Impacto: {scen.difference >= 0 ? `+${scen.difference.toFixed(2)}` : scen.difference.toFixed(2)} pts
                  </Text>
                </View>
              </View>
            ))}

            {/* Final Exam Calculator Section */}
            <View style={[styles.sectionHeaderRow, { marginTop: 24 }]}>
              <Text style={styles.sectionTitle}>📝 Calculadora de Prova Final</Text>
            </View>

            {safeSubjects.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyCardText}>
                  Nenhuma disciplina cadastrada no semestre atual. Cadastre matérias na aba Notas ou Agenda para ver o cálculo da prova final.
                </Text>
              </View>
            ) : (
              safeSubjects.map(sub => {
                let avg = sub.passGrade || 7.0;
                if (sub.gradeGroups && sub.gradeGroups.length > 0) {
                  let totalWeight = 0;
                  let weightedSum = 0;
                  sub.gradeGroups.forEach(g => {
                    if (g && g.items && g.items.length > 0) {
                      const itemSum = g.items.reduce((acc, it) => acc + (it.grade || 0), 0);
                      const groupScore = (itemSum / g.items.length) * (g.weight / 100);
                      weightedSum += groupScore;
                      totalWeight += g.weight;
                    }
                  });
                  avg = totalWeight > 0 ? (weightedSum / (totalWeight / 100)) : (sub.passGrade || 7.0);
                }

                const finalCalc = CourseCRService.calculateFinalExamRequirement(avg, sub.passGrade || 7.0);

                return (
                  <View key={sub.id} style={styles.examCard}>
                    <View style={styles.examRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.examSubjectName}>{sub.name}</Text>
                        <Text style={styles.examSubjectAvg}>
                          Média Atual: <Text style={{ fontWeight: '700', color: colors.text }}>{avg.toFixed(1)}</Text> (Corte: {(sub.passGrade || 7.0).toFixed(1)})
                        </Text>
                      </View>
                      
                      <View style={[styles.examBadge, { backgroundColor: finalCalc.badgeColor + '25' }]}>
                        <Text style={[styles.examBadgeText, { color: finalCalc.badgeColor }]}>
                          {finalCalc.status === 'approved' ? 'Aprovado' : `Final: ${finalCalc.neededGrade.toFixed(1)}`}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.examMessage}>{finalCalc.message}</Text>
                  </View>
                );
              })
            )}
          </View>
        ) : (
          /* =========================================================================
             TAB 2: FLUXOGRAMA & % DE CONCLUSÃO DO CURSO
             ========================================================================= */
          <View style={styles.tabSection}>
            {/* Progress Hero Bar */}
            <View style={styles.progressHeroCard}>
              <View style={styles.progressHeroHeader}>
                <View>
                  <Text style={styles.progressHeroTitle}>Integralização do Curso</Text>
                  <Text style={styles.progressHeroSubtitle}>
                    {degreeProgress.completedCredits} de {degreeProgress.totalRequiredCredits} Créditos Totais
                  </Text>
                </View>
                <Text style={styles.progressHeroPercent}>
                  {(degreeProgress?.completionPercentage ?? 0).toFixed(1)}%
                </Text>
              </View>

              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${Math.min(100, Math.max(0, degreeProgress.completionPercentage))}%`, backgroundColor: colors.primary }
                  ]}
                />
              </View>

              <View style={styles.progressFooter}>
                <Text style={styles.progressFooterText}>
                  ✅ {degreeProgress.completedSubjectsCount} de {degreeProgress.totalSubjectsCount} disciplinas concluídas
                </Text>
              </View>
            </View>

            {/* Semester Selector Carousel (Pills) */}
            <View style={styles.semesterNav}>
              <Text style={styles.semesterNavTitle}>Selecione o Semestre:</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.semesterPillsScroll}
              >
                {safeSemesters.map((sem, idx) => {
                  const completedInSem = (sem.subjects || []).filter(s => s.isCompleted).length;
                  const isSelected = idx === selectedSemesterIndex;

                  return (
                    <TouchableOpacity
                      key={idx}
                      style={[styles.semesterPill, isSelected && styles.semesterPillActive]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setSelectedSemesterIndex(idx);
                      }}
                    >
                      <Text style={[styles.semesterPillText, isSelected && styles.semesterPillTextActive]}>
                        {sem.semesterNumber}º Sem
                      </Text>
                      <View style={[styles.semesterPillBadge, isSelected && styles.semesterPillBadgeActive]}>
                        <Text style={[styles.semesterPillBadgeText, isSelected && styles.semesterPillBadgeTextActive]}>
                          {completedInSem}/{(sem.subjects || []).length}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Subjects List for Current Semester */}
            {currentSemester && (
              <View style={styles.semesterContentCard}>
                <View style={styles.semesterCardHeader}>
                  <Text style={styles.semesterCardTitle}>{currentSemester.title}</Text>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <TouchableOpacity
                      style={[styles.addSubjectBtn, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border, borderWidth: 1 }]}
                      onPress={handleSyncCurriculum}
                      accessibilityRole="button"
                      accessibilityLabel="Sincronizar Grade"
                    >
                      <Text style={[styles.addSubjectBtnText, { color: colors.text }]}>🔄 Sincronizar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.addSubjectBtn}
                      onPress={() => setIsAddSubjectModalVisible(true)}
                      accessibilityRole="button"
                      accessibilityLabel="Adicionar Matéria ao Semestre"
                    >
                      <Text style={styles.addSubjectBtnText}>+ Matéria</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {(!currentSemester.subjects || currentSemester.subjects.length === 0) ? (
                  <Text style={styles.emptySemesterText}>
                    Nenhuma matéria neste semestre. Clique em "+ Matéria" ou importe o fluxograma.
                  </Text>
                ) : (
                  currentSemester.subjects.map(sub => (
                    <View
                      key={sub.id}
                      style={[styles.subjectItem, sub.isCompleted && styles.subjectItemCompleted]}
                    >
                      <TouchableOpacity
                        style={styles.subjectItemClickable}
                        onPress={() => handleToggleSubject(sub.id)}
                        activeOpacity={0.7}
                        accessibilityLabel={`Alternar status de ${sub.name}`}
                      >
                        <View style={[styles.checkbox, sub.isCompleted && styles.checkboxChecked]}>
                          {sub.isCompleted && <Text style={styles.checkmark}>✓</Text>}
                        </View>

                        <View style={styles.subjectItemInfo}>
                          <Text
                            style={[styles.subjectItemName, sub.isCompleted && styles.subjectItemNameCompleted]}
                            numberOfLines={2}
                          >
                            {sub.name}
                          </Text>
                          <Text style={styles.subjectItemMeta}>
                            {sub.credits} créditos • {sub.hours || sub.credits * 15}h {sub.code ? `• ${sub.code}` : ''}
                          </Text>
                        </View>

                        <View style={[styles.statusBadge, sub.isCompleted ? styles.statusBadgeDone : styles.statusBadgePending]}>
                          <Text style={[styles.statusBadgeText, sub.isCompleted ? styles.statusBadgeTextDone : styles.statusBadgeTextPending]}>
                            {sub.isCompleted ? 'Concluída' : 'Pendente'}
                          </Text>
                        </View>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.subjectDeleteBtn}
                        onPress={() => handleDeleteCurriculumSubject(sub.id, sub.name)}
                        accessibilityLabel={`Excluir disciplina ${sub.name}`}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.subjectDeleteBtnText}>🗑️</Text>
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </View>
            )}

          </View>
        )}
      </ScrollView>

      {/* =========================================================================
          MODAL: IMPORTAR HISTÓRICO OU FLUXOGRAMA
          ========================================================================= */}
      <Modal
        visible={isImportModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsImportModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalCard}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalScrollContent}
            >
              <Text style={styles.modalTitle}>📥 Importador Acadêmico</Text>
              <Text style={styles.modalSubtitle}>
                Cole o texto do seu portal (SIGAA, Sophia, TOTVS) ou fluxograma de matérias
              </Text>

              {/* Mode Switcher */}
              <View style={styles.modalTabSwitch}>
                <TouchableOpacity
                  style={[styles.modalTabBtn, importMode === 'transcript' && styles.modalTabBtnActive]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setImportMode('transcript');
                  }}
                  disabled={isProcessingDocument}
                >
                  <Text style={[styles.modalTabBtnText, importMode === 'transcript' && styles.modalTabBtnTextActive]}>
                    📄 Histórico / CR
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalTabBtn, importMode === 'curriculum' && styles.modalTabBtnActive]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setImportMode('curriculum');
                  }}
                  disabled={isProcessingDocument}
                >
                  <Text style={[styles.modalTabBtnText, importMode === 'curriculum' && styles.modalTabBtnTextActive]}>
                    🗺️ Grade / Fluxograma
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Suggested Academic Prompt Chips */}
              <View style={styles.promptChipsContainer}>
                <Text style={[styles.promptChipsLabel, { color: colors.textSecondary }]}>
                  💡 Exemplos de texto para teste rápido:
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.promptChipsScroll}>
                  {importMode === 'transcript' ? (
                    <>
                      <TouchableOpacity
                        style={[styles.promptChip, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setImportInputText(
                            'Histórico Escolar Oficial:\nCR Acumulado: 8.45\n' +
                            '1º Semestre 2024:\n' +
                            '- Cálculo I (4 créditos): 8.5 (Aprovado)\n' +
                            '- Física I (4 créditos): 9.0 (Aprovado)\n' +
                            '- Algoritmos e Programação (4 créditos): 9.5 (Aprovado)'
                          );
                        }}
                        activeOpacity={0.7}
                        accessible={true}
                        accessibilityRole="button"
                        accessibilityLabel="Inserir exemplo de histórico escolar"
                      >
                        <Text style={[styles.promptChipText, { color: colors.text }]}>📄 Histórico Completo</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.promptChip, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setImportInputText(
                            'Boletim Semestral:\n' +
                            'CR: 7.80\n' +
                            'Álgebra Linear (4 cr) - Média 8.2\n' +
                            'Geometria Analítica (3 cr) - Média 7.5\n' +
                            'Química Geral (3 cr) - Média 8.0'
                          );
                        }}
                        activeOpacity={0.7}
                        accessible={true}
                        accessibilityRole="button"
                        accessibilityLabel="Inserir exemplo de boletim semestral"
                      >
                        <Text style={[styles.promptChipText, { color: colors.text }]}>📊 Boletim Rápido</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={[styles.promptChip, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setImportInputText(
                            '1º Semestre:\n- Cálculo I (4 créditos)\n- Física I (4 créditos)\n- Introdução à Engenharia (2 créditos)\n\n' +
                            '2º Semestre:\n- Cálculo II (4 créditos)\n- Física II (4 créditos)\n- Álgebra Linear (4 créditos)\n\n' +
                            '3º Semestre:\n- Cálculo III (4 créditos)\n- Mecânica Geral (4 créditos)\n- Eletromagnetismo (4 créditos)'
                          );
                        }}
                        activeOpacity={0.7}
                        accessible={true}
                        accessibilityRole="button"
                        accessibilityLabel="Inserir exemplo de grade de engenharia"
                      >
                        <Text style={[styles.promptChipText, { color: colors.text }]}>⚙️ Grade Engenharia</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.promptChip, { backgroundColor: colors.surfaceSubtle, borderColor: colors.border }]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setImportInputText(
                            '1º Semestre:\n- Programação I (4 créditos)\n- Circuitos Digitais (4 créditos)\n- Matemática Discreta (4 créditos)\n\n' +
                            '2º Semestre:\n- Estrutura de Dados (4 créditos)\n- Arquitetura de Computadores (4 créditos)\n- Cálculo para Computação (4 créditos)'
                          );
                        }}
                        activeOpacity={0.7}
                        accessible={true}
                        accessibilityRole="button"
                        accessibilityLabel="Inserir exemplo de grade de computação"
                      >
                        <Text style={[styles.promptChipText, { color: colors.text }]}>💻 Grade Computação</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </ScrollView>
              </View>

              <TextInput
                style={styles.importTextInput}
                placeholder={
                  importMode === 'transcript'
                    ? 'Ex: Cole o texto do histórico escolar contendo o CR e as disciplinas concluídas...'
                    : 'Ex: Cole a lista de disciplinas por semestre (1º Semestre, 2º Semestre)...'
                }
                placeholderTextColor={colors.textSecondary}
                multiline
                value={importInputText}
                onChangeText={setImportInputText}
                editable={!isProcessingDocument}
              />

              {/* Botão Full-Width: Analisar PDF / Imagem com Lumen AI */}
              <View style={styles.aiActionContainer}>
                <TouchableOpacity
                  style={[styles.modalActionSubmit, styles.modalActionAIFullWidth]}
                  onPress={handleDocumentUpload}
                  disabled={isProcessingDocument}
                  activeOpacity={0.8}
                >
                  {isProcessingDocument ? (
                    <ActivityIndicator color={getContrastTextColor(colors.primary)} size="small" />
                  ) : (
                    <Text style={[styles.modalActionSubmitText, { color: getContrastTextColor(colors.primary) }]}>
                      📄 Analisar PDF / Imagem com Lumen AI
                    </Text>
                  )}
                </TouchableOpacity>
                <Text style={styles.aiActionHelperText}>
                  A IA do Gemini vai ler seu documento e organizar a grade automaticamente.
                </Text>
              </View>

              {/* Linha de Ações: Cancelar (esquerda) e Processar Texto (direita com cor primária) */}
              <View style={styles.modalPrimaryActionsRow}>
                <TouchableOpacity
                  style={[styles.modalActionCancel, { flex: 1 }]}
                  onPress={() => setIsImportModalVisible(false)}
                  disabled={isProcessingDocument}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalActionCancelText}>Cancelar</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalActionSubmit, styles.modalActionSubmitPrimary]}
                  onPress={handleExecuteImport}
                  disabled={isProcessingDocument}
                  activeOpacity={0.8}
                >
                  <Text style={styles.modalActionSubmitText}>Processar Texto</Text>
                </TouchableOpacity>
              </View>

              {/* Ação Secundária: Restaurar Grade Padrão centralizado discretamente abaixo em estilo texto sutil */}
              <TouchableOpacity
                style={styles.modalActionSecondaryDiscrete}
                onPress={handleResetToTemplate}
                disabled={isProcessingDocument}
                activeOpacity={0.7}
              >
                <Text style={styles.modalActionSecondaryDiscreteText}>Restaurar Grade Padrão</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* =========================================================================
          MODAL: DEFINIR META DE CR
          ========================================================================= */}
      <Modal
        visible={isTargetModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsTargetModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalCardSmall}>
            <Text style={styles.modalTitle}>🎯 Definir Meta de CR</Text>
            <Text style={styles.modalSubtitle}>
              Insira o Coeficiente de Rendimento desejado para sua graduação:
            </Text>

            <TextInput
              style={styles.singleInput}
              placeholder="Ex: 8.5"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
              value={targetInput}
              onChangeText={setTargetInput}
            />

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.modalActionCancel}
                onPress={() => setIsTargetModalVisible(false)}
              >
                <Text style={styles.modalActionCancelText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalActionSubmit}
                onPress={handleSaveTargetCR}
              >
                <Text style={styles.modalActionSubmitText}>Salvar Meta</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* =========================================================================
          MODAL: ADICIONAR MATÉRIA AO SEMESTRE
          ========================================================================= */}
      <Modal
        visible={isAddSubjectModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsAddSubjectModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalCardSmall}>
            <Text style={styles.modalTitle}>+ Adicionar Disciplina</Text>
            <Text style={styles.modalSubtitle}>
              Adicionar ao {currentSemester?.title || 'Semestre Atual'}:
            </Text>

            <TextInput
              style={[styles.singleInput, { marginBottom: 10 }]}
              placeholder="Nome da matéria (ex: Cálculo Numérico)"
              placeholderTextColor={colors.textSecondary}
              value={newSubjectName}
              onChangeText={setNewSubjectName}
            />

            <TextInput
              style={styles.singleInput}
              placeholder="Créditos (ex: 4)"
              placeholderTextColor={colors.textSecondary}
              keyboardType="number-pad"
              value={newSubjectCredits}
              onChangeText={setNewSubjectCredits}
            />

            <View style={styles.modalButtonsRow}>
              <TouchableOpacity
                style={styles.modalActionCancel}
                onPress={() => setIsAddSubjectModalVisible(false)}
              >
                <Text style={styles.modalActionCancelText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalActionSubmit}
                onPress={handleAddSubject}
              >
                <Text style={styles.modalActionSubmitText}>Adicionar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
};

const createStyles = (colors: ReturnType<typeof getThemeColors>, theme: ThemeType) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle,
      backgroundColor: colors.surface,
      gap: 10,
    },
    headerTitleContainer: {
      width: '100%',
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.text,
      letterSpacing: -0.3,
    },
    headerSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
      letterSpacing: -0.1,
    },
    headerButtons: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    headerBtn: {
      flex: 1,
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: colors.surfaceSubtle,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    headerBtnText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
    headerBtnPrimary: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primary,
    },
    headerBtnPrimaryText: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.primary,
    },
    headerBtnSuccess: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primary,
    },
    headerBtnSuccessText: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.primary,
    },
    closeSemesterBanner: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.primary,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    closeSemesterTitle: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.text,
      marginBottom: 2,
    },
    closeSemesterDesc: {
      fontSize: 11,
      color: colors.textSecondary,
      lineHeight: 15,
    },
    closeSemesterBannerBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      alignItems: 'center',
    },
    closeSemesterBannerBtnText: {
      fontSize: 12,
      fontWeight: '800',
      color: getContrastTextColor(colors.primary),
    },
    tabContainer: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceSubtle,
      marginHorizontal: 16,
      marginVertical: 8,
      padding: 3,
      borderRadius: 12,
      gap: 4,
    },
    tabButton: {
      flex: 1,
      paddingVertical: 8,
      alignItems: 'center',
      borderRadius: 9,
      backgroundColor: 'transparent',
    },
    tabButtonActive: {
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.12,
      shadowRadius: 2,
      elevation: 2,
    },
    tabButtonText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textMuted,
    },
    tabButtonTextActive: {
      color: colors.primary,
      fontWeight: '800',
    },
    scrollContent: {
      flex: 1,
    },
    scrollContentContainer: {
      padding: 16,
      paddingBottom: 120,
    },
    tabSection: {
      gap: 16,
    },
    heroCard: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderSubtle,
    },
    heroRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    heroMetric: {
      flex: 1,
      alignItems: 'center',
    },
    heroDivider: {
      width: 1,
      height: 48,
      backgroundColor: colors.borderSubtle,
      marginHorizontal: 12,
    },
    heroLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 4,
    },
    heroValue: {
      fontSize: 28,
      fontWeight: '900',
      color: colors.text,
    },
    heroSubtext: {
      fontSize: 10,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 4,
    },
    heroEditBtn: {
      marginTop: 4,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 4,
      backgroundColor: colors.primaryLight,
    },
    heroEditText: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.primary,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 8,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.text,
    },
    sectionBadge: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.primary,
      backgroundColor: colors.primaryLight,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    scenarioCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      borderLeftWidth: 4,
    },
    scenarioHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    scenarioTitle: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.text,
      flex: 1,
    },
    scenarioCRBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      marginLeft: 8,
    },
    scenarioCRValue: {
      fontSize: 13,
      fontWeight: '900',
    },
    scenarioDesc: {
      fontSize: 12,
      color: colors.textSecondary,
      lineHeight: 16,
      marginBottom: 6,
    },
    scenarioFooter: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
    },
    scenarioDiff: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textMuted,
    },
    emptyCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      alignItems: 'center',
    },
    emptyCardText: {
      fontSize: 12,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
    },
    examCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      marginBottom: 10,
    },
    examRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    examSubjectName: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.text,
    },
    examSubjectAvg: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
    },
    examBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
      marginLeft: 8,
    },
    examBadgeText: {
      fontSize: 11,
      fontWeight: '800',
    },
    examMessage: {
      fontSize: 11,
      color: colors.textSecondary,
      lineHeight: 15,
    },
    progressHeroCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
    },
    progressHeroHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    progressHeroTitle: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.text,
    },
    progressHeroSubtitle: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
    },
    progressHeroPercent: {
      fontSize: 22,
      fontWeight: '900',
      color: colors.primary,
    },
    progressBarTrack: {
      height: 8,
      backgroundColor: colors.surfaceHighlight,
      borderRadius: 4,
      overflow: 'hidden',
      marginBottom: 10,
    },
    progressBarFill: {
      height: '100%',
      borderRadius: 4,
    },
    progressFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    progressFooterText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    semesterNav: {
      marginTop: 8,
    },
    semesterNavTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textMuted,
      marginBottom: 8,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    semesterPillsScroll: {
      gap: 8,
      paddingBottom: 4,
    },
    semesterPill: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 20,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      gap: 6,
    },
    semesterPillActive: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.primary,
    },
    semesterPillText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textMuted,
    },
    semesterPillTextActive: {
      color: colors.primary,
      fontWeight: '800',
    },
    semesterPillBadge: {
      backgroundColor: colors.surfaceHighlight,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 10,
    },
    semesterPillBadgeActive: {
      backgroundColor: colors.primary + '30',
    },
    semesterPillBadgeText: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.textMuted,
    },
    semesterPillBadgeTextActive: {
      color: colors.primary,
    },
    semesterContentCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      marginTop: 8,
    },
    semesterCardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    semesterCardTitle: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.text,
    },
    addSubjectBtn: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 6,
      backgroundColor: colors.primaryLight,
    },
    addSubjectBtnText: {
      fontSize: 11,
      fontWeight: '800',
      color: colors.primary,
    },
    emptySemesterText: {
      fontSize: 12,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingVertical: 20,
    },
    subjectItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSubtle,
    },
    subjectItemClickable: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    subjectDeleteBtn: {
      padding: 6,
      marginLeft: 8,
      borderRadius: 6,
      backgroundColor: colors.surfaceHighlight,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    subjectDeleteBtnText: {
      fontSize: 12,
    },
    subjectItemCompleted: {
      opacity: 0.8,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: colors.borderSubtle,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 10,
    },
    checkboxChecked: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    checkmark: {
      fontSize: 11,
      fontWeight: '900',
      color: getContrastTextColor(colors.primary),
    },
    subjectItemInfo: {
      flex: 1,
      marginRight: 8,
    },
    subjectItemName: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
    subjectItemNameCompleted: {
      color: colors.textMuted,
      textDecorationLine: 'line-through',
    },
    subjectItemMeta: {
      fontSize: 10,
      color: colors.textSecondary,
      marginTop: 2,
    },
    statusBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
    },
    statusBadgeDone: {
      backgroundColor: colors.primaryLight,
    },
    statusBadgePending: {
      backgroundColor: colors.surfaceHighlight,
    },
    statusBadgeText: {
      fontSize: 10,
      fontWeight: '700',
    },
    statusBadgeTextDone: {
      color: colors.primary,
    },
    statusBadgeTextPending: {
      color: colors.textMuted,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.7)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    modalCard: {
      width: '100%',
      maxWidth: 420,
      maxHeight: '90%',
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 18,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
    },
    modalCardSmall: {
      width: '100%',
      maxWidth: 360,
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 18,
      borderWidth: 1,
      borderColor: colors.borderSubtle,
    },
    modalScrollContent: {
      paddingBottom: 8,
    },
    modalTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.text,
      marginBottom: 4,
    },
    modalSubtitle: {
      fontSize: 11,
      color: colors.textSecondary,
      marginBottom: 12,
      lineHeight: 15,
    },
    modalTabSwitch: {
      flexDirection: 'row',
      backgroundColor: colors.background,
      borderRadius: 8,
      padding: 3,
      marginBottom: 12,
      gap: 4,
    },
    modalTabBtn: {
      flex: 1,
      paddingVertical: 6,
      alignItems: 'center',
      borderRadius: 6,
    },
    modalTabBtnActive: {
      backgroundColor: colors.surfaceHighlight,
    },
    modalTabBtnText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textMuted,
    },
    modalTabBtnTextActive: {
      color: colors.text,
      fontWeight: '700',
    },
    promptChipsContainer: {
      marginBottom: 10,
    },
    promptChipsLabel: {
      fontSize: 11,
      fontWeight: '700',
      marginBottom: 6,
    },
    promptChipsScroll: {
      gap: 8,
      paddingVertical: 2,
    },
    promptChip: {
      minHeight: 44,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    promptChipText: {
      fontSize: 12,
      fontWeight: '700',
    },
    importTextInput: {
      height: 160,
      backgroundColor: colors.surfaceSubtle,
      borderRadius: 12,
      padding: 14,
      color: colors.text,
      fontSize: 13,
      lineHeight: 18,
      textAlignVertical: 'top',
      borderWidth: 1.5,
      borderColor: colors.border,
      marginBottom: 16,
    },
    singleInput: {
      height: 48,
      backgroundColor: colors.surfaceSubtle,
      borderRadius: 12,
      paddingHorizontal: 14,
      color: colors.text,
      fontSize: 14,
      borderWidth: 1.5,
      borderColor: colors.border,
      marginBottom: 16,
    },
    aiActionContainer: {
      marginVertical: 12,
    },
    modalActionAIFullWidth: {
      width: '100%',
      minHeight: 48,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    aiActionHelperText: {
      textAlign: 'center',
      fontSize: 11,
      color: colors.textMuted,
      marginTop: 6,
    },
    modalPrimaryActionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginTop: 4,
      marginBottom: 8,
    },
    modalActionsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    modalButtonsRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 8,
    },
    modalActionCancel: {
      minHeight: 44,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceSubtle,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    modalActionCancelText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    modalActionSubmit: {
      minHeight: 44,
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalActionSubmitPrimary: {
      flex: 1,
    },
    modalActionSubmitText: {
      fontSize: 13,
      fontWeight: '700',
      color: getContrastTextColor(colors.primary),
    },
    modalActionSecondary: {
      paddingVertical: 8,
    },
    modalActionSecondaryText: {
      fontSize: 12,
      color: colors.danger,
      fontWeight: '600',
    },
    modalActionSecondaryDiscrete: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      marginTop: 2,
    },
    modalActionSecondaryDiscreteText: {
      fontSize: 12,
      color: colors.danger,
      fontWeight: '600',
      textAlign: 'center',
    },
  });
