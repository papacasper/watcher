export function localPayableDate(date: string, hour = 12, minute = 0, second = 0, ms = 0): Date {
  const parts = date.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return new Date(year, month - 1, day, hour, minute, second, ms);
}
