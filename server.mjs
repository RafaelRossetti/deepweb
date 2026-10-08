import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { createApp } from './lib/http.mjs';
import { createStore } from './lib/store.mjs';

const store = createStore();
const port = Number(process.env.PORT || 3000);
const app = createApp({ store });
const server = createServer(app);
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(port, '0.0.0.0', () => {
  console.log(`THOR Arena: http://localhost:${port}`);
  console.log(`Armazenamento: ${store.mode}. Dados e PDFs ficam privados no servidor.`);
  if (!process.env.VERCEL) {
    const addresses = Object.values(networkInterfaces()).flat().filter(i => i?.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address));
    addresses.forEach(i => console.log(`Alunos na mesma rede: http://${i.address}:${port}`));
    if (!process.env.TEACHER_PASSWORD) console.log('Sem senha configurada: abrir atividades como professor é permitido somente neste computador (localhost).');
  }
});

function stop() { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
