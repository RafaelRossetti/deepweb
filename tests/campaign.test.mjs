import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newActivity, addParticipant, action, viewerFor, snapshot, expire, normalizeState } from '../lib/engine.mjs';
import { tickCampaign, fullKeys, keySeal, keyCount } from '../lib/campaign.mjs';
import { createApp } from '../lib/http.mjs';
import { createStore } from '../lib/store.mjs';

function game(sizes = [1, 1, 1]) {
  let now = 1000000;
  const state = newActivity({ title: 'Campanha de teste' }, 'teacher', now);
  const teams = []; const people = [];
  const teacher = input => action(state, viewerFor(state, 'teacher'), input, now);
  for (let index = 0; index < sizes.length; index++) {
    const members = [];
    for (let n = 0; n < sizes[index]; n++) { const token = `student-${index}-${n}`; const participantId = addParticipant(state, { name: `Aluno ${index}/${n}` }, token, now); const p = { token, participantId }; members.push(p); people.push(p); }
    teacher({ type: 'team-create', name: `Time ${index}`, memberIds: members.map(p => p.participantId) }); teams.push({ ...state.teams.at(-1), members });
  }
  teacher({ type: 'prepare' }); teacher({ type: 'start', minutes: 20 });
  const advance = ms => { now += ms; tickCampaign(state, Math.min(now, state.endsAt)); expire(state, now); };
  function send(person, input, wait = true) {
    const member = state.participants.find(p => p.id === person.participantId);
    if (wait) advance(Math.max(0, member.commandGuard.cooldownUntil - now));
    tickCampaign(state, now);
    return action(state, viewerFor(state, person.token), { entryMode: 'typed', nonce: member.commandGuard.nonce, ...input }, now);
  }
  function ok(result) { assert.equal(result.rejection, undefined, result.rejection?.message); return result; }
  function capture(person, ownerId) {
    let result;
    for (const command of ['scan', 'inspect', 'access', ownerId === state.participants.find(p => p.id === person.participantId).teamId ? 'recover' : 'extract']) {
      const key = state.keys.find(k => k.ownerTeamId === ownerId);
      result = ok(send(person, { type: 'attack', targetTeamId: key.holderTeamId, objectiveTeamId: ownerId, command }));
    }
    return result;
  }
  function keepBossIdle(teamId) { const c = state.teams.find(t => t.id === teamId).campaign; if (c.interpol) c.interpol.nextWaveAt = now + 1000000; for (const i of state.incidents) if (i.bot && i.defenderTeamId === teamId) i.status = 'abandoned'; }
  const view = person => snapshot(state, viewerFor(state, person.token), now);
  return { state, teams, people, teacher, advance, send, ok, capture, view, keepBossIdle, get now() { return now; } };
}

test('campaign is the default, auto-assigns both abilities and starts with solo teams and no PDFs', () => {
  const g = game([1, 3]); assert.equal(g.state.mode, 'campaign'); assert.equal(g.state.status, 'running');
  assert.ok(g.state.participants.every(p => p.role === 'both')); assert.equal(g.state.keys.length, 2);
  assert.ok(g.state.teams.every(t => !t.document)); assert.equal(keyCount(g.state, g.teams[0].id), 1);
  const previous = structuredClone(g.state); delete previous.mode; normalizeState(previous, g.now); assert.equal(previous.mode, 'classic');
});

test('twenty teams and sixty dual-role players keep isolated sessions, unique keys and simultaneous captures', () => {
  const g=game(Array(20).fill(3));
  for(const command of ['scan','inspect','access','extract']) for(let n=0;n<20;n++) {
    const team=g.teams[n],owner=g.teams[(n+1)%20];const key=g.state.keys.find(k=>k.ownerTeamId===owner.id);
    g.ok(g.send(team.members[0],{type:'attack',targetTeamId:key.holderTeamId,objectiveTeamId:owner.id,command}));
  }
  assert.equal(g.state.participants.length,60);assert.equal(g.state.keys.length,20);assert.equal(g.state.captures.length,20);
  assert.ok(g.state.teams.every(t=>t.captureCount===1&&t.score===50));assert.equal(new Set(g.state.keys.map(k=>k.id)).size,20);
  for(const team of g.teams){const view=g.view(team.members[0]);assert.equal(view.participants.length,3);assert.equal(view.campaign.count,1);assert.equal(view.campaign.total,20);}
  assert.equal(snapshot(g.state,{kind:'public'},g.now).participants.length,0);
});

