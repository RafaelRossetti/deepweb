import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ArenaError, LIMITS, action, addParticipant, attachDocument, expire, fail, hash, matches, newActivity, normalizeState, secret, snapshot, text, viewerFor } from './engine.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticFiles = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/index.html', ['index.html', 'text/html; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']], ['/js/arena.js', ['js/arena.js', 'text/javascript; charset=utf-8']]]);
const MAX_JSON = 4 * 1024 * 1024 + 2048;
const localHosts = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const queues = new WeakMap();
function token(req) {
  const header = req.headers.authorization;
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
}
function headers(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'");
}
function json(res, status, value) {
  res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value));
}
async function body(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Envie dados no formato JSON.');
  if (Number(req.headers['content-length']) > MAX_JSON) fail(413, 'Envie um PDF de até 3 MiB.');
  let bytes = 0; const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_JSON) fail(413, 'Envie um PDF de até 3 MiB.');
    chunks.push(chunk);
  }
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    return input;
  } catch { fail(400, 'Dados inválidos. Tente novamente.'); }
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  let originHost;
  try { originHost = new URL(origin).host; } catch { fail(403, 'Origem da solicitação inválida.'); }
  if (originHost !== req.headers.host) fail(403, 'Acesse a atividade pelo mesmo endereço da aplicação.');
}
async function serialized(store, code, work) {
  let pending = queues.get(store); if (!pending) { pending = new Map(); queues.set(store, pending); }
  const previous = pending.get(code) || Promise.resolve();
  let release; const next = new Promise(resolve => { release = resolve; }); pending.set(code, next);
  await previous;
  try { return await work(); }
  finally { release(); if (pending.get(code) === next) pending.delete(code); }
}
// Local requests share a queue. CAS also protects against other server instances
// when using Supabase, including simultaneous captures on Vercel.
export async function transact(store, code, clock, operation, readOnly = false) {
  return serialized(store, code, async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const record = await store.read(code);
      if (!record) fail(404, 'Atividade não encontrada. Confira o código.');
      const state = structuredClone(record.state); const now = clock();
      const upgraded = normalizeState(state, now);
      const expired = expire(state, now);
      let result; let error;
      try { result = operation(state, now); } catch (caught) { error = caught; }
      if (error && !expired) throw error;
      if (readOnly && !upgraded && !expired && !result?.dirty) { if (error) throw error; return { state, now, result }; }
      if (await store.compareAndSwap(code, record.revision, state)) {
        if (error) throw error;
        return { state, now, result };
      }
      // Yield rather than spin on cross-instance contention.
      await new Promise(resolve => setTimeout(resolve, Math.min(4 + attempt * 2, 40)));
    }
    fail(503, 'Muitos acessos simultâneos. Aguarde um instante e tente novamente.');
  });
}
export function createApp({ store, clock = Date.now, teacherPassword = process.env.TEACHER_PASSWORD, allowLocalTeacher = !process.env.VERCEL } = {}) {
  if (!store) throw new Error('Armazenamento é obrigatório.');
  const teacherPasswordHash = teacherPassword ? hash(teacherPassword) : null;
  const attempts = new Map();
  function limit(req) {
    const key = req.socket?.remoteAddress || 'server'; const now = Date.now();
    const old = attempts.get(key);
    const entry = old && now - old.at < 60000 ? old : { at: now, count: 0 };
    entry.count += 1; attempts.set(key, entry);
    if (attempts.size > 1000) for (const [ip, value] of attempts) if (now - value.at > 60000) attempts.delete(ip);
    if (entry.count > 180) fail(429, 'Muitas tentativas de entrada. Aguarde um minuto.');
  }
  return async function app(req, res) {
    headers(res);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, storage: store.mode, version: '0.1.0', teacherPasswordRequired: Boolean(teacherPasswordHash) });
      if (req.method === 'GET' && staticFiles.has(url.pathname)) {
        const [filename, contentType] = staticFiles.get(url.pathname);
        res.setHeader('Content-Type', contentType); res.statusCode = 200;
        return res.end(await readFile(path.join(projectRoot, filename)));
      }
      if (req.method === 'POST') sameOrigin(req);
      if (url.pathname === '/api/activities' && req.method === 'POST') {
        limit(req); const input = await body(req);
        if (teacherPasswordHash) { if (!matches(input.password, teacherPasswordHash)) fail(403, 'Senha do professor incorreta.'); }
        else if (!(allowLocalTeacher && localHosts.has(req.socket?.remoteAddress))) fail(403, 'Configure TEACHER_PASSWORD no servidor para abrir uma atividade por este endereço.');
        const capability = secret();
        for (let count = 0; count < 8; count++) {
          const state = newActivity(input, capability, clock());
          try {
            await store.create(state.code, state);
            return json(res, 201, { code: state.code, token: capability, viewer: { kind: 'teacher' }, snapshot: snapshot(state, { kind: 'teacher' }, clock()) });
          } catch (error) { if (error.status !== 409) throw error; }
        }
        fail(503, 'Não foi possível gerar o código da atividade. Tente novamente.');
      }
      const route = /^\/api\/activities\/([A-Z2-9]{6})(?:\/(join|action|documents|download)(?:\/([a-zA-Z0-9_-]+))?)?$/.exec(url.pathname);
      if (!route) fail(404, 'Endereço não encontrado.');
      const [, code, resource, resourceId] = route;
      const bearer = token(req);
      if (!resource && req.method === 'GET') {
        const outcome = await transact(store, code, clock, (state, now) => {
          const viewer = viewerFor(state, bearer);
          let dirty = false;
          if (viewer.kind === 'student') {
            const participant = state.participants.find(p => p.id === viewer.participantId);
            if (now - participant.lastSeenAt >= 15000) { participant.lastSeenAt = now; dirty = true; }
          }
          return { viewer, dirty };
        }, true);
        return json(res, 200, snapshot(outcome.state, outcome.result.viewer, outcome.now));
      }
      if (resource === 'join' && !resourceId && req.method === 'POST') {
        limit(req); const input = await body(req); const capability = secret();
        const outcome = await transact(store, code, clock, (state, now) => ({ participantId: addParticipant(state, input, capability, now) }));
        return json(res, 201, { code, token: capability, participantId: outcome.result.participantId, snapshot: snapshot(outcome.state, viewerFor(outcome.state, capability, true), outcome.now) });
      }
      if (resource === 'action' && !resourceId && req.method === 'POST') {
        const input = await body(req);
        const outcome = await transact(store, code, clock, (state, now) => action(state, viewerFor(state, bearer, true), input, now));
        if (outcome.result.rejection) return json(res, outcome.result.rejection.status, { error: outcome.result.rejection.message, snapshot: snapshot(outcome.state, viewerFor(outcome.state, bearer, true), outcome.now) });
        const { cleanupKey, ...result } = outcome.result;
        if (cleanupKey) await store.deleteDocument(cleanupKey).catch(() => {});
        return json(res, 200, { ...result, snapshot: snapshot(outcome.state, viewerFor(outcome.state, bearer, true), outcome.now) });
      }
      if (resource === 'documents' && resourceId && req.method === 'POST') {
        // Reject unauthorized requests before parsing PDF bytes or storing a file.
        const check = await transact(store, code, clock, state => {
          const viewer = viewerFor(state, bearer, true);
          if (viewer.kind !== 'teacher') fail(403, 'Somente o professor pode enviar os PDFs.');
          if (!['lobby', 'preparing'].includes(state.status)) fail(409, 'Os documentos estão fechados nesta fase.');
          if (!state.teams.some(t => t.id === resourceId)) fail(404, 'Equipe não encontrada.');
          return {};
        }, true);
        const input = await body(req);
        const filename = text(input.name, 'Nome do PDF', 120).replace(/[\\/]/g, '_');
        if (!filename.toLowerCase().endsWith('.pdf') || typeof input.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64) || input.base64.length % 4 !== 0) fail(400, 'Selecione um arquivo PDF válido.');
        const bytes = Buffer.from(input.base64, 'base64');
        if (bytes.length < 5 || bytes.length > LIMITS.pdfBytes || bytes.subarray(0, 5).toString() !== '%PDF-') fail(400, 'Envie um PDF de até 3 MiB.');
        const document = await store.putDocument(code, resourceId, bytes);
        let outcome;
        try {
          outcome = await transact(store, code, clock, (state, now) => ({ oldKey: attachDocument(state, viewerFor(state, bearer, true), resourceId, { key: document.key, name: filename, size: bytes.length }, now) }));
        } catch (error) { await store.deleteDocument(document.key).catch(() => {}); throw error; }
        if (outcome.result.oldKey) await store.deleteDocument(outcome.result.oldKey).catch(() => {});
        return json(res, 200, { message: `PDF de ${check.state.teams.find(t => t.id === resourceId).name} enviado.`, snapshot: snapshot(outcome.state, { kind: 'teacher' }, outcome.now) });
      }
      if (resource === 'download' && resourceId && req.method === 'GET') {
        // Read bytes before consuming the ticket, so a storage outage can be retried.
        const record = await store.read(code);
        if (!record) fail(404, 'Atividade não encontrada.');
        const entry = record.state.downloads.find(d => matches(resourceId, d.ticketHash));
        if (!entry || entry.usedAt !== null || clock() >= entry.expiresAt) fail(410, 'Este acesso ao PDF já foi usado ou expirou.');
        const bytes = await store.getDocument(entry.documentKey);
        const outcome = await transact(store, code, clock, (state, now) => {
          const current = state.downloads.find(d => matches(resourceId, d.ticketHash));
          if (!current || current.usedAt !== null || now >= current.expiresAt) fail(410, 'Este acesso ao PDF já foi usado ou expirou.');
          current.usedAt = now; return { name: current.name };
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="retrospectiva.pdf"; filename*=UTF-8''${encodeURIComponent(outcome.result.name)}`);
        res.setHeader('Content-Length', bytes.length); res.statusCode = 200; return res.end(bytes);
      }
      fail(405, 'Método não permitido para esta ação.');
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status >= 500) console.error(`[THOR] ${error.name}: falha no servidor (${status}).`);
      if (!res.headersSent) json(res, status, { error: status >= 500 && !(error instanceof ArenaError) ? 'Não foi possível concluir a solicitação. Tente novamente.' : error.message });
      else res.end();
    }
  };
}
