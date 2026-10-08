import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../lib/http.mjs';
import { createStore } from '../lib/store.mjs';
import { LIMITS, EFFECTS, newActivity, addParticipant, action as engineAction, normalizeState, snapshot as engineSnapshot, viewerFor } from '../lib/engine.mjs';

const PASSWORD = 'senha-do-professor-em-teste';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');

async function fixture(t, { maxIncoming = 2 } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'deepweb-arena-test-'));
  let now = Date.UTC(2026, 9, 8, 15);
  let server;
  let base;
  async function open() {
    const store = await createStore({ dataDir, supabaseUrl: '', supabaseKey: '' });
    const handler = await createApp({
      store, clock: () => now, teacherPassword: PASSWORD, allowLocalTeacher: true,
    });
    server = createServer(handler);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function close() {
    if (!server?.listening) return;
    server.closeIdleConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  t.after(async () => {
    await close();
    // This directory is freshly created and owned by this test fixture.
    assert.ok(dataDir.startsWith(join(tmpdir(), 'deepweb-arena-test-')));
    await rm(dataDir, { recursive: true, force: true });
  });
  await open();

  async function request(path, { token, body, method = body === undefined ? 'GET' : 'POST' } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(base + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await response.json()
      : Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers: response.headers, data };
  }
  function ok(result) {
    assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result.data));
    return result.data;
  }
  function denied(result) {
    assert.ok(result.status >= 400 && result.status < 500, `Expected rejection: ${JSON.stringify(result.data)}`);
    assert.equal(typeof result.data.error, 'string');
    return result;
  }
  const activity = ok(await request('/api/activities', {
    body: { title: 'Arena Fecart de teste', password: PASSWORD, maxIncoming },
  }));
  assert.equal(typeof activity.code, 'string');
  assert.equal(typeof activity.token, 'string');
  const prefix = `/api/activities/${activity.code}`;
  async function action(token, body) {
    if (['attack', 'defense', 'logs'].includes(body.type)) {
      const current = await snapshot(token);
      body = { entryMode: 'typed', nonce: current.viewer.commandGuard?.nonce, ...body };
    }
    return request(prefix + '/action', { token, body });
  }
  async function snapshot(token = activity.token) {
    const data = ok(await request(prefix, { token }));
    return data.snapshot ?? data;
  }
  async function student(name) {
    const person = ok(await request(prefix + '/join', { body: { name } }));
    assert.equal(typeof person.participantId, 'string');
    assert.equal(typeof person.token, 'string');
    return { ...person, name };
  }
  async function document(teamId, pdf = PDF, token = activity.token, name = 'retrospectiva.pdf') {
    return request(prefix + '/documents/' + teamId, {
      token, body: { name, base64: pdf.toString('base64') },
    });
  }
  async function createTeam(name, members, roles = members.map((_, index) => index ? 'defense' : 'attack')) {
    const before = new Set((await snapshot()).teams.map(team => team.id));
    ok(await action(activity.token, { type: 'team-create', name, memberIds: members.map(member => member.participantId) }));
    const team = (await snapshot()).teams.find(team => !before.has(team.id));
    assert.ok(team, 'The teacher-created team must appear in the activity');
    await Promise.all(members.map(async (member, index) => {
      member.role = roles[index];
      ok(await action(member.token, { type: 'role', role: member.role }));
    }));
    return { ...team, members };
  }
  async function teams(count = 3, roles) {
    const result = [];
    for (let index = 0; index < count; index++) {
      const members = await Promise.all([0, 1, 2].map(member => student(`Aluno privado ${index}-${member}`)));
      const team = await createTeam(`Equipe ${index + 1}`, members, roles?.[index]);
      ok(await document(team.id));
      result.push(team);
    }
    return result;
  }
  async function start(minutes = 10) {
    ok(await action(activity.token, { type: 'prepare' }));
    return ok(await action(activity.token, { type: 'start', minutes }));
  }
  async function attack(person, target, command) {
    return action(person.token, { type: 'attack', targetTeamId: target.id ?? target, command });
  }
  async function capture(person, target) {
    let result;
    for (const command of ['scan', 'inspect', 'access', 'extract']) {
      result = ok(await attack(person, target, command));
      now += 4001;
    }
    assert.ok(result.download?.ticket, 'A validated capture must return a download ticket');
    return result;
  }
  return {
    request, ok, denied, activity, prefix, action, snapshot, student, document,
    createTeam, teams, start, attack, capture,
    advance: milliseconds => { now += milliseconds; },
    restart: async () => { await close(); await open(); },
  };
}

