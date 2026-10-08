import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../lib/http.mjs';
import { createStore } from '../lib/store.mjs';

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
  async function createTeam(name, members, roles = ['attack', 'defense', 'analyst']) {
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
      now += 3001;
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

test('teacher permissions, team sizes, PDF validation and readiness protect the activity', async t => {
  const f = await fixture(t);
  const members = await Promise.all([0, 1, 2, 3].map(index => f.student(`Pessoa reservada ${index}`)));
  f.denied(await f.action(members[0].token, {
    type: 'team-create', name: 'Sem autorização', memberIds: members.slice(0, 2).map(member => member.participantId),
  }));
  for (const count of [1, 4]) {
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
  const [attackers, target] = await f.teams(2, [['attack', 'attack', 'defense'], ['attack', 'defense', 'analyst']]);
  await f.start();
  for (const command of ['scan', 'inspect', 'access']) {
    await Promise.all(attackers.members.slice(0, 2).map(async member => f.ok(await f.attack(member, target, command))));
    f.advance(3001);
  }
  const results = await Promise.all(attackers.members.slice(0, 2).map(member => f.attack(member, target, 'extract')));
  assert.equal(results.filter(result => result.status >= 200 && result.status < 300).length, 1);
  f.denied(results.find(result => result.status >= 400));
  const snapshot = await f.snapshot();
  const team = snapshot.teams.find(team => team.id === attackers.id);
  assert.equal(team.captureCount, 1);
  assert.equal(team.score, 50);
  assert.equal(snapshot.teams.find(team => team.id === target.id).compromised, true);
  f.advance(3001);
  f.denied(await f.attack(attackers.members[0], target, 'extract'));
  const after = (await f.snapshot()).teams.find(team => team.id === attackers.id);
  assert.equal(after.captureCount, 1);
  assert.equal(after.score, 50);
});

test('a defense applies only to its incident and scores only after a new eligible attack', async t => {
  const f = await fixture(t);
  const [alpha, defender, gamma] = await f.teams();
  await f.start();
  await Promise.all([alpha, gamma].map(async team => f.ok(await f.attack(team.members[0], defender, 'scan'))));
  let state = await f.snapshot();
  const incident = state.incidents.find(item => item.attackerTeamId === alpha.id);
  const unrelated = state.incidents.find(item => item.attackerTeamId === gamma.id);
  assert.ok(incident && unrelated);
  f.denied(await f.action(defender.members[1].token, { type: 'defense', incidentId: incident.id, command: 'revoke' }));
  f.ok(await f.action(defender.members[1].token, { type: 'defense', incidentId: incident.id, command: 'reroute' }));
  state = await f.snapshot();
  assert.equal(state.incidents.find(item => item.id === incident.id).stage, 0);
  const other = state.incidents.find(item => item.id === unrelated.id);
  assert.equal(other.status, unrelated.status);
  assert.equal(other.stage, unrelated.stage);
  assert.equal(other.defenseCount, unrelated.defenseCount);
  assert.equal(state.teams.find(team => team.id === defender.id).score, 5);
  f.denied(await f.action(defender.members[1].token, { type: 'defense', incidentId: incident.id, command: 'block' }));
  f.advance(3001);
  f.ok(await f.attack(alpha.members[0], defender, 'scan'));
  f.denied(await f.action(defender.members[1].token, { type: 'defense', incidentId: incident.id, command: 'block' }));
  f.advance(2001);
  f.ok(await f.action(defender.members[1].token, { type: 'defense', incidentId: incident.id, command: 'block' }));
  f.advance(5001);
  f.denied(await f.action(defender.members[1].token, { type: 'defense', incidentId: incident.id, command: 'block' }));
  f.ok(await f.attack(alpha.members[0], defender, 'reconnect'));
  f.advance(3001);
  f.ok(await f.attack(alpha.members[0], defender, 'scan'));
  f.ok(await f.action(defender.members[1].token, { type: 'defense', incidentId: incident.id, command: 'block' }));
  const final = (await f.snapshot()).teams.find(team => team.id === defender.id);
  assert.equal(final.defenseCount, 3);
  assert.equal(final.score, 15);
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
  const roles = ['attack', 'defense', 'analyst'];
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
    f.advance(3001);
  }
  await Promise.all(people.map(async person => f.ok(await f.request(f.prefix, { token: person.token }))));
  state = await f.snapshot();
  assert.equal(state.teams.reduce((sum, team) => sum + team.captureCount, 0), 20);
  assert.equal(state.teams.reduce((sum, team) => sum + team.score, 0), 1000);
  assert.ok(state.teams.every(team => team.captureCount === 1 && team.compromised));
  f.ok(await f.action(f.activity.token, { type: 'finish' }));
  assert.ok((await f.snapshot()).teams.every(team => team.score === 50 && team.survivalBonus === 0));
});
