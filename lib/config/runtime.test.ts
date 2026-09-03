import { describe, expect, it } from 'vitest';
import { RuntimeConfigError, parseRuntimeConfig } from './runtime';

describe('parseRuntimeConfig', () => {
  it('uses safe local defaults', () => {
    expect(parseRuntimeConfig({})).toEqual({
      environment: 'development',
      buildId: 'local',
      syntheticDataOnly: true,
    });
  });

  it('accepts an explicit synthetic production deployment', () => {
    expect(
      parseRuntimeConfig({
        ORION_ENV: 'production',
        ORION_BUILD_ID: 'release-2026.08.28',
        ORION_SYNTHETIC_DATA_ONLY: 'true',
      }),
    ).toEqual({
      environment: 'production',
      buildId: 'release-2026.08.28',
      syntheticDataOnly: true,
    });
  });

  it.each([
    { ORION_ENV: 'prod' },
    { ORION_BUILD_ID: 'release with spaces' },
    { ORION_SYNTHETIC_DATA_ONLY: 'false' },
    { ORION_ENV: 'production' },
  ])('fails closed for invalid configuration: %o', (source) => {
    expect(() => parseRuntimeConfig(source)).toThrow(RuntimeConfigError);
  });
});