test('teacher permissions, team membership, PDF validation and readiness protect the activity', async t => {
  const f = await fixture(t);
  const members = await Promise.all([0, 1, 2, 3].map(index => f.student(`Pessoa reservada ${index}`)));
  f.denied(await f.action(members[0].token, {
    type: 'team-create', name: 'Sem autorização', memberIds: members.slice(0, 2).map(member => member.participantId),
  }));
  for (const count of [0]) {
    f.denied(await f.action(f.activity.token, {
      type: 'team-create', name: 'Tamanho inválido', memberIds: members.slice(0, count).map(member => member.participantId),
    }));
  }
  const first = await f.createTeam('Dupla', members.slice(0, 2), ['attack', 'defense']);
  const secondMembers = await Promise.all([0, 1].map(index => f.student(`Outra pessoa ${index}`)));
  const second = await f.createTeam('Outra dupla', secondMembers, ['attack', 'defense']);
  f.denied(await f.document(first.id, PDF, members[0].token));
  f.denied(await f.document(first.id, Buffer.from('Este arquivo não é um PDF')));
  const oversized = Buffer.alloc(3 * 1024 * 1024 + 1, 32);
  oversized.write('%PDF-1.4');
  f.denied(await f.document(first.id, oversized));
  assert.equal((await f.snapshot()).teams.find(team => team.id === first.id).document.ready, false);
  const limit = Buffer.alloc(3 * 1024 * 1024, 32);
  limit.write('%PDF-1.4');
  f.ok(await f.document(first.id, limit));
  f.ok(await f.action(f.activity.token, { type: 'prepare' }));
  f.denied(await f.action(f.activity.token, { type: 'start', minutes: 10 }));
  f.ok(await f.document(second.id));
  f.denied(await f.action(f.activity.token, { type: 'start', minutes: 0 }));
  f.ok(await f.action(f.activity.token, { type: 'start', minutes: 10 }));
  f.denied(await f.action(members[0].token, { type: 'finish' }));
  f.denied(await f.document(first.id));
});

test('groups accept one, four or eight members and still require attacker and defender before starting', async t => {
  const f = await fixture(t);
  const people = await Promise.all(Array.from({ length: 13 }, (_, index) => f.student('Integrante ' + index)));
  f.denied(await f.action(f.activity.token, { type: 'team-create', name: 'Repetido', memberIds: [people[0].participantId, people[0].participantId] }));
  f.denied(await f.action(f.activity.token, { type: 'team-create', name: 'Inexistente', memberIds: ['not-a-participant'] }));
  const solo = await f.createTeam('Em organização', people.slice(0, 1));
  const large = await f.createTeam('Grupo de oito', people.slice(1, 9));
  const four = await f.createTeam('Grupo de quatro', people.slice(9));
  const state = await f.snapshot();
  assert.deepEqual(state.teams.map(team => team.memberIds.length), [1, 8, 4]);
  assert.equal(new Set(state.teams.flatMap(team => team.memberIds)).size, 13);
  f.denied(await f.action(f.activity.token, { type: 'team-create', name: 'Já atribuído', memberIds: [people[1].participantId] }));
  for (const team of [solo, large, four]) f.ok(await f.document(team.id));
  f.ok(await f.action(f.activity.token, { type: 'prepare' }));
  const rejected = f.denied(await f.action(f.activity.token, { type: 'start', minutes: 10 }));
  assert.match(rejected.data.error, /Em organização precisa de pelo menos um atacante e um defensor/);
  f.ok(await f.action(f.activity.token, { type: 'team-delete', teamId: solo.id }));
  f.ok(await f.action(f.activity.token, { type: 'start', minutes: 10 }));
  await f.capture(large.members[0], four);
  assert.equal((await f.snapshot()).teams.find(team => team.id === large.id).score, 50);
});

