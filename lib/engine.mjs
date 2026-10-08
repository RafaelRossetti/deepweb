import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const LIMITS = Object.freeze({ participants: 60, teams: 20, pdfBytes: 3 * 1024 * 1024, attackMs: 3000, defenseMs: 5000, downloadMs: 10 * 60 * 1000 });
export class ArenaError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function fail(status, message) { throw new ArenaError(status, message); }
export const secret = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(String(value)).digest('hex');
export const id = () => randomUUID();
export function matches(value, expectedHash) {
  if (typeof value !== 'string' || !expectedHash) return false;
  const actual = Buffer.from(hash(value), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function code() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(6), n => alphabet[n % alphabet.length]).join('');
}
export function text(value, label, max = 80) {
  if (typeof value !== 'string') fail(400, `${label} é obrigatório.`);
  const result = value.trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (!result || result.length > max) fail(400, `${label} deve ter entre 1 e ${max} caracteres.`);
  return result;
}
function integer(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail(400, `${label} deve estar entre ${min} e ${max}.`);
  return value;
}
export function newActivity(input, token, now) {
  return { code: code(), title: text(input.title || 'Operação Retrospectiva', 'Título'), status: 'lobby', createdAt: now,
    startedAt: null, endsAt: null, finishedAt: null, maxIncoming: integer(input.maxIncoming ?? 2, 'Atacantes simultâneos por equipe', 1, 20),
    points: { capture: 50, defense: 5, survival: 50 }, teacherHash: hash(token), participants: [], teams: [], incidents: [], captures: [], downloads: [], announcements: [], events: [] };
}
export function viewerFor(state, token, required = false) {
  if (matches(token, state.teacherHash)) return { kind: 'teacher' };
  const participant = state.participants.find(p => matches(token, p.tokenHash));
  if (participant) return { kind: 'student', participantId: participant.id, teamId: participant.teamId, role: participant.role };
  if (required || token) fail(401, 'Sessão inválida. Entre novamente na atividade.');
  return { kind: 'public' };
}
function teacher(viewer) { if (viewer.kind !== 'teacher') fail(403, 'Essa ação é exclusiva do professor.'); }
function student(viewer) { if (viewer.kind !== 'student') fail(403, 'Entre como participante para executar essa ação.'); }
function preparing(state) { if (!['lobby', 'preparing'].includes(state.status)) fail(409, 'A organização e os documentos estão fechados nesta fase.'); }
function running(state) { if (state.status !== 'running') fail(409, 'Os ataques e as defesas só são liberados durante a dinâmica.'); }
function event(state, message, now, teamIds = []) {
  state.events.push({ id: id(), text: message, at: now, teamIds });
  if (state.events.length > 300) state.events.splice(0, state.events.length - 300);
}
export function finish(state, now, reason = 'Atividade encerrada pelo professor.') {
  if (state.status === 'finished') return false;
  if (state.status !== 'running') fail(409, 'Inicie a dinâmica antes de encerrá-la.');
  state.status = 'finished'; state.finishedAt = now;
  for (const team of state.teams) {
    if (!team.compromised && team.document) { team.survivalBonus = state.points.survival; team.score += state.points.survival; }
  }
  event(state, reason, now);
  return true;
}
export function expire(state, now) {
  if (state.status === 'running' && now >= state.endsAt) return finish(state, now, 'Tempo esgotado. Ranking final calculado.');
  return false;
}
export function addParticipant(state, input, token, now) {
  preparing(state);
  if (state.participants.length >= LIMITS.participants) fail(409, 'A atividade atingiu o limite de 60 participantes.');
  const name = text(input.name, 'Nome do participante', 60);
  if (state.participants.some(p => p.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) fail(409, 'Esse nome já entrou. Use um nome que identifique você ou retome sua sessão neste navegador.');
  const participant = { id: id(), name, tokenHash: hash(token), teamId: null, role: null, joinedAt: now, lastSeenAt: now };
  state.participants.push(participant);
  return participant.id;
}
export function attachDocument(state, viewer, teamId, document, now) {
  teacher(viewer); preparing(state);
  const team = state.teams.find(t => t.id === teamId);
  if (!team) fail(404, 'Equipe não encontrada.');
  const oldKey = team.document?.key;
  team.document = document;
  event(state, `PDF de ${team.name} preparado.`, now, [team.id]);
  return oldKey;
}
export function action(state, viewer, input, now) {
  if (!input || typeof input.type !== 'string') fail(400, 'Escolha uma ação.');
  const member = state.participants.find(p => p.id === viewer.participantId);
  if (member) member.lastSeenAt = now;
  switch (input.type) {
    case 'team-create': {
      teacher(viewer); preparing(state);
      if (state.teams.length >= LIMITS.teams) fail(409, 'Limite de 20 equipes atingido.');
      const name = text(input.name, 'Nome da equipe', 40);
      if (state.teams.some(t => t.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) fail(409, 'Já existe uma equipe com esse nome.');
      if (!Array.isArray(input.memberIds) || input.memberIds.length < 2 || input.memberIds.length > 3 || new Set(input.memberIds).size !== input.memberIds.length) fail(400, 'Selecione dois ou três participantes diferentes.');
      const members = input.memberIds.map(pid => state.participants.find(p => p.id === pid));
      if (members.some(p => !p || p.teamId)) fail(409, 'Selecione somente participantes que ainda não estão em uma equipe.');
      const team = { id: id(), name, memberIds: input.memberIds, document: null, score: 0, captureCount: 0, defenseCount: 0, survivalBonus: 0, compromised: false };
      state.teams.push(team); members.forEach(p => { p.teamId = team.id; p.role = null; });
      return { message: `Equipe ${name} formada. Os integrantes podem escolher seus papéis.` };
    }
    case 'team-delete': {
      teacher(viewer); preparing(state);
      const team = state.teams.find(t => t.id === input.teamId);
      if (!team) fail(404, 'Equipe não encontrada.');
      state.participants.filter(p => p.teamId === team.id).forEach(p => { p.teamId = null; p.role = null; });
      state.teams = state.teams.filter(t => t.id !== team.id);
      return { message: 'Equipe desfeita. Os alunos voltaram à lista de espera.', cleanupKey: team.document?.key };
    }
    case 'role': {
      student(viewer); preparing(state);
      if (!member.teamId) fail(409, 'Aguarde o professor colocar você em uma equipe.');
      if (!['attack', 'defense', 'analyst'].includes(input.role)) fail(400, 'Escolha ataque, defesa ou análise.');
      member.role = input.role;
      return { message: 'Papel escolhido. A equipe precisa de pelo menos um atacante e um defensor.' };
    }
    case 'prepare':
      teacher(viewer); preparing(state); state.status = 'preparing';
      event(state, 'Preparação liberada: estudem e experimentem as ferramentas.', now);
      return { message: 'Preparação liberada. Você pode enviar os PDFs enquanto os alunos estudam.' };
    case 'start': {
      teacher(viewer);
      if (state.status !== 'preparing') fail(409, 'Libere a preparação antes de iniciar.');
      const minutes = integer(input.minutes, 'Duração em minutos', 1, 180);
      if (state.teams.length < 2) fail(409, 'Forme pelo menos duas equipes.');
      for (const team of state.teams) {
        const members = state.participants.filter(p => p.teamId === team.id);
        if (!members.some(p => p.role === 'attack') || !members.some(p => p.role === 'defense')) fail(409, `${team.name} precisa de pelo menos um atacante e um defensor.`);
        if (members.some(p => !p.role)) fail(409, `Todos os integrantes de ${team.name} precisam escolher um papel.`);
        if (!team.document) fail(409, `Envie o PDF de ${team.name} antes de iniciar.`);
      }
      state.status = 'running'; state.startedAt = now; state.endsAt = now + minutes * 60000;
      event(state, `Dinâmica iniciada por ${minutes} minuto(s).`, now);
      return { message: 'Ataques e defesas liberados!' };
    }
    case 'announce': {
      teacher(viewer);
      if (state.status === 'finished') fail(409, 'A atividade já terminou.');
      const message = text(input.text, 'Alerta', 500);
      state.announcements.push({ id: id(), text: message, at: now });
      if (state.announcements.length > 30) state.announcements.shift();
      event(state, `Aviso do professor: ${message}`, now);
      return { message: 'Alerta enviado para todos.' };
    }
    case 'extend': {
      teacher(viewer); running(state);
      const minutes = integer(input.minutes, 'Tempo adicional', 1, 60);
      state.endsAt += minutes * 60000;
      event(state, `Professor acrescentou ${minutes} minuto(s).`, now);
      return { message: `${minutes} minuto(s) acrescentado(s).` };
    }
    case 'finish':
      teacher(viewer); finish(state, now);
      return { message: 'Atividade encerrada. Ranking final disponível para todos.' };
    case 'logs':
      student(viewer);
      return { message: 'Observe os incidentes e seus registros. Ler os logs não soma pontos.' };
    case 'attack':
      student(viewer); running(state);
      if (member.role !== 'attack') fail(403, 'Somente integrantes no papel de ataque podem atacar.');
      return attack(state, member, input, now);
    case 'defense':
      student(viewer); running(state);
      if (member.role !== 'defense') fail(403, 'Somente integrantes no papel de defesa podem responder aos incidentes.');
      return defense(state, member, input, now);
    default: fail(400, 'Ação desconhecida. Escolha uma ferramenta do catálogo.');
  }
}
function attack(state, member, input, now) {
  const ownTeam = state.teams.find(t => t.id === member.teamId);
  const target = state.teams.find(t => t.id === input.targetTeamId);
  if (!ownTeam || !target) fail(404, 'Selecione uma equipe alvo.');
  if (target.id === ownTeam.id) fail(400, 'Você precisa atacar outra equipe.');
  if (state.captures.some(c => c.attackerTeamId === ownTeam.id && c.defenderTeamId === target.id)) fail(409, 'Sua equipe já extraiu esse documento. Escolha outro grupo.');
  if (!['scan', 'inspect', 'access', 'extract', 'reconnect'].includes(input.command)) fail(400, 'Comando de ataque desconhecido.');
  let incident = state.incidents.find(i => i.attackerId === member.id && i.defenderTeamId === target.id && i.status !== 'captured');
  if (!incident) {
    if (input.command !== 'scan') fail(409, 'Comece com scan para reconhecer o alvo.');
    if (state.incidents.some(i => i.attackerId === member.id && i.status !== 'captured')) fail(409, 'Conclua seu ataque atual antes de escolher outro alvo.');
    if (state.incidents.filter(i => i.defenderTeamId === target.id && i.status !== 'captured').length >= state.maxIncoming) fail(409, 'Este alvo já está recebendo o máximo de ataques. Escolha outra equipe.');
    incident = { id: id(), attackerId: member.id, attackerTeamId: ownTeam.id, defenderTeamId: target.id, stage: 0, status: 'active', route: 1,
      attackCooldownUntil: 0, defenseCooldownUntil: 0, defenseCount: 0, lastAttackSeq: 0, lastDefenseSeq: 0, lastActionAt: now };
    state.incidents.push(incident);
  }
  if (now < incident.attackCooldownUntil) fail(429, 'A ferramenta está em execução. Aguarde o intervalo de três segundos.');
  if (incident.status === 'blocked') {
    if (input.command !== 'reconnect') fail(409, 'Conexão interrompida. Execute reconnect antes de tentar novamente.');
    incident.status = 'active'; incident.stage = 0; incident.route += 1;
    incident.attackCooldownUntil = now + LIMITS.attackMs; incident.lastActionAt = now;
    event(state, `${ownTeam.name} refez uma conexão com ${target.name}.`, now, [ownTeam.id, target.id]);
    return { message: 'Conexão restabelecida. Execute scan para localizar a rota novamente.' };
  }
  const expected = { scan: 0, inspect: 1, access: 2, extract: 3 };
  if (input.command === 'reconnect') fail(409, 'A conexão já está ativa. Continue a investigação.');
  if (incident.stage !== expected[input.command]) fail(409, `Etapa atual: ${['execute scan', 'execute inspect', 'execute access', 'execute extract'][incident.stage]}.`);
  incident.lastAttackSeq += 1; incident.lastActionAt = now; incident.attackCooldownUntil = now + LIMITS.attackMs;
  if (input.command === 'extract') {
    incident.status = 'captured';
    const ticket = secret();
    state.captures.push({ id: id(), attackerTeamId: ownTeam.id, defenderTeamId: target.id, attackerId: member.id, at: now });
    state.downloads.push({ ticketHash: hash(ticket), documentKey: target.document.key, name: target.document.name, expiresAt: now + LIMITS.downloadMs, usedAt: null });
    ownTeam.score += state.points.capture; ownTeam.captureCount += 1; target.compromised = true;
    // The capture belongs to the team: sibling connections cannot obtain a second copy.
    state.incidents.filter(i => i.attackerTeamId === ownTeam.id && i.defenderTeamId === target.id).forEach(i => { i.status = 'captured'; });
    event(state, `${ownTeam.name} extraiu o PDF de ${target.name}: +${state.points.capture} pontos.`, now, [ownTeam.id, target.id]);
    return { message: `PDF capturado! +${state.points.capture} pontos. Este grupo não pode ser capturado novamente pela sua equipe.`, download: { ticket, name: target.document.name } };
  }
  incident.stage += 1;
  const messages = { scan: 'Serviço de documentos localizado. Use inspect para investigar a configuração.', inspect: 'Pista encontrada: credencial de treino com permissão excessiva. Use access.', access: 'Acesso ao cofre obtido. Use extract para recuperar o PDF.' };
  event(state, `${ownTeam.name}: ${input.command} contra ${target.name}.`, now, [ownTeam.id, target.id]);
  return { message: messages[input.command] };
}
function defense(state, member, input, now) {
  const incident = state.incidents.find(i => i.id === input.incidentId);
  if (!incident || incident.defenderTeamId !== member.teamId) fail(403, 'Selecione uma conexão que está atacando sua equipe.');
  if (!['reroute', 'block', 'revoke'].includes(input.command)) fail(400, 'Comando de defesa desconhecido.');
  if (incident.status !== 'active' || incident.stage < 1) fail(409, 'Essa conexão ainda não apresenta uma etapa de ataque que possa ser defendida.');
  if (incident.lastDefenseSeq >= incident.lastAttackSeq) fail(409, 'Essa etapa já recebeu uma resposta. Aguarde um novo avanço desse atacante.');
  if (now < incident.defenseCooldownUntil) fail(429, 'Aguarde cinco segundos para responder novamente a esta conexão.');
  if (input.command === 'revoke' && incident.stage !== 3) fail(409, 'Revogar acesso só funciona depois que o atacante entrou no cofre.');
  incident.lastDefenseSeq = incident.lastAttackSeq; incident.defenseCount += 1; incident.defenseCooldownUntil = now + LIMITS.defenseMs; incident.lastActionAt = now;
  if (input.command === 'reroute') { incident.stage = 0; incident.route += 1; }
  if (input.command === 'block') { incident.stage = 0; incident.status = 'blocked'; }
  if (input.command === 'revoke') incident.stage = 2;
  const ownTeam = state.teams.find(t => t.id === member.teamId);
  ownTeam.score += state.points.defense; ownTeam.defenseCount += 1;
  const label = { reroute: 'despistou a conexão', block: 'bloqueou a conexão', revoke: 'revogou o acesso' }[input.command];
  event(state, `${ownTeam.name} ${label} ${incident.id.slice(0, 8)}: +${state.points.defense} pontos.`, now, [incident.attackerTeamId, ownTeam.id]);
  return { message: `Defesa válida! +${state.points.defense} pontos. Somente esta conexão foi afetada.` };
}
export function snapshot(state, viewer, now) {
  const publicView = viewer.kind === 'public';
  const canSee = teamId => viewer.kind === 'teacher' || viewer.teamId === teamId;
  const teams = state.teams.map(t => ({ id: t.id, name: t.name, memberIds: canSee(t.id) ? t.memberIds : [], document: { ready: !!t.document, name: canSee(t.id) ? (t.document?.name || '') : '', size: canSee(t.id) ? (t.document?.size || 0) : 0 }, score: t.score, captureCount: t.captureCount, defenseCount: t.defenseCount, survivalBonus: t.survivalBonus, compromised: t.compromised }));
  const sorted = [...teams].sort((a, b) => b.score - a.score || b.captureCount - a.captureCount || b.defenseCount - a.defenseCount || a.name.localeCompare(b.name, 'pt-BR'));
  const ranking = sorted.map((t, index) => ({ id: t.id, name: t.name, score: t.score, captureCount: t.captureCount, defenseCount: t.defenseCount, survivalBonus: t.survivalBonus, position: index + 1 }));
  return {
    activity: { code: state.code, title: state.title, status: state.status, startedAt: state.startedAt, endsAt: state.endsAt, finishedAt: state.finishedAt, maxIncoming: state.maxIncoming, points: state.points },
    viewer,
    participants: publicView ? [] : state.participants.filter(p => viewer.kind === 'teacher' || p.id === viewer.participantId || (viewer.teamId && p.teamId === viewer.teamId)).map(p => ({ id: p.id, name: p.name, teamId: p.teamId, role: p.role, online: now - p.lastSeenAt < 45000 })),
    teams, ranking,
    incidents: publicView ? [] : state.incidents.filter(i => viewer.kind === 'teacher' || i.attackerTeamId === viewer.teamId || i.defenderTeamId === viewer.teamId).map(i => ({ id: i.id, attackerId: i.attackerId, attackerName: state.participants.find(p => p.id === i.attackerId)?.name || '', attackerTeamId: i.attackerTeamId, attackerTeamName: state.teams.find(t => t.id === i.attackerTeamId)?.name || '', defenderTeamId: i.defenderTeamId, defenderTeamName: state.teams.find(t => t.id === i.defenderTeamId)?.name || '', stage: i.stage, status: i.status, route: i.route, attackCooldownUntil: i.attackCooldownUntil, defenseCooldownUntil: i.defenseCooldownUntil, defenseCount: i.defenseCount, lastActionAt: i.lastActionAt, responded: i.lastDefenseSeq >= i.lastAttackSeq })),
    captures: publicView ? [] : state.captures.filter(c => viewer.kind === 'teacher' || c.attackerTeamId === viewer.teamId || c.defenderTeamId === viewer.teamId),
    announcements: state.announcements,
    events: publicView ? [] : state.events.filter(e => viewer.kind === 'teacher' || !e.teamIds.length || e.teamIds.includes(viewer.teamId)).slice(-60),
    serverNow: now
  };
}
