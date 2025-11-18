/**
 * Component: Cron Utilities
 * Documentation: documentation/backend/services/scheduler.md
 */

export interface SchedulePreset {
  label: string;
  cron: string;
  description: string;
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { label: 'Every 15 minutes', cron: '*/15 * * * *', description: 'Runs 4 times per hour' },
  { label: 'Every 30 minutes', cron: '*/30 * * * *', description: 'Runs twice per hour' },
  { label: 'Every hour', cron: '0 * * * *', description: 'Runs at the start of every hour' },
  { label: 'Every 2 hours', cron: '0 */2 * * *', description: 'Runs 12 times per day' },
  { label: 'Every 3 hours', cron: '0 */3 * * *', description: 'Runs 8 times per day' },
  { label: 'Every 6 hours', cron: '0 */6 * * *', description: 'Runs 4 times per day' },
  { label: 'Every 12 hours', cron: '0 */12 * * *', description: 'Runs twice per day' },
  { label: 'Daily at midnight', cron: '0 0 * * *', description: 'Runs once per day at 12:00 AM' },
  { label: 'Daily at noon', cron: '0 12 * * *', description: 'Runs once per day at 12:00 PM' },
  { label: 'Daily at 6 AM', cron: '0 6 * * *', description: 'Runs once per day at 6:00 AM' },
  { label: 'Weekly (Sunday midnight)', cron: '0 0 * * 0', description: 'Runs once per week' },
  { label: 'Monthly (1st at midnight)', cron: '0 0 1 * *', description: 'Runs once per month' },
];

/**
 * Converts a cron expression to a human-readable description
 * @param cron - The cron expression (e.g., "0 *\/6 * * *")
 * @returns Human-readable description (e.g., "Every 6 hours")
 */
export function cronToHuman(cron: string): string {
  // Check if it matches a preset
  const preset = SCHEDULE_PRESETS.find(p => p.cron === cron);
  if (preset) {
    return preset.label;
  }

  // Parse the cron expression
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) {
    return cron; // Invalid cron, return as-is
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Minutes pattern
  if (minute.startsWith('*/')) {
    const interval = parseInt(minute.substring(2), 10);
    return `Every ${interval} minute${interval !== 1 ? 's' : ''}`;
  }

  // Hours pattern
  if (hour.startsWith('*/') && minute === '0') {
    const interval = parseInt(hour.substring(2), 10);
    return `Every ${interval} hour${interval !== 1 ? 's' : ''}`;
  }

  // Daily pattern
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    if (hour === '*') {
      if (minute === '0') {
        return 'Every hour';
      }
      const minInterval = parseInt(minute.replace('*/', ''), 10);
      return `Every ${minInterval} minutes`;
    }

    const hourNum = parseInt(hour, 10);
    if (!isNaN(hourNum)) {
      const minuteNum = parseInt(minute, 10);
      const time = formatTime(hourNum, minuteNum);
      return `Daily at ${time}`;
    }
  }

  // Weekly pattern
  if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const days = parseDayOfWeek(dayOfWeek);
    const hourNum = parseInt(hour, 10);
    const minuteNum = parseInt(minute, 10);
    const time = formatTime(hourNum, minuteNum);
    return `Weekly on ${days} at ${time}`;
  }

  // Monthly pattern
  if (month === '*' && dayOfWeek === '*' && dayOfMonth !== '*') {
    const day = parseInt(dayOfMonth, 10);
    const hourNum = parseInt(hour, 10);
    const minuteNum = parseInt(minute, 10);
    const time = formatTime(hourNum, minuteNum);
    return `Monthly on day ${day} at ${time}`;
  }

  // Fallback: return the cron expression
  return cron;
}

/**
 * Parse day of week number to name
 */
function parseDayOfWeek(dayOfWeek: string): string {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const day = parseInt(dayOfWeek, 10);
  if (!isNaN(day) && day >= 0 && day <= 6) {
    return dayNames[day];
  }
  return dayOfWeek;
}

/**
 * Format hour and minute to 12-hour time
 */
function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const displayMinute = minute.toString().padStart(2, '0');
  return `${displayHour}:${displayMinute} ${period}`;
}

/**
 * Validates a cron expression
 * @param cron - The cron expression to validate
 * @returns true if valid, false otherwise
 */
export function isValidCron(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  // Basic validation - each part should be valid
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  return (
    isValidCronField(minute, 0, 59) &&
    isValidCronField(hour, 0, 23) &&
    isValidCronField(dayOfMonth, 1, 31) &&
    isValidCronField(month, 1, 12) &&
    isValidCronField(dayOfWeek, 0, 7)
  );
}

/**
 * Validates a single cron field
 */