test('key capture, recovery and recapture preserve exclusive custody and cap repeated awards', () => {
  const g = game(); const [a,b] = g.teams; const alice=a.members[0], bob=b.members[0];
  g.capture(alice, b.id); assert.equal(a.campaign.rescueCount, 0); assert.equal(g.state.teams[0].score, 50); assert.equal(keyCount(g.state,a.id),2);
  g.capture(bob,b.id); assert.equal(g.state.teams[1].score,50); assert.equal(g.state.teams[1].campaign.rescueCount,1); assert.equal(keyCount(g.state,b.id),1);
  g.capture(alice,b.id); g.capture(bob,b.id);
  assert.equal(g.state.teams[0].captureCount,1); assert.equal(g.state.teams[0].score,50); assert.equal(g.state.teams[1].campaign.rescueCount,1); assert.equal(g.state.teams[1].score,50);
  assert.equal(g.state.keys.length,3); assert.equal(new Set(g.state.keys.map(k=>k.id)).size,3); assert.equal(g.state.captures.length,1); assert.equal(g.state.rescues.length,1);assert.equal(g.state.captures[0].count,2);assert.equal(g.state.rescues[0].count,2);assert.equal(g.state.teams[1].campaign.leakCount,2);
});

test('one player attacks and defends with a shared interval, affecting only the selected incident', () => {
  const g=game();const [a,b]=g.teams;const alice=a.members[0],bob=b.members[0];
  g.ok(g.send(alice,{type:'attack',targetTeamId:b.id,command:'scan'}));g.ok(g.send(bob,{type:'attack',targetTeamId:a.id,command:'scan'}));
  const incoming=g.state.incidents.find(i=>i.attackerId===bob.participantId);
  assert.equal(g.send(alice,{type:'defense',incidentId:incoming.id,command:'reroute'},false).rejection.status,429);
  g.ok(g.send(alice,{type:'defense',incidentId:incoming.id,command:'reroute'}));assert.equal(incoming.stage,0);
  assert.equal(g.state.incidents.find(i=>i.attackerId===alice.participantId).stage,1);
  assert.equal(g.send(alice,{type:'attack',targetTeamId:b.id,command:'inspect'},false).rejection.status,429);
});

test('a key can be stolen from a different holder; transferring it closes stale investigations', () => {
  const g=game(); const [a,b,c]=g.teams;g.capture(a.members[0],b.id);
  g.ok(g.send(b.members[0],{type:'attack',targetTeamId:a.id,objectiveTeamId:b.id,command:'scan'}));
  g.capture(c.members[0],b.id);
  assert.equal(g.state.keys.find(k=>k.ownerTeamId===b.id).holderTeamId,c.id);
  assert.equal(g.state.incidents.find(i=>i.attackerId===b.members[0].participantId).status,'abandoned');
  assert.equal(g.send(b.members[0],{type:'attack',targetTeamId:a.id,objectiveTeamId:b.id,command:'inspect'}).rejection.status,409);
});

test('brute force requires all current keys and the exact mask/seal, and losing a key cancels the job', () => {
  const g=game([2,1]);const [a,b]=g.teams; const alice=a.members[0];
  assert.equal(g.send(alice,{type:'campaign-command',command:'bruteforce --mask ?d?d?d?d --keys fake'}).rejection.status,409);
  g.capture(alice,b.id);g.keepBossIdle(a.id);
  assert.equal(g.send(alice,{type:'campaign-command',command:`bruteforce --mask ?l?l?l?l --keys ${keySeal(g.state,a.id)}`}).rejection.status,409);
  g.ok(g.send(alice,{type:'campaign-command',command:`bruteforce --mask ?d?d?d?d --keys ${keySeal(g.state,a.id)}`}));
  assert.equal(g.send(a.members[1],{type:'campaign-command',command:`bruteforce --mask ?d?d?d?d --keys ${keySeal(g.state,a.id)}`}).rejection.status,409);
  g.capture(b.members[0],b.id);assert.equal(g.state.teams[0].campaign.brute.status,'cancelled');g.advance(21000);assert.equal(g.state.teams[0].campaign.documentUnlocked,false);
  g.capture(alice,b.id);g.keepBossIdle(a.id);g.ok(g.send(alice,{type:'campaign-command',command:`bruteforce --mask ?d?d?d?d --keys ${keySeal(g.state,a.id)}`}));g.advance(20000);
  assert.equal(g.view(a.members[1]).campaign.documentUnlocked,true);assert.equal(g.view(b.members[0]).campaign.documentUnlocked,false);
});

