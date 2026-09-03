import { describe, expect, it, vi } from 'vitest';
import {
  assertStorageReady,
  READINESS_SCHEMA_MARKER,
  type ReadinessBucket,
  type ReadinessDatabase,
} from './readiness';

function databaseReturning(result: { ok: number } | null): ReadinessDatabase {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn((value: string) => {
        expect(value).toBe(READINESS_SCHEMA_MARKER);
        return {
          bind: vi.fn(),
          first: vi.fn(async () => result),
        };
      }),
      first: vi.fn(),
    })),
  };
}

describe('storage readiness', () => {
  it('requires the latest integrity migration and a readable object store', async () => {
    const files: ReadinessBucket = { list: vi.fn(async () => ({ objects: [] })) };

    await expect(assertStorageReady(databaseReturning({ ok: 1 }), files)).resolves.toBeUndefined();
    expect(files.list).toHaveBeenCalledWith({ limit: 1 });
  });

  it('rejects an empty or unmigrated database', async () => {
    const files: ReadinessBucket = { list: vi.fn(async () => ({ objects: [] })) };

    await expect(assertStorageReady(databaseReturning(null), files)).rejects.toThrow(
      /database schema/i,
    );
    expect(files.list).not.toHaveBeenCalled();
  });

  it('rejects an unavailable object store', async () => {
    const files: ReadinessBucket = {
      list: vi.fn(async () => {
        throw new Error('storage unavailable');
      }),
    };

    await expect(assertStorageReady(databaseReturning({ ok: 1 }), files)).rejects.toThrow(
      /storage unavailable/i,
    );
  });
});
