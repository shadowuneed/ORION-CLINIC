import { z } from 'zod';

const environmentSchema = z.enum(['development', 'test', 'production']);
const buildIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, 'Build identifier contains unsupported characters');

export type RuntimeEnvironment = z.infer<typeof environmentSchema>;

export type RuntimeConfig = {
  environment: RuntimeEnvironment;
  buildId: string;
  syntheticDataOnly: true;
};

export type RuntimeConfigSource = {
  ORION_ENV?: unknown;
  ORION_BUILD_ID?: unknown;
  ORION_SYNTHETIC_DATA_ONLY?: unknown;
};

export class RuntimeConfigError extends Error {
  constructor() {
    super('Runtime configuration is invalid');
    this.name = 'RuntimeConfigError';
  }
}

export function parseRuntimeConfig(source: RuntimeConfigSource): RuntimeConfig {
  const environmentResult = environmentSchema.safeParse(
    source.ORION_ENV ?? 'development',
  );
  const buildIdResult = buildIdSchema.safeParse(
    source.ORION_BUILD_ID ?? 'local',
  );
  const syntheticResult = z.literal('true').safeParse(
    source.ORION_SYNTHETIC_DATA_ONLY ?? 'true',
  );

  if (
    !environmentResult.success ||
    !buildIdResult.success ||
    !syntheticResult.success ||
    (environmentResult.data === 'production' &&
      source.ORION_SYNTHETIC_DATA_ONLY !== 'true')
  ) {
    throw new RuntimeConfigError();
  }

  return {
    environment: environmentResult.data,
    buildId: buildIdResult.data,
    syntheticDataOnly: true,
  };
}