test('Interpol honors the incoming limit, accepts exact IP responses, is winnable and awards each wave once', () => {
  const g=game([1,1]);const [a,b]=g.teams;g.capture(a.members[0],b.id);g.advance(4000);
  let bot=g.state.incidents.find(i=>i.bot&&i.status==='active');assert.ok(bot);assert.equal(g.state.incidents.filter(i=>i.defenderTeamId===a.id&&i.status==='active').length,1);
  const response=()=>`${['','reroute','block','revoke'][bot.stage]} ${bot.origin}`;
  const reserve=g.state.teams[0].defenseReserve.charges;
  assert.equal(g.send(a.members[0],{type:'defense',incidentId:bot.id,command:'block 1.1.1.1'}).rejection.status,409);
  assert.equal(g.state.teams[0].defenseReserve.charges,reserve);
  for(let n=0;n<3;n++){bot=g.state.incidents.find(i=>i.id===bot.id);g.ok(g.send(a.members[0],{type:'defense',incidentId:bot.id,command:response()}));if(n<2)g.advance(8000);}
  assert.equal(bot.status,'defeated');assert.equal(g.state.teams[0].campaign.wavesWon,1);assert.equal(g.state.teams[0].score,90);
  assert.equal(g.send(a.members[0],{type:'defense',incidentId:bot.id,command:response()}).rejection.status,409);assert.equal(g.state.teams[0].score,90);
});

test('idle human connections cannot occupy every slot indefinitely and starve the Interpol or other players', () => {
  const g=game();const [a,b,c]=g.teams;
  for(const team of[b,c])g.ok(g.send(team.members[0],{type:'attack',targetTeamId:a.id,objectiveTeamId:a.id,command:'scan'}));
  g.capture(a.members[0],b.id);g.capture(a.members[0],c.id);g.advance(4000);
  assert.equal(g.state.incidents.some(i=>i.bot),false);assert.equal(fullKeys(g.state,a.id),true);
  g.advance(45000-(g.now-1000000));assert.equal(g.state.incidents.filter(i=>i.bot&&i.status==='active').length,1);
  assert.ok(g.state.incidents.filter(i=>i.attackerId===b.members[0].participantId||i.attackerId===c.members[0].participantId).every(i=>i.status==='abandoned'));
  g.ok(g.send(c.members[0],{type:'attack',targetTeamId:a.id,objectiveTeamId:a.id,command:'scan'}));assert.equal(g.state.incidents.filter(i=>i.defenderTeamId===a.id&&i.status==='active').length,2);
});

test('a missed Interpol deadline returns one key and cannot unlock a brute job with a later deadline', () => {
  const g=game([1,1]);const [a,b]=g.teams;g.capture(a.members[0],b.id);g.advance(4000);
  g.ok(g.send(a.members[0],{type:'campaign-command',command:`bruteforce --mask ?d?d?d?d --keys ${keySeal(g.state,a.id)}`}));g.advance(21000);
  assert.equal(fullKeys(g.state,a.id),false);assert.equal(g.state.keys.find(k=>k.ownerTeamId===b.id).holderTeamId,b.id);
  assert.equal(g.state.teams[0].campaign.documentUnlocked,false);assert.equal(g.state.teams[0].campaign.brute.status,'cancelled');
});

function openPentagon(g,a,b){
  g.capture(a.members[0],b.id);g.keepBossIdle(a.id);g.ok(g.send(a.members[0],{type:'campaign-command',command:`bruteforce --mask ?d?d?d?d --keys ${keySeal(g.state,a.id)}`}));g.advance(20000);
  g.ok(g.send(a.members[0],{type:'campaign-command',command:`connect ${g.state.teams[0].campaign.accessCode}`}));
}
function solvePlayer(g,team,person){
  for(let stage=0;stage<4;stage++){
    const p=g.state.teams.find(t=>t.id===team.id).campaign.mission.players.find(p=>p.participantId===person.participantId);
    g.ok(g.send(person,{type:'campaign-command',command:[`scan ${p.ip}`,`inspect ${p.port}`,`access ${p.token}`,'extract master'][stage]}));
    if(stage<3)g.ok(g.send(person,{type:'campaign-command',command:`${['','reroute','block','revoke'][p.threat.stage]} ${p.threat.origin}`}));
  }
}
test('Pentagon requires the PDF code, arguments and each member; the master award cannot be duplicated', () => {
  const g=game([2,1]);const [a,b]=g.teams;openPentagon(g,a,b);
  assert.equal(g.view(a.members[1]).campaign.mission.players.length,2);
  const p=g.state.teams[0].campaign.mission.players[0];assert.equal(g.send(a.members[0],{type:'campaign-command',command:'scan 127.0.0.1'}).rejection.status,409);assert.equal(p.stage,0);
  solvePlayer(g,a,a.members[0]);assert.equal(g.state.teams[0].campaign.masterCount,0);assert.equal(g.state.teams[0].campaign.mission.status,'active');
  solvePlayer(g,a,a.members[1]);assert.equal(g.state.teams[0].campaign.masterCount,1);assert.equal(g.state.teams[0].campaign.mission.status,'complete');
  const score=g.state.teams[0].score;assert.equal(g.send(a.members[1],{type:'campaign-command',command:'extract master'}).rejection.status,409);assert.equal(g.state.teams[0].score,score);
  const publicView=snapshot(g.state,{kind:'public'},g.now);assert.equal(publicView.campaign,null);assert.equal(JSON.stringify(publicView).includes(g.state.teams[0].campaign.accessCode),false);assert.equal(publicView.ranking[0].masterCount,1);
});

