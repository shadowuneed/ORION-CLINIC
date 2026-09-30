export const cloudGenerationCookie = '__Host-orion-cloud-generation';
export const cloudGenerationHeader = 'orion-session-generation';

export function readCloudGenerationCookie(value: string): string | null {
  const values = value.split(';').map(part => part.trim()).filter(part => part.startsWith(`${cloudGenerationCookie}=`));
  if (values.length !== 1) return null;
  const generation = values[0].slice(cloudGenerationCookie.length + 1);
  return /^[a-f0-9]{32}$/.test(generation) ? generation : null;
}
