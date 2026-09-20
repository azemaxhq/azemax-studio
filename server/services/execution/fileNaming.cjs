function isValidJavaIdentifier(name) {
    return typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function sanitizeJavaFilename(filename) {
    if (!filename || typeof filename !== 'string') return null;
    // Strip path components, handle both slash styles
    const trimmed = filename.trim();
    if (!trimmed) return null;
    // Prevent null bytes and traversal
    if (trimmed.includes('\0')) return null;
    // Take basename only
    const base = trimmed.split('/').pop().split('\\').pop();
    if (!base || base.includes('..')) return null;
    // Allow only safe chars, no dirs
    if (!/^[a-zA-Z0-9_.-]+$/.test(base)) return null;
    if (base.includes('/') || base.includes('\\')) return null;
    let name = base;
    let ext = '';
    const dot = base.lastIndexOf('.');
    if (dot > 0) {
        name = base.slice(0, dot);
        ext = base.slice(dot).toLowerCase();
    }
    // For Java, extension should be .java if present, else we normalize
    if (ext && ext !== '.java') {
        // If extension is not .java, treat whole base as name if it's a valid identifier
        // e.g., "test.java" ok, "test.txt" => name would be "test", but we only allow .java
        // For safety, only accept .java, otherwise fallback to identifier check on name
        // If user passed "HelloWorld.java " trimmed, ext is .java, ok
        // Otherwise if they passed weird ext, we still sanitize name
        if (!isValidJavaIdentifier(name)) return null;
        return `${name}.java`;
    }
    if (!isValidJavaIdentifier(name)) return null;
    return `${name}.java`;
}

function extractPublicTopLevelTypes(code) {
    // Handles: public [modifiers] class|interface|enum|record|@interface Name
    // Modifiers: final, abstract, sealed, static, strictfp (common Java modifiers)
    const re = /\bpublic\s+(?:(?:final|abstract|sealed|static|strictfp)\s+)*(?:class|interface|enum|record|@interface)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
    const types = [];
    let m;
    while ((m = re.exec(code)) !== null) {
        const name = m[1];
        if (isValidJavaIdentifier(name)) types.push(name);
    }
    return types;
}

function resolveJavaFileName(code, editorFilename) {
    const publicTypes = extractPublicTopLevelTypes(code);
    if (publicTypes.length === 1) {
        return `${publicTypes[0]}.java`;
    }
    // If multiple or zero public types, try sanitized editor filename
    if (editorFilename) {
        const sanitized = sanitizeJavaFilename(editorFilename);
        if (sanitized) return sanitized;
    }
    // Fallbacks: if no public type but code has a single package-private class, using Main.java is safe (Wandbox prog.java can hold package-private)
    // But per task, generic safe filename is acceptable when no public type
    return 'Main.java';
}

function resolveFileName(language, code, ext, editorFilename) {
    let fileName = `main${ext || ''}`;

    switch (language) {
        case 'java': {
            fileName = resolveJavaFileName(code, editorFilename);
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

module.exports = { resolveFileName, codeNeedsStdin, isValidJavaIdentifier, sanitizeJavaFilename, extractPublicTopLevelTypes, resolveJavaFileName };
