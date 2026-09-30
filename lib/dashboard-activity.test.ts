import { describe, expect, it } from 'vitest';
import { recentEncounterDates } from './dashboard-activity';

describe('recent encounter chart', () => {
  it('groups exact last-state dates without inventing earlier edits', () => {
    const day = Date.UTC(2026, 8, 28, 12);
    const result = recentEncounterDates([
      { updatedAt: day }, { updatedAt: day + 1000 },
      { updatedAt: day - 2 * 86_400_000 },
      { updatedAt: day - 9 * 86_400_000 },
    ], day);
    expect(result.map((point) => point.count)).toEqual([0, 0, 0, 0, 1, 0, 2]);
  });

  it('retains an empty seven-day window', () => {
    expect(recentEncounterDates([], Date.UTC(2026, 8, 28)).map((point) => point.count)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