test('Pentagon deadlines permit retry, loss of a key pauses everyone, and recovery resumes without erasing completed players', () => {
  const g=game([2,1]);const [a,b]=g.teams;openPentagon(g,a,b);const alice=a.members[0];
  let p=g.state.teams[0].campaign.mission.players[0];g.ok(g.send(alice,{type:'campaign-command',command:`scan ${p.ip}`}));g.advance(13000);
  p=g.state.teams[0].campaign.mission.players[0];assert.equal(p.stage,0);assert.equal(p.failures,1);
  g.advance(5000);solvePlayer(g,a,alice);g.capture(b.members[0],b.id);assert.equal(g.state.teams[0].campaign.mission.paused,true);assert.equal(p.stage,4);
  assert.equal(g.send(a.members[1],{type:'campaign-command',command:'scan fake'}).rejection.status,409);
  g.capture(alice,b.id);g.keepBossIdle(a.id);assert.equal(g.state.teams[0].campaign.mission.paused,false);solvePlayer(g,a,a.members[1]);assert.equal(g.state.teams[0].campaign.masterCount,1);
});

test('one attentive player can protect all keys from the Interpol and complete the full Pentagon at normal difficulty', () => {
  const g=game([1,1]);const [a,b]=g.teams;const person=a.members[0];g.capture(person,b.id);
  for(let step=0;step<1800&&g.state.teams[0].campaign.masterCount===0;step++){
    g.advance(100);const member=g.state.participants.find(p=>p.id===person.participantId);
    if(g.now<member.commandGuard.cooldownUntil+1000)continue;
    const c=g.state.teams[0].campaign;const player=c.mission?.players[0];const bot=g.state.incidents.find(i=>i.bot&&i.status==='active'&&i.stage>0);
    const threats=[...(player?.threat?[{kind:'mission',deadline:player.threat.deadline,stage:player.threat.stage,origin:player.threat.origin}]:[]),...(bot?[{kind:'bot',deadline:bot.deadline,stage:bot.stage,origin:bot.origin}]:[])].sort((x,y)=>x.deadline-y.deadline);
    if(threats.length){const threat=threats[0];const command=['','reroute','block','revoke'][threat.stage]+' '+threat.origin;
      if(threat.kind==='mission')g.ok(g.send(person,{type:'campaign-command',command},false));
      else if(g.view(person).teams.find(t=>t.id===a.id).defenseReserve.charges)g.ok(g.send(person,{type:'defense',incidentId:bot.id,command},false));
      continue;
    }
    if(!c.brute)g.ok(g.send(person,{type:'campaign-command',command:`bruteforce --mask ?d?d?d?d --keys ${keySeal(g.state,a.id)}`},false));
    else if(c.documentUnlocked&&!c.mission)g.ok(g.send(person,{type:'campaign-command',command:`connect ${c.accessCode}`},false));
    else if(player&&player.stage<4&&g.now>=player.readyAt)g.ok(g.send(person,{type:'campaign-command',command:[`scan ${player.ip}`,`inspect ${player.port}`,`access ${player.token}`,'extract master'][player.stage]},false));
  }
  assert.equal(g.state.teams[0].campaign.masterCount,1);assert.equal(g.state.teams[0].campaign.mission.players[0].failures,0);
  assert.ok(g.state.teams[0].campaign.wavesWon>=1);assert.equal(fullKeys(g.state,a.id),true);
});

