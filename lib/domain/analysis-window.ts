export const CLINICAL_ANALYSIS_WINDOW_SIZE = 24;

export function clinicalAnalysisWindow(totalFinalSegments: number) {
  const total = Number.isSafeInteger(totalFinalSegments) && totalFinalSegments > 0
    ? totalFinalSegments
    : 0;
  const included = Math.min(CLINICAL_ANALYSIS_WINDOW_SIZE, total);
  return { total, included, omitted: total - included };
}
