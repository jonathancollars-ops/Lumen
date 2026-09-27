import { AppEvent } from '../types';

export interface BusyScheduleBlock {
  type: 'busy';
  id: string;
  eventId?: string;
  subjectId?: string;
  title: string;
  startTime: string; // '08:00'
  endTime: string;   // '10:00'
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  location?: string;
  category?: string;
  isCompleted?: boolean;
  event?: AppEvent;
}

export interface FreeScheduleBlock {
  type: 'free';
  id: string;
  startTime: string; // '10:00'
  endTime: string;   // '13:30'
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  durationFormatted: string; // '3h 30m'
  suggestedSubjectId?: string;
}

export type ScheduleTimelineBlock = BusyScheduleBlock | FreeScheduleBlock;

export interface DayScheduleSummary {
  totalOccupiedMinutes: number;
  totalFreeMinutes: number;
  totalOccupiedFormatted: string; // ex: '3h 30m'
  totalFreeFormatted: string;     // ex: '5h 00m'
  blocks: ScheduleTimelineBlock[];
  busyBlocks: BusyScheduleBlock[];
  freeBlocks: FreeScheduleBlock[];
}

export interface CalculateDayScheduleOptions {
  dayStartMinutes?: number; // Padrão: 07:00 (420)
  dayEndMinutes?: number;   // Padrão: 22:00 (1320)
  minFreeWindowMinutes?: number; // Padrão: 15
}

export const STUDY_DAY_START_HOUR = 7;
export const STUDY_DAY_END_HOUR = 22;
export const MIN_FREE_WINDOW_MINUTES = 15;

/**
 * Converte string 'HH:mm' para total de minutos desde a meia-noite (0 - 1439).
 * Totalmente defensivo contra strings nulas, indefinidas ou malformadas.
 */
export function timeToMinutes(timeStr?: string | null): number {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const parts = timeStr.trim().split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const safeH = isNaN(h) ? 0 : Math.max(0, Math.min(23, h));
  const safeM = isNaN(m) ? 0 : Math.max(0, Math.min(59, m));
  return safeH * 60 + safeM;
}

/**
 * Converte total de minutos em string formatada 'HH:mm'.
 */
export function minutesToTime(mins: number): string {
  if (isNaN(mins)) return '00:00';
  const clamped = Math.max(0, Math.min(24 * 60 - 1, mins));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Formata duração em minutos para o padrão legível:
 * - Se 0: '0h 00m'
 * - Se >= 60: 'Xh Ym' (ex: '3h 30m', '5h 00m')
 * - Se < 60: 'Ym' (ex: '45m', '15m')
 */
export function formatDuration(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(isNaN(minutes) ? 0 : minutes));
  if (safeMinutes === 0) return '0h 00m';

  const h = Math.floor(safeMinutes / 60);
  const m = safeMinutes % 60;

  if (h === 0) {
    return `${m}m`;
  }
  const formattedMinutes = m < 10 ? `0${m}` : `${m}`;
  return `${h}h ${formattedMinutes}m`;
}

/**
 * Motor de cálculo de cronograma diário:
 * Analisa os eventos do dia, identifica blocos ocupados e calcula intervalos
 * livres no período útil do estudante (07:00 às 22:00) com duração >= 15 min.
 */