test('control is only earned while the original key is home and cannot accrue beyond activity expiry', () => {
  const g=game();const [a,b]=g.teams;g.advance(60000);assert.ok(g.state.teams.every(t=>t.score===5));
  g.capture(a.members[0],b.id);const before=g.state.teams[1].score;g.advance(120000);assert.equal(g.state.teams[1].score,before);
  g.advance(g.state.endsAt-g.now+60000);const final=g.state.teams[0].score;assert.equal(g.state.status,'finished');g.advance(600000);assert.equal(g.state.teams[0].score,final);
});

test('ending a campaign stops pending searches and AI while preserving unlocked PDFs and completed flags', () => {
  const g=game([1,1]);const [a,b]=g.teams;g.capture(a.members[0],b.id);g.keepBossIdle(a.id);
  g.ok(g.send(a.members[0],{type:'campaign-command',command:`bruteforce --mask ?d?d?d?d --keys ${keySeal(g.state,a.id)}`}));g.teacher({type:'finish'});
  assert.equal(g.state.teams[0].campaign.brute.status,'ended');assert.equal(g.state.teams[0].campaign.documentUnlocked,false);
  const score=g.state.teams[0].score;g.advance(200000);assert.equal(g.state.teams[0].score,score);
});

test('HTTP campaign gates private PDFs and code, persists completion and serializes competing extractions', async t => {
  const dataDir=await mkdtemp(join(tmpdir(),'deepweb-campaign-test-'));let now=1000000;
  const store=createStore({dataDir,supabaseUrl:'',supabaseKey:''});const server=createServer(createApp({store,clock:()=>now,teacherPassword:'teacher'}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeIdleConnections();await new Promise(r=>server.close(r));assert.ok(dataDir.startsWith(join(tmpdir(),'deepweb-campaign-test-')));await rm(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}`;
  async function api(route,token,body){const r=await fetch(base+route,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:r.headers.get('content-type').includes('json')?await r.json():Buffer.from(await r.arrayBuffer())};}
  const created=await api('/api/activities',null,{title:'Campanha HTTP',password:'teacher'});assert.equal(created.status,201);const {code,token}=created.data;const prefix=`/api/activities/${code}`;const people=[];
  for(let n=0;n<4;n++)people.push((await api(prefix+'/join',null,{name:'Participante '+n})).data);
  for(const [name,members] of [['A',people.slice(0,2)],['B',[people[2]]],['C',[people[3]]]])assert.equal((await api(prefix+'/action',token,{type:'team-create',name,memberIds:members.map(p=>p.participantId)})).status,200);
  let view=(await api(prefix,token)).data;const a=view.teams.find(t=>t.name==='A'),b=view.teams.find(t=>t.name==='B');
  await api(prefix+'/action',token,{type:'prepare'});await api(prefix+'/action',token,{type:'start',minutes:10});
  async function cmd(person,body){const current=(await api(prefix,person.token)).data;return api(prefix+'/action',person.token,{...body,entryMode:'typed',nonce:current.viewer.commandGuard.nonce});}
  assert.equal((await api(prefix+'/dossier',people[0].token)).status,409);assert.equal((await api(prefix+'/dossier')).status,401);
  for(const command of ['scan','inspect','access']){await Promise.all(people.slice(0,2).map(p=>cmd(p,{type:'attack',targetTeamId:b.id,objectiveTeamId:b.id,command})));now+=4000;}
  const race=await Promise.all(people.slice(0,2).map(p=>cmd(p,{type:'attack',targetTeamId:b.id,objectiveTeamId:b.id,command:'extract'})));
  assert.equal(race.filter(r=>r.status===200).length,1);view=(await api(prefix,token)).data;assert.equal(view.teams.find(t=>t.id===a.id).score,50);assert.equal(view.captures.length,1);
  // Persisted record: a teacher does not receive dossier secrets through snapshots.
  assert.equal(JSON.stringify(view).includes((await store.read(code)).state.teams[0].campaign.accessCode),false);
  const saved=await store.read(code);saved.state.teams[0].campaign.documentUnlocked=true;await store.compareAndSwap(code,saved.revision,saved.state);
  const pdf=await api(prefix+'/dossier',people[0].token);assert.equal(pdf.status,200);assert.equal(pdf.data.subarray(0,5).toString(),'%PDF-');
  assert.ok(pdf.data.toString('latin1').includes(saved.state.teams[0].campaign.accessCode));assert.equal((await api(prefix+'/dossier/'+a.id,people[2].token)).status,403);
  const reopened=createStore({dataDir,supabaseUrl:'',supabaseKey:''});assert.equal((await reopened.read(code)).state.teams[0].campaign.documentUnlocked,true);
});