test('roles, incoming limits and public snapshots isolate participants and private documents', async t => {
  const f = await fixture(t, { maxIncoming: 1 });
  const teams = await f.teams();
  await f.start();
  const [alpha, beta, gamma] = teams;
  f.denied(await f.attack(alpha.members[1], beta, 'scan'));
  f.denied(await f.attack(alpha.members[2], beta, 'scan'));
  f.denied(await f.attack(gamma.members[0], gamma, 'scan'));
  f.ok(await f.attack(alpha.members[0], beta, 'scan'));
  f.denied(await f.attack(alpha.members[0], beta, 'inspect'));
  f.denied(await f.attack(gamma.members[0], beta, 'scan'));
  f.denied(await f.attack(alpha.members[0], gamma, 'scan'));
  f.ok(await f.attack(gamma.members[0], alpha, 'scan'));
  const teacher = await f.snapshot();
  const incident = teacher.incidents.find(item => item.attackerId === alpha.members[0].participantId);
  assert.ok(incident);
  f.denied(await f.action(beta.members[0].token, { type: 'defense', incidentId: incident.id, command: 'block' }));
  f.denied(await f.action(gamma.members[1].token, { type: 'defense', incidentId: incident.id, command: 'block' }));
  const publicText = JSON.stringify(await f.snapshot(null));
  const studentText = JSON.stringify(await f.snapshot(alpha.members[0].token));
  for (const team of teams) {
    for (const person of team.members) {
      assert.equal(publicText.includes(person.name), false, 'Public data must not reveal individual names');
      assert.equal(publicText.includes(person.token), false, 'Public data must not reveal participant tokens');
      assert.equal(studentText.includes(person.token), false, 'A student snapshot must not reveal bearer tokens');
    }
  }
  assert.equal(publicText.includes(f.activity.token), false);
  assert.equal(studentText.includes(f.activity.token), false);
  for (const text of [publicText, studentText]) {
    assert.equal(/"(?:base64|documentPath|filePath|dataDir)"\s*:/.test(text), false);
    assert.equal(text.includes('deepweb-arena-test-'), false);
  }
  f.denied(await f.request(f.prefix, { token: 'token-inexistente' }));
});

test('two members racing for the same target award only one capture and one set of points', async t => {
  const f = await fixture(t);
  const [attackers, target] = await f.teams(2, [['attack', 'attack', 'defense'], ['attack', 'defense', 'defense']]);
  await f.start();
  for (const command of ['scan', 'inspect', 'access']) {
    await Promise.all(attackers.members.slice(0, 2).map(async member => f.ok(await f.attack(member, target, command))));
    f.advance(4001);
  }
  const results = await Promise.all(attackers.members.slice(0, 2).map(member => f.attack(member, target, 'extract')));
  assert.equal(results.filter(result => result.status >= 200 && result.status < 300).length, 1);
  f.denied(results.find(result => result.status >= 400));
  const snapshot = await f.snapshot();
  const team = snapshot.teams.find(team => team.id === attackers.id);
  assert.equal(team.captureCount, 1);
  assert.equal(team.score, 50);
  assert.equal(snapshot.teams.find(team => team.id === target.id).compromised, true);
  f.advance(4001);
  f.denied(await f.attack(attackers.members[0], target, 'extract'));
  const after = (await f.snapshot()).teams.find(team => team.id === attackers.id);
  assert.equal(after.captureCount, 1);
  assert.equal(after.score, 50);
});

test('defenses match stages, preserve other incidents and enforce the player interval across connections', async t => {
  const f = await fixture(t);
  const [alpha, defender, gamma] = await f.teams();
  await f.start();
  await Promise.all([alpha, gamma].map(async team => f.ok(await f.attack(team.members[0], defender, 'scan'))));
  let state = await f.snapshot();
  const incident = state.incidents.find(item => item.attackerTeamId === alpha.id);
  const unrelated = state.incidents.find(item => item.attackerTeamId === gamma.id);
  const respond = (id, command) => f.action(defender.members[1].token, { type: 'defense', incidentId: id, command });
  f.denied(await respond(incident.id, 'block'));
  f.denied(await respond(incident.id, 'revoke'));
  f.ok(await respond(incident.id, 'reroute'));
  state = await f.snapshot();
  assert.equal(state.incidents.find(item => item.id === incident.id).stage, 0);
  assert.deepEqual(state.incidents.find(item => item.id === unrelated.id), unrelated);
  assert.equal(state.teams.find(team => team.id === defender.id).score, 5);
  assert.equal((await respond(unrelated.id, 'reroute')).status, 429);
  f.advance(4001);
  f.ok(await f.attack(alpha.members[0], defender, 'scan'));
  assert.equal((await respond(incident.id, 'reroute')).status, 429);
  f.advance(1001);
  f.ok(await respond(incident.id, 'reroute'));
  f.advance(5001);
  f.denied(await respond(incident.id, 'reroute'));
  f.ok(await f.attack(alpha.members[0], defender, 'scan'));
  f.advance(4001);
  f.ok(await f.attack(alpha.members[0], defender, 'inspect'));
  f.denied(await respond(incident.id, 'reroute'));
  f.ok(await respond(incident.id, 'block'));
  assert.equal((await f.snapshot()).incidents.find(i => i.id === incident.id).status, 'blocked');
  f.advance(8001);
  f.ok(await f.attack(alpha.members[0], defender, 'reconnect'));
  for (const command of ['scan', 'inspect', 'access']) {
    f.advance(4001);
    f.ok(await f.attack(alpha.members[0], defender, command));
  }
  f.denied(await respond(incident.id, 'block'));
  f.ok(await respond(incident.id, 'revoke'));
  const final = await f.snapshot();
  assert.equal(final.incidents.find(i => i.id === incident.id).stage, 2);
  assert.equal(final.teams.find(team => team.id === defender.id).defenseCount, 4);
  assert.equal(final.teams.find(team => team.id === defender.id).score, 20);
});

