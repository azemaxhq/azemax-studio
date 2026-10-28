const path = require('path');
const { RUNTIMES } = require('./runtimeDetection.cjs');

function getLanguageConfig(language, filePath, tmpDir) {
    const key = String(language || '').toLowerCase();
    const baseName = path.basename(String(filePath || ''), path.extname(String(filePath || '')));
    const outputBinary = path.join(tmpDir, baseName);

    const configs = {
        python: {
            ext: '.py',
            cmd: RUNTIMES.python,
            args: (f) => [f],
            compile: null,
        },
        javascript: {
            ext: '.js',
            cmd: RUNTIMES.node,
            args: (f) => [f],
            compile: null,
        },
        typescript: {
            ext: '.ts',
            cmd: RUNTIMES.npx,
            args: (f) => ['tsx', f],
            compile: null,
        },
        c: {
            ext: '.c',
            cmd: null,
            args: () => [outputBinary],
            compile: {
                cmd: RUNTIMES.gcc,
                args: (f) => [f, '-o', outputBinary, '-lm'],
            },
        },
        cpp: {
            ext: '.cpp',
            cmd: null,
            args: () => [outputBinary],
            compile: {
                cmd: RUNTIMES.gpp,
                args: (f) => [f, '-o', outputBinary, '-lm'],
            },
        },
        java: {
            ext: '.java',
            cmd: RUNTIMES.java,
            args: () => ['-cp', tmpDir, baseName],
            compile: {
                cmd: RUNTIMES.javac,
                args: (f) => [f],
            },
        },
        ruby: {
            ext: '.rb',
            cmd: RUNTIMES.ruby,
            args: (f) => [f],
            compile: null,
        },
        php: {
            ext: '.php',
            cmd: RUNTIMES.php,
            args: (f) => [f],
            compile: null,
        },
        perl: {
            ext: '.pl',
            cmd: RUNTIMES.perl,
            args: (f) => [f],
            compile: null,
        },
        rust: {
            ext: '.rs',
            cmd: null,
            args: () => [outputBinary],
            compile: {
                cmd: RUNTIMES.rustc,
                args: (f) => [f, '-o', outputBinary],
            },
        },
        go: {
            ext: '.go',
            cmd: RUNTIMES.go,
            args: (f) => ['run', f],
            compile: null,
        },
        swift: {
            ext: '.swift',
            cmd: RUNTIMES.swift,
            args: (f) => [f],
            compile: null,
        },
        bash: {
            ext: '.sh',
            cmd: RUNTIMES.bash,
            args: (f) => [f],
            compile: null,
        },
        shell: {
            ext: '.sh',
            cmd: RUNTIMES.bash,
            args: (f) => [f],
            compile: null,
        },
        zsh: {
            ext: '.sh',
            cmd: RUNTIMES.zsh,
            args: (f) => [f],
            compile: null,
        },
    };

    // Own-property lookup only: language comes from client input, and a bare
    // `configs[language]` would resolve prototype keys such as `__proto__` or
    // `constructor` to non-null values.
    return Object.prototype.hasOwnProperty.call(configs, key) ? configs[key] : null;
}

function canRunLocally(config) {
    if (!config) return false;
    if (config.cmd) return true;
    return Boolean(config.compile?.cmd);
}

module.exports = { getLanguageConfig, canRunLocally };
