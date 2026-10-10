import { AppEvent, AttendanceRecord, Subject } from '../types';

export function filterValidAttendances(
  records: AttendanceRecord[], subjects: Subject[], events: AppEvent[],
): AttendanceRecord[] {
  const subjectMap = new Map(subjects.filter(Boolean).map(subject => [subject.id, subject]));
  const eventMap = new Map(events.filter(Boolean).map(event => [event.id, event]));
  return records.filter(record => {
    if (!record) return false;
    const subject = subjectMap.get(record.subjectId);
    if (!subject) return false;
    if (record.status !== 'pending') return true;
    const event = eventMap.get(record.eventId);
    return !subject.isArchived && !!event && event.subjectId === subject.id && event.category === 'Faculdade/Aulas';
  });
}
