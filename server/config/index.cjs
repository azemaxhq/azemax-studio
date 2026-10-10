// Backward-compatible facade over the strict env validator.
// All configuration lives in ./env.cjs (fail-closed validation).
// Existing `require('./config/index.cjs')` call sites keep working.
const env = require('./env.cjs');

module.exports = {
    PORT: env.PORT,
    DATA_DIR: env.DATA_DIR,
    WORKSPACES_DIR: env.WORKSPACES_DIR,
    DATABASE_PATH: env.DATABASE_PATH,
    AI_MODELS: env.AI_MODELS,
    CORS_ORIGIN: env.CORS_ORIGIN,
    ALLOW_LOCAL_EXECUTION: env.ALLOW_LOCAL_EXECUTION,
    // Re-exported for new code (auth, limits, storage).
    DISABLE_AUTH: env.DISABLE_AUTH,
    AUTH_SECRET: env.AUTH_SECRET,
    CORS_LIST: env.CORS_LIST,
    ALLOW_SHELL: env.ALLOW_SHELL,
    LIMITS: env.LIMITS,
    isProd: env.isProd,
    isTest: env.isTest,
    publicSummary: env.publicSummary,
    fail: env.fail,
};
