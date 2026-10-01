export type CloudObservationPageQuery = {
  facilityId?: string | string[];
  accessAssignmentId?: string | string[];
  patientId?: string | string[];
  careTaskId?: string | string[];
};

export class InvalidCloudObservationPageSelectionError extends Error {}

function one(value: string | string[] | undefined, maximum: number) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maximum || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new InvalidCloudObservationPageSelectionError('Invalid observation page selection.');
  }
  return value;
}

/** A malformed explicit selection is never replaced with an implicit grant. */
export function cloudObservationPageSelection(query: CloudObservationPageQuery) {
  if (query.careTaskId !== undefined) {
    // Care coordination has not been ported. Do not pretend to execute its task.
    throw new InvalidCloudObservationPageSelectionError('Care task is not connected.');
  }
  return { facilityId: one(query.facilityId, 100), accessAssignmentId: one(query.accessAssignmentId, 160),
    patientId: one(query.patientId, 160) };
}

export function cloudObservationPageReturnTo(query: CloudObservationPageQuery) {
  const params = new URLSearchParams();
  for (const key of ['facilityId', 'accessAssignmentId', 'patientId', 'careTaskId'] as const) {
    const value = query[key];
    for (const item of value === undefined ? [] : Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return `/observations${params.size ? `?${params}` : ''}`;
}