test('download tickets authorize PDF bytes once and remain separate from capture scoring', async t => {
  const f = await fixture(t);
  const [alpha, beta] = await f.teams(2);
  await f.start();
  const capture = await f.capture(alpha.members[0], beta);
  f.denied(await f.request(f.prefix + '/download/ticket-inexistente'));
  const first = await f.request(f.prefix + '/download/' + capture.download.ticket);
  assert.equal(first.status, 200);
  assert.match(first.headers.get('content-type'), /application\/pdf/);
  assert.deepEqual(first.data, PDF);
  const repeated = await f.request(f.prefix + '/download/' + capture.download.ticket);
  assert.ok(repeated.status >= 400 && repeated.status < 500);
  const team = (await f.snapshot()).teams.find(team => team.id === alpha.id);
  assert.equal(team.captureCount, 1);
  assert.equal(team.score, 50);
});

test('switching targets closes only the requesting attacker and cannot bypass cooldown or duplicate captures', async t => {
  const f = await fixture(t);
  const [alpha, beta, gamma] = await f.teams(3, [['attack', 'attack', 'defense'], ['attack', 'defense', 'defense'], ['attack', 'defense', 'defense']]);
  await f.start();
  f.ok(await f.attack(alpha.members[0], beta, 'scan'));
  f.ok(await f.attack(alpha.members[1], beta, 'scan'));
  const before = await f.snapshot();
  f.denied(await f.action(alpha.members[2].token, { type: 'attack-abandon' }));
  f.ok(await f.action(alpha.members[0].token, { type: 'attack-abandon' }));
  let state = await f.snapshot();
  assert.equal(state.incidents.find(i => i.attackerId === alpha.members[0].participantId).status, 'abandoned');
  assert.deepEqual(state.incidents.find(i => i.attackerId === alpha.members[1].participantId), before.incidents.find(i => i.attackerId === alpha.members[1].participantId));
  assert.equal(state.teams.find(team => team.id === alpha.id).score, 0);
  assert.equal((await f.attack(alpha.members[0], gamma, 'scan')).status, 429);
  f.advance(4001);
  await f.capture(alpha.members[0], gamma);
  f.denied(await f.attack(alpha.members[0], gamma, 'scan'));
  f.ok(await f.attack(alpha.members[0], beta, 'scan'));
  state = await f.snapshot();
  assert.equal(state.incidents.filter(i => i.attackerId === alpha.members[0].participantId && i.status === 'active')[0].stage, 1);
  assert.equal(state.teams.find(team => team.id === alpha.id).captureCount, 1);
  f.ok(await f.action(alpha.members[0].token, { type: 'attack-abandon' }));
  f.advance(LIMITS.attackMs);
  for (const command of ['inspect', 'access', 'extract']) {
    f.ok(await f.attack(alpha.members[1], beta, command));
    f.advance(LIMITS.attackMs);
  }
  state = await f.snapshot();
  assert.ok(state.incidents.filter(i => i.attackerId === alpha.members[0].participantId && i.defenderTeamId === beta.id).every(i => i.status === 'abandoned'));
});

test('manual finish adds survival once and blocks new attack points', async t => {
  const f = await fixture(t);
  const [alpha, beta, gamma] = await f.teams();
  await f.start();
  await f.capture(alpha.members[0], beta);
  f.ok(await f.action(f.activity.token, { type: 'finish' }));
  for (let read = 0; read < 3; read++) {
    const state = await f.snapshot();
    const score = id => state.teams.find(team => team.id === id);
    assert.equal(score(alpha.id).survivalBonus, 50);
    assert.equal(score(alpha.id).score, 100);
    assert.equal(score(beta.id).survivalBonus, 0);
    assert.equal(score(beta.id).score, 0);
    assert.equal(score(gamma.id).survivalBonus, 50);
    assert.equal(score(gamma.id).score, 50);
  }
  const duplicate = await f.action(f.activity.token, { type: 'finish' });
  assert.ok(duplicate.status < 500);
  f.denied(await f.attack(gamma.members[0], alpha, 'scan'));
  assert.equal((await f.snapshot()).teams.find(team => team.id === alpha.id).score, 100);
});

