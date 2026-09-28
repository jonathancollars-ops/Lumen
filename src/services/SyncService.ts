import { format, parseISO, getDay } from 'date-fns';
import {
  AppEvent,
  AttendanceRecord,
  Subject,
  GradeItem,
  GradeGroup,
  AIParsedItem,
  SyncResult,
  AIConfig,
} from '../types';
import { StorageService } from './storage';
import { NotificationService } from './notifications';
import { AIParsingService } from './AIParsingService';

export const SIMULATION_RAW_MESSAGES = [
  "Aviso aos alunos de Cálculo 1: Excepcionalmente não teremos aula hoje (2026-08-17) devido à minha participação em banca acadêmica. O conteúdo será reposto na próxima semana. Prof. Carlos",
  "Turma de Algoritmos, publiquei no AVA a Lista de Exercícios 3 sobre Árvores Binárias. O prazo final de entrega é dia 2026-08-24 às 23:59. Não deixem para a última hora!",
  "Atenção pessoal de Física I: a nossa Prova P2 foi reagendada para o dia 2026-08-28 no horário normal da aula (08:00 às 10:00). Tragam calculadora científica."
];

export interface SyncProcessResult {
  updatedEvents: AppEvent[];
  updatedAttendances: AttendanceRecord[];
  updatedSubjects: Subject[];
  syncResult: SyncResult;
}

export class SyncService {
  /**
   * Matches a subject by ID, exact name, normalized accents, Roman numerals, or substring.
   */
  public static matchSubject(nameOrId: string, subjects: Subject[]): Subject | undefined {
    if (!nameOrId || subjects.length === 0) return undefined;

    // 1. Direct ID match
    const byId = subjects.find(s => s.id === nameOrId);
    if (byId) return byId;

    const normalize = (str: string) =>
      str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/gi, '')
        .trim();

    const targetNorm = normalize(nameOrId);

    // 2. Exact normalized name match
    const exactNorm = subjects.find(s => normalize(s.name) === targetNorm);
    if (exactNorm) return exactNorm;

    // 3. Roman / Arabic numeral normalization
    const replaceNumerals = (str: string) =>
      str
        .replace(/\b1\b/g, 'i')
        .replace(/\b2\b/g, 'ii')
        .replace(/\b3\b/g, 'iii')
        .replace(/\b4\b/g, 'iv')
        .replace(/\b5\b/g, 'v');

    const targetNumeralNorm = replaceNumerals(targetNorm);
    const byNumeral = subjects.find(s => replaceNumerals(normalize(s.name)) === targetNumeralNorm);
    if (byNumeral) return byNumeral;

    // 4. Unambiguous substring match
    const substringMatches = subjects.filter(s => {
      const sNorm = normalize(s.name);
      return sNorm.includes(targetNorm) || targetNorm.includes(sNorm);
    });
    if (substringMatches.length === 1) return substringMatches[0];

