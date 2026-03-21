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
console.log('PYTHON:', findCommand(['python3', 'python']));