test('announcements reach every student, extension postpones expiry and GET finalizes exactly once', async t => {
  const f = await fixture(t);
  const teams = await f.teams(2);
  await f.start(1);
  const text = 'Aviso coletivo de teste: faltam dois minutos.';
  f.ok(await f.action(f.activity.token, { type: 'announce', text }));
  await Promise.all(teams.flatMap(team => team.members).map(async person => {
    assert.ok(JSON.stringify(await f.snapshot(person.token)).includes(text));
  }));
  for (const minutes of [0, 61]) {
    f.denied(await f.action(f.activity.token, { type: 'extend', minutes }));
  }
  f.advance(30000);
  f.ok(await f.action(f.activity.token, { type: 'extend', minutes: 2 }));
  f.advance(31000);
  assert.ok((await f.snapshot()).teams.every(team => team.survivalBonus === 0));
  f.advance(120000);
  await f.snapshot(null); // Even a public read must settle an expired activity.
  for (let read = 0; read < 2; read++) {
    assert.ok((await f.snapshot()).teams.every(team => team.survivalBonus === 50 && team.score === 50));
  }
  f.denied(await f.attack(teams[0].members[0], teams[1], 'scan'));
});

test('an action arriving after expiry finalizes before applying attack or defense', async t => {
  const f = await fixture(t);
  const [alpha, beta] = await f.teams(2);
  await f.start(1);
  f.ok(await f.attack(alpha.members[0], beta, 'scan'));
  f.advance(60001);
  f.denied(await f.attack(alpha.members[0], beta, 'inspect'));
  const state = await f.snapshot();
  assert.ok(state.teams.every(team => team.survivalBonus === 50 && team.captureCount === 0));
});

test('reopening storage preserves teacher/student access, teams, PDFs and recorded points', async t => {
  const f = await fixture(t);
  const [alpha, beta] = await f.teams(2);
  await f.start();
  await f.restart();
  let state = await f.snapshot();
  assert.equal(state.teams.length, 2);
  assert.ok(state.teams.every(team => team.document.ready));
  const capture = await f.capture(alpha.members[0], beta);
  await f.restart();
  state = await f.snapshot();
  const team = state.teams.find(team => team.id === alpha.id);
  assert.equal(team.score, 50);
  assert.equal(team.captureCount, 1);
  const download = await f.request(f.prefix + '/download/' + capture.download.ticket);
  assert.equal(download.status, 200);
  assert.deepEqual(download.data, PDF);
});

test('guided buttons are consumed once per person, survive reload and require an exact typed command afterwards', async t => {
  const f = await fixture(t);
  const [alpha, beta] = await f.teams(2);
  await f.start();
  const person = alpha.members[0];
  const guide = await f.action(person.token, { type: 'command-guide', command: 'scan' });
  f.ok(guide);
  const nonce = guide.data.snapshot.viewer.commandGuard.nonce;
  f.denied(await f.action(person.token, { type: 'command-guide', command: 'scan' }));
  f.ok(await f.request(f.prefix + '/action', { token: person.token, body: { type: 'attack', command: 'scan', targetTeamId: beta.id, entryMode: 'guided', nonce } }));
  await f.restart();
  const current = await f.snapshot(person.token);
  assert.deepEqual(current.viewer.commandGuard.guidedUsed, ['scan']);
  f.advance(LIMITS.attackMs);
  const before = await f.snapshot();
  for (const command of ['INSPECT', 'inspect extra', 'inspec', '']) {
    f.denied(await f.attack(person, beta, command));
    assert.deepEqual((await f.snapshot()).incidents, before.incidents);
  }
  f.denied(await f.action(person.token, { type: 'attack', command: 'inspect', targetTeamId: beta.id, entryMode: 'guided' }));
  f.ok(await f.attack(person, beta, 'inspect'));
  const incident = (await f.snapshot()).incidents[0];
  f.ok(await f.action(beta.members[1].token, { type: 'defense', incidentId: incident.id, command: 'block' }));
  f.advance(LIMITS.attackMs);
  f.ok(await f.attack(person, beta, 'reconnect'));
  f.advance(LIMITS.attackMs);
  f.ok(await f.attack(person, beta, 'scan'));
  f.denied(await f.action(person.token, { type: 'command-guide', command: 'scan' }));
  assert.equal((await f.snapshot()).teamMetrics.find(m => m.teamId === alpha.id).members[0].attackByCommand.scan, 2);
});

