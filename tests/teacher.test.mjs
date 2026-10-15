import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../lib/http.mjs';
import { createStore } from '../lib/store.mjs';
import { newActivity, addParticipant, action, viewerFor } from '../lib/engine.mjs';
import { startCampaign } from '../lib/campaign.mjs';

const PASSWORD = 'senha-privada-do-dashboard';
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

async function fixture(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'deepweb-teacher-test-'));
  const store = createStore({ dataDir, supabaseUrl: '', supabaseKey: '' });
  let now = Date.UTC(2026, 9, 15, 12);
  const servers = [];
  async function open(appOptions = options) {
    const server = createServer(createApp({ store, clock: () => now, teacherPassword: PASSWORD, ...appOptions }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
  }
  const base = await open();
  t.after(async () => {
    for (const server of servers) {
      server.closeIdleConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
    assert.ok(dataDir.startsWith(join(tmpdir(), 'deepweb-teacher-test-')));
    await rm(dataDir, { recursive: true, force: true });
  });
  async function request(path, { token, body, origin, baseUrl = base } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (origin) headers.Origin = origin;
    const response = await fetch(baseUrl + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  }
  async function login(extra = {}) {
    const response = await request('/api/teacher/login', { body: { password: PASSWORD }, ...extra });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data;
  }
  async function seed(code, { mode = 'classic', createdAt = now, status = 'lobby', score = 75 } = {}) {
    const teacherToken = `teacher-original-${code}`;
    const studentToken = `student-original-${code}`;
    const state = newActivity({ title: `Turma ${code}`, mode }, teacherToken, createdAt);
    state.code = code;
    const participantId = addParticipant(state, { name: `Aluno reservado ${code}` }, studentToken, createdAt);
    action(state, viewerFor(state, teacherToken), { type: 'team-create', name: `Time ${code}`, memberIds: [participantId] }, createdAt);
    state.teams[0].score = score;
    state.status = status;
    if (status === 'finished') { state.startedAt = createdAt + 1000; state.endsAt = createdAt + 61000; state.finishedAt = createdAt + 61000; }
    await store.create(code, state);
    return { state, teacherToken, studentToken, participantId, teamId: state.teams[0].id };
  }
  return { store, request, login, seed, open, now: () => now, advance: ms => { now += ms; } };
}

test('dashboard login protects the complete history and uses expiring signed sessions', async t => {
  const f = await fixture(t);
  const saved = await f.seed('AAAAAA');
  for (const token of [undefined, saved.teacherToken, saved.studentToken, 'teacher.invalid.signature']) {
    assert.equal((await f.request('/api/teacher/activities', { token })).status, 401);
  }
  assert.equal((await f.request('/api/teacher/login', { body: { password: 'incorrecta' } })).status, 403);
  assert.equal((await f.request('/api/teacher/login', { body: { password: PASSWORD }, origin: 'https://outro-site.example' })).status, 403);
  const session = await f.login();
  assert.equal(session.expiresAt, f.now() + 12 * 60 * 60 * 1000);
  assert.equal(JSON.stringify(session).includes(PASSWORD), false);
  const created = await f.request('/api/activities', { token: session.token, body: { title: 'Criada pelo dashboard' } });
  assert.equal(created.status, 201);
  assert.equal(created.data.snapshot.viewer.kind, 'teacher');
  assert.equal((await f.request('/api/activities', { token: 'teacher.invalid.signature', body: { title: 'Não permitida' } })).status, 401);
  assert.equal((await f.request('/api/teacher/activities', { token: session.token })).status, 200);
  assert.equal((await f.request('/api/teacher/activities', { token: session.token.slice(0, -1) + '!' })).status, 401);
  const secondInstance = await f.open();
  assert.equal((await f.request('/api/teacher/activities', { token: session.token, baseUrl: secondInstance })).status, 200);
  const changedPassword = await f.open({ teacherPassword: 'outra-senha' });
  assert.equal((await f.request('/api/teacher/activities', { token: session.token, baseUrl: changedPassword })).status, 401);
  f.advance(12 * 60 * 60 * 1000);
  assert.equal((await f.request('/api/teacher/activities', { token: session.token })).status, 401);
  assert.equal((await f.request('/api/activities/AAAAAA', { token: session.token })).status, 401);
});

test('passwordless dashboard is available only with the local teacher gate', async t => {
  const f = await fixture(t, { teacherPassword: '', allowLocalTeacher: true });
  const local = await f.login({ body: {} });
  assert.equal((await f.request('/api/teacher/activities', { token: local.token })).status, 200);
  const app = createApp({ store: f.store, teacherPassword: '', allowLocalTeacher: true });
  const remoteRequest = { method: 'POST', url: '/api/teacher/login', headers: { host: 'arena.local', 'content-type': 'application/json' }, socket: { remoteAddress: '192.168.1.50' }, async *[Symbol.asyncIterator]() { yield Buffer.from('{}'); } };
  let remoteBody;
  const remoteResponse = { setHeader() {}, end(value) { remoteBody = value; } };
  await app(remoteRequest, remoteResponse);
  assert.equal(remoteResponse.statusCode, 403);
  assert.equal(JSON.parse(remoteBody).token, undefined);
  const disabled = await f.open({ teacherPassword: '', allowLocalTeacher: false });
  assert.equal((await f.request('/api/teacher/login', { body: {}, baseUrl: disabled })).status, 403);
});

test('teacher history is recent-first, paginated, private and preserves legacy activity records', async t => {
  const f = await fixture(t);
  await f.seed('AAAAAA', { createdAt: f.now() - 10000, status: 'finished' });
  await f.seed('BBBBBB', { createdAt: f.now() - 5000, mode: 'campaign', status: 'finished', score: 125 });
  await f.seed('CCCCCC', { createdAt: f.now(), mode: 'campaign' });
  await f.seed('DDDDDD', { createdAt: f.now() });
  const session = await f.login();
  const before = await Promise.all(['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD'].map(code => f.store.read(code)));
  const first = await f.request('/api/teacher/activities?limit=2', { token: session.token });
  assert.equal(first.status, 200);
  assert.deepEqual(first.data.activities.map(activity => activity.code), ['CCCCCC', 'DDDDDD']);
  assert.equal(first.data.hasMore, true);
  assert.equal(first.data.offset, 0);
  assert.equal(first.data.limit, 2);
  const second = await f.request('/api/teacher/activities?offset=2&limit=2', { token: session.token });
  assert.deepEqual(second.data.activities.map(activity => activity.code), ['BBBBBB', 'AAAAAA']);
  assert.equal(second.data.hasMore, false);
  assert.deepEqual(second.data.activities[0].winners, [{ name: 'Time BBBBBB', score: 125 }]);
  assert.equal(second.data.activities[0].participantCount, 1);
  assert.equal(second.data.activities[0].teamCount, 1);
  const text = JSON.stringify([first.data, second.data]);
  for (const privateValue of ['teacherHash', 'tokenHash', 'Aluno reservado', 'student-original', 'teacher-original', 'documentKey', 'commandGuard']) assert.equal(text.includes(privateValue), false, privateValue);
  assert.deepEqual(await Promise.all(['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD'].map(code => f.store.read(code))), before);
  for (const query of ['offset=-1', 'offset=no', 'limit=0', 'limit=101', 'limit=1.5', 'offset=9007199254740991']) {
    assert.equal((await f.request(`/api/teacher/activities?${query}`, { token: session.token })).status, 400, query);
  }
});

test('dashboard can recover teacher controls and metrics without replacing original capabilities', async t => {
  const f = await fixture(t);
  const session = await f.login();
  for (const [code, mode] of [['AAAAAA', 'classic'], ['BBBBBB', 'campaign']]) {
    const saved = await f.seed(code, { mode });
    const initialHash = (await f.store.read(code)).state.teacherHash;
    const recovered = await f.request(`/api/activities/${code}`, { token: session.token });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.data.viewer.kind, 'teacher');
    assert.equal(recovered.data.teamMetrics.length, 1);
    assert.equal(recovered.data.teamMetrics[0].members[0].name, `Aluno reservado ${code}`);
    const upload = await f.request(`/api/activities/${code}/documents/${saved.teamId}`, { token: session.token, body: { name: 'resultado.pdf', base64: PDF.toString('base64') } });
    assert.equal(upload.status, 200);
    assert.equal((await f.request(`/api/activities/${code}/action`, { token: session.token, body: { type: 'prepare' } })).status, 200);
    assert.equal((await f.request(`/api/activities/${code}`, { token: saved.teacherToken })).data.viewer.kind, 'teacher');
    assert.equal((await f.request(`/api/activities/${code}`, { token: saved.studentToken })).data.viewer.kind, 'student');
    assert.equal((await f.store.read(code)).state.teacherHash, initialHash);
    assert.equal((await f.store.read(code)).state.teams[0].score, 75);
    assert.equal((await f.request(`/api/activities/${code}/action`, { token: saved.studentToken, body: { type: 'prepare' } })).status, 403);
    if (mode === 'campaign') {
      const record = await f.store.read(code);
      record.state.teams[0].campaign.documentUnlocked = true;
      record.state.teams[0].campaign.accessCode = '1234';
      await f.store.compareAndSwap(code, record.revision, record.state);
      const dossier = await f.request(`/api/activities/${code}/dossier/${saved.teamId}`, { token: session.token });
      assert.equal(dossier.status, 200);
      assert.equal(dossier.data.subarray(0, 5).toString(), '%PDF-');
    }
  }
});

test('expired legacy activities finalize once while listing and retain the same final points', async t => {
  const f = await fixture(t);
  await f.seed('AAAAAA', { createdAt: f.now() - 200000 });
  const record = await f.store.read('AAAAAA');
  delete record.state.mode;
  record.state.status = 'running';
  record.state.startedAt = f.now() - 120000;
  record.state.endsAt = f.now() - 60000;
  record.state.teams[0].document = { key: 'private-pdf', name: 'reservado.pdf', size: 12 };
  await f.store.compareAndSwap('AAAAAA', record.revision, record.state);
  const before = await f.store.read('AAAAAA');
  const session = await f.login();
  const listing = await f.request('/api/teacher/activities', { token: session.token });
  assert.equal(listing.status, 200);
  assert.equal(listing.data.activities[0].mode, 'classic');
  assert.equal(listing.data.activities[0].status, 'finished');
  assert.equal(listing.data.activities[0].winners[0].score, 125);
  const settled = await f.store.read('AAAAAA');
  assert.equal(settled.revision, before.revision + 1);
  assert.equal(settled.state.status, 'finished');
  assert.equal(settled.state.teams[0].score, 125);
  const repeated = await f.request('/api/teacher/activities', { token: session.token });
  assert.deepEqual(repeated.data.activities, listing.data.activities);
  assert.deepEqual(await f.store.read('AAAAAA'), settled);
  const result = await f.request('/api/activities/AAAAAA', { token: session.token });
  assert.equal(result.data.ranking[0].score, listing.data.activities[0].winners[0].score);
  assert.deepEqual(await f.store.read('AAAAAA'), settled);
});

test('expired campaign AI results are saved once and active campaigns are not simulated by the index', async t => {
  const f = await fixture(t);
  const saved = await f.seed('AAAAAA', { mode: 'campaign', createdAt: f.now() - 180000 });
  const record = await f.store.read('AAAAAA');
  const state = record.state;
  for (const name of ['Segundo time', 'Terceiro time']) {
    const participantId = addParticipant(state, { name: `Aluno ${name}` }, `token-${name}`, f.now() - 180000);
    action(state, viewerFor(state, saved.teacherToken), { type: 'team-create', name, memberIds: [participantId] }, f.now() - 180000);
  }
  state.status = 'running'; state.startedAt = f.now() - 120000; state.endsAt = f.now() + 60000;
  startCampaign(state, state.startedAt);
  for (const key of state.keys) key.holderTeamId = saved.teamId;
  state.teams[0].score = 25;
  state.teams[0].campaign.interpol = { nextWaveAt: f.now() + 30000, wave: 1 };
  for (const team of state.teams.slice(1)) { team.score = 75; team.campaign.controlSince = null; }
  state.incidents.push({ id: 'interpol-pending', bot: 'interpol', defenderTeamId: saved.teamId, attackerId: null, attackerTeamId: null, stage: 1, status: 'active', deadline: f.now() - 2000, lastActionAt: f.now() - 5000, wave: 1, lastAttackSeq: 1, lastDefenseSeq: 0 });
  await f.store.compareAndSwap(state.code, record.revision, state);
  const before = await f.store.read(state.code);
  const session = await f.login();
  const active = await f.request('/api/teacher/activities', { token: session.token });
  assert.equal(active.data.activities[0].status, 'running');
  assert.deepEqual(active.data.activities[0].winners, []);
  assert.deepEqual(await f.store.read(state.code), before);
  f.advance(61000);
  const first = await f.request('/api/teacher/activities', { token: session.token });
  assert.equal(first.status, 200);
  const finished = await f.store.read(state.code);
  assert.equal(finished.state.status, 'finished');
  assert.equal(finished.revision, before.revision + 1);
  assert.equal(finished.state.keys.filter(key => key.ownerTeamId !== saved.teamId && key.holderTeamId === key.ownerTeamId).length, 1);
  const detail = await f.request(`/api/activities/${state.code}`, { token: session.token });
  const winningScore = detail.data.ranking[0].score;
  assert.deepEqual(first.data.activities[0].winners, detail.data.ranking.filter(team => team.score === winningScore).map(team => ({ name: team.name, score: team.score })));
  const again = await f.request('/api/teacher/activities', { token: session.token });
  assert.deepEqual(again.data.activities, first.data.activities);
  assert.deepEqual(await f.store.read(state.code), finished);
});

test('Supabase history uses authenticated REST with stable ordering and an extra row for pagination', async t => {
  const calls = [];
  const states = ['AAAAAA', 'BBBBBB', 'CCCCCC'].map(code => ({ code, createdAt: 100, teacherHash: 'private' }));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: new URL(url), options });
    return new Response(JSON.stringify(states.map(state => ({ state, revision: 1 }))), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const store = createStore({ supabaseUrl: 'https://private.example', supabaseKey: 'sb_secret_test_private' });
  const page = await store.list({ offset: 10, limit: 2 });
  assert.equal(page.records.length, 2);
  assert.equal(page.hasMore, true);
  assert.equal(calls[0].url.pathname, '/rest/v1/thor_activities');
  assert.equal(calls[0].url.searchParams.get('order'), 'created_at.desc,code.asc');
  assert.equal(calls[0].url.searchParams.get('offset'), '10');
  assert.equal(calls[0].url.searchParams.get('limit'), '3');
  assert.equal(calls[0].options.headers.apikey, 'sb_secret_test_private');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  await assert.rejects(store.list({ offset: -1, limit: 2 }), { status: 400 });
});
