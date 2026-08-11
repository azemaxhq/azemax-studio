const { execSync } = require('child_process');

function findCommand(commands) {
    for (const cmd of commands) {
        try {
            const out = execSync(`which ${cmd} 2>/dev/null`, { stdio: 'pipe' }).toString().trim();
            if (out) return out;
        } catch {
            continue;
        }
    }
    return null;
}

const RUNTIMES = {
    python: findCommand(['python3', 'python']),
    node: findCommand(['node']),
    gcc: findCommand(['gcc']),
    gpp: findCommand(['g++']),
    javac: findCommand(['javac']),
    java: findCommand(['java']),
    ruby: findCommand(['ruby']),
    php: findCommand(['php']),
    perl: findCommand(['perl']),
    rustc: findCommand(['rustc']),
    go: findCommand(['go']),
    swift: findCommand(['swift', 'swiftc']),
    bash: findCommand(['bash']),
    zsh: findCommand(['zsh']),
    npx: findCommand(['npx']),
};

function listDetectedRuntimes() {
    const runtimes = [];
    const checks = [
        { language: 'python', cmd: RUNTIMES.python },
        { language: 'javascript', cmd: RUNTIMES.node },
        { language: 'typescript', cmd: RUNTIMES.npx ? 'npx tsx' : null },
        { language: 'c', cmd: RUNTIMES.gcc },
        { language: 'cpp', cmd: RUNTIMES.gpp },
        { language: 'java', cmd: RUNTIMES.javac && RUNTIMES.java ? RUNTIMES.javac : null },
        { language: 'ruby', cmd: RUNTIMES.ruby },
        { language: 'php', cmd: RUNTIMES.php },
        { language: 'perl', cmd: RUNTIMES.perl },
        { language: 'rust', cmd: RUNTIMES.rustc },
        { language: 'go', cmd: RUNTIMES.go },
        { language: 'swift', cmd: RUNTIMES.swift },
        { language: 'bash', cmd: RUNTIMES.bash },
        { language: 'csharp', cmd: 'wandbox' },
        { language: 'scala', cmd: 'wandbox' },
        { language: 'r', cmd: 'wandbox' },
        { language: 'lua', cmd: 'wandbox' },
    ];

    for (const { language, cmd } of checks) {
        if (cmd) {
            runtimes.push({ language, version: '*', aliases: [language], runtime: cmd });
        }
    }

    return runtimes;
}

module.exports = { RUNTIMES, findCommand, listDetectedRuntimes };