test('concurrent replay accepts one command and autoclick locks persist without blocking other players', async t => {
  const f = await fixture(t);
  const [alpha, beta] = await f.teams(2, [['attack', 'attack', 'defense'], ['attack', 'defense', 'defense']]);
  await f.start();
  const person = alpha.members[0];
  const current = await f.snapshot(person.token);
  const body = { type: 'attack', targetTeamId: beta.id, command: 'scan', entryMode: 'typed', nonce: current.viewer.commandGuard.nonce };
  const results = await Promise.all([0, 1].map(() => f.request(f.prefix + '/action', { token: person.token, body })));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal((await f.snapshot()).incidents[0].stage, 1);
  f.advance(LIMITS.attackMs);
  f.denied(await f.request(f.prefix + '/action', { token: person.token, body })); // Old nonce even after the interval.
  for (let count = 0; count < 3; count++) f.denied(await f.request(f.prefix + '/action', { token: person.token, body: { ...body, nonce: 'invalid' } }));
  let locked = await f.snapshot(person.token);
  assert.equal(locked.viewer.commandGuard.lockedUntil - locked.serverNow, 8000);
  await f.restart();
  locked = await f.snapshot(person.token);
  f.denied(await f.attack(person, beta, 'inspect'));
  f.ok(await f.attack(alpha.members[1], beta, 'scan'));
  const privateNonce = locked.viewer.commandGuard.nonce;
  assert.equal(JSON.stringify(await f.snapshot(alpha.members[1].token)).includes(privateNonce), false);
  assert.equal(JSON.stringify(await f.snapshot()).includes(privateNonce), false);
  assert.equal(JSON.stringify(await f.snapshot(null)).includes(privateNonce), false);
  f.advance(8000);
  f.ok(await f.attack(person, beta, 'inspect'));
  assert.equal((await f.snapshot()).incidents.find(i => i.attackerId === person.participantId).stage, 2);
});

test('simultaneous defenders share a bounded reserve; invalid defenses cost nothing and recharge cannot be duplicated', async t => {
  const f = await fixture(t);
  const [alpha, beta] = await f.teams(2, [['attack', 'attack', 'defense'], ['attack', 'defense', 'defense']]);
  await f.start();
  await Promise.all(alpha.members.slice(0, 2).map(async person => f.ok(await f.attack(person, beta, 'scan'))));
  const incidents = (await f.snapshot()).incidents;
  const respond = (index, command) => f.action(beta.members[index + 1].token, { type: 'defense', incidentId: incidents[index].id, command });
  f.denied(await respond(0, 'block'));
  assert.equal((await f.snapshot()).teams.find(t => t.id === beta.id).defenseReserve.charges, 2);
  const first = await Promise.all([0, 1].map(index => respond(index, 'reroute')));
  first.forEach(f.ok);
  let team = (await f.snapshot()).teams.find(t => t.id === beta.id);
  assert.equal(team.score, 10);
  assert.equal(team.defenseReserve.charges, 0);
  f.advance(4000);
  await Promise.all(alpha.members.slice(0, 2).map(async person => f.ok(await f.attack(person, beta, 'scan'))));
  f.advance(1000);
  f.denied(await respond(0, 'reroute'));
  f.denied(await respond(1, 'reroute'));
  assert.equal((await f.snapshot()).teams.find(t => t.id === beta.id).score, 10);
  f.advance(3000);
  const racing = await Promise.all([0, 1].map(index => respond(index, 'reroute')));
  assert.equal(racing.filter(result => result.status === 200).length, 1);
  f.denied(racing.find(result => result.status >= 400));
  team = (await f.snapshot()).teams.find(t => t.id === beta.id);
  assert.equal(team.defenseReserve.charges, 0);
  assert.equal(team.defenseCount, 3);
  assert.equal(team.score, 15);
  f.advance(8000);
  assert.equal((await f.snapshot()).teams.find(t => t.id === beta.id).defenseReserve.charges, 1);
  f.advance(100000);
  assert.equal((await f.snapshot()).teams.find(t => t.id === beta.id).defenseReserve.charges, 2);
});

test('detailed team metrics count distinct leaks and keep individual command data private', async t => {
  const f = await fixture(t);
  const [alpha, beta, gamma] = await f.teams();
  await f.start();
  await f.capture(alpha.members[0], beta);
  await f.capture(gamma.members[0], beta);
  const teacher = await f.snapshot();
  assert.equal(teacher.teams.find(t => t.id === beta.id).leakCount, 2);
  assert.equal(teacher.ranking.find(t => t.id === beta.id).leakCount, 2);
  const detail = teacher.teamMetrics.find(m => m.teamId === beta.id);
  assert.deepEqual(detail.leaks.map(l => l.teamName).sort(), [alpha.name, gamma.name].sort());
  const attackerDetail = teacher.teamMetrics.find(m => m.teamId === alpha.id);
  assert.equal(attackerDetail.attackCommands, 4);
  assert.equal(attackerDetail.members[0].captures, 1);
  assert.equal(attackerDetail.points.captures, 50);
  assert.equal(attackerDetail.capturedTeams[0].teamName, beta.name);
  f.denied(await f.attack(alpha.members[0], beta, 'scan'));
  assert.equal((await f.snapshot()).teams.find(t => t.id === beta.id).leakCount, 2);
  assert.deepEqual((await f.snapshot(alpha.members[0].token)).teamMetrics, []);
  assert.deepEqual((await f.snapshot(null)).teamMetrics, []);
});

