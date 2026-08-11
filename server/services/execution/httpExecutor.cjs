const { WANDBOX_LANGUAGES } = require('./constants.cjs');
const { getLanguageConfig, canRunLocally } = require('./languageConfig.cjs');
const { executeLocally } = require('./localExecutor.cjs');
const { compileViaWandbox } = require('./wandboxExecutor.cjs');

async function executeCode({ language, files, stdin = '' }) {
    if (!language || !files?.length) {
        return {
            run: { stdout: '', stderr: 'Language and files required', code: 1 },
        };
    }

    const code = files[0].content || '';
    const lang = language.toLowerCase();
    const initialConfig = getLanguageConfig(lang, 'main', '/tmp');

    if (canRunLocally(initialConfig)) {
        try {
            const result = await executeLocally({ language: lang, code, stdin });
            return { run: result };
        } catch (err) {
            console.warn(`[EXEC] Local run failed for ${lang}, trying Wandbox:`, err.message);
        }
    }

    if (!WANDBOX_LANGUAGES[lang]) {
        return {
            run: {
                stdout: '',
                stderr: `Unsupported language: ${language}`,
                code: 1,
            },
        };
    }

    const result = await compileViaWandbox({ language: lang, code, stdin });
    return { run: result };
}

module.exports = { executeCode };
