import { AppEvent, AttendanceRecord, Subject } from '../types';
import { StorageService } from './storage';
import { generateId, getLocalDateString } from '../utils';
import { filterValidAttendances } from '../utils/attendanceValidity';

export const AttendanceService = {
  /**
   * Generates pending attendance records for recurring weekly classes that occurred in the past.
   * Defensively handles nullish, non-array, or corrupted inputs without throwing.
   */
  async generatePendingAttendances(
    events?: AppEvent[] | null,
    existingRecords?: AttendanceRecord[] | null,
    subjects?: Subject[] | null,
  ): Promise<AttendanceRecord[]> {
    try {
      const today = new Date();
      const todayStr = getLocalDateString(today);
      const currentMins = today.getHours() * 60 + today.getMinutes();

      const safeEvents = Array.isArray(events)
        ? events.filter((e): e is AppEvent => Boolean(e && typeof e === 'object'))
        : [];

      const subjectList = subjects === undefined ? await StorageService.getSubjects() : subjects;
      const safeSubjects = Array.isArray(subjectList) ? subjectList.filter(Boolean) : [];
      const activeSubjectIds = new Set(safeSubjects.filter(subject => !subject.isArchived).map(subject => subject.id));
      const inputRecords = Array.isArray(existingRecords)
        ? existingRecords.filter((r): r is AttendanceRecord => Boolean(r && typeof r === 'object'))
        : [];
      const safeRecords = filterValidAttendances(inputRecords, safeSubjects, safeEvents);

      const newRecords: AttendanceRecord[] = [];
      const classEvents = safeEvents.filter(
        e => e.category === 'Faculdade/Aulas' && e.recurrence === 'weekly' && !!e.subjectId && activeSubjectIds.has(e.subjectId)
      );

      // Fast lookup for existing records: Set of "eventId:date"
      const existingSet = new Set<string>();
      for (const r of safeRecords) {
        if (r && r.eventId && r.date && typeof r.eventId === 'string' && typeof r.date === 'string') {
          existingSet.add(`${r.eventId}:${r.date}`);
        }
      }

      for (const event of classEvents) {
        if (!event.id || !event.subjectId || !event.date || typeof event.date !== 'string') {
          continue;
        }

        const dateClean = event.date.split('T')[0];
        const startDate = new Date(`${dateClean}T12:00:00`);
        if (isNaN(startDate.getTime())) continue;

        const recurrenceDays = Array.isArray(event.recurrenceDays)
          ? [...new Set(event.recurrenceDays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))]
          : [];
        const targetDays = recurrenceDays.length > 0 ? recurrenceDays : [startDate.getDay()];

        for (const targetDayOfWeek of targetDays) {
          // Align each weekday to its first occurrence on or after the start date.
          const cursorDate = new Date(startDate);
          const dayDiff = (targetDayOfWeek - cursorDate.getDay() + 7) % 7;
          cursorDate.setDate(cursorDate.getDate() + dayDiff);

          // Step by 7 days directly with safety loop counter (max 520 weeks / 10 years)
          let loopSafety = 0;
          const MAX_WEEKS = 520;

          while (getLocalDateString(cursorDate) <= todayStr && loopSafety < MAX_WEEKS) {
            loopSafety++;
            const dateStr = getLocalDateString(cursorDate);

            // Check if class has finished
            let isPast = false;
            if (dateStr < todayStr) {
              isPast = true;
            } else if (dateStr === todayStr) {
              const endTimeStr = typeof event.endTime === 'string' && event.endTime.includes(':')
                ? event.endTime
                : '23:59';
              const parts = endTimeStr.split(':').map(Number);
              const endH = Number.isFinite(parts[0]) ? parts[0] : 23;
              const endM = Number.isFinite(parts[1]) ? parts[1] : 59;
              if (endH * 60 + endM < currentMins) {
                isPast = true;
              }
            }

            if (isPast) {
              const key = `${event.id}:${dateStr}`;
              if (!existingSet.has(key)) {
                existingSet.add(key); // prevent duplicates in the same pass
                newRecords.push({
                  id: generateId('att'),
                  subjectId: event.subjectId,
                  eventId: event.id,
                  date: dateStr,
                  status: 'pending'
                });
              }
            }

            // Advance exactly 1 week (7 days)
            cursorDate.setDate(cursorDate.getDate() + 7);
          }
        }
      }

      if (newRecords.length > 0 || safeRecords.length !== inputRecords.length) {
        const updatedRecords = [...safeRecords, ...newRecords];
        try {
          // Re-check persisted subjects/events inside the write queue: deletion
          // or a cloud restore may have happened while records were generated.
          return await StorageService.reconcileAttendances(updatedRecords);
        } catch (saveError) {
          console.warn('AttendanceService: Failed to persist generated attendances', saveError);
          return [];
        }
      }

      return safeRecords;
    } catch (err) {
      console.warn('AttendanceService.generatePendingAttendances caught unexpected error:', err);
      return [];
    }
  }
};
