function resolveFileName(language, code, ext) {
    let fileName = `main${ext || ''}`;

    switch (language) {
        case 'java': {
            const classMatch = code.match(/(?:public\s+)?class\s+(\w+)/);
            if (classMatch) fileName = `${classMatch[1]}.java`;
            break;
        }
        case 'kotlin': {
            const ktClassMatch = code.match(/(?:fun\s+main|class\s+(\w+))/);
            fileName = ktClassMatch?.[1] ? `${ktClassMatch[1]}.kt` : 'main.kt';
            break;
        }
        case 'go':
            fileName = 'main.go';
            break;
        case 'rust':
            fileName = 'main.rs';
            break;
        case 'swift':
            fileName = 'main.swift';
            break;
        case 'c':
            fileName = 'main.c';
            break;
        case 'cpp':
            fileName = 'main.cpp';
            break;
        case 'python':
            fileName = 'main.py';
            break;
        case 'typescript':
            fileName = 'main.ts';
            break;
        case 'javascript':
            fileName = 'main.js';
            break;
        case 'ruby':
            fileName = 'main.rb';
            break;
        case 'php':
            fileName = 'main.php';
            break;
        case 'perl':
            fileName = 'main.pl';
            break;
        case 'bash':
        case 'shell':
        case 'zsh':
            fileName = 'main.sh';
            break;
        case 'csharp':
            fileName = 'Program.cs';
            break;
        case 'scala':
            fileName = 'Main.scala';
            break;
        case 'r':
            fileName = 'main.r';
            break;
        default:
            if (ext) fileName = `main${ext}`;
    }

    return fileName;
}

function codeNeedsStdin(language, code) {
    const patterns = {
        python: /\binput\s*\(/,
        csharp: /Console\.(ReadLine|Read|ReadKey)\s*\(/,
        java: /new\s+Scanner\s*\(|System\.in|BufferedReader/,
        c: /\bscanf\s*\(|\bgets\s*\(|\bgetchar\s*\(|\bfgets\s*\(/,
        cpp: /\bcin\s*>>|\bscanf\s*\(|\bgetline\s*\(.*cin/,
        ruby: /\bgets\b|\breadline\b|\bSTDIN\./,
        go: /fmt\.Scan|bufio\.NewReader.*os\.Stdin/,
        rust: /std::io::stdin|io::stdin/,
        php: /\bfgets\s*\(\s*STDIN|\breadline\s*\(/,
        perl: /<STDIN>/,
        swift: /readLine\s*\(/,
        bash: /\bread\s/,
        scala: /scala\.io\.StdIn|readLine/,
        r: /\breadline\s*\(|\bscan\s*\(/,
        lua: /io\.read\s*\(/,
    };
    const pattern = patterns[language.toLowerCase()];
    return pattern ? pattern.test(code) : false;
}

module.exports = { resolveFileName, codeNeedsStdin };
