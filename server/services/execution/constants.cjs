const WANDBOX_LANGUAGES = {
    python: 'cpython-3.14.0',
    javascript: 'nodejs-20.17.0',
    typescript: 'typescript-5.6.2',
    c: 'gcc-13.2.0-c',
    cpp: 'gcc-13.2.0',
    java: 'openjdk-jdk-22+36',
    ruby: 'ruby-3.4.1',
    php: 'php-8.3.12',
    perl: 'perl-5.41.6',
    rust: 'rust-1.82.0',
    go: 'go-1.23.2',
    swift: 'swift-6.0.2',
    lua: 'lua-5.4.4',
    bash: 'bash',
    csharp: 'mono-6.12.0.199',
    scala: 'scala-3.5.1',
    r: 'r-4.4.1',
};

const EXECUTION_TIMEOUT_MS = 60_000;
const COMPILE_TIMEOUT_MS = 30_000;

module.exports = { WANDBOX_LANGUAGES, EXECUTION_TIMEOUT_MS, COMPILE_TIMEOUT_MS };
