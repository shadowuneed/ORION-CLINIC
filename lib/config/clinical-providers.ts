import { z } from 'zod';

const localSpeechUrlSchema = z
  .string()
  .url()
  .transform((value) => new URL(value))
  .refine(
    (url) =>
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost'),
    'Local speech service must use a loopback HTTP address',
  );

const groqBaseUrlSchema = z
  .string()
  .url()
  .transform((value) => value.replace(/\/+$/, ''));

export type ClinicalProviderConfigSource = {
  ORION_STT_BASE_URL?: unknown;
  ORION_STT_MODEL?: unknown;
  GROQ_API_KEY?: unknown;
  GROQ_MODEL?: unknown;
  GROQ_API_BASE_URL?: unknown;
};

export type ClinicalProviderConfig = {
  localSpeech: {
    baseUrl: string;
    model: string;
  };
  groq: {
    apiKey: string | null;
    model: string;
    baseUrl: string;
  };
};

export class ClinicalProviderConfigError extends Error {
  constructor() {
    super('Clinical provider configuration is invalid');
    this.name = 'ClinicalProviderConfigError';
  }
}

export function parseClinicalProviderConfig(
  source: ClinicalProviderConfigSource,
): ClinicalProviderConfig {
  const speechUrl = localSpeechUrlSchema.safeParse(
    source.ORION_STT_BASE_URL ?? 'http://127.0.0.1:3101',
  );
  const speechModel = z
    .string()
    .trim()
    .min(1)
    .max(120)
    .safeParse(source.ORION_STT_MODEL ?? 'gigaam-multilingual-local');
  const groqKey = z
    .string()
    .trim()
    .min(1)
    .max(500)
    .optional()
    .safeParse(source.GROQ_API_KEY);
  const groqModel = z
    .string()
    .trim()
    .min(1)
    .max(120)
    .safeParse(source.GROQ_MODEL ?? 'openai/gpt-oss-120b');
  const groqBaseUrl = groqBaseUrlSchema.safeParse(
    source.GROQ_API_BASE_URL ?? 'https://api.groq.com/openai/v1',
  );

  if (
    !speechUrl.success ||
    !speechModel.success ||
    !groqKey.success ||
    !groqModel.success ||
    !groqBaseUrl.success
  ) {
    throw new ClinicalProviderConfigError();
  }

  return {
    localSpeech: {
      baseUrl: speechUrl.data.toString().replace(/\/$/, ''),
      model: speechModel.data,
    },
    groq: {
      apiKey: groqKey.data ?? null,
      model: groqModel.data,
      baseUrl: groqBaseUrl.data,
    },
  };
}
