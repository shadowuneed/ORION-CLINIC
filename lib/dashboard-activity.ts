export type UpdatedEncounter = { updatedAt: number };

/** A chart of the latest saved state per encounter, not a count of all edits. */
export function recentEncounterDates(encounters: readonly UpdatedEncounter[], today = Date.now()) {
  const valid = encounters.map((item) => item.updatedAt).filter(Number.isFinite);
  const anchor = valid.length ? Math.max(...valid) : today;
  const lastDay = Math.floor(anchor / 86_400_000) * 86_400_000;
  return Array.from({ length: 7 }, (_, index) => {
    const day = lastDay - (6 - index) * 86_400_000;
    return {
      day,
      label: new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(day),
      count: valid.filter((value) => Math.floor(value / 86_400_000) * 86_400_000 === day).length,
    };
  });
}
