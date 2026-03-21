const https = require('https');

https.get('https://wandbox.org/api/list.json', (res) => {
    let raw = '';
    res.on('data', chunk => raw += chunk);
    res.on('end', () => {
        const list = JSON.parse(raw);
        const langs = ['python', 'nodejs', 'typescript', 'gcc', 'openjdk', 'ruby', 'php', 'rust', 'go', 'bash'];

        const best = {};
        for (const comp of list) {
            if (comp.name.includes('head')) continue;

            for (const lang of langs) {
                if (comp.name.startsWith(lang) || comp.name.startsWith('cpython') && lang === 'python') {
                    if (!best[lang]) best[lang] = comp.name;
                }
            }
        }
        console.log(best);
    });
});
