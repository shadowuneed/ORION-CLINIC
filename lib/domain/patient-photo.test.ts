import { describe, expect, it } from 'vitest';
import {
  appendPatientPhotoVersion,
  detectPatientPhotoMime,
} from './patient-photo';

function buffer(bytes: number[]) {
  return Uint8Array.from(bytes).buffer;
}

describe('patient photo content validation', () => {
  it('preserves the selected facility when adding a cache version', () => {
    expect(
      appendPatientPhotoVersion(
        '/api/patients/patient-a/photo?facilityId=fac-a',
        4,
      ),
    ).toBe('/api/patients/patient-a/photo?facilityId=fac-a&v=4');
    expect(
      appendPatientPhotoVersion('/api/patients/patient-a/photo', 4),
    ).toBe('/api/patients/patient-a/photo?v=4');
  });

  it('detects supported image signatures', () => {
    expect(detectPatientPhotoMime(buffer([0xff, 0xd8, 0xff, 0x00]))).toBe(
      'image/jpeg',
    );
    expect(
      detectPatientPhotoMime(
        buffer([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe('image/png');
    expect(
      detectPatientPhotoMime(
        buffer([
          0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
        ]),
      ),
    ).toBe('image/webp');
  });

  it('rejects text and truncated signatures', () => {
    expect(detectPatientPhotoMime(new TextEncoder().encode('not an image').buffer)).toBeNull();
    expect(detectPatientPhotoMime(buffer([0x89, 0x50, 0x4e]))).toBeNull();
  });
});