function isValidCronField(field: string, min: number, max: number): boolean {
  // Asterisk is always valid
  if (field === '*') {
    return true;
  }

  // Step values (*/n)
  if (field.startsWith('*/')) {
    const step = parseInt(field.substring(2), 10);
    return !isNaN(step) && step > 0 && step <= max;
  }

  // Range (n-m)
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(s => parseInt(s, 10));
    return !isNaN(start) && !isNaN(end) && start >= min && end <= max && start < end;
  }

  // List (n,m,o)
  if (field.includes(',')) {
    const values = field.split(',').map(s => parseInt(s, 10));
    return values.every(v => !isNaN(v) && v >= min && v <= max);
  }

  // Single value
  const value = parseInt(field, 10);
  return !isNaN(value) && value >= min && value <= max;
}

/**
 * Custom schedule builder
 */
export interface CustomSchedule {
  type: 'minutes' | 'hours' | 'daily' | 'weekly' | 'monthly' | 'custom';
  interval?: number; // For minutes/hours
  time?: { hour: number; minute: number }; // For daily/weekly/monthly
  dayOfWeek?: number; // For weekly (0-6)
  dayOfMonth?: number; // For monthly (1-31)
  customCron?: string; // For custom
}

/**
 * Converts custom schedule to cron expression
 */
export function customScheduleToCron(schedule: CustomSchedule): string {
  switch (schedule.type) {
    case 'minutes':
      return `*/${schedule.interval || 15} * * * *`;

    case 'hours':
      const hourInterval = schedule.interval || 1;
      // If interval is 24 or more hours, convert to daily at midnight
      if (hourInterval >= 24) {
        return `0 0 * * *`; // Daily at midnight
      }
      return `0 */${hourInterval} * * *`;

    case 'daily':
      const dailyHour = schedule.time?.hour || 0;
      const dailyMinute = schedule.time?.minute || 0;
      return `${dailyMinute} ${dailyHour} * * *`;

    case 'weekly':
      const weeklyHour = schedule.time?.hour || 0;
      const weeklyMinute = schedule.time?.minute || 0;
      const weeklyDay = schedule.dayOfWeek || 0;
      return `${weeklyMinute} ${weeklyHour} * * ${weeklyDay}`;

    case 'monthly':
      const monthlyHour = schedule.time?.hour || 0;
      const monthlyMinute = schedule.time?.minute || 0;
      const monthlyDay = schedule.dayOfMonth || 1;
      return `${monthlyMinute} ${monthlyHour} ${monthlyDay} * *`;

    case 'custom':
      return schedule.customCron || '0 * * * *';

    default:
      return '0 * * * *';
  }
}

/**
 * Attempts to parse a cron expression into a custom schedule
 */
export function cronToCustomSchedule(cron: string): CustomSchedule {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { type: 'custom', customCron: cron };
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Minutes pattern
  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const interval = parseInt(minute.substring(2), 10);
    return { type: 'minutes', interval };
  }

  // Hours pattern
  if (hour.startsWith('*/') && minute === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const interval = parseInt(hour.substring(2), 10);
    return { type: 'hours', interval };
  }

  // Daily pattern
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && !hour.includes('*') && !minute.includes('*')) {
    const hourNum = parseInt(hour, 10);
    const minuteNum = parseInt(minute, 10);
    if (!isNaN(hourNum) && !isNaN(minuteNum)) {
      return { type: 'daily', time: { hour: hourNum, minute: minuteNum } };
    }
  }

  // Weekly pattern
  if (dayOfMonth === '*' && month === '*' && !dayOfWeek.includes('*') && !hour.includes('*') && !minute.includes('*')) {
    const hourNum = parseInt(hour, 10);
    const minuteNum = parseInt(minute, 10);
    const dayNum = parseInt(dayOfWeek, 10);
    if (!isNaN(hourNum) && !isNaN(minuteNum) && !isNaN(dayNum)) {
      return { type: 'weekly', time: { hour: hourNum, minute: minuteNum }, dayOfWeek: dayNum };
    }
  }

  // Monthly pattern
  if (month === '*' && dayOfWeek === '*' && !dayOfMonth.includes('*') && !hour.includes('*') && !minute.includes('*')) {
    const hourNum = parseInt(hour, 10);
    const minuteNum = parseInt(minute, 10);
    const dayNum = parseInt(dayOfMonth, 10);
    if (!isNaN(hourNum) && !isNaN(minuteNum) && !isNaN(dayNum)) {
      return { type: 'monthly', time: { hour: hourNum, minute: minuteNum }, dayOfMonth: dayNum };
    }
  }

  // Fallback to custom
  return { type: 'custom', customCron: cron };
}
