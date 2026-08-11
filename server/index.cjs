const http = require('http');
const WebSocket = require('ws');
const { createApp } = require('./app.cjs');
const { PORT } = require('./config/index.cjs');
const { attachExecutionWebSocket } = require('./websocket/executionHandler.cjs');
const { listDetectedRuntimes } = require('./services/execution/runtimeDetection.cjs');

const app = createApp();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

attachExecutionWebSocket(wss);

server.listen(PORT, () => {
    const runtimes = listDetectedRuntimes();
    console.log(`\n🚀 AI Code Editor API`);
    console.log(`   HTTP:      http://localhost:${PORT}/api`);
    console.log(`   Health:    http://localhost:${PORT}/api/health`);
    console.log(`   WebSocket: ws://localhost:${PORT}`);
    console.log(`   Runtimes:  ${runtimes.length} local language(s) detected\n`);
});
