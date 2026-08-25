declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    SONIOX_API_KEY?: string;
    SONIOX_REGION?: 'us' | 'eu' | 'jp';
  }
}
