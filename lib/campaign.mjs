import { randomBytes } from 'node:crypto';
import { fail, id, hash, secret, event } from './common.mjs';

export const DIFFICULTIES = Object.freeze({ easy: { label: 'Treino', reactionMs: 18000 }, normal: { label: 'Equilibrado', reactionMs: 14000 }, hard: { label: 'Desafio', reactionMs: 11000 } });
const DEFENSE = ['', 'reroute', 'block', 'revoke'];
const rand = (min, max) => min + randomBytes(2).readUInt16BE() % (max - min + 1);
const accessCode = () => { const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from(randomBytes(8), n => alphabet[n % alphabet.length]).join(''); };
const isLive = i => ['active', 'blocked'].includes(i.status);
export function isCampaign(state) { return state.mode === 'campaign'; }
export function campaignTeam(team) {
  return team.campaign ||= { rescueCount: 0, leakCount: 0, controlCount: 0, wavesWon: 0, masterCount: 0, controlSince: null, interpol: null, documentGranted: false, brute: null, documentUnlocked: false, accessCode: accessCode(), mission: null };
}
export function keyCount(state, teamId) { return (state.keys || []).filter(k => k.holderTeamId === teamId).length; }
export function fullKeys(state, teamId) { return state.keys?.length >= 2 && keyCount(state, teamId) === state.keys.length; }
export function keySeal(state, teamId) { return hash(state.keys.filter(k => k.holderTeamId === teamId).map(k => `${k.id}:${k.version}`).sort().join('|')).slice(0, 8); }
export function startCampaign(state, now) {
  state.keys = state.teams.map(t => ({ id: id(), ownerTeamId: t.id, holderTeamId: t.id, version: 1 }));
  state.rescues = [];
  for (const team of state.teams) { const c = campaignTeam(team); c.controlSince = now; }
}
export function moveKey(state, key, holderTeamId, now) {
  const oldHolder = key.holderTeamId;
  key.holderTeamId = holderTeamId; key.version++;
  for (const incident of state.incidents) if (incident.keyId === key.id && isLive(incident)) { incident.status = 'abandoned'; incident.lastActionAt = now; }
  for (const team of state.teams) {
    if (team.id === key.ownerTeamId) campaignTeam(team).controlSince = holderTeamId === team.id ? now : null;
    if (team.id === oldHolder && !fullKeys(state, team.id)) {
      const c = campaignTeam(team);
      if (c.brute?.status === 'running') { c.brute.status = 'cancelled'; event(state, `${team.name}: brute force interrompida pela perda de uma chave.`, now, [team.id]); }
      if (c.mission?.status === 'active') { c.mission.paused = true; for (const p of c.mission.players) if (p.threat) p.threat.deadline = null; }
    }
  }
}
export function keyCapture(state, member, incident, now) {
  const own = state.teams.find(t => t.id === member.teamId);
  const key = state.keys.find(k => k.id === incident.keyId);
  if (!key || key.holderTeamId !== incident.defenderTeamId || key.version !== incident.keyVersion) fail(409, 'A chave mudou de cofre. Reconheça sua nova localização.');
  const previous = key.holderTeamId;
  const owner = state.teams.find(t => t.id === key.ownerTeamId);
  const rescue = key.ownerTeamId === own.id;
  const ledger = rescue ? state.rescues.find(r => r.teamId === own.id && r.fromTeamId === previous) : state.captures.find(c => c.attackerTeamId === own.id && c.defenderTeamId === owner.id);
  const rewarded = !ledger;
  const points = rewarded ? (rescue ? state.points.rescue : state.points.capture) : 0;
  if (ledger) { ledger.count = (ledger.count || 1) + 1; ledger.lastAt = now; }
  if (rescue) { if (rewarded) { state.rescues.push({ id: id(), teamId: own.id, fromTeamId: previous, participantId: member.id, at: now, points, count: 1 }); campaignTeam(own).rescueCount++; } }
  else { if (rewarded) { state.captures.push({ id: id(), attackerTeamId: own.id, defenderTeamId: owner.id, holderTeamId: previous, attackerId: member.id, at: now, points, count: 1 }); own.captureCount++; } campaignTeam(owner).leakCount++; member.metrics.keyCaptures = (member.metrics.keyCaptures || 0) + 1; owner.compromised = true; }
  own.score += points; moveKey(state, key, own.id, now); incident.status = 'captured';
  event(state, `${own.name} ${rescue ? 'resgatou sua chave' : `capturou a chave de ${owner.name}`}: +${points} pontos${rewarded ? '' : ' (prêmio já recebido)'}.`, now, [own.id, owner.id, previous]);
  let download;
  if (!rescue && rewarded && owner.document) {
    const ticket = secret(); state.downloads.push({ ticketHash: hash(ticket), documentKey: owner.document.key, name: owner.document.name, expiresAt: now + 600000, usedAt: null }); download = { ticket, name: owner.document.name };
  }
  unlockCampaign(state, own, now);
  return { message: `${rescue ? 'Chave resgatada' : 'Chave capturada'}! +${points} pontos. ${keyCount(state, own.id)}/${state.keys.length} chaves no cofre.${fullKeys(state, own.id) ? ' Dossiê disponível e Interpol ativada!' : ''}`, ...(download ? { download } : {}) };
}
function unlockCampaign(state, team, now) {
  if (!fullKeys(state, team.id)) return;
  const c = campaignTeam(team);
  if (!c.documentGranted) { c.documentGranted = true; event(state, `${team.name} reuniu todas as chaves. Dossiê bloqueado entregue a todos os integrantes.`, now, [team.id]); }
  if (!c.interpol) { c.interpol = { nextWaveAt: now, wave: 0 }; event(state, `Interpol mobilizada contra ${team.name}.`, now, [team.id]); }
  if (c.mission?.paused) { c.mission.paused = false; for (const p of c.mission.players) if (p.threat) p.threat.deadline = now + reaction(state, true); }
}
function reaction(state, pentagon = false) { return DIFFICULTIES[state.bossDifficulty || 'normal'].reactionMs - (pentagon ? 2000 : 0); }
function bossProbe(state, incident, now) {
  incident.stage = rand(1, 3); incident.origin = `10.66.${state.teams.findIndex(t => t.id === incident.defenderTeamId) + 1}.${rand(10, 240)}`;
  incident.lastAttackSeq++; incident.lastActionAt = now; incident.deadline = now + reaction(state); incident.nextProbeAt = null;
}
export function tickCampaign(state, now) {
  if (!isCampaign(state) || state.status !== 'running') return false;
  let dirty = false;
  for (const incident of state.incidents) if (!incident.bot && isLive(incident) && now - incident.lastActionAt >= 45000) {
    incident.status = 'abandoned'; incident.lastActionAt = now; dirty = true;
    event(state, 'Conexão encerrada após 45 segundos sem ação. A vaga de ataque foi liberada.', now, [incident.attackerTeamId, incident.defenderTeamId]);
  }
  for (const team of state.teams) {
    const c = campaignTeam(team); unlockCampaign(state, team, now);
    if (c.controlSince !== null) {
      const minutes = Math.floor((now - c.controlSince) / 60000);
      if (minutes > 0) { team.score += minutes * state.points.control; c.controlCount += minutes; c.controlSince += minutes * 60000; dirty = true; }
    }
    const activeBot = state.incidents.find(i => i.bot === 'interpol' && i.defenderTeamId === team.id && i.status === 'active');
    const failureBeforeBrute = activeBot?.stage > 0 && now >= activeBot.deadline && activeBot.deadline <= (c.brute?.endsAt || 0);
    if (c.brute?.status === 'running' && now >= c.brute.endsAt && !failureBeforeBrute) {
      c.brute.status = fullKeys(state, team.id) && c.brute.seal === keySeal(state, team.id) ? 'complete' : 'cancelled';
      if (c.brute.status === 'complete') { c.documentUnlocked = true; event(state, `${team.name} concluiu a brute force. O PDF com o código do Pentágono está aberto para a equipe.`, now, [team.id]); } dirty = true;
    }
    if (activeBot) {
      if (activeBot.stage === 0 && now >= activeBot.nextProbeAt) { bossProbe(state, activeBot, now); dirty = true; }
      else if (activeBot.stage > 0 && now >= activeBot.deadline) {
        activeBot.status = 'captured'; activeBot.lastActionAt = now; c.interpol.nextWaveAt = now + 30000;
        const held = state.keys.filter(k => k.holderTeamId === team.id && k.ownerTeamId !== team.id);
        if (held.length) { const key = held[rand(0, held.length - 1)]; moveKey(state, key, key.ownerTeamId, now); event(state, `Interpol venceu a onda contra ${team.name} e devolveu uma chave ao dono.`, now, [team.id, key.ownerTeamId]); }
        else event(state, `Interpol venceu a onda contra ${team.name}. Nova onda em 30 segundos.`, now, [team.id]);
        dirty = true;
      }
    } else if (c.interpol && now >= c.interpol.nextWaveAt && state.incidents.filter(i => i.defenderTeamId === team.id && isLive(i)).length < state.maxIncoming) {
      const bot = { id: id(), bot: 'interpol', attackerId: null, attackerTeamId: null, defenderTeamId: team.id, stage: 0, status: 'active', route: 1, attackCooldownUntil: 0, defenseCooldownUntil: 0, defenseCount: 0, lastAttackSeq: 0, lastDefenseSeq: 0, lastActionAt: now, responses: 0, wave: ++c.interpol.wave };
      state.incidents.push(bot); bossProbe(state, bot, now); dirty = true;
    }
    if (c.mission?.status === 'active' && !c.mission.paused) for (const player of c.mission.players) {
      if (player.threat && now >= player.threat.deadline) { player.stage = Math.max(0, player.stage - 1); player.threat = null; player.failures++; player.readyAt = now + 5000; dirty = true; event(state, `${team.name}: a IA do Pentágono interrompeu uma etapa. Leia os logs e tente novamente.`, now, [team.id]); }
    }
  }
  // Keep completed bot history bounded independently of live human connections.
  const oldBots = state.incidents.filter(i => i.bot && !isLive(i));
  if (oldBots.length > 40) { const discard = new Set(oldBots.slice(0, oldBots.length - 40).map(i => i.id)); state.incidents = state.incidents.filter(i => !discard.has(i.id)); dirty = true; }
  const keep = new Set();
  for (const team of state.teams) for (const incident of state.incidents.filter(i => !i.bot && !isLive(i) && i.defenderTeamId === team.id).slice(-12)) keep.add(incident.id);
  const bounded = state.incidents.filter(i => i.bot || isLive(i) || keep.has(i.id));
  if (bounded.length !== state.incidents.length) { state.incidents = bounded; dirty = true; }
  return dirty;
}
export function bossDefense(state, team, incident, command, now) {
  const expected = `${DEFENSE[incident.stage]} ${incident.origin}`;
  if (command !== expected) fail(409, 'Resposta da IA incorreta. Confira a etapa e o IP de origem nos logs; digite ferramenta e IP.');
  incident.responses++; incident.lastDefenseSeq = incident.lastAttackSeq; incident.defenseCount++; incident.lastActionAt = now; incident.defenseCooldownUntil = now + 5000;
  team.defenseCount++; team.score += state.points.defense;
  if (incident.responses === 3) { incident.status = 'defeated'; campaignTeam(team).wavesWon++; team.score += state.points.wave; campaignTeam(team).interpol.nextWaveAt = now + 20000; }
  else { incident.stage = 0; incident.deadline = null; incident.nextProbeAt = now + 8000; }
  event(state, `${team.name}: resposta correta à Interpol (${incident.responses}/3).${incident.status === 'defeated' ? ` Onda vencida: bônus +${state.points.wave}.` : ''}`, now, [team.id]);
  return { message: `Defesa da IA válida: +${state.points.defense}.${incident.status === 'defeated' ? ` Onda vencida: +${state.points.wave} pontos!` : ' A próxima investida chega em 8 segundos.'}` };
}
export function campaignAction(state, member, input, now) {
  if (!isCampaign(state)) fail(409, 'Essa missão pertence ao modo Campanha das Chaves.');
  const team = state.teams.find(t => t.id === member.teamId); if (!team) fail(403, 'Aguarde sua equipe.');
  if (!fullKeys(state, team.id)) fail(409, 'Reúna todas as chaves atuais para executar a brute force ou avançar no Pentágono.');
  const c = campaignTeam(team); const command = input.command;
  if (typeof command !== 'string') fail(400, 'Digite um comando completo.');
  if (command.startsWith('bruteforce')) {
    if (c.documentUnlocked) fail(409, 'O PDF já está aberto para todos os integrantes.');
    if (c.brute?.status === 'running') fail(409, 'A busca da equipe já está em andamento. Protejam as chaves.');
    const expected = `bruteforce --mask ?d?d?d?d --keys ${keySeal(state, team.id)}`;
    if (command !== expected) fail(409, 'Máscara ou conjunto de chaves incorreto. A pista descreve quatro dígitos numéricos.');
    c.brute = { status: 'running', startedAt: now, endsAt: now + 20000, seal: keySeal(state, team.id), participantId: member.id };
    return { message: 'Brute force guiada iniciada: 10.000 combinações simuladas em 20 segundos. Defendam as chaves; perder uma interrompe a busca.' };
  }
  if (!c.documentUnlocked) fail(409, 'Conclua a brute force e leia o código no PDF.');
  if (command.startsWith('connect ')) {
    if (command !== `connect ${c.accessCode}`) fail(409, 'Código incorreto. Leia o código de acesso no PDF da sua equipe.');
    if (c.mission) fail(409, 'A missão do Pentágono já foi aberta para todos os integrantes.');
    c.mission = { status: 'active', paused: false, startedAt: now, players: state.participants.filter(p => p.teamId === team.id).map((p, index) => ({ participantId: p.id, stage: 0, ip: `10.90.${state.teams.indexOf(team) + 1}.${index + 10}`, port: [22, 443, 8080][rand(0, 2)], token: randomBytes(3).toString('hex'), threat: null, failures: 0, readyAt: now })) };
    event(state, `${team.name} entrou no Pentágono virtual. Cada integrante precisa vencer seu desafio.`, now, [team.id]);
    return { message: 'Missão cooperativa aberta. Todos têm um terminal próprio; leiam as pistas e neutralizem cada contra-ataque da IA.' };
  }
  if (!c.mission || c.mission.status !== 'active') fail(409, 'Entre no Pentágono com connect e o código encontrado no PDF.');
  const player = c.mission.players.find(p => p.participantId === member.id);
  if (!player) fail(403, 'Você não integra a missão desta equipe.');
  if (player.stage === 4) fail(409, 'Seu desafio já foi concluído. Ajude o time a proteger as chaves.');
  if (now < player.readyAt) fail(429, 'A IA encerrou sua tentativa. Aguarde cinco segundos.');
  if (player.threat) {
    if (command !== `${DEFENSE[player.threat.stage]} ${player.threat.origin}`) fail(409, 'A IA está contra-atacando. Identifique a etapa nos logs e responda com a ferramenta e o IP de origem corretos.');
    player.threat = null;
    return { message: 'Contra-ataque da IA neutralizado. Continue sua investigação pelo terminal.' };
  }
  const expected = [`scan ${player.ip}`, `inspect ${player.port}`, `access ${player.token}`, 'extract master'][player.stage];
  if (command !== expected) fail(409, 'Comando ou argumento incorreto. Leia o resultado da sua última etapa nos logs.');
  player.stage++;
  if (player.stage === 4) {
    if (c.mission.players.every(p => p.stage === 4)) { c.mission.status = 'complete'; c.masterCount = 1; team.score += state.points.master; event(state, `${team.name} conquistou a bandeira mestra: todos venceram a IA! +${state.points.master} pontos.`, now); return { message: `Bandeira mestra conquistada! +${state.points.master} pontos para a equipe. A rodada continua: protejam as chaves.` }; }
    return { message: 'Seu desafio foi vencido! A bandeira mestra aguarda os demais integrantes. Proteja as chaves enquanto eles terminam.' };
  }
  player.threat = { stage: player.stage, origin: `10.99.${state.teams.indexOf(team) + 1}.${rand(10, 240)}`, deadline: now + reaction(state, true) };
  return { message: `${player.stage === 1 ? `Serviço descoberto na porta ${player.port}.` : player.stage === 2 ? `Credencial de sessão encontrada: ${player.token}.` : 'Acesso autorizado ao cofre mestre.'} A IA iniciou um contra-ataque; consulte a etapa e o IP nos logs.` };
}
export function campaignSnapshot(state, viewer) {
  if (!isCampaign(state) || viewer.kind === 'public') return null;
  const team = state.teams.find(t => t.id === viewer.teamId);
  const keys = (state.keys || []).map(k => ({ ...k, ownerName: state.teams.find(t => t.id === k.ownerTeamId)?.name || '', holderName: state.teams.find(t => t.id === k.holderTeamId)?.name || '' }));
  if (!team) return { keys };
  const c = campaignTeam(team); const player = c.mission?.players.find(p => p.participantId === viewer.participantId);
  return { keys, total: keys.length || state.teams.length, count: keyCount(state, team.id), full: fullKeys(state, team.id), seal: fullKeys(state, team.id) ? keySeal(state, team.id) : '', documentGranted: c.documentGranted, documentUnlocked: c.documentUnlocked, brute: c.brute ? { ...c.brute, seal: undefined } : null,
    interpol: c.interpol ? { wave: c.interpol.wave, nextWaveAt: c.interpol.nextWaveAt, wavesWon: c.wavesWon } : null,
    mission: c.mission ? { status: c.mission.status, paused: c.mission.paused, players: c.mission.players.map(p => ({ participantId: p.participantId, name: state.participants.find(m => m.id === p.participantId)?.name || '', stage: p.stage, failures: p.failures })), player: player ? { stage: player.stage, ip: player.ip, ...(player.stage >= 1 ? { port: player.port } : {}), ...(player.stage >= 2 ? { token: player.token } : {}), threat: player.threat, readyAt: player.readyAt } : null } : null };
}
