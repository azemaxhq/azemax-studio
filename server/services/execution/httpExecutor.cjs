const { getWandboxLanguage } = require('./constants.cjs');
const { getLanguageConfig, canRunLocally } = require('./languageConfig.cjs');
const { executeLocally } = require('./localExecutor.cjs');
const { compileViaWandbox } = require('./wandboxExecutor.cjs');
const { ALLOW_LOCAL_EXECUTION } = require('../../config/index.cjs');

async function executeCode({ language, files, stdin = '', filename = null }) {
    if (typeof language !== 'string' || !language.trim() || !Array.isArray(files) || files.length === 0) {
        return {
            run: { stdout: '', stderr: 'Language and files required', code: 1 },
        };
    }
    const first = files[0];
    if (!first || typeof first !== 'object' || Array.isArray(first)) {
        return {
            run: { stdout: '', stderr: 'Invalid file entry', code: 1 },
        };
    }

    const code = typeof first.content === 'string' ? first.content : '';
    // Prefer explicit filename field, fallback to files[0].name for backwards compat
    const candidateFilename = (typeof filename === 'string' && filename)
        || (typeof first.name === 'string' && first.name)
        || null;
    const input = typeof stdin === 'string' ? stdin : '';
    const lang = language.trim().toLowerCase();
    const initialConfig = getLanguageConfig(lang, 'main', '/tmp');

    // Public beta: local execution is disabled by default in production to avoid
    // arbitrary code running on the host.  Use Wandbox sandbox instead.
    if (ALLOW_LOCAL_EXECUTION && canRunLocally(initialConfig)) {
        try {
            const result = await executeLocally({ language: lang, code, stdin: input, filename: candidateFilename });
            return { run: result };
        } catch (err) {
            console.warn(`[EXEC] Local run failed for ${lang}, trying Wandbox:`, err.message);
        }
    } else if (!ALLOW_LOCAL_EXECUTION && canRunLocally(initialConfig)) {
        // Intentionally skip local execution — fall through to Wandbox
    }

    if (!getWandboxLanguage(lang)) {
        return {
            run: {
                stdout: '',
                stderr: `Unsupported language: ${language}`,
                code: 1,
            },
        };
    }

    const result = await compileViaWandbox({ language: lang, code, stdin: input, filename: candidateFilename });
    return { run: result };
}

module.exports = { executeCode };
