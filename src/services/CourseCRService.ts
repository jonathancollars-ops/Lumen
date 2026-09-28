import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Subject,
  CourseProgressData,
  CourseSemester,
  CourseHistorySubject,
  CRSimulationScenario
} from '../types';
import { generateId, getCurrentSemesterId } from '../utils';
import { calculateFinalGrade } from '../components/GradeEngine';

const COURSE_PROGRESS_STORAGE_KEY = '@lumen_course_progress';

export const DEFAULT_CURRICULUM_TEMPLATE: CourseProgressData = {
  courseName: 'Graduação',
  targetCR: 8.5,
  baselineCR: 8.0,
  totalRequiredCredits: 200,
  completedCredits: 40,
  totalRequiredHours: 3200,
  completedHours: 600,
  semesters: [
    {
      semesterNumber: 1,
      title: '1º Semestre',
      subjects: [
        { id: 'sub_1_1', name: 'Cálculo Diferencial e Integral I', code: 'MAT101', credits: 5, hours: 80, isCompleted: true, grade: 8.5 },
        { id: 'sub_1_2', name: 'Geometria Analítica e Álgebra Linear', code: 'MAT102', credits: 4, hours: 60, isCompleted: true, grade: 7.8 },
        { id: 'sub_1_3', name: 'Introdução à Programação', code: 'CC101', credits: 4, hours: 60, isCompleted: true, grade: 9.0 },
        { id: 'sub_1_4', name: 'Física Geral I', code: 'FIS101', credits: 4, hours: 60, isCompleted: true, grade: 7.2 },
        { id: 'sub_1_5', name: 'Metodologia Científica', code: 'HUM101', credits: 2, hours: 30, isCompleted: true, grade: 9.5 }
      ]
    },
    {
      semesterNumber: 2,
      title: '2º Semestre',
      subjects: [
        { id: 'sub_2_1', name: 'Cálculo Diferencial e Integral II', code: 'MAT201', credits: 5, hours: 80, isCompleted: true, grade: 8.0 },
        { id: 'sub_2_2', name: 'Estruturas de Dados', code: 'CC201', credits: 4, hours: 60, isCompleted: true, grade: 8.7 },
        { id: 'sub_2_3', name: 'Física Geral II', code: 'FIS201', credits: 4, hours: 60, isCompleted: true, grade: 7.5 },
        { id: 'sub_2_4', name: 'Circuitos Digitais', code: 'ENG201', credits: 4, hours: 60, isCompleted: true, grade: 8.2 }
      ]
    },
    {
      semesterNumber: 3,
      title: '3º Semestre',
      subjects: [
        { id: 'sub_3_1', name: 'Cálculo III', code: 'MAT301', credits: 4, hours: 60, isCompleted: true, grade: 7.9 },
        { id: 'sub_3_2', name: 'Algoritmos Avançados', code: 'CC301', credits: 4, hours: 60, isCompleted: false },
        { id: 'sub_3_3', name: 'Eletromagnetismo', code: 'FIS301', credits: 4, hours: 60, isCompleted: false },
        { id: 'sub_3_4', name: 'Probabilidade e Estatística', code: 'EST301', credits: 4, hours: 60, isCompleted: false }
      ]
    },
    {
      semesterNumber: 4,
      title: '4º Semestre',
      subjects: [
        { id: 'sub_4_1', name: 'Sistemas Operacionais', code: 'CC401', credits: 4, hours: 60, isCompleted: false },
        { id: 'sub_4_2', name: 'Bancos de Dados', code: 'CC402', credits: 4, hours: 60, isCompleted: false },
        { id: 'sub_4_3', name: 'Redes de Computadores', code: 'CC403', credits: 4, hours: 60, isCompleted: false },
        { id: 'sub_4_4', name: 'Engenharia de Software', code: 'CC404', credits: 4, hours: 60, isCompleted: false }
      ]
    },
    {
      semesterNumber: 5,
      title: '5º Semestre',
      subjects: [
        { id: 'sub_5_1', name: 'Inteligência Artificial', code: 'CC501', credits: 4, hours: 60, isCompleted: false },
        { id: 'sub_5_2', name: 'Compiladores', code: 'CC502', credits: 4, hours: 60, isCompleted: false },
        { id: 'sub_5_3', name: 'Sistemas Distribuídos', code: 'CC503', credits: 4, hours: 60, isCompleted: false }
      ]
    },
    {
      semesterNumber: 6,
      title: '6º Semestre',
      subjects: [
        { id: 'sub_6_1', name: 'Segurança da Informação', code: 'CC601', credits: 4, hours: 60, isCompleted: false },
        { id: 'sub_6_2', name: 'Computação Gráfica', code: 'CC602', credits: 4, hours: 60, isCompleted: false },
        { id: 'sub_6_3', name: 'Otimização e Pesquisa Operacional', code: 'MAT601', credits: 4, hours: 60, isCompleted: false }
      ]
    },
    {
      semesterNumber: 7,
      title: '7º Semestre',
      subjects: [
        { id: 'sub_7_1', name: 'Trabalho de Conclusão de Curso I', code: 'TCC701', credits: 3, hours: 45, isCompleted: false },
        { id: 'sub_7_2', name: 'Estágio Supervisionado', code: 'EST701', credits: 6, hours: 120, isCompleted: false },
        { id: 'sub_7_3', name: 'Tópicos Especiais I', code: 'TOP701', credits: 4, hours: 60, isCompleted: false }
      ]
    },
    {
      semesterNumber: 8,
      title: '8º Semestre',
      subjects: [
        { id: 'sub_8_1', name: 'Trabalho de Conclusão de Curso II', code: 'TCC801', credits: 4, hours: 60, isCompleted: false },
        { id: 'sub_8_2', name: 'Empreendedorismo e Inovação', code: 'ADM801', credits: 2, hours: 30, isCompleted: false },
        { id: 'sub_8_3', name: 'Ética e Cidadania', code: 'HUM801', credits: 2, hours: 30, isCompleted: false }
      ]
    }
  ]
};

function parseOfficialCR(value: unknown): number | undefined {
  const normalized = typeof value === 'string' ? value.trim().replace(',', '.') : value;
  const number = typeof normalized === 'number' ? normalized : Number(normalized);
  return Number.isFinite(number) && number >= 0 && number <= 10 ? number : undefined;
}