test('all ten teacher effects are scoped, bounded, nonstacking and cleared at finish without affecting scores', async t => {
  const f = await fixture(t);
  const [alpha, beta] = await f.teams(2);
  await f.start();
  assert.equal(EFFECTS.length, 10);
  f.denied(await f.action(alpha.members[0].token, { type: 'effect', teamId: beta.id, effectId: 'glitch', seconds: 5 }));
  for (const seconds of [0, 21]) f.denied(await f.action(f.activity.token, { type: 'effect', teamId: beta.id, effectId: 'glitch', seconds }));
  f.denied(await f.action(f.activity.token, { type: 'effect', teamId: beta.id, effectId: 'invalid', seconds: 5 }));
  for (const effect of EFFECTS) {
    f.ok(await f.action(f.activity.token, { type: 'effect', teamId: beta.id, effectId: effect.id, seconds: 5 }));
    f.denied(await f.action(f.activity.token, { type: 'effect', teamId: beta.id, effectId: effect.id, seconds: 5 }));
    assert.equal((await f.snapshot(beta.members[0].token)).effects[0].effectId, effect.id);
    assert.deepEqual((await f.snapshot(alpha.members[0].token)).effects, []);
    assert.deepEqual((await f.snapshot(null)).effects, []);
    f.advance(5000);
    assert.deepEqual((await f.snapshot(beta.members[0].token)).effects, []);
  }
  assert.ok((await f.snapshot()).teams.every(team => team.score === 0));
  f.ok(await f.action(f.activity.token, { type: 'effect', teamId: beta.id, effectId: 'fog' }));
  f.ok(await f.action(f.activity.token, { type: 'effect-clear', teamId: beta.id }));
  assert.deepEqual((await f.snapshot()).effects, []);
  f.ok(await f.action(f.activity.token, { type: 'effect', teamId: beta.id, effectId: 'fog' }));
  f.ok(await f.action(f.activity.token, { type: 'finish' }));
  assert.deepEqual((await f.snapshot()).effects, []);
  assert.ok((await f.snapshot()).teams.every(team => team.score === 50));
});

test('existing activities migrate analyst roles without losing PDFs, points or captures', () => {
  const now = Date.UTC(2026, 9, 8, 15);
  const state = newActivity({ title: 'Atividade em andamento' }, 'teacher-token', now);
  const personId = addParticipant(state, { name: 'Integrante anterior' }, 'student-token', now);
  const person = state.participants[0];
  person.role = 'analyst'; person.teamId = 'old-team';
  delete person.commandGuard; delete person.metrics; delete state.effects; delete state.metricsStartedAt;
  state.status = 'running';
  state.teams.push({ id: 'old-team', name: 'Grupo anterior', memberIds: [personId], document: { key: 'private.pdf', name: 'trabalho.pdf', size: 1024 }, score: 55, captureCount: 1, defenseCount: 1, survivalBonus: 0, compromised: false });
  state.captures.push({ id: 'old-capture', attackerId: personId, attackerTeamId: 'old-team', defenderTeamId: 'other-team', at: now });
  assert.equal(normalizeState(state, now), true);
  assert.equal(normalizeState(state, now), false);
  assert.equal(person.role, 'defense');
  assert.equal(state.teams[0].score, 55);
  assert.equal(state.teams[0].document.key, 'private.pdf');
  assert.equal(state.captures[0].id, 'old-capture');
  assert.equal(engineSnapshot(state, viewerFor(state, 'student-token'), now).teams[0].defenseReserve.charges, 2);
});