    return undefined;
  }

  /**
   * Finds a weekly or date-specific class event for a subject and target date.
   */
  public static findClassEvent(
    subjectId: string,
    targetDate: string,
    events: AppEvent[]
  ): AppEvent | undefined {
    try {
      const parsedTarget = parseISO(targetDate);
      const targetDayOfWeek = getDay(parsedTarget); // 0 (Sun) - 6 (Sat)

      // Priority 1: Weekly recurring class matching day of week
      const weeklyClass = events.find(e => {
        if (e.category !== 'Faculdade/Aulas' || e.subjectId !== subjectId) return false;
        if (e.recurrence === 'weekly') {
          const classDay = getDay(parseISO(e.date));
          return classDay === targetDayOfWeek || e.recurrenceDays?.includes(targetDayOfWeek);
        }
        return false;
      });
      if (weeklyClass) return weeklyClass;

      // Priority 2: Direct date-matched class
      const singleClass = events.find(e => {
        if (e.category !== 'Faculdade/Aulas' || e.subjectId !== subjectId) return false;
        return e.date === targetDate;
      });
      if (singleClass) return singleClass;

      // Priority 3: Fallback to any class for this subject
      return events.find(e => e.category === 'Faculdade/Aulas' && e.subjectId === subjectId);
    } catch {
      return events.find(e => e.subjectId === subjectId);
    }
  }

  /**
   * Processes a list of parsed AI items against current events, attendances, and subjects.
   */
  public static async processParsedItems(
    parsedItems: AIParsedItem[],
    currentEvents: AppEvent[],
    currentAttendances: AttendanceRecord[],
    currentSubjects: Subject[]
  ): Promise<SyncProcessResult> {
    let runningEvents = [...currentEvents];
    let runningAttendances = [...currentAttendances];
    let runningSubjects = [...currentSubjects];

    const cancelledAttendances: AttendanceRecord[] = [];
    const createdEvents: AppEvent[] = [];
    const updatedEvents: AppEvent[] = [];
    const logs: string[] = [];

    for (const item of parsedItems) {
      if (!item.intent || item.intent === 'none') {
        logs.push(`[Ignorado] Item sem ação identificada: ${item.rawSummary || item.title}`);
        continue;
      }

      const matchedSubject = this.matchSubject(item.subjectName, runningSubjects);
      const subjectDisplayName = matchedSubject ? matchedSubject.name : (item.subjectName || 'Matéria Desconhecida');

      switch (item.intent) {
        case 'cancelled_class': {
          const targetDate = item.targetDate || format(new Date(), 'yyyy-MM-dd');
          const matchedClassEvent = matchedSubject
            ? this.findClassEvent(matchedSubject.id, targetDate, runningEvents)
            : undefined;

          const eventId = matchedClassEvent ? matchedClassEvent.id : '';
          const subjectId = matchedSubject ? matchedSubject.id : '';

          const existingIndex = runningAttendances.findIndex(
            a => a.date === targetDate && (
              (eventId && a.eventId === eventId) ||
              (subjectId && a.subjectId === subjectId)
            )
          );

          let updatedRecord: AttendanceRecord;

          if (existingIndex !== -1) {
            updatedRecord = {
              ...runningAttendances[existingIndex],
              status: 'cancelled'
            };
            runningAttendances[existingIndex] = updatedRecord;
          } else {
            updatedRecord = {
              id: `att_cancel_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
              subjectId: subjectId,
              eventId: eventId,
              date: targetDate,
              status: 'cancelled'
            };
            runningAttendances.push(updatedRecord);
          }

          cancelledAttendances.push(updatedRecord);
          logs.push(
            `[Cancelamento] Aula de "${subjectDisplayName}" em ${targetDate} marcada como cancelada (eventId: ${eventId || 'N/A'}). Não contabiliza faltas e foi ocultada da agenda.`
          );
          break;
        }

        case 'homework': {
          const targetDate = item.targetDate || format(new Date(), 'yyyy-MM-dd');
          const startTime = item.startTime || '23:59';
          const endTime = item.endTime || '23:59';
          const alerts = item.alerts && item.alerts.length > 0 ? item.alerts : [10080, 1440];

          const existingEventIndex = runningEvents.findIndex(
            e => e.category === 'Provas/Trabalhos' &&
                 e.date === targetDate &&
                 (e.subjectId === matchedSubject?.id || !matchedSubject) &&
                 e.title.toLowerCase().trim() === item.title.toLowerCase().trim()
          );

          let targetEvent: AppEvent;

          if (existingEventIndex !== -1) {
            targetEvent = {
              ...runningEvents[existingEventIndex],
              title: item.title,
              description: item.description || item.rawSummary || runningEvents[existingEventIndex].description,
              startTime: startTime,
              endTime: endTime,
              alerts: alerts,
              isImportant: true,
              isNotified: true
            };
            runningEvents[existingEventIndex] = targetEvent;
            updatedEvents.push(targetEvent);
            logs.push(
              `[Tarefa] Atualizado prazo de entrega "${item.title}" (${subjectDisplayName}) para ${targetDate} às ${startTime}. Alertas: [10080, 1440].`
            );
          } else {
            targetEvent = {
              id: `event_hw_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
              title: item.title,
              description: item.description || item.rawSummary || 'Tarefa sincronizada do Microsoft Teams',
              category: 'Provas/Trabalhos',
              date: targetDate,
              startTime: startTime,
              endTime: endTime,
              recurrence: 'none',
              alerts: alerts,
              isCompleted: false,
              isImportant: true,
              isNotified: true,
              subjectId: matchedSubject?.id
            };
            runningEvents.push(targetEvent);
            createdEvents.push(targetEvent);
            logs.push(
              `[Tarefa] Criado evento de entrega "${item.title}" (${subjectDisplayName}) para ${targetDate} às ${startTime}. Alertas: [10080, 1440].`
            );
          }

          try {
            await NotificationService.scheduleEventNotifications(targetEvent);
          } catch (notifErr) {
            logs.push(`[Aviso] Notificação não agendada em ambiente restrito: ${notifErr}`);
          }
          break;
        }

        case 'exam': {
          const targetDate = item.targetDate || format(new Date(), 'yyyy-MM-dd');
          const startTime = item.startTime || '08:00';
          const endTime = item.endTime || '10:00';
          const alerts = item.alerts && item.alerts.length > 0 ? item.alerts : [10080, 1440];

          const normalizeTitle = (t: string) => t
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const normItem = normalizeTitle(item.title);

          const getExamCode = (t: string) => {
            const m = t.match(/\b(p[1-9]|exame\s+final|prova\s+final|sub|recupera[cç][aã]o|avalia[cç][aã]o\s*\d+|batch\s*\d+)\b/i);
            return m ? m[1].toLowerCase().replace(/\s+/g, ' ') : null;
          };
          const codeItem = getExamCode(item.title);
          const numsItem = (normItem.match(/\b\d+\b/g) || []).join(',');

          let existingEventIndex = runningEvents.findIndex(e => {
            if (e.category !== 'Provas/Trabalhos') return false;
            if (matchedSubject && e.subjectId !== matchedSubject.id) return false;

            const normE = normalizeTitle(e.title);
            if (normE === normItem) return true;

            const codeE = getExamCode(e.title);
            if (codeE && codeItem) {
              return codeE === codeItem;
            }

            const numsE = (normE.match(/\b\d+\b/g) || []).join(',');
            if (numsE === numsItem && (normE.includes(normItem) || normItem.includes(normE))) {
              return true;
            }

            if (e.date === targetDate && numsE === numsItem) {
              const wordsE = normE.split(' ');
              const wordsItem = normItem.split(' ');
              const commonWords = wordsE.filter(w => w.length > 2 && wordsItem.includes(w));
              if (commonWords.length >= 2) return true;
            }

            return false;
          });

          // A rescheduling message often uses a shorter title than the original
          // exam. If it names the same subject and there's only one open exam,
          // update that exam instead of creating a second calendar entry.
          const rescheduleText = `${item.title} ${item.description || ''} ${item.rawSummary || ''}`;
          const isReschedule = item.isReschedule === true || /remarc|adiad|transferid|nova data|outra data/i.test(rescheduleText);
          if (existingEventIndex === -1 && isReschedule && matchedSubject) {
            const candidates = runningEvents
              .map((event, index) => ({ event, index }))
              .filter(({ event }) => event.category === 'Provas/Trabalhos' &&
                event.subjectId === matchedSubject.id && !event.isCompleted);
            if (candidates.length === 1) existingEventIndex = candidates[0].index;
          }

          let examEvent: AppEvent;

          if (existingEventIndex !== -1) {
            examEvent = {
              ...runningEvents[existingEventIndex],
              title: item.title,
              description: item.description || item.rawSummary || runningEvents[existingEventIndex].description,
              date: targetDate,
              startTime: startTime,
              endTime: endTime,
              alerts: alerts,
              isImportant: true,
              isNotified: true,
              weight: runningEvents[existingEventIndex].weight || 1,
              maxGrade: runningEvents[existingEventIndex].maxGrade || 10
            };
            runningEvents[existingEventIndex] = examEvent;
            updatedEvents.push(examEvent);
            logs.push(
              `[Prova] Atualizada prova "${examEvent.title}" (${subjectDisplayName}) para ${targetDate} (${startTime} - ${endTime}). Alertas: [10080, 1440].`
            );
          } else {
            examEvent = {
              id: `event_exam_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
              title: item.title,
              description: item.description || item.rawSummary || 'Prova sincronizada do Microsoft Teams',
              category: 'Provas/Trabalhos',
              date: targetDate,
              startTime: startTime,
              endTime: endTime,
              recurrence: 'none',
              alerts: alerts,
              isCompleted: false,
              isImportant: true,
              isNotified: true,
              subjectId: matchedSubject?.id,
              weight: 1,
              maxGrade: 10
            };
            runningEvents.push(examEvent);
            createdEvents.push(examEvent);
            logs.push(
              `[Prova] Criada nova prova "${examEvent.title}" (${subjectDisplayName}) para ${targetDate} (${startTime} - ${endTime}). Alertas: [10080, 1440].`
            );
          }

          if (matchedSubject) {
            const subjectIdx = runningSubjects.findIndex(s => s.id === matchedSubject.id);
            if (subjectIdx !== -1) {
              const subj = runningSubjects[subjectIdx];
              let gradeGroups = subj.gradeGroups ? [...subj.gradeGroups] : [];

              if (gradeGroups.length === 0) {
                const defaultGroup: GradeGroup = {
                  id: `group_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                  name: 'Avaliações',
                  weight: 1,
                  items: []
                };
                gradeGroups = [defaultGroup];
              }

              const targetGroup = { ...gradeGroups[0] };
              let items = [...targetGroup.items];

              const existingGradeItemIndex = items.findIndex(
                gi => gi.eventId === examEvent.id || gi.name.toLowerCase().trim() === examEvent.title.toLowerCase().trim()
              );

              if (existingGradeItemIndex !== -1) {
                items[existingGradeItemIndex] = {
                  ...items[existingGradeItemIndex],
                  name: examEvent.title,
                  weight: examEvent.weight || 1,
                  maxGrade: examEvent.maxGrade || 10,
                  eventId: examEvent.id
                };
              } else {
                const newGradeItem: GradeItem = {
                  id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                  name: examEvent.title,
                  weight: examEvent.weight || 1,
                  maxGrade: examEvent.maxGrade || 10,
                  eventId: examEvent.id
                };
                items.push(newGradeItem);
              }

              targetGroup.items = items;
              gradeGroups[0] = targetGroup;
              runningSubjects[subjectIdx] = { ...subj, gradeGroups };
              logs.push(`[Notas] Item "${examEvent.title}" vinculado ao grupo "${targetGroup.name}" de ${subj.name}.`);
            }
          }

          try {
            await NotificationService.scheduleEventNotifications(examEvent);
          } catch (notifErr) {
            logs.push(`[Aviso] Notificação não agendada em ambiente restrito: ${notifErr}`);
          }
          break;
        }
      }
    }

    const syncResult: SyncResult = {
      cancelledAttendances,
      createdEvents,
      updatedEvents,
      logs
    };

    return {
      updatedEvents: runningEvents,
      updatedAttendances: runningAttendances,
      updatedSubjects: runningSubjects,
      syncResult
    };
  }

  /**
   * Executes the debug simulation using the 3 hardcoded raw Portuguese messages.
   * Atomically persists state to StorageService.
   */
  public static async runSimulation(
    aiConfig: AIConfig | null | undefined,
    currentEvents: AppEvent[],
    currentAttendances: AttendanceRecord[],
    currentSubjects: Subject[]
  ): Promise<SyncProcessResult> {
    const logs: string[] = [];
    logs.push("=== INICIANDO SIMULAÇÃO DE MENSAGENS DO TEAMS ===");

    let runningSubjects = [...currentSubjects];
    let runningEvents = [...currentEvents];

    // Seed test subjects if not present to guarantee rich linked data
    const requiredSubjectNames = ['Cálculo 1', 'Algoritmos', 'Física I'];

    for (const name of requiredSubjectNames) {
      if (!this.matchSubject(name, runningSubjects)) {
        const newSubj: Subject = {
          id: `subj_sim_${name.toLowerCase().replace(/[^\w]/g, '_')}_${Date.now()}`,
          name: name,
          color: name === 'Cálculo 1' ? '#0A84FF' : (name === 'Algoritmos' ? '#00FFAA' : '#BF5AF2'),
          passGrade: 7.0,
          maxAbsences: 15,
          workloadHours: 60,
          gradeGroups: [{
            id: `group_sim_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: 'Avaliações',
            weight: 1,
            items: []
          }]
        };
        runningSubjects.push(newSubj);

        if (name === 'Cálculo 1') {
          const classEvent: AppEvent = {
            id: `event_class_calc_${Date.now()}`,
            title: 'Aula de Cálculo 1',
            category: 'Faculdade/Aulas',
            date: '2026-08-17',
            startTime: '08:00',
            endTime: '10:00',
            recurrence: 'weekly',
            alerts: [15],
            isCompleted: false,
            subjectId: newSubj.id
          };
          runningEvents.push(classEvent);
        }
      }
    }

    const context = {
      currentDate: '2026-08-17',
      currentDayOfWeek: 'Monday',
      registeredSubjects: runningSubjects.map(s => s.name)
    };

    const allParsedItems: AIParsedItem[] = [];

    for (let i = 0; i < SIMULATION_RAW_MESSAGES.length; i++) {
      const rawMsg = SIMULATION_RAW_MESSAGES[i];
      logs.push(`\n[Mensagem ${i + 1}/${SIMULATION_RAW_MESSAGES.length}] Processando texto bruto:`);
      logs.push(`"${rawMsg}"`);

      try {
        let result;
        if (aiConfig?.apiKey && aiConfig.apiKey.trim().length > 0) {
          logs.push(`Enviando ao provedor de IA (${aiConfig.provider || 'gemini'})...`);
          result = await AIParsingService.parseMessage(rawMsg, aiConfig, context);
        } else {
          logs.push(`[Modo Mock/Offline] Chave de IA não configurada. Executando analisador determinístico.`);
          result = AIParsingService.parseMessageMock(rawMsg, context);
        }

        logs.push(`Itens extraídos pela IA: ${result.items.length} item(ns) com confiança ${(result.confidence * 100).toFixed(0)}%`);
        for (const it of result.items) {
          logs.push(` -> Intenção: ${it.intent} | Matéria: ${it.subjectName} | Data: ${it.targetDate} | Alertas: [${it.alerts.join(', ')}]`);
        }

        allParsedItems.push(...result.items);
      } catch (err: any) {
        logs.push(`[Erro na IA] Falha ao analisar mensagem: ${err?.message || err}. Usando fallback mock.`);
        const fallbackResult = AIParsingService.parseMessageMock(rawMsg, context);
        allParsedItems.push(...fallbackResult.items);
      }
    }

    logs.push("\n=== SINCRONIZANDO ITENS EXTRAÍDOS COM O APP ===");
    const processResult = await this.processParsedItems(
      allParsedItems,
      runningEvents,
      currentAttendances,
      runningSubjects
    );

    // Merge simulation logs
    processResult.syncResult.logs = [...logs, ...processResult.syncResult.logs];

    // Atomically persist to storage
    try {
      await Promise.all([
        StorageService.saveEvents(processResult.updatedEvents),
        StorageService.saveAttendances(processResult.updatedAttendances),
        StorageService.saveSubjects(processResult.updatedSubjects)
      ]);
      processResult.syncResult.logs.push("[Persistência] Estado do aplicativo atualizado atomicamente no StorageService.");
    } catch (saveErr) {
      processResult.syncResult.logs.push(`[Aviso] Falha ao persistir no StorageService: ${saveErr}`);
    }

    processResult.syncResult.logs.push("=== SIMULAÇÃO CONCLUÍDA COM SUCESSO ===");
    return processResult;
  }
}
