import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const LIMITS = Object.freeze({ participants: 60, teams: 20, pdfBytes: 3 * 1024 * 1024, attackMs: 4000, defenseMs: 5000, defenseCapacity: 2, defenseRechargeMs: 8000, downloadMs: 10 * 60 * 1000 });
export const EFFECTS = Object.freeze([
  { id: 'glitch', name: 'Glitch', description: 'Sombras coloridas e pequenas falhas no terminal.' },
  { id: 'tremor', name: 'Terremoto', description: 'A estação treme levemente.' },
  { id: 'fog', name: 'Neblina', description: 'Uma névoa suaviza os detalhes da estação.' },
  { id: 'mirror', name: 'Espelho', description: 'A estação fica invertida na horizontal.' },
  { id: 'matrix', name: 'Chuva de código', description: 'Caracteres percorrem o fundo da tela.' },
  { id: 'retro', name: 'Monitor antigo', description: 'Filtro sépia e linhas de um monitor antigo.' },
  { id: 'blackout', name: 'Modo blecaute', description: 'A estação fica temporariamente escurecida.' },
  { id: 'pulse', name: 'Pulso do cofre', description: 'As bordas brilham em um pulso lento.' },
  { id: 'wind', name: 'Vento digital', description: 'Os painéis deslizam suavemente para os lados.' },
  { id: 'tilt', name: 'Maré de dados', description: 'Os painéis se inclinam suavemente.' }
]);
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
    points: { capture: 50, defense: 5, survival: 50 }, teacherHash: hash(token), participants: [], teams: [], incidents: [], captures: [], downloads: [], announcements: [], events: [], effects: [], metricsStartedAt: now };
}
function newGuard() { return { nonce: secret(), guidedUsed: [], guidedPending: null, cooldownUntil: 0, lockedUntil: 0, failures: [], rejectedCount: 0 }; }
function newMetrics(attackCommands = 0) { return { attackCommands, defenseCommands: 0, reconnects: 0, abandoned: 0, rejectedCommands: 0, attackByCommand: {}, defenseByCommand: {} }; }
// Upgrade existing activities in place; scores, PDFs and existing captures are retained.
export function normalizeState(state, now) {
  let changed = false;
  if (!state.effects) { state.effects = []; changed = true; }
  if (!state.metricsStartedAt) { state.metricsStartedAt = now; changed = true; }
  for (const team of state.teams) {
    if (!team.defenseReserve) { team.defenseReserve = { charges: LIMITS.defenseCapacity, updatedAt: now }; changed = true; }
  }
  for (const member of state.participants) {
    if (member.role === 'analyst') { member.role = ['running', 'finished'].includes(state.status) ? 'defense' : null; changed = true; }
    if (!member.commandGuard) { member.commandGuard = newGuard(); changed = true; }
    if (!member.metrics) { member.metrics = newMetrics(state.incidents.filter(i => i.attackerId === member.id).reduce((sum, i) => sum + (i.lastAttackSeq || 0), 0)); changed = true; }
  }
  return changed;
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
  for (const effect of state.effects || []) effect.endsAt = Math.min(effect.endsAt, now);
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
  const participant = { id: id(), name, tokenHash: hash(token), teamId: null, role: null, joinedAt: now, lastSeenAt: now, commandGuard: newGuard(), metrics: newMetrics() };
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
  const member = state.participants.find(p => p.id === viewer.participantId);
  const guarded = viewer.kind === 'student' && member && ['attack', 'defense', 'logs'].includes(input?.type);
  if (!guarded) return performAction(state, viewer, input, now);
  const guard = member.commandGuard;
  function reject(status, message, burst = false) {
    const current = state.participants.find(p => p.id === member.id);
    const currentGuard = current.commandGuard;
    currentGuard.rejectedCount += 1; current.metrics.rejectedCommands += 1;
    if (burst && now >= currentGuard.lockedUntil) {
      currentGuard.failures = currentGuard.failures.filter(at => now - at < 5000);
      currentGuard.failures.push(now);
      if (currentGuard.failures.length >= 4) {
        currentGuard.lockedUntil = now + 8000; currentGuard.failures = []; currentGuard.nonce = secret();
        message = 'Proteção contra autoclique: aguarde oito segundos e digite um novo comando.'; status = 429;
      }
    }
    return { rejection: { status, message } };
  }
  if (state.status !== 'running') return reject(409, 'Os comandos só são liberados durante a dinâmica.');
  if (now < guard.lockedUntil) return reject(429, 'Proteção contra autoclique ativa. Aguarde o contador para tentar novamente.');
  if (now < guard.cooldownUntil) return reject(429, 'Aguarde o intervalo entre comandos; trocar de conexão não remove esse intervalo.', true);
  if (input.nonce !== guard.nonce) return reject(409, 'Este comando já foi enviado ou está desatualizado. Digite novamente após a atualização.', true);
  if (!['guided', 'typed'].includes(input.entryMode)) return reject(400, 'Escolha a primeira execução guiada ou digite o comando completo.', true);
  const command = input.type === 'logs' ? 'logs' : input.command;
  if (input.entryMode === 'guided' && guard.guidedPending !== command) return reject(409, 'A execução guiada deste comando já foi usada. Agora escreva o comando.', true);
  const before = structuredClone(state);
  let result;
  try { result = performAction(state, viewer, input, now); }
  catch (error) {
    if (!(error instanceof ArenaError)) throw error;
    Object.assign(state, before);
    const currentGuard = state.participants.find(p => p.id === member.id).commandGuard;
    currentGuard.guidedPending = null; currentGuard.nonce = secret();
    return reject(error.status, error.message);
  }
  guard.nonce = secret(); guard.failures = [];
  guard.guidedPending = null;
  guard.cooldownUntil = now + (input.type === 'attack' ? LIMITS.attackMs : input.type === 'defense' ? LIMITS.defenseMs : 1000);
  if (input.type === 'attack') {
    member.metrics.attackCommands += 1;
    member.metrics.attackByCommand[command] = (member.metrics.attackByCommand[command] || 0) + 1;
    if (command === 'reconnect') member.metrics.reconnects += 1;
  }
  if (input.type === 'defense') {
    member.metrics.defenseCommands += 1;
    member.metrics.defenseByCommand[command] = (member.metrics.defenseByCommand[command] || 0) + 1;
  }
  return result;
}
function performAction(state, viewer, input, now) {
  if (!input || typeof input.type !== 'string') fail(400, 'Escolha uma ação.');
  const member = state.participants.find(p => p.id === viewer.participantId);
  if (member) member.lastSeenAt = now;
  switch (input.type) {
    case 'team-create': {
      teacher(viewer); preparing(state);
      if (state.teams.length >= LIMITS.teams) fail(409, 'Limite de 20 equipes atingido.');
      const name = text(input.name, 'Nome da equipe', 40);
      if (state.teams.some(t => t.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) fail(409, 'Já existe uma equipe com esse nome.');
      if (!Array.isArray(input.memberIds) || input.memberIds.length < 1 || input.memberIds.length > LIMITS.participants || new Set(input.memberIds).size !== input.memberIds.length) fail(400, 'Selecione ao menos um participante, sem repetir integrantes.');
      const members = input.memberIds.map(pid => state.participants.find(p => p.id === pid));
      if (members.some(p => !p || p.teamId)) fail(409, 'Selecione somente participantes que ainda não estão em uma equipe.');
      const team = { id: id(), name, memberIds: input.memberIds, document: null, score: 0, captureCount: 0, defenseCount: 0, survivalBonus: 0, compromised: false, defenseReserve: { charges: LIMITS.defenseCapacity, updatedAt: now } };
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
      if (!['attack', 'defense'].includes(input.role)) fail(400, 'Escolha atacante ou defensor.');
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
        if (members.some(p => !['attack', 'defense'].includes(p.role))) fail(409, `Todos os integrantes de ${team.name} precisam escolher atacante ou defensor.`);
        if (!team.document) fail(409, `Envie o PDF de ${team.name} antes de iniciar.`);
      }
      state.status = 'running'; state.startedAt = now; state.endsAt = now + minutes * 60000;
      state.teams.forEach(team => { team.defenseReserve = { charges: LIMITS.defenseCapacity, updatedAt: now }; });
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
    case 'effect': {
      teacher(viewer); running(state);
      const team = state.teams.find(t => t.id === input.teamId);
      const effect = EFFECTS.find(e => e.id === input.effectId);
      if (!team || !effect) fail(400, 'Escolha um grupo e um efeito do catálogo.');
      const seconds = integer(input.seconds ?? 8, 'Duração do efeito em segundos', 5, 20);
      if (state.effects.some(e => e.teamId === team.id && e.endsAt > now)) fail(409, 'Este grupo já está sob um efeito. Encerre-o ou aguarde o término.');
      state.effects.push({ id: id(), teamId: team.id, effectId: effect.id, startedAt: now, endsAt: now + seconds * 1000 });
      if (state.effects.length > 60) state.effects.splice(0, state.effects.length - 60);
      event(state, `Professor enviou ${effect.name} para ${team.name} por ${seconds} segundos.`, now, [team.id]);
      return { message: `${effect.name} enviado para ${team.name}.` };
    }
    case 'effect-clear': {
      teacher(viewer); running(state);
      if (!state.teams.some(t => t.id === input.teamId)) fail(404, 'Equipe não encontrada.');
      for (const effect of state.effects) if (effect.teamId === input.teamId) effect.endsAt = Math.min(effect.endsAt, now);
      return { message: 'Efeito encerrado para este grupo.' };
    }
    case 'finish':
      teacher(viewer); finish(state, now);
      return { message: 'Atividade encerrada. Ranking final disponível para todos.' };
    case 'logs':
      student(viewer);
      return { message: 'Observe os incidentes e seus registros. Ler os logs não soma pontos.' };
    case 'command-guide': {
      student(viewer); running(state);
      const commands = member.role === 'attack' ? ['scan', 'inspect', 'access', 'extract', 'reconnect'] : member.role === 'defense' ? ['reroute', 'block', 'revoke', 'logs'] : [];
      if (!commands.includes(input.command)) fail(400, 'Escolha um comando da sua função.');
      if (now < member.commandGuard.lockedUntil) fail(429, 'Aguarde a proteção contra autoclique terminar.');
      if (member.commandGuard.guidedUsed.includes(input.command)) fail(409, 'Você já clicou neste comando. Agora precisa escrevê-lo.');
      member.commandGuard.guidedUsed.push(input.command);
      member.commandGuard.guidedPending = input.command; member.commandGuard.nonce = secret();
      return {};
    }
    case 'attack':
      student(viewer); running(state);
      if (member.role !== 'attack') fail(403, 'Somente integrantes no papel de ataque podem atacar.');
      return attack(state, member, input, now);
    case 'attack-abandon': {
      student(viewer); running(state);
      if (member.role !== 'attack') fail(403, 'Somente atacantes podem trocar de alvo.');
      const incident = state.incidents.find(i => i.attackerId === member.id && ['active', 'blocked'].includes(i.status));
      if (!incident) fail(409, 'Não há uma conexão em andamento para encerrar.');
      incident.status = 'abandoned'; incident.lastActionAt = now;
      member.metrics.abandoned += 1;
      event(state, `${state.teams.find(t => t.id === member.teamId).name} encerrou uma conexão para trocar de alvo.`, now, [member.teamId, incident.defenderTeamId]);
      return { message: 'Conexão encerrada. Escolha outro alvo e comece com scan. O progresso desta conexão foi encerrado.' };
    }
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
  if (now < (member.attackCooldownUntil || 0)) fail(429, 'Aguarde quatro segundos entre comandos, inclusive ao trocar de alvo.');
  let incident = state.incidents.find(i => i.attackerId === member.id && i.defenderTeamId === target.id && ['active', 'blocked'].includes(i.status));
  if (!incident) {
    if (input.command !== 'scan') fail(409, 'Comece com scan para reconhecer o alvo.');
    if (state.incidents.some(i => i.attackerId === member.id && ['active', 'blocked'].includes(i.status))) fail(409, 'Use Trocar alvo para encerrar sua conexão atual.');
    if (state.incidents.filter(i => i.defenderTeamId === target.id && ['active', 'blocked'].includes(i.status)).length >= state.maxIncoming) fail(409, 'Este alvo já está recebendo o máximo de ataques. Escolha outra equipe.');
    incident = { id: id(), attackerId: member.id, attackerTeamId: ownTeam.id, defenderTeamId: target.id, stage: 0, status: 'active', route: 1,
      attackCooldownUntil: 0, defenseCooldownUntil: 0, defenseCount: 0, lastAttackSeq: 0, lastDefenseSeq: 0, lastActionAt: now };
    state.incidents.push(incident);
  }
  if (now < incident.attackCooldownUntil) fail(429, 'A ferramenta está em execução. Aguarde o intervalo de quatro segundos.');
  if (incident.status === 'blocked') {
    if (input.command !== 'reconnect') fail(409, 'Conexão interrompida. Execute reconnect antes de tentar novamente.');
    incident.status = 'active'; incident.stage = 0; incident.route += 1;
    incident.attackCooldownUntil = now + LIMITS.attackMs; incident.lastActionAt = now;
    member.attackCooldownUntil = now + LIMITS.attackMs;
    event(state, `${ownTeam.name} refez uma conexão com ${target.name}.`, now, [ownTeam.id, target.id]);
    return { message: 'Conexão restabelecida. Execute scan para localizar a rota novamente.' };
  }
  const expected = { scan: 0, inspect: 1, access: 2, extract: 3 };
  if (input.command === 'reconnect') fail(409, 'A conexão já está ativa. Continue a investigação.');
  if (incident.stage !== expected[input.command]) fail(409, `Etapa atual: ${['execute scan', 'execute inspect', 'execute access', 'execute extract'][incident.stage]}.`);
  incident.lastAttackSeq += 1; incident.lastActionAt = now; incident.attackCooldownUntil = now + LIMITS.attackMs;
  member.attackCooldownUntil = now + LIMITS.attackMs;
  if (input.command === 'extract') {
    incident.status = 'captured';
    const ticket = secret();
    state.captures.push({ id: id(), attackerTeamId: ownTeam.id, defenderTeamId: target.id, attackerId: member.id, at: now });
    state.downloads.push({ ticketHash: hash(ticket), documentKey: target.document.key, name: target.document.name, expiresAt: now + LIMITS.downloadMs, usedAt: null });
    ownTeam.score += state.points.capture; ownTeam.captureCount += 1; target.compromised = true;
    // The capture belongs to the team: sibling connections cannot obtain a second copy.
    state.incidents.filter(i => i.attackerTeamId === ownTeam.id && i.defenderTeamId === target.id && ['active', 'blocked'].includes(i.status)).forEach(i => { i.status = 'captured'; });
    event(state, `${ownTeam.name} extraiu o PDF de ${target.name}: +${state.points.capture} pontos.`, now, [ownTeam.id, target.id]);
    return { message: `PDF capturado! +${state.points.capture} pontos. Este grupo não pode ser capturado novamente pela sua equipe.`, download: { ticket, name: target.document.name } };
  }
  incident.stage += 1;
  const messages = { scan: 'Serviço de documentos localizado. Use inspect para investigar a configuração.', inspect: 'Pista encontrada: credencial de treino com permissão excessiva. Use access.', access: 'Acesso ao cofre obtido. Use extract para recuperar o PDF.' };
  event(state, `${ownTeam.name}: ${input.command} contra ${target.name}.`, now, [ownTeam.id, target.id]);
  return { message: messages[input.command] };
}
function defenseReserve(team, now) {
  const reserve = team.defenseReserve || { charges: LIMITS.defenseCapacity, updatedAt: now };
  const recovered = Math.floor(Math.max(0, now - reserve.updatedAt) / LIMITS.defenseRechargeMs);
  const charges = Math.min(LIMITS.defenseCapacity, reserve.charges + recovered);
  const updatedAt = charges === LIMITS.defenseCapacity ? now : reserve.updatedAt + recovered * LIMITS.defenseRechargeMs;
  return { charges, updatedAt, capacity: LIMITS.defenseCapacity, nextChargeAt: charges < LIMITS.defenseCapacity ? updatedAt + LIMITS.defenseRechargeMs : null };
}
function defense(state, member, input, now) {
  const incident = state.incidents.find(i => i.id === input.incidentId);
  if (!incident || incident.defenderTeamId !== member.teamId) fail(403, 'Selecione uma conexão que está atacando sua equipe.');
  if (!['reroute', 'block', 'revoke'].includes(input.command)) fail(400, 'Comando de defesa desconhecido.');
  if (incident.status !== 'active' || incident.stage < 1) fail(409, 'Essa conexão ainda não apresenta uma etapa de ataque que possa ser defendida.');
  if (incident.lastDefenseSeq >= incident.lastAttackSeq) fail(409, 'Essa etapa já recebeu uma resposta. Aguarde um novo avanço desse atacante.');
  if (now < incident.defenseCooldownUntil) fail(429, 'Aguarde cinco segundos para responder novamente a esta conexão.');
  if (input.command === 'revoke' && incident.stage !== 3) fail(409, 'Revogar acesso só funciona depois que o atacante entrou no cofre.');
  if (input.command === 'reroute' && incident.stage !== 1) fail(409, 'Use reroute na etapa Alvo reconhecido. Nesta etapa, escolha outra defesa.');
  if (input.command === 'block' && incident.stage !== 2) fail(409, 'Use block na etapa Pista encontrada. Observe o estágio antes de responder.');
  const ownTeam = state.teams.find(t => t.id === member.teamId);
  const reserve = defenseReserve(ownTeam, now);
  if (reserve.charges === 0) fail(429, `A reserva da equipe está vazia. Próxima defesa em ${Math.ceil((reserve.nextChargeAt - now) / 1000)} segundo(s).`);
  ownTeam.defenseReserve = { charges: reserve.charges - 1, updatedAt: reserve.updatedAt };
  incident.lastDefenseSeq = incident.lastAttackSeq; incident.defenseCount += 1; incident.defenseCooldownUntil = now + LIMITS.defenseMs; incident.lastActionAt = now;
  if (input.command === 'reroute') { incident.stage = 0; incident.route += 1; }
  if (input.command === 'block') { incident.stage = 0; incident.status = 'blocked'; }
  if (input.command === 'revoke') incident.stage = 2;
  ownTeam.score += state.points.defense; ownTeam.defenseCount += 1;
  const label = { reroute: 'despistou a conexão', block: 'bloqueou a conexão', revoke: 'revogou o acesso' }[input.command];
  event(state, `${ownTeam.name} ${label} ${incident.id.slice(0, 8)}: +${state.points.defense} pontos.`, now, [incident.attackerTeamId, ownTeam.id]);
  return { message: `Defesa válida! +${state.points.defense} pontos. Somente esta conexão foi afetada.` };
}
export function snapshot(state, viewer, now) {
  const publicView = viewer.kind === 'public';
  const canSee = teamId => viewer.kind === 'teacher' || viewer.teamId === teamId;
  const teams = state.teams.map(t => ({ id: t.id, name: t.name, memberIds: canSee(t.id) ? t.memberIds : [], document: { ready: !!t.document, name: canSee(t.id) ? (t.document?.name || '') : '', size: canSee(t.id) ? (t.document?.size || 0) : 0 }, score: t.score, captureCount: t.captureCount, defenseCount: t.defenseCount, survivalBonus: t.survivalBonus, compromised: t.compromised, leakCount: state.captures.filter(c => c.defenderTeamId === t.id).length, ...(canSee(t.id) ? { defenseReserve: defenseReserve(t, now) } : {}) }));
  const sorted = [...teams].sort((a, b) => b.score - a.score || b.captureCount - a.captureCount || b.defenseCount - a.defenseCount || a.name.localeCompare(b.name, 'pt-BR'));
  const ranking = sorted.map((t, index) => ({ id: t.id, name: t.name, score: t.score, captureCount: t.captureCount, defenseCount: t.defenseCount, survivalBonus: t.survivalBonus, leakCount: t.leakCount, position: index + 1 }));
  const member = state.participants.find(p => p.id === viewer.participantId);
  const teamMetrics = viewer.kind === 'teacher' ? teams.map(team => {
    const members = state.participants.filter(p => p.teamId === team.id).map(p => ({ id: p.id, name: p.name, role: p.role, online: now - p.lastSeenAt < 45000, ...p.metrics, captures: state.captures.filter(c => c.attackerId === p.id).length, lockUntil: p.commandGuard?.lockedUntil || 0 }));
    const active = i => ['active', 'blocked'].includes(i.status);
    return { teamId: team.id, attackCommands: members.reduce((sum, m) => sum + (m.attackCommands || 0), 0), rejectedCommands: members.reduce((sum, m) => sum + (m.rejectedCommands || 0), 0), outgoing: state.incidents.filter(i => i.attackerTeamId === team.id && active(i)).length, incoming: state.incidents.filter(i => i.defenderTeamId === team.id && active(i)).length,
      points: { captures: team.captureCount * state.points.capture, defenses: team.defenseCount * state.points.defense, survival: team.survivalBonus }, members,
      leaks: state.captures.filter(c => c.defenderTeamId === team.id).map(c => ({ id: c.id, teamName: state.teams.find(t => t.id === c.attackerTeamId)?.name || '', at: c.at })),
      capturedTeams: state.captures.filter(c => c.attackerTeamId === team.id).map(c => ({ id: c.id, teamName: state.teams.find(t => t.id === c.defenderTeamId)?.name || '', at: c.at })) };
  }) : [];
  return {
    activity: { code: state.code, title: state.title, status: state.status, startedAt: state.startedAt, endsAt: state.endsAt, finishedAt: state.finishedAt, maxIncoming: state.maxIncoming, points: state.points, metricsStartedAt: state.metricsStartedAt, rules: { attackMs: LIMITS.attackMs, defenseMs: LIMITS.defenseMs, defenseCapacity: LIMITS.defenseCapacity, defenseRechargeMs: LIMITS.defenseRechargeMs } },
    viewer: { ...viewer, ...(member ? { attackCooldownUntil: member.attackCooldownUntil || 0, commandGuard: { nonce: member.commandGuard.nonce, guidedUsed: member.commandGuard.guidedUsed, guidedPending: member.commandGuard.guidedPending, cooldownUntil: member.commandGuard.cooldownUntil, lockedUntil: member.commandGuard.lockedUntil } } : {}) },
    participants: publicView ? [] : state.participants.filter(p => viewer.kind === 'teacher' || p.id === viewer.participantId || (viewer.teamId && p.teamId === viewer.teamId)).map(p => ({ id: p.id, name: p.name, teamId: p.teamId, role: p.role, online: now - p.lastSeenAt < 45000 })),
    teams, ranking, teamMetrics,
    effectCatalog: EFFECTS,
    effects: publicView ? [] : (state.effects || []).filter(e => e.endsAt > now && (viewer.kind === 'teacher' || e.teamId === viewer.teamId)),
    incidents: publicView ? [] : state.incidents.filter(i => viewer.kind === 'teacher' || i.attackerTeamId === viewer.teamId || i.defenderTeamId === viewer.teamId).map(i => ({ id: i.id, attackerId: i.attackerId, attackerName: state.participants.find(p => p.id === i.attackerId)?.name || '', attackerTeamId: i.attackerTeamId, attackerTeamName: state.teams.find(t => t.id === i.attackerTeamId)?.name || '', defenderTeamId: i.defenderTeamId, defenderTeamName: state.teams.find(t => t.id === i.defenderTeamId)?.name || '', stage: i.stage, status: i.status, route: i.route, attackCooldownUntil: i.attackCooldownUntil, defenseCooldownUntil: i.defenseCooldownUntil, defenseCount: i.defenseCount, lastActionAt: i.lastActionAt, responded: i.lastDefenseSeq >= i.lastAttackSeq })),
    captures: publicView ? [] : state.captures.filter(c => viewer.kind === 'teacher' || c.attackerTeamId === viewer.teamId || c.defenderTeamId === viewer.teamId),
    announcements: state.announcements,
    events: publicView ? [] : state.events.filter(e => viewer.kind === 'teacher' || !e.teamIds.length || e.teamIds.includes(viewer.teamId)).slice(-60),
    serverNow: now
  };
}