export class CourseCRService {
  /**
   * Calculates the weighted cumulative Grade Point Average (CR / GPA) from completed subjects.
   * Formula: CR = Sum(Grade * Credits) / Sum(Credits)
   */
  static calculateHistoricalCR(data: CourseProgressData): number {
    const officialCR = parseOfficialCR(data?.officialCR);
    if (officialCR !== undefined) return officialCR;

    if (!data || !Array.isArray(data.semesters)) {
      return data?.baselineCR || 0;
    }

    let totalWeightedScore = 0;
    let totalCredits = 0;

    data.semesters.forEach(sem => {
      if (sem && Array.isArray(sem.subjects)) {
        sem.subjects.forEach(sub => {
          if (sub && sub.isCompleted && typeof sub.grade === 'number' && !isNaN(sub.grade)) {
            const credits = (typeof sub.credits === 'number' && sub.credits > 0) ? sub.credits : 1;
            totalWeightedScore += sub.grade * credits;
            totalCredits += credits;
          }
        });
      }
    });

    if (totalCredits === 0) {
      return data.baselineCR || 0;
    }

    const calculated = totalWeightedScore / totalCredits;
    return isNaN(calculated) ? (data.baselineCR || 0) : Number(calculated.toFixed(2));
  }

  /**
   * Calculates degree completion progress metrics (Credits and % Completion).
   */
  static calculateDegreeProgress(data: CourseProgressData): {
    completedCredits: number;
    totalRequiredCredits: number;
    completionPercentage: number;
    completedSubjectsCount: number;
    totalSubjectsCount: number;
  } {
    if (!data || !Array.isArray(data.semesters)) {
      return {
        completedCredits: data?.completedCredits || 0,
        totalRequiredCredits: data?.totalRequiredCredits || 200,
        completionPercentage: 0,
        completedSubjectsCount: 0,
        totalSubjectsCount: 0
      };
    }

    let completedCredits = 0;
    let totalCredits = 0;
    let completedSubjectsCount = 0;
    let totalSubjectsCount = 0;

    data.semesters.forEach(sem => {
      if (sem && Array.isArray(sem.subjects)) {
        sem.subjects.forEach(sub => {
          if (sub) {
            const credits = (typeof sub.credits === 'number' && sub.credits > 0)
              ? sub.credits
              : (sub.hours ? Math.round(sub.hours / 15) : 4);
            totalCredits += credits;
            totalSubjectsCount++;

            if (sub.isCompleted) {
              completedCredits += credits;
              completedSubjectsCount++;
            }
          }
        });
      }
    });

    const targetTotalCredits = (data.totalRequiredCredits && data.totalRequiredCredits > 0)
      ? data.totalRequiredCredits
      : Math.max(totalCredits, 1);

    const effectiveCompleted = totalSubjectsCount > 0
      ? completedCredits
      : Math.max(completedCredits, data.completedCredits || 0);

    const percentage = Math.min((effectiveCompleted / targetTotalCredits) * 100, 100.0);

    return {
      completedCredits: effectiveCompleted,
      totalRequiredCredits: targetTotalCredits,
      completionPercentage: isNaN(percentage) ? 0 : Number(percentage.toFixed(1)),
      completedSubjectsCount,
      totalSubjectsCount
    };
  }

  /**
   * Simulates dynamic CR scenarios based on current semester active subjects.
   */
  static simulateCRScenarios(
    courseData: CourseProgressData,
    currentSemesterSubjects: Subject[] = []
  ): {
    currentCR: number;
    scenarios: CRSimulationScenario[];
  } {
    const safeData = (courseData && Array.isArray(courseData.semesters))
      ? courseData
      : DEFAULT_CURRICULUM_TEMPLATE;

    const historicalCR = this.calculateHistoricalCR(safeData);

    let pastCredits = 0;
    let pastWeightedSum = 0;

    safeData.semesters.forEach(sem => {
      if (sem && Array.isArray(sem.subjects)) {
        sem.subjects.forEach(sub => {
          if (sub && sub.isCompleted && typeof sub.grade === 'number' && !isNaN(sub.grade)) {
            const credits = sub.credits > 0 ? sub.credits : 4;
            pastWeightedSum += sub.grade * credits;
            pastCredits += credits;
          }
        });
      }
    });

    if (pastCredits === 0) {
      pastCredits = safeData.completedCredits || 40;
      pastWeightedSum = historicalCR * pastCredits;
    }

    // Evaluate current semester subjects
    let currentSemesterCredits = 0;
    let currentSemesterWorstSum = 0; // If future exams get 0
    let currentSemesterBestSum = 0; // If future exams get 10
    let currentSemesterEstimatedSum = 0;

    const safeSubjects = Array.isArray(currentSemesterSubjects) ? currentSemesterSubjects : [];

    safeSubjects.forEach(sub => {
      if (sub) {
        const credits = sub.workloadHours ? Math.round(sub.workloadHours / 20) : 4;
        currentSemesterCredits += credits;

        if (sub.gradeGroups && sub.gradeGroups.length > 0) {
          const calc = calculateFinalGrade(sub.gradeGroups, sub.passGrade || 7.0);
          const currentScore = typeof calc.score === 'number' && !isNaN(calc.score) ? calc.score : (sub.passGrade || 7.0);
          
          currentSemesterEstimatedSum += currentScore * credits;
          currentSemesterWorstSum += (calc.hasMissingItems ? currentScore * 0.7 : currentScore) * credits;
          currentSemesterBestSum += 10.0 * credits;
        } else {
          // No grades entered yet
          const fallback = typeof sub.passGrade === 'number' ? sub.passGrade : 7.0;
          currentSemesterEstimatedSum += fallback * credits;
          currentSemesterWorstSum += (fallback * 0.5) * credits;
          currentSemesterBestSum += 10.0 * credits;
        }
      }
    });

    const totalEstimatedCredits = pastCredits + currentSemesterCredits;

    // Projected CR Calculations
    const realisticCR = totalEstimatedCredits > 0
      ? Number(((pastWeightedSum + currentSemesterEstimatedSum) / totalEstimatedCredits).toFixed(2))
      : historicalCR;

    const worstCaseCR = totalEstimatedCredits > 0
      ? Number(((pastWeightedSum + currentSemesterWorstSum) / totalEstimatedCredits).toFixed(2))
      : historicalCR;

    const bestCaseCR = totalEstimatedCredits > 0
      ? Number(((pastWeightedSum + currentSemesterBestSum) / totalEstimatedCredits).toFixed(2))
      : historicalCR;

    const targetCR = safeData.targetCR || 8.5;
    const targetTotalWeighted = targetCR * totalEstimatedCredits;
    const neededCurrentWeighted = targetTotalWeighted - pastWeightedSum;
    const neededInCurrent = currentSemesterCredits > 0 ? (neededCurrentWeighted / currentSemesterCredits) : targetCR;
    const neededFormatted = isNaN(neededInCurrent) ? targetCR.toFixed(1) : neededInCurrent.toFixed(1);

    const scenarios: CRSimulationScenario[] = [
      {
        title: '📊 Cenário Realista (Manter Médias Atuais)',
        projectedCR: isNaN(realisticCR) ? historicalCR : realisticCR,
        difference: Number(((isNaN(realisticCR) ? historicalCR : realisticCR) - historicalCR).toFixed(2)),
        description: 'Mantendo o ritmo e notas parciais calculadas nas disciplinas deste período.',
        type: 'realistic',
        badgeColor: '#3B82F6'
      },
      {
        title: '🛑 Pior Caso (Parar Hoje / Nota Zero)',
        projectedCR: isNaN(worstCaseCR) ? historicalCR : worstCaseCR,
        difference: Number(((isNaN(worstCaseCR) ? historicalCR : worstCaseCR) - historicalCR).toFixed(2)),
        description: 'Se você não realizar mais nenhuma avaliação e tirar zero nas provas restantes.',
        type: 'worst_case',
        badgeColor: '#EF4444'
      },
      {
        title: `🎯 Meta Desejada (CR ${targetCR})`,
        projectedCR: targetCR,
        difference: Number((targetCR - historicalCR).toFixed(2)),
        description: neededInCurrent > 10 
          ? `Alvo matematicamente inalcançável neste semestre (exigiria média ${neededFormatted}).`
          : `Você precisa de média ponderada de no mínimo ${neededFormatted} nas matérias deste semestre.`,
        type: 'target',
        badgeColor: '#10B981'
      },
      {
        title: '🚀 Melhor Caso (Nota 10 em tudo)',
        projectedCR: isNaN(bestCaseCR) ? historicalCR : bestCaseCR,
        difference: Number(((isNaN(bestCaseCR) ? historicalCR : bestCaseCR) - historicalCR).toFixed(2)),
        description: 'Se gabaritar todas as provas e trabalhos pendentes até o final do semestre.',
        type: 'best_case',
        badgeColor: '#8B5CF6'
      }
    ];

    return {
      currentCR: historicalCR,
      scenarios
    };
  }

