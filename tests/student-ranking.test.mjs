import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { newActivity, addParticipant, attachDocument, action, normalizeState, snapshot, viewerFor } from '../lib/engine.mjs';
import { tickCampaign } from '../lib/campaign.mjs';
import { createStore } from '../lib/store.mjs';

function game(mode = 'classic', sizes = [2, 1, 1]) {
  let now = 1000000;
  const state = newActivity({ title: 'Resultados individuais', mode }, 'teacher-private', now);
  const teacher = input => action(state, viewerFor(state, 'teacher-private'), input, now);
  const names = ['José', 'Ana', 'Bruno', 'Carlos'];
  const people = [], teams = [];
  for (const [teamIndex, size] of sizes.entries()) {
    const members = [];
    for (let index = 0; index < size; index++) {
      const token = `student-private-${people.length}`;
      const id = addParticipant(state, { name: names[people.length] }, token, now);
      const person = { id, token }; people.push(person); members.push(person);
    }
    teacher({ type: 'team-create', name: `Equipe ${teamIndex + 1}`, memberIds: members.map(p => p.id) });
    const team = state.teams.at(-1); teams.push(team);
    if (mode === 'classic') {
      attachDocument(state, viewerFor(state, 'teacher-private'), team.id, { key: `private-pdf-${teamIndex}`, name: 'material.pdf', size: 20 }, now);
      for (const person of members) action(state, viewerFor(state, person.token), { type: 'role', role: 'both' }, now);
    }
  }
  const waitingToken = 'waiting-private';
  const waitingId = addParticipant(state, { name: 'Ágata' }, waitingToken, now);
  teacher({ type: 'prepare' }); teacher({ type: 'start', minutes: 20 });
  function send(person, input, wait = true) {
    const member = state.participants.find(p => p.id === person.id);
    if (wait) now = Math.max(now, member.commandGuard.cooldownUntil);
    return action(state, viewerFor(state, person.token), { entryMode: 'typed', nonce: member.commandGuard.nonce, ...input }, now);
  }
  function ok(result) { assert.equal(result.rejection, undefined, result.rejection?.message); return result; }
  function capture(person, ownerTeamId) {
    const member = state.participants.find(p => p.id === person.id);
    for (const command of ['scan', 'inspect', 'access', member.teamId === ownerTeamId ? 'recover' : 'extract']) {
      const holderTeamId = mode === 'campaign' ? state.keys.find(key => key.ownerTeamId === ownerTeamId).holderTeamId : ownerTeamId;
      ok(send(person, { type: 'attack', command, targetTeamId: holderTeamId, objectiveTeamId: ownerTeamId }));
    }
  }
  return { state, people, teacher, send, ok, capture, waitingId, waitingToken,
    get teams() { return teams.map(team => state.teams.find(current => current.id === team.id)); },
    view: () => snapshot(state, viewerFor(state, 'teacher-private'), now),
    advance: ms => { now += ms; }, get now() { return now; } };
}

test('student rankings include waiting students, use Brazilian alphabetical tie breaks and share rank positions', () => {
  const g = game();
  const initial = g.view();
  assert.deepEqual(initial.studentRanking.map(row => row.name), ['Ágata', 'Ana', 'Bruno', 'Carlos', 'José']);
  assert.ok(initial.studentRanking.every(row => row.score === 0 && row.position === 1));
  const waiting = initial.studentRanking.find(row => row.id === g.waitingId);
  assert.equal(waiting.teamId, null); assert.equal(waiting.teamName, ''); assert.equal(waiting.role, null);
  g.capture(g.people[0], g.teams[1].id);
  g.capture(g.people[1], g.teams[2].id);
  const rows = g.view().studentRanking;
  assert.deepEqual(rows.map(row => [row.name, row.score, row.position]), [['Ana', 50, 1], ['José', 50, 1], ['Ágata', 0, 3], ['Bruno', 0, 3], ['Carlos', 0, 3]]);
  assert.equal(rows[0].teamId, g.teams[0].id); assert.equal(rows[0].teamName, 'Equipe 1');
  assert.equal(rows[0].role, 'both'); assert.deepEqual(rows[0].points, { captures: 50, rescues: 0, defenses: 0 });
});

