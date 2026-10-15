import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ArenaError, LIMITS, action, addParticipant, attachDocument, expire, fail, hash, matches, newActivity, normalizeState, secret, snapshot, text, viewerFor } from './engine.mjs';
import { isCampaign, tickCampaign } from './campaign.mjs';
import { dossierPdf } from './dossier.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticFiles = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/index.html', ['index.html', 'text/html; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']], ['/js/arena.js', ['js/arena.js', 'text/javascript; charset=utf-8']]]);
const MAX_JSON = 4 * 1024 * 1024 + 2048;
const localHosts = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const queues = new WeakMap();
const localTeacherSessionKey = secret();
const TEACHER_SESSION_MS = 12 * 60 * 60 * 1000;
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
      const progressed = tickCampaign(state, Math.min(now, state.endsAt ?? now));
      const expired = expire(state, now);
      let result; let error;
      try { result = operation(state, now); } catch (caught) { error = caught; }
      if (error && !expired && !progressed) throw error;
      if (readOnly && !upgraded && !progressed && !expired && !result?.dirty) { if (error) throw error; return { state, now, result }; }
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
  // Password-derived signing works across serverless instances. Local-only
  // installations use a process secret, so no configured credential is needed.
  const teacherSessionKey = teacherPassword ? createHmac('sha256', teacherPassword).update('thor:teacher:sessions:v1').digest() : localTeacherSessionKey;
  const attempts = new Map();
  function authorizeTeacher(req, password) {
    if (teacherPasswordHash) { if (!matches(password, teacherPasswordHash)) fail(403, 'Senha do professor incorreta.'); }
    else if (!(allowLocalTeacher && localHosts.has(req.socket?.remoteAddress))) fail(403, 'Configure TEACHER_PASSWORD no servidor para acessar o dashboard do professor por este endereço.');
  }
  function signature(value) { return createHmac('sha256', teacherSessionKey).update(value).digest('base64url'); }
  function teacherSession(bearer) {
    if (typeof bearer !== 'string' || bearer.length > 1024) fail(401, 'Sessão do professor inválida ou expirada. Entre no dashboard novamente.');
    const parts = bearer.split('.');
    if (parts.length !== 3 || parts[0] !== 'teacher' || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) fail(401, 'Sessão do professor inválida ou expirada. Entre no dashboard novamente.');
    const actual = Buffer.from(parts[2]); const expected = Buffer.from(signature(`${parts[0]}.${parts[1]}`));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail(401, 'Sessão do professor inválida ou expirada. Entre no dashboard novamente.');
    let claims;
    try { claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { fail(401, 'Sessão do professor inválida ou expirada. Entre no dashboard novamente.'); }
    if (!Number.isSafeInteger(claims?.expiresAt) || clock() >= claims.expiresAt) fail(401, 'Sessão do professor inválida ou expirada. Entre no dashboard novamente.');
  }
  function activityViewer(state, bearer, required = false) {
    if (typeof bearer === 'string' && bearer.startsWith('teacher.')) { teacherSession(bearer); return { kind: 'teacher' }; }
    return viewerFor(state, bearer, required);
  }
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
      if (url.pathname === '/api/teacher/login' && req.method === 'POST') {
        limit(req); const input = await body(req); authorizeTeacher(req, input.password);
        const expiresAt = clock() + TEACHER_SESSION_MS;
        const payload = Buffer.from(JSON.stringify({ expiresAt, nonce: secret() })).toString('base64url');
        const value = `teacher.${payload}`;
        return json(res, 200, { token: `${value}.${signature(value)}`, expiresAt });
      }
      if (url.pathname === '/api/teacher/activities' && req.method === 'GET') {
        teacherSession(token(req));
        const offsetText = url.searchParams.get('offset') ?? '0'; const limitText = url.searchParams.get('limit') ?? '50';
        if (!/^\d+$/.test(offsetText) || !/^\d+$/.test(limitText)) fail(400, 'Paginação de atividades inválida.');
        const offset = Number(offsetText); const pageLimit = Number(limitText);
        if (!Number.isSafeInteger(offset) || offset > Number.MAX_SAFE_INTEGER - 101 || !Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 100) fail(400, 'Paginação de atividades inválida.');
        const page = await store.list({ offset, limit: pageLimit }); const now = clock();
        const activities = [];
        for (const record of page.records) {
          let state = structuredClone(record.state);
          // Settle expired rounds through CAS: campaign progression can choose a
          // random key, and the displayed final result must be the saved result.
          if (state.status === 'running' && now >= state.endsAt) {
            const settled = await transact(store, state.code, clock, () => ({}), true);
            state = settled.state;
          }
          // Active rounds show their recorded progress without simulating and
          // discarding an AI move. Older schemas may be normalized on a copy.
          normalizeState(state, now);
          const view = snapshot(state, { kind: 'teacher' }, now);
          activities.push({ code: state.code, title: state.title, mode: state.mode, status: state.status, createdAt: state.createdAt, startedAt: state.startedAt, finishedAt: state.finishedAt, endsAt: state.endsAt,
            participantCount: state.participants.length, teamCount: state.teams.length,
            winners: state.status === 'finished' ? view.ranking.filter(team => team.score === view.ranking[0]?.score).map(team => ({ name: team.name, score: team.score })) : [] });
        }
        return json(res, 200, { activities, hasMore: page.hasMore, offset, limit: pageLimit });
      }
      if (url.pathname === '/api/activities' && req.method === 'POST') {
        limit(req); const input = await body(req);
        const dashboardToken = token(req);
        if (typeof dashboardToken === 'string' && dashboardToken.startsWith('teacher.')) teacherSession(dashboardToken);
        else authorizeTeacher(req, input.password);
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
      const route = /^\/api\/activities\/([A-Z2-9]{6})(?:\/(join|action|documents|download|dossier)(?:\/([a-zA-Z0-9_-]+))?)?$/.exec(url.pathname);
      if (!route) fail(404, 'Endereço não encontrado.');
      const [, code, resource, resourceId] = route;
      const bearer = token(req);
      if (!resource && req.method === 'GET') {
        const outcome = await transact(store, code, clock, (state, now) => {
          const viewer = activityViewer(state, bearer);
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
        const outcome = await transact(store, code, clock, (state, now) => action(state, activityViewer(state, bearer, true), input, now));
        if (outcome.result.rejection) return json(res, outcome.result.rejection.status, { error: outcome.result.rejection.message, snapshot: snapshot(outcome.state, activityViewer(outcome.state, bearer, true), outcome.now) });
        const { cleanupKey, ...result } = outcome.result;
        if (cleanupKey) await store.deleteDocument(cleanupKey).catch(() => {});
        return json(res, 200, { ...result, snapshot: snapshot(outcome.state, activityViewer(outcome.state, bearer, true), outcome.now) });
      }
      if (resource === 'documents' && resourceId && req.method === 'POST') {
        // Reject unauthorized requests before parsing PDF bytes or storing a file.
        const check = await transact(store, code, clock, state => {
          const viewer = activityViewer(state, bearer, true);
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
          outcome = await transact(store, code, clock, (state, now) => ({ oldKey: attachDocument(state, activityViewer(state, bearer, true), resourceId, { key: document.key, name: filename, size: bytes.length }, now) }));
        } catch (error) { await store.deleteDocument(document.key).catch(() => {}); throw error; }
        if (outcome.result.oldKey) await store.deleteDocument(outcome.result.oldKey).catch(() => {});
        return json(res, 200, { message: `PDF de ${check.state.teams.find(t => t.id === resourceId).name} enviado.`, snapshot: snapshot(outcome.state, { kind: 'teacher' }, outcome.now) });
      }
      if (resource === 'dossier' && req.method === 'GET') {
        const outcome = await transact(store, code, clock, state => {
          const viewer = activityViewer(state, bearer, true);
          if (!isCampaign(state) || !['teacher', 'student'].includes(viewer.kind)) fail(403, 'Entre na campanha para abrir o dossiê.');
          const teamId = resourceId || viewer.teamId;
          if (viewer.kind === 'student' && viewer.teamId !== teamId) fail(403, 'O dossiê pertence a outra equipe.');
          const team = state.teams.find(t => t.id === teamId);
          if (!team?.campaign?.documentUnlocked) fail(409, 'O PDF está bloqueado. Reúna as chaves e conclua a brute force.');
          return { bytes: dossierPdf(team.name, team.campaign.accessCode) };
        }, true);
        res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'attachment; filename="dossie-pentagono.pdf"');
        res.setHeader('Content-Length', outcome.result.bytes.length); res.statusCode = 200; return res.end(outcome.result.bytes);
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
