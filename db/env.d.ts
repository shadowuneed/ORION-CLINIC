declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    ORION_ENV?: string;
    ORION_BUILD_ID?: string;
    ORION_SYNTHETIC_DATA_ONLY?: string;
    ORION_STT_BASE_URL?: string;
    ORION_STT_MODEL?: string;
    GROQ_API_KEY?: string;
    GROQ_MODEL?: string;
    GROQ_API_BASE_URL?: string;
  }
}