  /**
   * Toggles completion status of a subject in the curriculum matrix.
   */
  static toggleSubjectCompletion(data: CourseProgressData, subjectId: string): CourseProgressData {
    const safeData = (data && Array.isArray(data.semesters)) ? data : DEFAULT_CURRICULUM_TEMPLATE;
    const updatedSemesters = safeData.semesters.map(sem => {
      const updatedSubjects = (sem.subjects || []).map(sub => {
        if (sub.id === subjectId) {
          return { ...sub, isCompleted: !sub.isCompleted };
        }
        return sub;
      });
      return { ...sem, subjects: updatedSubjects };
    });

    const progress = this.calculateDegreeProgress({ ...safeData, semesters: updatedSemesters });

    return {
      ...safeData,
      semesters: updatedSemesters,
      completedCredits: progress.completedCredits,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Adds a new subject to a specific semester in the curriculum matrix.
   */
  static addSubjectToSemester(
    data: CourseProgressData,
    semesterNumber: number,
    subject: { name: string; credits: number; hours?: number; code?: string; isCompleted?: boolean }
  ): CourseProgressData {
    const safeData = (data && Array.isArray(data.semesters)) ? data : DEFAULT_CURRICULUM_TEMPLATE;
    const newSubject: CourseHistorySubject = {
      id: generateId('subj'),
      name: subject.name.trim(),
      code: subject.code?.trim(),
      credits: subject.credits > 0 ? subject.credits : 4,
      hours: subject.hours || subject.credits * 15,
      isCompleted: !!subject.isCompleted
    };

    let semesterFound = false;
    const updatedSemesters = safeData.semesters.map(sem => {
      if (sem.semesterNumber === semesterNumber) {
        semesterFound = true;
        return {
          ...sem,
          subjects: [...(sem.subjects || []), newSubject]
        };
      }
      return sem;
    });

    if (!semesterFound) {
      updatedSemesters.push({
        semesterNumber,
        title: `${semesterNumber}º Semestre`,
        subjects: [newSubject]
      });
      updatedSemesters.sort((a, b) => a.semesterNumber - b.semesterNumber);
    }

    const progress = this.calculateDegreeProgress({ ...safeData, semesters: updatedSemesters });

    return {
      ...safeData,
      semesters: updatedSemesters,
      completedCredits: progress.completedCredits,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Remove uma matéria correspondente (por id ou nome normalizado) que esteja no semestre atual/ativo em courseData.
   * Evita a permanência de matérias fantasmas na aba de Desempenho ao excluir disciplinas no aplicativo.
   */
  static removeSubjectFromCurrentSemester(
    courseData: CourseProgressData,
    subjectId: string,
    subjectName?: string
  ): CourseProgressData {
    const safeData = (courseData && Array.isArray(courseData.semesters))
      ? courseData
      : DEFAULT_CURRICULUM_TEMPLATE;

    const currentSemId = getCurrentSemesterId();
    const normName = subjectName?.trim().toLowerCase();

    // Localiza o semestre ativo (por título coincidente, ou primeiro com pendentes, ou último)
    let activeSemIndex = safeData.semesters.findIndex(s => s.title && s.title.includes(currentSemId));
    if (activeSemIndex === -1) {
      activeSemIndex = safeData.semesters.findIndex(s => Array.isArray(s.subjects) && s.subjects.some(sub => !sub.isCompleted));
    }
    if (activeSemIndex === -1 && safeData.semesters.length > 0) {
      activeSemIndex = safeData.semesters.length - 1;
    }

    const updatedSemesters = safeData.semesters.map((sem, idx) => {
      const isActiveSem = idx === activeSemIndex;

      const filteredSubjects = (sem.subjects || []).filter(sub => {
        // Se o id da disciplina for idêntico ao subjectId, remove de qualquer semestre
        if (sub.id === subjectId) return false;

        // Se houver correspondência pelo nome da matéria, remove do semestre ativo ou se estiver pendente
        if (normName && (isActiveSem || !sub.isCompleted)) {
          if (this.isSubjectMatch(sub.name, normName, sub.code)) {
            return false;
          }
        }

        return true;
      });

      return {
        ...sem,
        subjects: filteredSubjects
      };
    });

    const progress = this.calculateDegreeProgress({ ...safeData, semesters: updatedSemesters });
    const historicalCR = this.calculateHistoricalCR({ ...safeData, semesters: updatedSemesters });

    return {
      ...safeData,
      baselineCR: historicalCR,
      semesters: updatedSemesters,
      completedCredits: progress.completedCredits,
      totalRequiredCredits: progress.totalRequiredCredits,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Remove explicitamente uma disciplina do fluxograma/matriz curricular independente do semestre.
   */
  static removeSubjectFromCurriculum(
    courseData: CourseProgressData,
    subjectId: string,
    subjectName?: string
  ): CourseProgressData {
    return this.removeSubjectFromCurrentSemester(courseData, subjectId, subjectName);
  }

  /**
   * Reconcilia a grade curricular (courseData) com a lista de matérias ativas do usuário.
   * Remove disciplinas não consolidadas que foram excluídas (fantasmas), preservando
   * rigorosamente qualquer disciplina com histórico consolidado (isCompleted: true)
   * ou notas definitivas registradas.
   */
  static reconcileWithActiveSubjects(
    courseData: CourseProgressData,
    activeSubjectIds: string[]
  ): CourseProgressData {
    const safeData = (courseData && Array.isArray(courseData.semesters))
      ? courseData
      : DEFAULT_CURRICULUM_TEMPLATE;

    const activeIdSet = new Set<string>(
      Array.isArray(activeSubjectIds) ? activeSubjectIds.filter(Boolean) : []
    );

    const updatedSemesters = safeData.semesters.map(sem => {
      if (!sem || !Array.isArray(sem.subjects)) {
        return sem;
      }

      const filteredSubjects = sem.subjects.filter(sub => {
        if (!sub) return false;

        // 1. Disciplinas concluídas ou com nota definitiva consolidada pertencem ao histórico e NUNCA devem ser removidas
        const isConsolidated = Boolean(sub.isCompleted) || sub.isPassing === true;
        const hasDefinitiveGrade = typeof sub.grade === 'number' && !isNaN(sub.grade) && sub.grade > 0;
        if (isConsolidated || hasDefinitiveGrade) {
          return true;
        }

        // 2. Se a matéria está entre os IDs ativos registrados pelo usuário, permanece ativa
        if (activeIdSet.has(sub.id)) {
          return true;
        }

        // 3. Matéria não consolidada vinculada a ID de matéria (subj_) que não consta mais em activeSubjectIds é fantasma -> remove
        if (sub.id.startsWith('subj_') && !activeIdSet.has(sub.id)) {
          return false;
        }

        // 4. Se a matéria não consolidada e sem nota estiver em um bloco temporário ou de extensão (em andamento/cursando) sem estar nos ativos -> remove
        const semTitle = (sem.title || '').toLowerCase();
        if ((semTitle.includes('andamento') || semTitle.includes('cursando')) && !activeIdSet.has(sub.id)) {
          return false;
        }

        // 5. Matérias do template fixo da grade não vinculadas a IDs removidos permanecem
        return true;
      });

      return {
        ...sem,
        subjects: filteredSubjects
      };
    }).filter(sem => {
      // Se um semestre de extensão em andamento ficou completamente vazio após a reconciliação, remove-o
      const semTitle = (sem.title || '').toLowerCase();
      if ((semTitle.includes('andamento') || semTitle.includes('cursando')) && (!sem.subjects || sem.subjects.length === 0)) {
        return false;
      }
      return true;
    });

    const progress = this.calculateDegreeProgress({ ...safeData, semesters: updatedSemesters });
    const historicalCR = this.calculateHistoricalCR({ ...safeData, semesters: updatedSemesters });

    return {
      ...safeData,
      baselineCR: historicalCR,
      semesters: updatedSemesters,
      completedCredits: progress.completedCredits,
      totalRequiredCredits: progress.totalRequiredCredits,
      lastUpdated: new Date().toISOString()
    };
  }


  /**
   * Fecha e consolida o semestre letivo ativo no histórico definitivo:
   * 1. Percorre as matérias ativas (activeSubjects), calcula a média final de cada uma.
   * 2. Define isCompleted (finalGrade >= passGrade), grade, credits (workloadHours / 15 || 4).
   * 3. Consolida esse semestre no array de semestres do courseData com o título do período (ex: "2026.1").
   * 4. Recalcula o CR Oficial acumulado (calculateHistoricalCR) e degreeProgress.
   */
  static closeActiveSemester(
    courseData: CourseProgressData,
    activeSubjects: Subject[],
    semesterName?: string,
    passGrade: number = 7.0
  ): CourseProgressData {
    const safeData = (courseData && Array.isArray(courseData.semesters))
      ? courseData
      : DEFAULT_CURRICULUM_TEMPLATE;

    const periodTitle = (semesterName && semesterName.trim()) ? semesterName.trim() : getCurrentSemesterId();

    const closedSubjects: CourseHistorySubject[] = (activeSubjects || []).map(sub => {
      const targetPassGrade = typeof sub.passGrade === 'number' && !isNaN(sub.passGrade)
        ? sub.passGrade
        : passGrade;

      let finalGrade = targetPassGrade;
      if (sub.gradeGroups && sub.gradeGroups.length > 0) {
        const calc = calculateFinalGrade(sub.gradeGroups, targetPassGrade);
        if (typeof calc.score === 'number' && !isNaN(calc.score)) {
          finalGrade = Number(calc.score.toFixed(1));
        }
      }

      const credits = (sub.workloadHours && sub.workloadHours > 0)
        ? Math.max(1, Math.round(sub.workloadHours / 15))
        : 4;
      const hours = (sub.workloadHours && sub.workloadHours > 0)
        ? sub.workloadHours
        : credits * 15;

      const isCompleted = finalGrade >= targetPassGrade;

      return {
        id: sub.id || generateId('flow'),
        name: sub.name.trim(),
        code: sub.code ? String(sub.code).trim() : undefined,
        credits,
        hours,
        grade: finalGrade,
        isCompleted,
        isPassing: isCompleted
      };
    });

    const existingIndex = safeData.semesters.findIndex(s => 
      s.title.toLowerCase().trim() === periodTitle.toLowerCase().trim()
    );

    let updatedSemesters: CourseSemester[];
    if (existingIndex !== -1) {
      updatedSemesters = [...safeData.semesters];
      updatedSemesters[existingIndex] = {
        ...updatedSemesters[existingIndex],
        subjects: closedSubjects
      };
    } else {
      const maxNum = safeData.semesters.reduce((max, s) => Math.max(max, s.semesterNumber || 0), 0);
      const newSem: CourseSemester = {
        semesterNumber: maxNum + 1,
        title: periodTitle,
        subjects: closedSubjects
      };
      updatedSemesters = [...safeData.semesters, newSem];
    }

    const newHistoricalCR = this.calculateHistoricalCR({
      ...safeData,
      officialCR: undefined,
      semesters: updatedSemesters
    });
    const progress = this.calculateDegreeProgress({ ...safeData, semesters: updatedSemesters });

    return {
      ...safeData,
      baselineCR: newHistoricalCR,
      officialCR: undefined,
      semesters: updatedSemesters,
      completedCredits: progress.completedCredits,
      totalRequiredCredits: progress.totalRequiredCredits,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Calculates required final exam score based on standard academic regulations:
   * Rule: (Average * 6 + FinalExam * 4) / 10 >= 5.0  (or target passGrade)
   * Required Final = (PassGrade * 10 - Average * 6) / 4
   */
  static calculateFinalExamRequirement(currentAverage: number, passGrade: number = 7.0): {
    neededGrade: number;
    status: 'approved' | 'final_exam' | 'reproved';
    message: string;
    badgeColor: string;
  } {
    const avg = typeof currentAverage === 'number' && !isNaN(currentAverage) ? currentAverage : 0;
    const pass = typeof passGrade === 'number' && !isNaN(passGrade) ? passGrade : 7.0;

    if (avg >= pass) {
      return {
        neededGrade: 0,
        status: 'approved',
        message: `Parabéns! Média ${avg.toFixed(1)} atingiu ou superou o corte de aprovação direta (${pass.toFixed(1)}).`,
        badgeColor: '#10B981'
      };
    }

    // Direct reproval if average is below minimum exam threshold (usually 4.0 or 3.0)
    const minFinalThreshold = pass >= 7.0 ? 4.0 : 3.0;
    if (avg < minFinalThreshold) {
      return {
        neededGrade: 10.0,
        status: 'reproved',
        message: `Média ${avg.toFixed(1)} abaixo do mínimo de ${minFinalThreshold.toFixed(1)} para ter direito à Prova Final.`,
        badgeColor: '#EF4444'
      };
    }

    // Standard formula: Final Exam needed to reach 5.0 overall
    const targetOverall = 5.0;
    const needed = (targetOverall * 10 - avg * 6) / 4;
    const clampedNeeded = Math.max(0, Math.min(10.0, Number(needed.toFixed(1))));

    return {
      neededGrade: clampedNeeded,
      status: 'final_exam',
      message: `Você precisa tirar ${clampedNeeded.toFixed(1)} na Prova Final para fechar a média ponderada 5.0.`,
      badgeColor: '#F59E0B'
    };
  }

  /**
   * Parses raw copy-pasted academic transcript text (SIGAA, Sophia, TOTVS, etc.)
   */
  static parseHistoryText(rawText: string, existingData?: CourseProgressData): CourseProgressData {
    const base = (existingData && Array.isArray(existingData.semesters))
      ? existingData
      : DEFAULT_CURRICULUM_TEMPLATE;

    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const updatedSemesters = base.semesters.map(sem => ({
      ...sem,
      subjects: [...(sem.subjects || [])]
    }));

    let extractedCR: number | undefined;
    const crMatch = rawText.match(/(?:\bcoeficiente(?:\s+de)?(?:\s+rendimento)?\b|\brendimento\b|\bira\b|\bgpa\b|\bcr\b(?!\s*[ée]ditos?)|\bm[eé]dia(?:\s+geral)?\b)\s*(?:(?:acumulad[oa]|geral|do\s+(?:per[ií]odo|curso))\s*)?(?:\([^)]{0,40}\))?\s*[:=\-]\s*(\d{1,2}(?:[.,]\d+)?)/i);
    extractedCR = parseOfficialCR(crMatch?.[1]);

    lines.forEach(line => {
      const isApproved = /aprovado|aprovada|aprov|concluido|concluído|dispensado|dispensa|isento|aproveitado|aproveitamento/i.test(line);

      let grade: number | undefined = undefined;
      const gradeMatches = line.match(/\b([0-9]{1,2}[.,][0-9]{1,2})\b/g);
      if (gradeMatches) {
        for (const match of gradeMatches) {
          const num = parseFloat(match.replace(',', '.'));
          if (!isNaN(num) && num >= 0 && num <= 10.0) {
            grade = num;
          }
        }
      }

      updatedSemesters.forEach(sem => {
        sem.subjects.forEach(sub => {
          const normalizedLine = line.toLowerCase();
          const normalizedSub = sub.name.toLowerCase();
          const words = normalizedSub.split(' ').filter(w => w.length > 3);
          const matchCount = words.filter(w => normalizedLine.includes(w)).length;

          if (matchCount >= Math.min(2, words.length) || (sub.code && normalizedLine.includes(sub.code.toLowerCase()))) {
            if (isApproved || (grade !== undefined && grade >= 5.0)) {
              sub.isCompleted = true;
              if (grade !== undefined) sub.grade = grade;
            }
          }
        });
      });
    });

    const progress = this.calculateDegreeProgress({ ...base, semesters: updatedSemesters });
    return {
      ...base,
      baselineCR: extractedCR ?? base.baselineCR,
      officialCR: extractedCR ?? parseOfficialCR(base.officialCR),
      semesters: updatedSemesters,
      completedCredits: progress.completedCredits,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Parses a full Curriculum Flowchart (Fluxograma / Matriz Curricular) organized by semesters.
   */
  static parseCurriculumMatrixText(rawText: string, existingData?: CourseProgressData): CourseProgressData {
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const parsedSemesters: CourseSemester[] = [];
    let currentSemesterNumber = 1;
    let currentSubjects: CourseHistorySubject[] = [];
    const existingMap = new Map<string, { isCompleted: boolean; grade?: number }>();
    if (existingData && Array.isArray(existingData.semesters)) {
      for (const sem of existingData.semesters) {
        if (sem && Array.isArray(sem.subjects)) {
          for (const sub of sem.subjects) {
            if (sub && sub.name) {
              existingMap.set(sub.name.toLowerCase().trim(), {
                isCompleted: Boolean(sub.isCompleted),
                grade: typeof sub.grade === 'number' ? sub.grade : undefined
              });
            }
          }
        }
      }
    }

    lines.forEach(line => {
      const semesterHeaderMatch = line.match(/(?:(\d+)[ºª°]?\s*(?:semestre|periodo|período|fase|modulo|módulo|etapa)|(?:semestre|periodo|período|fase|modulo|módulo|etapa)\s*(\d+))/i);

      if (semesterHeaderMatch) {
        if (currentSubjects.length > 0) {
          parsedSemesters.push({
            semesterNumber: currentSemesterNumber,
            title: `${currentSemesterNumber}º Semestre`,
            subjects: currentSubjects
          });
          currentSubjects = [];
        }
        const parsedNum = parseInt(semesterHeaderMatch[1] || semesterHeaderMatch[2], 10);
        currentSemesterNumber = !isNaN(parsedNum) && parsedNum > 0 ? parsedNum : currentSemesterNumber + 1;
        return;
      }

      const isApproved = /aprovado|aprovada|concluído|concluída|feito|feita|dispensado|isento|aprov/i.test(line);

      const cleanName = line
        .replace(/MAT\d+|FIS\d+|CC\d+|ENG\d+|[A-Z]{2,4}\d{3,4}/g, '')
        .replace(/\b\d+\s*(h|horas|ch|cr|créditos)\b/gi, '')
        .replace(/aprovado|aprovada|concluído|concluída|reprovado|reprovada|trancado|isento/gi, '')
        .replace(/[0-9.,]+/g, '')
        .replace(/[-|–:()]/g, '')
        .trim();

      if (cleanName.length >= 3) {
        let credits = 4;
        const crUnitMatch = line.match(/(\d+)\s*(?:cr|créditos|cred|crédito)\b/i);
        const hoursUnitMatch = line.match(/(\d+)\s*(?:h|horas|ch)\b/i);

        if (crUnitMatch) {
          credits = parseInt(crUnitMatch[1], 10);
        } else if (hoursUnitMatch) {
          credits = Math.max(1, Math.round(parseInt(hoursUnitMatch[1], 10) / 15));
        }

        let grade: number | undefined = undefined;
        const gradeMatches = line.match(/\b([0-9]{1,2}[.,][0-9]{1,2})\b/g);
        if (gradeMatches) {
          for (const match of gradeMatches) {
            const num = parseFloat(match.replace(',', '.'));
            if (!isNaN(num) && num >= 0 && num <= 10.0) {
              grade = num;
            }
          }
        }

        let existingStatus = existingMap.get(cleanName.toLowerCase().trim());
        if (!existingStatus) {
          for (const [key, val] of existingMap.entries()) {
            if (this.isSubjectMatch(key, cleanName)) {
              existingStatus = val;
              break;
            }
          }
        }
        const finalCompleted = isApproved || (grade !== undefined && grade >= 5.0) || Boolean(existingStatus?.isCompleted);
        const finalGrade = grade !== undefined ? grade : existingStatus?.grade;

        currentSubjects.push({
          id: generateId('flow'),
          name: cleanName,
          credits,
          hours: credits * 15,
          isCompleted: finalCompleted,
          grade: finalGrade
        });
      }
    });

    if (currentSubjects.length > 0) {
      parsedSemesters.push({
        semesterNumber: currentSemesterNumber,
        title: `${currentSemesterNumber}º Semestre`,
        subjects: currentSubjects
      });
    }

    const base = (existingData && Array.isArray(existingData.semesters))
      ? existingData
      : DEFAULT_CURRICULUM_TEMPLATE;

    if (parsedSemesters.length === 0) return base;

    parsedSemesters.sort((a, b) => a.semesterNumber - b.semesterNumber);

    const progress = this.calculateDegreeProgress({ ...base, semesters: parsedSemesters });
    return {
      ...base,
      semesters: parsedSemesters,
      completedCredits: progress.completedCredits,
      totalRequiredCredits: progress.totalRequiredCredits,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Normaliza algarismos romanos ou arábicos no nome da matéria (ex: "I", "II", "1", "2")
   */
  static extractRomanOrArabicNumber(str: string): string | null {
    const match = str.match(/\b(i{1,3}|iv|v|vi{0,3}|ix|x|[1-9])\b/i);
    if (!match) return null;
    const val = match[1].toLowerCase();
    const romanMap: Record<string, string> = {
      'i': '1',
      'ii': '2',
      'iii': '3',
      'iv': '4',
      'v': '5',
      'vi': '6',
      'vii': '7',
      'viii': '8',
      'ix': '9',
      'x': '10'
    };
    return romanMap[val] || val;
  }

  /**
   * Determina com precisão se duas matérias correspondem à mesma disciplina.
   * Evita falsos positivos onde disciplinas distintas compartilham apenas uma palavra genérica.
   */
  static isSubjectMatch(nameA: string, nameB: string, codeA?: string, codeB?: string): boolean {
    if (!nameA || !nameB) return false;

    // Normaliza acentuação e caixa
    const normA = nameA.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const normB = nameB.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

    // 1. Igualdade exata
    if (normA === normB) return true;

    // 2. Correspondência por código
    const cleanCodeA = codeA ? codeA.trim().toLowerCase() : undefined;
    const cleanCodeB = codeB ? codeB.trim().toLowerCase() : undefined;
    if (cleanCodeA && cleanCodeB && cleanCodeA === cleanCodeB) {
      return true;
    }
    if (cleanCodeA && normB.includes(cleanCodeA)) {
      return true;
    }
    if (cleanCodeB && normA.includes(cleanCodeB)) {
      return true;
    }

    // 3. Verificação de numeração sequencial (I vs II, 1 vs 2, etc.)
    const numA = this.extractRomanOrArabicNumber(normA);
    const numB = this.extractRomanOrArabicNumber(normB);
    if (numA && numB && numA !== numB) {
      return false;
    }

    // 4. Correspondência de palavras significativas (> 3 letras)
    const stopWords = new Set(['para', 'com', 'pelo', 'pela', 'sobre', 'entre', 'como', 'mais', 'menos']);
    const wordsA = normA.split(/[^a-z0-9]+/).filter(w => w.length > 3 && !stopWords.has(w));
    const wordsB = normB.split(/[^a-z0-9]+/).filter(w => w.length > 3 && !stopWords.has(w));

    if (wordsA.length === 0 || wordsB.length === 0) return false;

    // Palavras compartilhadas com suporte a prefixos (ex: banco/bancos, sistema/sistemas)
    const sharedWords = wordsA.filter(wA =>
      wordsB.some(wB => wA === wB || (wA.length >= 4 && wB.length >= 4 && (wA.startsWith(wB) || wB.startsWith(wA))))
    );

    // Se ambas têm 2 ou mais palavras significativas:
    if (wordsA.length >= 2 && wordsB.length >= 2) {
      const minWords = Math.min(wordsA.length, wordsB.length);
      const required = Math.min(2, minWords);
      return sharedWords.length >= required && (sharedWords.length / minWords) >= 0.5;
    }

    // Se uma das duas tem apenas 1 palavra significativa (ex: "Cálculo" vs "Cálculo I"):
    if (wordsA.length === 1 || wordsB.length === 1) {
      return sharedWords.length === 1 && numA === numB;
    }

    return false;
  }

  /**
   * Aplica o resultado JSON da IA (histórico) na grade existente.
   * Reconhece todas as disciplinas (concluídas, cursando e reprovadas) e as mapeia em seus semestres.
   * Não descarta matérias aprovadas/cursando fora do template padrão: inclui-as dinamicamente.
   */
  static applyAIParsedTranscript(
    aiResult: {
      subjects?: Array<{
        name: string;
        code?: string;
        grade?: number;
        credits?: number;
        hours?: number;
        status?: 'approved' | 'in_progress' | 'reproved' | 'dispensed' | string;
        isCompleted?: boolean;
        semesterNumber?: number;
        semester?: number | string;
      }>;
      approvedSubjects?: Array<{
        name: string;
        code?: string;
        grade?: number;
        credits?: number;
        hours?: number;
        status?: string;
        isCompleted?: boolean;
        semesterNumber?: number;
        semester?: number | string;
      }>;
      baselineCR?: number;
    },
    existingData?: CourseProgressData
  ): CourseProgressData {
    const base = (existingData && Array.isArray(existingData.semesters))
      ? existingData
      : DEFAULT_CURRICULUM_TEMPLATE;

    const updatedSemesters: CourseSemester[] = base.semesters.map(sem => ({
      ...sem,
      subjects: [...(sem.subjects || [])]
    }));

    const rawList = (Array.isArray(aiResult?.subjects) && aiResult.subjects.length > 0)
      ? aiResult.subjects
      : (Array.isArray(aiResult?.approvedSubjects) ? aiResult.approvedSubjects : []);

    const baselineCR = parseOfficialCR(aiResult?.baselineCR)
      ?? parseOfficialCR(aiResult?.officialCR)
      ?? base.baselineCR;
    const officialCR = parseOfficialCR(aiResult?.baselineCR)
      ?? parseOfficialCR(aiResult?.officialCR)
      ?? parseOfficialCR(base.officialCR);

    const unmatchedSubjects: Array<{
      name: string;
      code?: string;
      grade?: number;
      credits?: number;
      hours?: number;
      isCompleted: boolean;
      status?: string;
      semesterNumber?: number;
      semester?: number | string;
    }> = [];

    rawList.forEach(rawSub => {
      if (!rawSub || typeof rawSub.name !== 'string' || rawSub.name.trim() === '') return;

      const statusLower = (rawSub.status || '').toLowerCase().trim();
      let isCompleted = false;
      if (
        statusLower === 'approved' ||
        statusLower === 'dispensed' ||
        statusLower === 'aprovado' ||
        statusLower === 'aprovada' ||
        statusLower === 'dispensado' ||
        statusLower === 'dispensada' ||
        statusLower === 'dispensa'
      ) {
        isCompleted = true;
      } else if (
        statusLower === 'in_progress' ||
        statusLower === 'cursando' ||
        statusLower === 'matriculado' ||
        statusLower === 'reproved' ||
        statusLower === 'reprovado' ||
        statusLower === 'reprovada'
      ) {
        isCompleted = false;
      } else if (typeof rawSub.isCompleted === 'boolean') {
        isCompleted = rawSub.isCompleted;
      } else if (typeof rawSub.grade === 'number' && !isNaN(rawSub.grade) && rawSub.grade >= 5.0) {
        isCompleted = true;
      }

      let foundMatch = false;

      for (const sem of updatedSemesters) {
        for (const sub of sem.subjects) {
          if (this.isSubjectMatch(sub.name, rawSub.name, sub.code, rawSub.code)) {
            sub.isCompleted = isCompleted;
            if (typeof rawSub.grade === 'number' && !isNaN(rawSub.grade)) {
              sub.grade = rawSub.grade;
            }
            foundMatch = true;
            break;
          }
        }
        if (foundMatch) break;
      }

      if (!foundMatch) {
        unmatchedSubjects.push({ ...rawSub, isCompleted });
      }
    });

    // Inclusão dinâmica de matérias fora do template padrão (eletivas/optativas/outro curso/reprovadas/cursando)
    if (unmatchedSubjects.length > 0) {
      unmatchedSubjects.forEach(unmatchedSub => {
        const credits = (typeof unmatchedSub.credits === 'number' && unmatchedSub.credits > 0)
          ? unmatchedSub.credits
          : 4;
        const hours = (typeof unmatchedSub.hours === 'number' && unmatchedSub.hours > 0)
          ? unmatchedSub.hours
          : credits * 15;
        const grade = (typeof unmatchedSub.grade === 'number' && !isNaN(unmatchedSub.grade))
          ? unmatchedSub.grade
          : undefined;

        const newSub: CourseHistorySubject = {
          id: generateId('flow'),
          name: unmatchedSub.name.trim(),
          code: unmatchedSub.code ? String(unmatchedSub.code).trim() : undefined,
          credits,
          hours,
          isCompleted: unmatchedSub.isCompleted,
          grade
        };

        // Identifica se um semestre foi indicado pela IA
        let targetSemNumber: number | undefined = undefined;
        if (typeof unmatchedSub.semesterNumber === 'number' && unmatchedSub.semesterNumber > 0) {
          targetSemNumber = unmatchedSub.semesterNumber;
        } else if (typeof unmatchedSub.semester === 'number' && unmatchedSub.semester > 0) {
          targetSemNumber = unmatchedSub.semester;
        } else if (typeof unmatchedSub.semester === 'string') {
          const m = unmatchedSub.semester.match(/(\d+)/);
          if (m) targetSemNumber = parseInt(m[1], 10);
        }

        if (targetSemNumber) {
          let targetSem = updatedSemesters.find(s => s.semesterNumber === targetSemNumber);
          if (!targetSem) {
            targetSem = {
              semesterNumber: targetSemNumber,
              title: `${targetSemNumber}º Semestre`,
              subjects: []
            };
            updatedSemesters.push(targetSem);
            updatedSemesters.sort((a, b) => a.semesterNumber - b.semesterNumber);
          }
          targetSem.subjects.push(newSub);
          return;
        }

        // Semestre de extensão / disciplinas se não houver número de semestre
        let targetGroupSem = updatedSemesters.find(s => {
          const t = s.title.toLowerCase();
          if (unmatchedSub.isCompleted) {
            return t.includes('concluídas') || (t.includes('eletivas') && !t.includes('andamento'));
          } else {
            return t.includes('andamento') || t.includes('cursando');
          }
        });

        if (!targetGroupSem) {
          const maxNum = updatedSemesters.reduce((max, s) => Math.max(max, s.semesterNumber || 0), 0);
          targetGroupSem = {
            semesterNumber: maxNum + 1,
            title: unmatchedSub.isCompleted ? 'Disciplinas Concluídas / Eletivas' : 'Disciplinas em Andamento / Eletivas',
            subjects: []
          };
          updatedSemesters.push(targetGroupSem);
        }

        targetGroupSem.subjects.push(newSub);
      });
    }

    const progress = this.calculateDegreeProgress({ ...base, semesters: updatedSemesters });
    return {
      ...base,
      baselineCR,
      officialCR,
      semesters: updatedSemesters,
      completedCredits: progress.completedCredits,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Aplica o resultado JSON da IA (fluxograma) como uma nova matriz.
   * Preserva o progresso do aluno (isCompleted e grade) de disciplinas já cursadas na matriz anterior.
   */
  static applyAIParsedCurriculum(aiResult: any, existingData?: CourseProgressData): CourseProgressData {
    const base = (existingData && Array.isArray(existingData.semesters))
      ? existingData
      : DEFAULT_CURRICULUM_TEMPLATE;

    const parsedSemesters = Array.isArray(aiResult?.semesters) ? aiResult.semesters : [];
    if (parsedSemesters.length === 0) return base;

    // Coleta o histórico de disciplinas já cursadas na matriz anterior para preservar isCompleted e nota
    const existingMap = new Map<string, { isCompleted: boolean; grade?: number }>();
    if (existingData && Array.isArray(existingData.semesters)) {
      for (const sem of existingData.semesters) {
        if (sem && Array.isArray(sem.subjects)) {
          for (const sub of sem.subjects) {
            if (sub && sub.name) {
              const norm = sub.name.toLowerCase().trim();
              existingMap.set(norm, {
                isCompleted: Boolean(sub.isCompleted),
                grade: typeof sub.grade === 'number' ? sub.grade : undefined
              });
              if (sub.code) {
                existingMap.set(sub.code.toLowerCase().trim(), {
                  isCompleted: Boolean(sub.isCompleted),
                  grade: typeof sub.grade === 'number' ? sub.grade : undefined
                });
              }
            }
          }
        }
      }
    }

    const findExistingStatus = (name: string, code?: string) => {
      const norm = name.toLowerCase().trim();
      if (existingMap.has(norm)) return existingMap.get(norm);
      if (code && existingMap.has(code.toLowerCase().trim())) return existingMap.get(code.toLowerCase().trim());

      for (const [key, val] of existingMap.entries()) {
        if (this.isSubjectMatch(key, name, undefined, code)) {
          return val;
        }
      }
      return null;
    };

    const mappedSemesters: CourseSemester[] = parsedSemesters.map((sem: any, idx: number) => {
      const num = sem.semesterNumber || idx + 1;
      const subjects = Array.isArray(sem.subjects) ? sem.subjects.map((sub: any) => {
        const name = sub?.name ? String(sub.name).trim() : 'Disciplina';
        const code = sub?.code ? String(sub.code).trim() : undefined;
        const credits = typeof sub?.credits === 'number' && sub.credits > 0 ? sub.credits : 4;
        const existingStatus = findExistingStatus(name, code);

        const isCompleted = Boolean(sub?.isCompleted) || Boolean(existingStatus?.isCompleted);
        const grade = typeof sub?.grade === 'number' ? sub.grade : existingStatus?.grade;

        return {
          id: generateId('flow'),
          name,
          code,
          credits,
          hours: typeof sub?.hours === 'number' && sub.hours > 0 ? sub.hours : credits * 15,
          isCompleted,
          grade
        } as CourseHistorySubject;
      }) : [];

      return {
        semesterNumber: num,
        title: sem.title || `${num}º Semestre`,
        subjects
      };
    });

    mappedSemesters.sort((a, b) => a.semesterNumber - b.semesterNumber);

    const progress = this.calculateDegreeProgress({ ...base, semesters: mappedSemesters });
    return {
      ...base,
      semesters: mappedSemesters,
      completedCredits: progress.completedCredits,
      totalRequiredCredits: progress.totalRequiredCredits,
      lastUpdated: new Date().toISOString()
    };
  }

  // Persistence helpers
  static async loadCourseProgress(): Promise<CourseProgressData> {
    try {
      const stored = await AsyncStorage.getItem(COURSE_PROGRESS_STORAGE_KEY);
      if (stored && typeof stored === 'string' && stored.trim().length > 0 && stored.trim() !== 'null' && stored.trim() !== 'undefined') {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.semesters) && parsed.semesters.length > 0) {
          return {
            ...DEFAULT_CURRICULUM_TEMPLATE,
            ...parsed,
            semesters: parsed.semesters.filter(Boolean).map((s: any) => ({
              ...s,
              subjects: Array.isArray(s.subjects) ? s.subjects.filter(Boolean) : []
            }))
          };
        }
      }
    } catch (e) {
      console.warn('Erro ao carregar progresso do curso:', e);
    }
    return DEFAULT_CURRICULUM_TEMPLATE;
  }

  static async saveCourseProgress(data: CourseProgressData): Promise<void> {
    try {
      await AsyncStorage.setItem(COURSE_PROGRESS_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Erro ao salvar progresso do curso:', e);
    }
  }
}
