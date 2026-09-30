import { describe, expect, it } from 'vitest';
import { clinicalAnalysisWindow } from './analysis-window';

describe('clinicalAnalysisWindow', () => {
  it('keeps every saved turn within the window', () => {
    expect(clinicalAnalysisWindow(7)).toEqual({ total: 7, included: 7, omitted: 0 });
  });

  it('discloses the turns excluded from a long consultation', () => {
    expect(clinicalAnalysisWindow(31)).toEqual({ total: 31, included: 24, omitted: 7 });
  });

  it('never presents an invalid count as clinical context', () => {
    expect(clinicalAnalysisWindow(-1)).toEqual({ total: 0, included: 0, omitted: 0 });
    expect(clinicalAnalysisWindow(Number.NaN)).toEqual({ total: 0, included: 0, omitted: 0 });
  });
});
