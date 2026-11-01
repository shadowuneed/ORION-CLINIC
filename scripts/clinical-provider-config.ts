import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { parseClinicalProviderConfig } from '../lib/config/clinical-providers';

/** PC-only provider injection. Never imported by a browser module or serialized. */
export function readClinicalProviderConfig(root: string) {
  const path = join(root, '.dev.vars');
  const values = existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
  const keys = ['ORION_STT_BASE_URL', 'ORION_STT_MODEL', 'GROQ_API_KEY', 'GROQ_MODEL', 'GROQ_API_BASE_URL'] as const;
  const selected = Object.fromEntries(keys.map(key => [key, process.env[key] ?? values[key]]));
  const config = parseClinicalProviderConfig(selected);
  // A transcription provider has no reason to send audio off this computer;
  // the only optional external destination is the explicitly consented Groq API.
  const speech = new URL(config.localSpeech.baseUrl);
  if (speech.username || speech.password || speech.search || speech.hash) throw new Error('Invalid local provider configuration');
  if (config.groq.baseUrl !== 'https://api.groq.com/openai/v1') throw new Error('Unapproved analysis provider endpoint');
  return config;
}