for (const mode of ['classic', 'campaign']) {
  test(`${mode}: successful captures and human defenses score only their actual participants`, () => {
    const g = game(mode), [attacker, teammate, defender] = g.people;
    g.ok(g.send(attacker, { type: 'attack', targetTeamId: g.teams[1].id, command: 'scan' }));
    let incident = g.state.incidents.find(i => i.attackerId === attacker.id);
    assert.equal(g.send(defender, { type: 'defense', incidentId: incident.id, command: 'block' }).rejection.status, 409);
    assert.equal(g.view().studentRanking.find(row => row.id === defender.id).score, 0);
    g.ok(g.send(defender, { type: 'logs', incidentId: incident.id }));
    assert.equal(g.view().studentRanking.find(row => row.id === defender.id).score, 0);
    g.ok(g.send(defender, { type: 'defense', incidentId: incident.id, command: 'reroute' }));
    assert.equal(g.send(defender, { type: 'defense', incidentId: incident.id, command: 'reroute' }, false).rejection.status, 429);
    assert.equal(g.send(defender, { type: 'defense', incidentId: incident.id, command: 'reroute' }).rejection.status, 409);
    g.capture(attacker, g.teams[1].id);
    const view = g.view(), row = view.studentRanking.find(row => row.id === attacker.id);
    assert.equal(row.score, 50); assert.equal(row.captures, 1); assert.equal(row.defenses, 0);
    assert.equal(view.studentRanking.find(row => row.id === teammate.id).score, 0);
    const defenseRow = view.studentRanking.find(row => row.id === defender.id);
    assert.equal(defenseRow.score, 5); assert.equal(defenseRow.defenses, 1);
    assert.deepEqual(defenseRow.points, { captures: 0, rescues: 0, defenses: 5 });
    assert.equal(view.studentRankingInfo.partial, false);
    const before = structuredClone(g.state);
    assert.deepEqual(g.view().studentRanking, view.studentRanking); assert.deepEqual(g.state, before);
    g.teacher({ type: 'finish' });
    assert.deepEqual(g.view().studentRanking, view.studentRanking);
    assert.equal(g.view().studentRankingInfo.collectiveBonusesIncluded, false);
    assert.equal(g.teams[0].survivalBonus, 50); assert.equal(g.teams[0].score, 100);
  });

  test(`${mode}: individual results are returned only to the teacher without leaking credentials`, () => {
    const g = game(mode);
    const teacherView = g.view();
    assert.ok(teacherView.studentRanking.length > 0);
    const serialized = JSON.stringify(teacherView.studentRanking);
    for (const sensitive of ['tokenHash', 'commandGuard', 'nonce', 'teacher-private', 'student-private', 'private-pdf']) assert.equal(serialized.includes(sensitive), false, sensitive);
    for (const viewer of [{ kind: 'public' }, viewerFor(g.state, g.people[0].token), viewerFor(g.state, g.waitingToken)]) {
      const view = snapshot(g.state, viewer, g.now);
      assert.equal(Object.hasOwn(view, 'studentRanking'), false);
      assert.equal(Object.hasOwn(view, 'studentRankingInfo'), false);
    }
  });
}

test('campaign recaptures and rescues retain their original recipient and never multiply a rewarded ledger', () => {
  const g = game('campaign'), [attacker, teammate, defender] = g.people;
  g.capture(attacker, g.teams[1].id);
  g.capture(defender, g.teams[1].id);
  g.capture(teammate, g.teams[1].id);
  g.capture(defender, g.teams[1].id);
  const view = g.view();
  assert.equal(g.state.captures[0].count, 2); assert.equal(g.state.rescues[0].count, 2);
  assert.equal(view.studentRanking.find(row => row.id === attacker.id).score, 50);
  assert.equal(view.studentRanking.find(row => row.id === teammate.id).score, 0);
  const rescueRow = view.studentRanking.find(row => row.id === defender.id);
  assert.equal(rescueRow.score, 50); assert.equal(rescueRow.rescues, 1);
  assert.deepEqual(rescueRow.points, { captures: 0, rescues: 50, defenses: 0 });
  assert.equal(view.studentRankingInfo.partial, false);
  assert.equal(g.teams[0].score, 50); assert.equal(g.teams[1].score, 50);
});

