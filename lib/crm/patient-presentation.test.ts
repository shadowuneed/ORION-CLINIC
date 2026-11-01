import { describe, expect, it } from 'vitest';
import { crmBirthDateLabel } from './patient-presentation';

describe('CRM saved patient calendar date', () => {
  it('presents the exact stored date without a time or device-zone shift', () => {
    expect(crmBirthDateLabel('1984-05-12')).toBe('12.05.1984');
    expect(crmBirthDateLabel('2000-02-29')).toBe('29.02.2000');
  });
  it.each([undefined, '', '2026-02-30', '2026-02-29', 'not-a-date', '1984-05-12T00:00:00Z'])('does not invent an absent or invalid birth date: %s', value => {
    expect(crmBirthDateLabel(value)).toBe('Не указана');
  });
});
