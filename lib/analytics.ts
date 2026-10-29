export interface MonthBucket {
  key: string;
  label: string;
}

export function getRecentMonths(count = 6, now = new Date()): MonthBucket[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (count - index - 1), 1);
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
    };
  });
}

export function timestampMonthKey(value?: { toMillis?: () => number }): string | null {
  const milliseconds = value?.toMillis?.();
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) return null;

  const date = new Date(milliseconds);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
