/** A saved date of birth is a calendar date, never a device-time timestamp. */
export function crmBirthDateLabel(value?: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Не указана';
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return 'Не указана';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(date);
}
