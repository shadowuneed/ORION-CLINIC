declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    GROQ_LLM_API_KEY?: string;
    GROQ_LLM_MODEL?: string;
    GROQ_COMPOUND_API_KEY?: string;
    GROQ_COMPOUND_MODEL?: string;
  }
}
