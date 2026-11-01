import { randomBytes, randomInt } from 'node:crypto';

// Only the explicitly selected local synthetic accounts use this format.
// Two independent uniform word choices + eight uniform base32 characters.
export const MEMORABLE_PASSWORD_WORDS = Object.freeze(`
apple apricot banana berry cherry coconut grape lemon mango melon orange peach pear plum tomato
almond barley bean bread butter candy cheese cookie cream honey maple muffin olive onion pepper potato rice salad sugar toast
badger bear beaver bird camel cat deer dolphin donkey eagle falcon ferret fish fox frog goat goose horse koala lion lizard llama monkey mouse otter owl panda parrot penguin rabbit raven robin seal sheep tiger turtle whale wolf zebra
acorn bamboo birch bloom branch cedar clover coral daisy fern flower forest grass grove hazel ivy lake leaf lotus meadow moss oak ocean orchid palm pine pond poppy reed river rose shore spruce stream tulip valley violet willow
amber blue bronze copper gold green indigo ivory jade lilac pearl pink purple red silver teal white yellow
anchor basket bell book bottle bowl box brick brush cabin candle carpet chair clock cloud comet crown crystal cube drum flag flute garden globe harp hill island kite ladder lamp moon mountain music nest paper pencil piano pillow planet plate pocket rainbow ribbon rock rope sail shell snow solar spoon spring star stone summer sun table tent tower train wave wheel window winter
`.trim().split(/\s+/));
export const MEMORABLE_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MEMORABLE_PASSWORD_CODE_LENGTH = 8;
export const MEMORABLE_PASSWORD_ENTROPY_BITS = 2 * Math.log2(MEMORABLE_PASSWORD_WORDS.length) +
  MEMORABLE_PASSWORD_CODE_LENGTH * Math.log2(MEMORABLE_PASSWORD_ALPHABET.length);

if (MEMORABLE_PASSWORD_WORDS.length < 128 || new Set(MEMORABLE_PASSWORD_WORDS).size !== MEMORABLE_PASSWORD_WORDS.length ||
  MEMORABLE_PASSWORD_WORDS.some(word => !/^[a-z]{3,8}$/.test(word)) || MEMORABLE_PASSWORD_ALPHABET.length !== 32 ||
  new Set(MEMORABLE_PASSWORD_ALPHABET).size !== 32 || MEMORABLE_PASSWORD_ENTROPY_BITS < 54) {
  throw new Error('Invalid memorable local test password configuration');
}

export function generateMemorableLocalPassword(): string {
  const first = MEMORABLE_PASSWORD_WORDS[randomInt(MEMORABLE_PASSWORD_WORDS.length)].toUpperCase();
  const second = MEMORABLE_PASSWORD_WORDS[randomInt(MEMORABLE_PASSWORD_WORDS.length)].toUpperCase();
  const bytes = randomBytes(MEMORABLE_PASSWORD_CODE_LENGTH);
  try {
    // Each byte contains exactly eight equally likely copies of every 5-bit
    // value; masking introduces no modulo bias for this 32-character alphabet.
    const code = Array.from(bytes, byte => MEMORABLE_PASSWORD_ALPHABET[byte & 31]).join('');
    return `${first}-${second}-${code}`;
  } finally { bytes.fill(0); }
}

export type LocalAccountProvisionMode =
  | Readonly<{ mode: 'provision_missing' }>
  | Readonly<{ mode: 'reset_one'; userId: string }>
  | Readonly<{ mode: 'reset_test_all'; memorable: true }>;

export function parseLocalAccountProvisionArgs(args: readonly string[]): LocalAccountProvisionMode {
  if (args.length === 0) return { mode: 'provision_missing' };
  if (args.length === 2 && args[0] === '--reset' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(args[1])) {
    return { mode: 'reset_one', userId: args[1] };
  }
  if (args.length === 2 && new Set(args).size === 2 && args.includes('--reset-test-all') && args.includes('--memorable')) {
    return { mode: 'reset_test_all', memorable: true };
  }
  throw new Error('Usage: node scripts/configure-local-accounts.mjs [--reset existing-user-id | --reset-test-all --memorable]');
}

export type LocalStaffIdentity = Readonly<{ id: string; issuer: string; subject: string }>;

// Exact reviewed local fixture identities from db/bootstrap.local.sql,
// db/seed.local.sql and db/seed.chronic-care.local.sql. "openai:sites" alone is
// not synthetic proof; only these three named local-development pairs qualify.
const reviewedSyntheticStaff: readonly LocalStaffIdentity[] = Object.freeze([
  { id: 'user-a', issuer: 'openai:sites', subject: 'local_seedy' },
  { id: 'user-b', issuer: 'openai:sites', subject: 'local_other_clinician' },
  { id: 'user-registrar', issuer: 'openai:sites', subject: 'local_registrar' },
  { id: 'user-care-nurse', issuer: 'orion:synthetic', subject: 'local-care-nurse' },
  { id: 'access-user-nurse-b', issuer: 'orion:synthetic', subject: 'synthetic-access-nurse-b' },
  { id: 'access-user-registrar-c', issuer: 'orion:synthetic', subject: 'synthetic-access-registrar-c' },
]);

export function assertReviewedSyntheticStaff(people: readonly LocalStaffIdentity[]): void {
  if (!people.length || people.some(person => !reviewedSyntheticStaff.some(known =>
    known.id === person.id && known.issuer === person.issuer && known.subject === person.subject))) {
    throw new Error('Test reset requires only already provisioned active reviewed synthetic local staff; no passwords changed');
  }
}