test('Interpol awards personal defenses while keeping wave, control and protection bonuses collective', () => {
  const g = game('campaign', [2, 1]), [attacker, teammate] = g.people;
  g.capture(attacker, g.teams[1].id);
  g.advance(4000); tickCampaign(g.state, g.now);
  const botId = g.state.incidents.find(i => i.bot && i.status === 'active').id;
  const response = () => { const bot = g.state.incidents.find(i => i.id === botId); return `${['', 'reroute', 'block', 'revoke'][bot.stage]} ${bot.origin}`; };
  assert.equal(g.send(teammate, { type: 'defense', incidentId: botId, command: 'block 1.1.1.1' }).rejection.status, 409);
  for (let index = 0; index < 3; index++) {
    g.ok(g.send(teammate, { type: 'defense', incidentId: botId, command: response() }));
    if (index < 2) { g.advance(8000); tickCampaign(g.state, g.now); }
  }
  assert.equal(g.send(teammate, { type: 'defense', incidentId: botId, command: response() }).rejection.status, 409);
  let view = g.view();
  assert.equal(g.teams[0].campaign.wavesWon, 1); assert.equal(g.teams[0].score, 90);
  assert.equal(view.studentRanking.find(row => row.id === attacker.id).score, 50);
  assert.equal(view.studentRanking.find(row => row.id === teammate.id).score, 15);
  assert.equal(view.studentRankingInfo.partial, false);
  g.advance(60000); tickCampaign(g.state, g.now); g.teacher({ type: 'finish' });
  view = g.view();
  assert.ok(g.teams[0].campaign.controlCount > 0);
  assert.equal(view.studentRanking.find(row => row.id === teammate.id).score, 15);
  assert.equal(view.studentRanking.find(row => row.id === attacker.id).score, 50);
});

test('legacy results credit known captures without inventing missing defense or rescue attribution', () => {
  const g = game('campaign');
  g.capture(g.people[0], g.teams[1].id);
  g.capture(g.people[2], g.teams[1].id);
  const legacy = structuredClone(g.state);
  legacy.teams[0].defenseCount = 4; legacy.teams[0].score += 20;
  delete legacy.metricsStartedAt;
  for (const member of legacy.participants) delete member.metrics;
  delete legacy.captures[0].points;
  delete legacy.rescues[0].participantId;
  const originalScores = legacy.teams.map(team => team.score), originalCaptures = structuredClone(legacy.captures);
  assert.equal(normalizeState(legacy, g.now + 1000), true);
  let view = snapshot(legacy, { kind: 'teacher' }, g.now + 1000);
  assert.equal(view.studentRanking.find(row => row.id === g.people[0].id).score, 50);
  assert.equal(view.studentRanking.find(row => row.id === g.people[2].id).score, 0);
  assert.equal(view.studentRankingInfo.partial, true);
  assert.equal(view.studentRankingInfo.unattributedDefenses, 4);
  assert.equal(view.studentRankingInfo.unattributedRescues, 1);
  assert.equal(view.studentRankingInfo.unattributedCaptures, 0);
  assert.equal(view.studentRankingInfo.metricsStartedAt, g.now + 1000);
  assert.match(view.studentRankingInfo.historicalNote, /sem identificação individual/);
  assert.deepEqual(legacy.teams.map(team => team.score), originalScores);
  assert.deepEqual(legacy.captures, originalCaptures);
  assert.equal(normalizeState(legacy, g.now + 2000), false);
  delete legacy.captures[0].attackerId;
  view = snapshot(legacy, { kind: 'teacher' }, g.now + 2000);
  assert.equal(view.studentRankingInfo.unattributedCaptures, 1);
  assert.ok(view.studentRanking.every(row => row.score === 0));
});

test('saved and reopened activities retain identical personal rankings and group scores', async t => {
  const g = game('campaign');
  g.capture(g.people[0], g.teams[1].id); g.capture(g.people[2], g.teams[1].id); g.teacher({ type: 'finish' });
  const expected = g.view(), before = structuredClone(g.state);
  const dataDir = await mkdtemp(join(tmpdir(), 'deepweb-student-ranking-test-'));
  t.after(async () => {
    const relativePath = relative(resolve(tmpdir()), resolve(dataDir));
    assert.ok(relativePath && !relativePath.startsWith('..') && !relativePath.includes(':'));
    assert.ok(relativePath.startsWith('deepweb-student-ranking-test-'));
    await rm(dataDir, { recursive: true, force: true });
  });
  const store = createStore({ dataDir, supabaseUrl: '', supabaseKey: '' });
  await store.create(g.state.code, g.state);
  const reopened = createStore({ dataDir, supabaseUrl: '', supabaseKey: '' });
  const record = await reopened.read(g.state.code);
  assert.equal(normalizeState(record.state, g.now), false);
  const view = snapshot(record.state, { kind: 'teacher' }, g.now);
  assert.deepEqual(view.studentRanking, expected.studentRanking);
  assert.deepEqual(view.studentRankingInfo, expected.studentRankingInfo);
  assert.deepEqual(view.ranking, expected.ranking);
  assert.deepEqual(g.state, before); assert.deepEqual(record.state, before);
});
