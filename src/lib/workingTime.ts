/**
 * Working Calendar Normalization Utility (Client-side version)
 * 
 * Mirrors the server-side implementation for consistent calculations.
 * Used for drill-down displays and filtering.
 */

// UTC+3 offset in milliseconds
const UTC_PLUS_3_OFFSET_MS = 3 * 60 * 60 * 1000;

// Working hours in local time (UTC+3)
const WORK_START_HOUR = 9;  // 09:00
const WORK_END_HOUR = 18;   // 18:00

/**
 * Fixed holidays (month-day format)
 */
const FIXED_HOLIDAYS = new Set([
  "12-31", "01-01", "01-02", "01-03", "01-04", "01-05", "01-06", "01-07", "01-08",
  "02-23",
  "03-08",
  "05-01",
  "05-09",
  "06-12",
  "11-04",
]);

function toMoscowTime(utcDate: Date): Date {
  return new Date(utcDate.getTime() + UTC_PLUS_3_OFFSET_MS);
}

function isWeekend(moscowDate: Date): boolean {
  const day = moscowDate.getUTCDay();
  return day === 0 || day === 6;
}

function isHoliday(moscowDate: Date): boolean {
  const month = String(moscowDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(moscowDate.getUTCDate()).padStart(2, '0');
  return FIXED_HOLIDAYS.has(`${month}-${day}`);
}

function isNonWorkingDay(moscowDate: Date): boolean {
  return isWeekend(moscowDate) || isHoliday(moscowDate);
}

function getWorkDayStart(moscowDate: Date): Date | null {
  if (isNonWorkingDay(moscowDate)) return null;
  
  const result = new Date(moscowDate);
  result.setUTCHours(WORK_START_HOUR, 0, 0, 0);
  return result;
}

function getWorkDayEnd(moscowDate: Date): Date | null {
  if (isNonWorkingDay(moscowDate)) return null;
  
  const result = new Date(moscowDate);
  result.setUTCHours(WORK_END_HOUR, 0, 0, 0);
  return result;
}

function getNextDay(moscowDate: Date): Date {
  const result = new Date(moscowDate);
  result.setUTCDate(result.getUTCDate() + 1);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

/**
 * Calculate working time in hours between two UTC timestamps
 */
export function calculateWorkingTime(startUtc: Date, endUtc: Date): number {
  if (endUtc <= startUtc) return 0;
  
  const startMoscow = toMoscowTime(startUtc);
  const endMoscow = toMoscowTime(endUtc);
  
  let totalHours = 0;
  let currentMoscow = new Date(startMoscow);
  
  while (currentMoscow < endMoscow) {
    if (isNonWorkingDay(currentMoscow)) {
      currentMoscow = getNextDay(currentMoscow);
      continue;
    }
    
    const dayStart = getWorkDayStart(currentMoscow)!;
    const dayEnd = getWorkDayEnd(currentMoscow)!;
    
    const effectiveStart = new Date(Math.max(currentMoscow.getTime(), dayStart.getTime()));
    const nextDay = getNextDay(currentMoscow);
    const effectiveEnd = new Date(Math.min(endMoscow.getTime(), dayEnd.getTime(), nextDay.getTime()));
    
    if (effectiveStart < dayEnd && effectiveEnd > dayStart) {
      const clampedStart = new Date(Math.max(effectiveStart.getTime(), dayStart.getTime()));
      const clampedEnd = new Date(Math.min(effectiveEnd.getTime(), dayEnd.getTime()));
      
      if (clampedEnd > clampedStart) {
        const hoursThisDay = (clampedEnd.getTime() - clampedStart.getTime()) / (1000 * 60 * 60);
        totalHours += hoursThisDay;
      }
    }
    
    currentMoscow = nextDay;
  }
  
  return Math.round(totalHours * 10000) / 10000;
}

/**
 * Calculate raw time in hours (no calendar normalization)
 */
export function calculateRawTime(startUtc: Date, endUtc: Date): number {
  if (endUtc <= startUtc) return 0;
  return (endUtc.getTime() - startUtc.getTime()) / (1000 * 60 * 60);
}

/**
 * Check if a timestamp falls within working hours
 */
export function isWorkingTime(utcDate: Date): boolean {
  const moscow = toMoscowTime(utcDate);
  if (isNonWorkingDay(moscow)) return false;
  
  const hour = moscow.getUTCHours();
  return hour >= WORK_START_HOUR && hour < WORK_END_HOUR;
}

/**
 * Get list of holidays for display
 */
export function getHolidaysList(): { date: string; description: string }[] {
  return [
    { date: "31 декабря - 8 января", description: "Новогодние праздники" },
    { date: "23 февраля", description: "День защитника Отечества" },
    { date: "8 марта", description: "Международный женский день" },
    { date: "1 мая", description: "Праздник Весны и Труда" },
    { date: "9 мая", description: "День Победы" },
    { date: "12 июня", description: "День России" },
    { date: "4 ноября", description: "День народного единства" },
  ];
}