export function calculateDaySchedule(
  events: AppEvent[],
  options?: CalculateDayScheduleOptions
): DayScheduleSummary {
  const windowStart = options?.dayStartMinutes ?? STUDY_DAY_START_HOUR * 60; // 07:00 (420)
  const windowEnd = options?.dayEndMinutes ?? STUDY_DAY_END_HOUR * 60;     // 22:00 (1320)
  const minFreeWindow = options?.minFreeWindowMinutes ?? MIN_FREE_WINDOW_MINUTES; // 15

  // 1. Filtrar eventos válidos e ordenar por horário de início
  const validEvents = (Array.isArray(events) ? events : []).filter(e => Boolean(e));

  const sortedEvents = [...validEvents].sort((a, b) => {
    return timeToMinutes(a.startTime || '08:00') - timeToMinutes(b.startTime || '08:00');
  });

  // 2. Mapear blocos ocupados
  const busyBlocks: BusyScheduleBlock[] = [];
  for (const evt of sortedEvents) {
    const startTimeStr = evt.startTime || '08:00';
    const startMins = timeToMinutes(startTimeStr);
    let endMins = evt.endTime ? timeToMinutes(evt.endTime) : startMins + 60;
    if (endMins <= startMins) {
      endMins += 24 * 60;
    }
    const endTimeStr = evt.endTime || minutesToTime(endMins);
    const duration = endMins - startMins;

    busyBlocks.push({
      type: 'busy',
      id: `busy_${evt.id}`,
      eventId: evt.id,
      subjectId: evt.subjectId,
      title: evt.title || 'Compromisso',
      startTime: startTimeStr,
      endTime: endTimeStr,
      startMinutes: startMins,
      endMinutes: endMins,
      durationMinutes: duration,
      location: evt.location,
      category: evt.category,
      isCompleted: evt.isCompleted,
      event: evt,
    });
  }

  // 3. Mesclar intervalos ocupados dentro da janela útil [windowStart, windowEnd]
  const clampedIntervals: { start: number; end: number }[] = [];
  for (const block of busyBlocks) {
    const s = Math.max(windowStart, Math.min(windowEnd, block.startMinutes));
    const e = Math.max(windowStart, Math.min(windowEnd, block.endMinutes));
    if (e > s) {
      clampedIntervals.push({ start: s, end: e });
    }
  }

  clampedIntervals.sort((a, b) => a.start - b.start);
  const mergedIntervals: { start: number; end: number }[] = [];
  for (const cur of clampedIntervals) {
    if (mergedIntervals.length === 0) {
      mergedIntervals.push({ ...cur });
    } else {
      const prev = mergedIntervals[mergedIntervals.length - 1];
      if (cur.start <= prev.end) {
        prev.end = Math.max(prev.end, cur.end);
      } else {
        mergedIntervals.push({ ...cur });
      }
    }
  }

  // Total de minutos ocupados dentro da janela útil
  let totalOccupiedMinutes = 0;
  for (const interval of mergedIntervals) {
    totalOccupiedMinutes += (interval.end - interval.start);
  }

  // 4. Calcular blocos de tempo livre a partir dos intervalos entre os períodos ocupados
  const freeBlocks: FreeScheduleBlock[] = [];
  let cursor = windowStart;

  for (const interval of mergedIntervals) {
    if (interval.start > cursor) {
      const gapDuration = interval.start - cursor;
      if (gapDuration >= minFreeWindow) {
        const startStr = minutesToTime(cursor);
        const endStr = minutesToTime(interval.start);
        freeBlocks.push({
          type: 'free',
          id: `free_${cursor}_${interval.start}`,
          startTime: startStr,
          endTime: endStr,
          startMinutes: cursor,
          endMinutes: interval.start,
          durationMinutes: gapDuration,
          durationFormatted: formatDuration(gapDuration),
        });
      }
    }
    cursor = Math.max(cursor, interval.end);
  }

  // Janela livre final até as 22:00
  if (cursor < windowEnd) {
    const trailingGap = windowEnd - cursor;
    if (trailingGap >= minFreeWindow) {
      const startStr = minutesToTime(cursor);
      const endStr = minutesToTime(windowEnd);
      freeBlocks.push({
        type: 'free',
        id: `free_${cursor}_${windowEnd}`,
        startTime: startStr,
        endTime: endStr,
        startMinutes: cursor,
        endMinutes: windowEnd,
        durationMinutes: trailingGap,
        durationFormatted: formatDuration(trailingGap),
      });
    }
  }

  const totalFreeMinutes = freeBlocks.reduce((acc, b) => acc + b.durationMinutes, 0);

  // 5. Construir a linha do tempo cronológica combinada
  const combinedBlocks: ScheduleTimelineBlock[] = [];
  let freeIdx = 0;
  let busyIdx = 0;

  while (freeIdx < freeBlocks.length || busyIdx < busyBlocks.length) {
    const currentFree = freeBlocks[freeIdx];
    const currentBusy = busyBlocks[busyIdx];

    if (currentFree && currentBusy) {
      if (currentFree.startMinutes <= currentBusy.startMinutes) {
        currentFree.suggestedSubjectId = currentBusy.subjectId;
        combinedBlocks.push(currentFree);
        freeIdx++;
      } else {
        combinedBlocks.push(currentBusy);
        busyIdx++;
      }
    } else if (currentFree) {
      const prevBusy = busyBlocks[busyBlocks.length - 1];
      if (prevBusy) {
        currentFree.suggestedSubjectId = prevBusy.subjectId;
      }
      combinedBlocks.push(currentFree);
      freeIdx++;
    } else if (currentBusy) {
      combinedBlocks.push(currentBusy);
      busyIdx++;
    }
  }

  return {
    totalOccupiedMinutes,
    totalFreeMinutes,
    totalOccupiedFormatted: formatDuration(totalOccupiedMinutes),
    totalFreeFormatted: formatDuration(totalFreeMinutes),
    blocks: combinedBlocks,
    busyBlocks,
    freeBlocks,
  };
}
