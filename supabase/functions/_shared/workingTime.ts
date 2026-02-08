/**
 * Working Calendar Normalization Utility
 * 
 * Calculates time spent only during working hours:
 * - Working hours: 09:00-18:00 UTC+3 (Moscow timezone)
 * - Excludes weekends (Saturday, Sunday)
 * - Excludes fixed holidays (Russian calendar)
 * 
 * This utility is deterministic and chunk-safe - same input always produces same output.
 */

// UTC+3 offset in milliseconds
const UTC_PLUS_3_OFFSET_MS = 3 * 60 * 60 * 1000;

// Working hours in local time (UTC+3)
const WORK_START_HOUR = 9;  // 09:00
const WORK_END_HOUR = 18;   // 18:00
const WORK_HOURS_PER_DAY = WORK_END_HOUR - WORK_START_HOUR; // 9 hours

/**
 * Fixed holidays (month-day format, e.g., "12-31" for Dec 31)
 * Russian calendar holidays:
 * - Dec 31 - Jan 8 (New Year holidays)
 * - Feb 23 (Defender of the Fatherland Day)
 * - Mar 8 (International Women's Day)
 * - May 1 (Spring and Labour Day)
 * - May 9 (Victory Day)
 * - Jun 12 (Russia Day)
 * - Nov 4 (Unity Day)
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

/**
 * Convert UTC date to UTC+3 (Moscow) timezone
 */
function toMoscowTime(utcDate: Date): Date {
  return new Date(utcDate.getTime() + UTC_PLUS_3_OFFSET_MS);
}

/**
 * Convert Moscow time back to UTC
 */
function toUtc(moscowDate: Date): Date {
  return new Date(moscowDate.getTime() - UTC_PLUS_3_OFFSET_MS);
}

/**
 * Check if a date (in Moscow timezone) is a weekend
 */
function isWeekend(moscowDate: Date): boolean {
  const day = moscowDate.getUTCDay();
  return day === 0 || day === 6; // Sunday = 0, Saturday = 6
}

/**
 * Check if a date (in Moscow timezone) is a holiday
 */
function isHoliday(moscowDate: Date): boolean {
  const month = String(moscowDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(moscowDate.getUTCDate()).padStart(2, '0');
  return FIXED_HOLIDAYS.has(`${month}-${day}`);
}

/**
 * Check if a date (in Moscow timezone) is a non-working day
 */
function isNonWorkingDay(moscowDate: Date): boolean {
  return isWeekend(moscowDate) || isHoliday(moscowDate);
}

/**
 * Get the start of working hours for a given day (in Moscow time)
 * Returns null if the day is a non-working day
 */
function getWorkDayStart(moscowDate: Date): Date | null {
  if (isNonWorkingDay(moscowDate)) return null;
  
  const result = new Date(moscowDate);
  result.setUTCHours(WORK_START_HOUR, 0, 0, 0);
  return result;
}

/**
 * Get the end of working hours for a given day (in Moscow time)
 * Returns null if the day is a non-working day
 */
function getWorkDayEnd(moscowDate: Date): Date | null {
  if (isNonWorkingDay(moscowDate)) return null;
  
  const result = new Date(moscowDate);
  result.setUTCHours(WORK_END_HOUR, 0, 0, 0);
  return result;
}

/**
 * Get the start of the next day (in Moscow time)
 */
function getNextDay(moscowDate: Date): Date {
  const result = new Date(moscowDate);
  result.setUTCDate(result.getUTCDate() + 1);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

/**
 * Calculate working time in hours between two UTC timestamps
 * 
 * Rules:
 * - Only counts time between 09:00-18:00 UTC+3
 * - Excludes weekends (Saturday, Sunday)
 * - Excludes fixed holidays
 * - If interval spans non-working time, only working portions are counted
 * 
 * @param startUtc - Start timestamp in UTC
 * @param endUtc - End timestamp in UTC
 * @returns Working time in hours (can be fractional)
 */
export function calculateWorkingTime(startUtc: Date, endUtc: Date): number {
  if (endUtc <= startUtc) return 0;
  
  // Convert to Moscow time for calculations
  const startMoscow = toMoscowTime(startUtc);
  const endMoscow = toMoscowTime(endUtc);
  
  let totalHours = 0;
  let currentMoscow = new Date(startMoscow);
  
  // Process day by day
  while (currentMoscow < endMoscow) {
    // Skip non-working days entirely
    if (isNonWorkingDay(currentMoscow)) {
      currentMoscow = getNextDay(currentMoscow);
      continue;
    }
    
    // Get work day boundaries
    const dayStart = getWorkDayStart(currentMoscow)!;
    const dayEnd = getWorkDayEnd(currentMoscow)!;
    
    // Calculate effective start within this work day
    const effectiveStart = new Date(Math.max(currentMoscow.getTime(), dayStart.getTime()));
    
    // Calculate effective end within this work day
    const nextDay = getNextDay(currentMoscow);
    const effectiveEnd = new Date(Math.min(endMoscow.getTime(), dayEnd.getTime(), nextDay.getTime()));
    
    // Only count if within working hours
    if (effectiveStart < dayEnd && effectiveEnd > dayStart) {
      const clampedStart = new Date(Math.max(effectiveStart.getTime(), dayStart.getTime()));
      const clampedEnd = new Date(Math.min(effectiveEnd.getTime(), dayEnd.getTime()));
      
      if (clampedEnd > clampedStart) {
        const hoursThisDay = (clampedEnd.getTime() - clampedStart.getTime()) / (1000 * 60 * 60);
        totalHours += hoursThisDay;
      }
    }
    
    // Move to next day
    currentMoscow = nextDay;
  }
  
  return Math.round(totalHours * 10000) / 10000; // Round to 4 decimal places
}

/**
 * Calculate raw time in hours between two dates (no calendar normalization)
 * Used for comparison and validation
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
 * Get information about a specific date for debugging
 */
export function getDateInfo(utcDate: Date): {
  utc: string;
  moscow: string;
  isWeekend: boolean;
  isHoliday: boolean;
  isWorkingDay: boolean;
  isWithinWorkHours: boolean;
} {
  const moscow = toMoscowTime(utcDate);
  const hour = moscow.getUTCHours();
  
  return {
    utc: utcDate.toISOString(),
    moscow: moscow.toISOString(),
    isWeekend: isWeekend(moscow),
    isHoliday: isHoliday(moscow),
    isWorkingDay: !isNonWorkingDay(moscow),
    isWithinWorkHours: hour >= WORK_START_HOUR && hour < WORK_END_HOUR,
  };
}
