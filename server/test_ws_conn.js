const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3001');

ws.on('open', () => {
    console.log('[WS] Connected successfully');
    ws.send(JSON.stringify({
        action: 'execute',
        language: 'javascript',
        files: [{ name: 'main', content: 'console.log("WS execution working");' }]
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'stdout') {
        console.log(`[WS STDOUT] ${msg.data.trim()}`);
    } else if (msg.type === 'exit') {
        console.log(`[WS] Process exited with code ${msg.code}`);
        process.exit(0);
    }
});

ws.on('error', (err) => {
    console.error('[WS ERROR]', err);
    process.exit(1);
});

setTimeout(() => {
    console.error('[WS TIMEOUT] Connection or execution timed out');
    process.exit(1);
}, 5000);
