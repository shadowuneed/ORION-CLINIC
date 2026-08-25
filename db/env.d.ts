declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    SONIOX_API_KEY?: string;
    SONIOX_REGION?: 'us' | 'eu' | 'jp';
    CLOUDFLARE_ACCOUNT_ID?: string;
    CLOUDFLARE_AI_API_TOKEN?: string;
  }
}