test('an attentive defender can resist one attacker but continuous simultaneous pressure creates a capture opportunity', () => {
  function simulate(attackerCount) {
    const state = newActivity({ title: 'Ensaio de equilíbrio' }, 'teacher', 1);
    const makeTeam = (id, name) => ({ id, name, memberIds: [], document: { key: id + '.pdf' }, score: 0, captureCount: 0, defenseCount: 0, survivalBonus: 0, compromised: false, defenseReserve: { charges: LIMITS.defenseCapacity, updatedAt: 1 } });
    state.teams = [makeTeam('attackers', 'Ataque'), makeTeam('defenders', 'Defesa')];
    const attackers = [];
    function person(name, role, teamId) {
      const id = addParticipant(state, { name }, name + '-token', 1);
      const member = state.participants.find(p => p.id === id);
      member.teamId = teamId; member.role = role;
      state.teams.find(team => team.id === teamId).memberIds.push(id);
      return id;
    }
    for (let index = 0; index < attackerCount; index++) attackers.push(person('Ataque ' + index, 'attack', 'attackers'));
    const defenderId = person('Defesa', 'defense', 'defenders');
    state.status = 'running'; state.startedAt = 1; state.endsAt = 120001;
    function send(participantId, input, now) {
      const member = state.participants.find(p => p.id === participantId);
      return engineAction(state, { kind: 'student', participantId, teamId: member.teamId, role: member.role }, { ...input, entryMode: 'typed', nonce: member.commandGuard.nonce }, now);
    }
    for (let now = 1; now <= state.endsAt && !state.teams[1].compromised; now += 250) {
      for (const participantId of attackers) {
        const member = state.participants.find(p => p.id === participantId);
        if (now < member.commandGuard.cooldownUntil) continue;
        const incident = state.incidents.find(i => i.attackerId === participantId && ['active', 'blocked'].includes(i.status));
        send(participantId, { type: 'attack', targetTeamId: 'defenders', command: incident?.status === 'blocked' ? 'reconnect' : ['scan', 'inspect', 'access', 'extract'][incident?.stage || 0] }, now);
      }
      const incoming = state.incidents.filter(i => i.defenderTeamId === 'defenders' && i.status === 'active' && i.stage > 0 && now - i.lastActionAt >= 1000).sort((a, b) => b.stage - a.stage)[0];
      const defender = state.participants.find(p => p.id === defenderId);
      if (incoming && now >= defender.commandGuard.cooldownUntil) send(defenderId, { type: 'defense', incidentId: incoming.id, command: ['', 'reroute', 'block', 'revoke'][incoming.stage] }, now);
    }
    return state;
  }
  const single = simulate(1);
  assert.equal(single.teams[1].compromised, false);
  assert.ok(single.teams[1].defenseCount > 0);
  const simultaneous = simulate(2);
  assert.equal(simultaneous.teams[1].compromised, true);
  assert.ok(simultaneous.teams[1].defenseCount > 0);
  assert.equal(simultaneous.captures.length, 1);
  assert.ok(simultaneous.captures[0].at > LIMITS.attackMs * 3, 'Defense must delay the capture beyond an uncontested attack');
});

test('60 students and 20 concurrent teams keep all participants, captures and points', async t => {
  const f = await fixture(t);
  const people = await Promise.all(Array.from({ length: 60 }, (_, index) => f.student(`Participante de carga ${index + 1}`)));
  assert.equal(new Set(people.map(person => person.participantId)).size, 60);
  assert.equal(new Set(people.map(person => person.token)).size, 60);
  const memberships = Array.from({ length: 20 }, (_, index) => people.slice(index * 3, index * 3 + 3));
  await Promise.all(memberships.map(async (members, index) => {
    f.ok(await f.action(f.activity.token, {
      type: 'team-create', name: `Trio ${index + 1}`, memberIds: members.map(member => member.participantId),
    }));
  }));
  let state = await f.snapshot();
  assert.equal(state.teams.length, 20);
  assert.equal(new Set(state.teams.flatMap(team => team.memberIds)).size, 60);
  assert.equal(state.teams.reduce((sum, team) => sum + team.memberIds.length, 0), 60);
  const roles = ['attack', 'defense', 'defense'];
  await Promise.all(people.map(async (person, index) => {
    f.ok(await f.action(person.token, { type: 'role', role: roles[index % 3] }));
  }));
  await Promise.all(state.teams.map(async team => f.ok(await f.document(team.id))));
  await f.start();
  const teamByParticipant = new Map();
  state.teams.forEach(team => team.memberIds.forEach(id => teamByParticipant.set(id, team)));
  const attackingTeams = memberships.map(members => ({
    person: members[0], team: teamByParticipant.get(members[0].participantId),
  }));
  for (const command of ['scan', 'inspect', 'access', 'extract']) {
    await Promise.all(attackingTeams.map(async ({ person }, index) => {
      const target = attackingTeams[(index + 1) % attackingTeams.length].team;
      f.ok(await f.attack(person, target, command));
    }));
    f.advance(4001);
  }
  await Promise.all(people.map(async person => f.ok(await f.request(f.prefix, { token: person.token }))));
  state = await f.snapshot();
  assert.equal(state.teams.reduce((sum, team) => sum + team.captureCount, 0), 20);
  assert.equal(state.teams.reduce((sum, team) => sum + team.score, 0), 1000);
  assert.ok(state.teams.every(team => team.captureCount === 1 && team.compromised));
  f.ok(await f.action(f.activity.token, { type: 'finish' }));
  assert.ok((await f.snapshot()).teams.every(team => team.score === 50 && team.survivalBonus === 0));
});
