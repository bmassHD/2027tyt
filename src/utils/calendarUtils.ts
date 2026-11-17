import { VaccinationScheduleItem } from '../types';
import { formatVaccinationDateRange } from '../services/firebaseService';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatUtcTimestamp(date: Date): string {
  return (
    date.getUTCFullYear() +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    'T' +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds()) +
    'Z'
  );
}

/**
 * Convert a local Vietnam time (UTC+7:00) YYYY-MM-DD + HH:MM into UTC YYYYMMDDTHHMMSSZ
 * so device Calendar apps (iOS, Android, Google, macOS, Outlook) place the event at the exact local hour regardless of DST.
 */
function vnLocalToUtcIcs(dateStr: string, hour: number, minute: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utcMs = Date.UTC(y, (m || 1) - 1, d || 1, hour - 7, minute, 0);
  return formatUtcTimestamp(new Date(utcMs));
}

function addOneDayIso(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1));
  return next.toISOString().split('T')[0];
}

function parseScheduleTimes(item: Pick<VaccinationScheduleItem, 'timeRange' | 'startTime' | 'endTime'>): {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
} {
  const fallback = { startHour: 7, startMinute: 30, endHour: 11, endMinute: 30 };

  let sh = fallback.startHour;
  let sm = fallback.startMinute;
  let eh = fallback.endHour;
  let em = fallback.endMinute;
  let parsedFromRange = false;

  if (item.timeRange) {
    const matches = Array.from(item.timeRange.matchAll(/(\d{1,2})[:hH](\d{2})/g));
    if (matches.length > 0) {
      const first = matches[0];
      const last = matches[matches.length - 1];
      sh = Math.min(23, Math.max(0, Number(first[1])));
      sm = Math.min(59, Math.max(0, Number(first[2])));
      eh = Math.min(23, Math.max(0, Number(last[1])));
      em = Math.min(59, Math.max(0, Number(last[2])));
      if (matches.length === 1 || eh < sh || (eh === sh && em <= sm)) {
        eh = Math.min(23, sh + 3);
        em = sm;
      }
      parsedFromRange = true;
    }
  }

  if (item.startTime && /^\d{1,2}:\d{2}$/.test(item.startTime.trim())) {
    const [h, m] = item.startTime.trim().split(':').map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      sh = Math.min(23, Math.max(0, h));
      sm = Math.min(59, Math.max(0, m));
      if (!parsedFromRange && !item.endTime) {
        eh = Math.min(23, sh + 3);
        em = sm;
      }
    }
  }

  if (item.endTime && /^\d{1,2}:\d{2}$/.test(item.endTime.trim())) {
    const [h, m] = item.endTime.trim().split(':').map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      eh = Math.min(23, Math.max(0, h));
      em = Math.min(59, Math.max(0, m));
    }
  }

  return { startHour: sh, startMinute: sm, endHour: eh, endMinute: em };
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function buildDescription(item: VaccinationScheduleItem, stationName?: string): string {
  const secondaryText =
    item.secondaryLocations && item.secondaryLocations.length > 0
      ? item.secondaryLocations.filter(s => s && s.trim()).join('; ')
      : '';
  const timeText =
    item.timeRange?.trim() ||
    (item.startTime && item.endTime ? `${item.startTime} - ${item.endTime}` : '07:30 - 11:00');
  const lines = [
    stationName ? `Đơn vị tổ chức: ${stationName}` : '',
    `Thời gian: ${formatVaccinationDateRange(item)} (${timeText})`,
    `Điểm tiêm chính: ${item.location}`,
    secondaryText ? `Điểm tiêm phụ: ${secondaryText}` : '',
    `Đối tượng tiêm: ${item.targetAudience}`,
    `Danh mục vắc xin: ${item.vaccines}`,
    item.notes ? `Lưu ý: ${item.notes}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

export function buildVaccinationIcsContent(
  item: VaccinationScheduleItem,
  stationName?: string
): string {
  const startDate = item.date || new Date().toISOString().split('T')[0];
  const endDate = item.endDate && item.endDate >= startDate ? item.endDate : startDate;
  const isMultiDay = endDate > startDate;
  const times = parseScheduleTimes(item);
  const dtStamp = formatUtcTimestamp(new Date());
  const uid = `${item.id || 'vac'}-${startDate}@tramyte.portal`;
  const description = buildDescription(item, stationName);

  // For multi-day range, generate daily-timed or all-day span properly:
  // Using timed event from startDate startHour to endDate endHour (or daily recurrence across the range)
  let dtStartLine: string;
  let dtEndLine: string;
  let rruleLine = '';

  if (isMultiDay) {
    // Timed daily event recurring each day from startDate to endDate!
    const dayCount =
      Math.round(
        (Date.parse(endDate + 'T00:00:00Z') - Date.parse(startDate + 'T00:00:00Z')) /
          86_400_000
      ) + 1;
    dtStartLine = `DTSTART:${vnLocalToUtcIcs(startDate, times.startHour, times.startMinute)}`;
    dtEndLine = `DTEND:${vnLocalToUtcIcs(startDate, times.endHour, times.endMinute)}`;
    if (dayCount > 1 && dayCount <= 60) {
      rruleLine = `RRULE:FREQ=DAILY;COUNT=${dayCount}`;
    } else {
      // Fallback for >60 days: all-day spanning event
      dtStartLine = `DTSTART;VALUE=DATE:${startDate.replace(/-/g, '')}`;
      dtEndLine = `DTEND;VALUE=DATE:${addOneDayIso(endDate).replace(/-/g, '')}`;
    }
  } else {
    dtStartLine = `DTSTART:${vnLocalToUtcIcs(startDate, times.startHour, times.startMinute)}`;
    dtEndLine = `DTEND:${vnLocalToUtcIcs(startDate, times.endHour, times.endMinute)}`;
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tram Y Te//Cong Thong Tin Dien Tu//VI',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    dtStartLine,
    dtEndLine,
    ...(rruleLine ? [rruleLine] : []),
    `SUMMARY:${escapeIcsText(item.title)}`,
    `LOCATION:${escapeIcsText(item.location)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT12H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(`Nhắc lịch: ${item.title}`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.join('\r\n');
}

export function downloadVaccinationIcs(
  item: VaccinationScheduleItem,
  stationName?: string
): void {
  const icsContent = buildVaccinationIcsContent(item, stationName);
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeSlug = (item.date || 'lich-tiem-chung').replace(/[^a-zA-Z0-9_-]/g, '');
  link.href = url;
  link.download = `lich-tiem-chung-${safeSlug}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function buildGoogleCalendarUrl(
  item: VaccinationScheduleItem,
  stationName?: string
): string {
  const startDate = item.date || new Date().toISOString().split('T')[0];
  const endDate = item.endDate && item.endDate >= startDate ? item.endDate : startDate;
  const times = parseScheduleTimes(item);

  const startUtc = vnLocalToUtcIcs(startDate, times.startHour, times.startMinute);
  const endUtc = vnLocalToUtcIcs(startDate, times.endHour, times.endMinute);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: item.title,
    dates: `${startUtc}/${endUtc}`,
    location: item.location,
    details: buildDescription(item, stationName),
  });

  if (endDate > startDate) {
    const dayCount =
      Math.round(
        (Date.parse(endDate + 'T00:00:00Z') - Date.parse(startDate + 'T00:00:00Z')) /
          86_400_000
      ) + 1;
    if (dayCount > 1 && dayCount <= 60) {
      params.set('recur', `RRULE:FREQ=DAILY;COUNT=${dayCount}`);
    }
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
