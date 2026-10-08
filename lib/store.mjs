import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';

const CODE_PATTERN = /^[A-Z2-9]{6}$/;
const TEAM_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const KEY_PATTERN = /^[A-Z2-9]{6}\/[a-zA-Z0-9_-]{1,80}\/[a-f0-9-]{36}\.pdf$/;
const DOCUMENT_BUCKET = 'thor-documents';
const MAX_PDF_BYTES = 3 * 1024 * 1024;
// Share queues across store instances in this process, without caching activity data.
const localQueues = new Map();

function storeError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  return error;
}

function assertCode(code) {
  if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
    throw storeError('Código de atividade inválido.', 400);
  }
  return code;
}

function assertRevision(revision) {
  if (!Number.isSafeInteger(revision) || revision < 1 || revision >= Number.MAX_SAFE_INTEGER) {
    throw storeError('Revisão de atividade inválida.', 400);
  }
}

function assertKey(key) {
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw storeError('Referência de documento inválida.', 400);
  }
  return key;
}

function serializeState(state) {
  let json;
  try {
    json = JSON.stringify(state);
  } catch {
    throw storeError('Estado da atividade inválido.', 400);
  }
  if (!json || state === null || typeof state !== 'object' || Array.isArray(state)) {
    throw storeError('Estado da atividade inválido.', 400);
  }
  // Capture an independent JSON snapshot before any asynchronous operation.
  return JSON.parse(json);
}

function documentInput(code, teamId, buffer) {
  assertCode(code);
  if (typeof teamId !== 'string' || !TEAM_PATTERN.test(teamId)) {
    throw storeError('Identificador de equipe inválido.', 400);
  }
  if (!Buffer.isBuffer(buffer) || buffer.length < 5 || buffer.length > MAX_PDF_BYTES) {
    throw storeError('Envie um PDF de até 3 MiB.', 400);
  }
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw storeError('O documento precisa ser um PDF.', 400);
  }
  return { key: `${code}/${teamId}/${randomUUID()}.pdf`, bytes: Buffer.from(buffer) };
}

async function withLocalQueue(key, operation) {
  const previous = localQueues.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  localQueues.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (localQueues.get(key) === current) localQueues.delete(key);
  }
}

async function writeTemporaryFile(filename, bytes) {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
  await handle.close();
  return temporary;
}

async function atomicWrite(filename, bytes, { exclusive = false } = {}) {
  const temporary = await writeTemporaryFile(filename, bytes);
  try {
    if (exclusive) {
      // A hard link publishes the complete file atomically and never replaces
      // an existing activity, including when two local processes create it.
      await fs.link(temporary, filename);
    } else {
      await fs.rename(temporary, filename);
    }
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}

function localStore(dataDir) {
  const root = path.resolve(dataDir);
  const activityFile = (code) => path.join(root, 'activities', `${assertCode(code)}.json`);
  const documentFile = (key) => {
    assertKey(key);
    const documentsRoot = path.join(root, 'documents');
    const resolved = path.resolve(documentsRoot, ...key.split('/'));
    if (!resolved.startsWith(`${documentsRoot}${path.sep}`)) {
      throw storeError('Referência de documento inválida.', 400);
    }
    return resolved;
  };

  async function read(code) {
    const filename = activityFile(code);
    let contents;
    try {
      contents = await fs.readFile(filename, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    let record;
    try {
      record = JSON.parse(contents);
      assertRevision(record.revision);
      if (!record.state || typeof record.state !== 'object' || Array.isArray(record.state)) throw new Error();
    } catch {
      throw storeError('Não foi possível ler os dados salvos da atividade.');
    }
    return { state: record.state, revision: record.revision };
  }

  return {
    mode: 'local',
    async create(code, state) {
      const filename = activityFile(code);
      const record = { state: serializeState(state), revision: 1 };
      return withLocalQueue(filename, async () => {
        try {
          await atomicWrite(filename, JSON.stringify(record), { exclusive: true });
        } catch (error) {
          if (error.code === 'EEXIST') throw storeError('Esta atividade já existe.', 409);
          throw error;
        }
        return record;
      });
    },
    read,
    async compareAndSwap(code, expectedRevision, state) {
      const filename = activityFile(code);
      assertRevision(expectedRevision);
      const snapshot = serializeState(state);
      return withLocalQueue(filename, async () => {
        const current = await read(code);
        if (!current || current.revision !== expectedRevision) return false;
        await atomicWrite(filename, JSON.stringify({ state: snapshot, revision: expectedRevision + 1 }));
        return true;
      });
    },
    async putDocument(code, teamId, buffer) {
      const { key, bytes } = documentInput(code, teamId, buffer);
      await atomicWrite(documentFile(key), bytes, { exclusive: true });
      return { key };
    },
    async getDocument(key) {
      try {
        return await fs.readFile(documentFile(key));
      } catch (error) {
        if (error.code === 'ENOENT') throw storeError('Documento não encontrado.', 404);
        throw error;
      }
    },
    async deleteDocument(key) {
      try {
        await fs.unlink(documentFile(key));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    },
  };
}

function supabaseStore(supabaseUrl, supabaseKey) {
  let base;
  try {
    base = new URL(supabaseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new Error();
    }
    if (base.pathname !== '/' && base.pathname !== '') throw new Error();
  } catch {
    throw storeError('SUPABASE_URL precisa ser a URL base do projeto.');
  }
  const key = String(supabaseKey).trim();
  const legacyJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key);
  if (!key.startsWith('sb_secret_') && !legacyJwt) {
    throw storeError('Configure uma chave secreta de servidor do Supabase.');
  }
  if (legacyJwt) {
    try {
      const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
      if (claims.role !== 'service_role') throw new Error();
    } catch {
      throw storeError('A chave legada do Supabase precisa ter a função service_role.');
    }
  }
  const headers = { apikey: key };
  // Modern sb_secret keys are opaque: only JWT keys go in Bearer Authorization.
  if (legacyJwt) headers.Authorization = `Bearer ${key}`;

  async function request(endpoint, options = {}) {
    let response;
    try {
      response = await fetch(new URL(endpoint, base), {
        ...options,
        headers: { ...headers, ...options.headers },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw storeError('Não foi possível conectar ao armazenamento. Tente novamente.', 503);
    }
    return response;
  }

  async function expect(response, { conflict = false, document = false } = {}) {
    if (response.ok) return response;
    // Do not surface upstream bodies: they can contain privileged project details.
    await response.arrayBuffer().catch(() => {});
    if (conflict && response.status === 409) throw storeError('Esta atividade já existe.', 409);
    if (document && response.status === 404) throw storeError('Documento não encontrado.', 404);
    throw storeError('O armazenamento do Supabase recusou a operação. Confira a configuração do projeto.', 502);
  }

  function tableUrl(code, revision) {
    assertCode(code);
    const query = new URLSearchParams({ code: `eq.${code}`, select: 'state,revision' });
    if (revision !== undefined) query.set('revision', `eq.${revision}`);
    return `/rest/v1/thor_activities?${query}`;
  }

  const objectPath = (key) => `${DOCUMENT_BUCKET}/${assertKey(key).split('/').map(encodeURIComponent).join('/')}`;

  return {
    mode: 'supabase',
    async create(code, state) {
      assertCode(code);
      const snapshot = serializeState(state);
      const response = await request('/rest/v1/thor_activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ code, state: snapshot, revision: 1 }),
      });
      await expect(response, { conflict: true });
      return { state: snapshot, revision: 1 };
    },
    async read(code) {
      const response = await expect(await request(tableUrl(code)));
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length > 1) throw storeError('Resposta inválida do armazenamento.', 502);
      if (!rows.length) return null;
      const revision = Number(rows[0].revision);
      assertRevision(revision);
      return { state: serializeState(rows[0].state), revision };
    },
    async compareAndSwap(code, expectedRevision, state) {
      assertRevision(expectedRevision);
      const snapshot = serializeState(state);
      const response = await expect(await request(tableUrl(code, expectedRevision), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ state: snapshot, revision: expectedRevision + 1 }),
      }));
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length > 1) throw storeError('Resposta inválida do armazenamento.', 502);
      return rows.length === 1;
    },
    async putDocument(code, teamId, buffer) {
      const { key: documentKey, bytes } = documentInput(code, teamId, buffer);
      await expect(await request(`/storage/v1/object/${objectPath(documentKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false' },
        body: bytes,
      }));
      return { key: documentKey };
    },
    async getDocument(documentKey) {
      const response = await expect(await request(`/storage/v1/object/authenticated/${objectPath(documentKey)}`), { document: true });
      return Buffer.from(await response.arrayBuffer());
    },
    async deleteDocument(documentKey) {
      assertKey(documentKey);
      await expect(await request(`/storage/v1/object/${DOCUMENT_BUCKET}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [documentKey] }),
      }));
    },
  };
}

export function createStore({
  dataDir = process.env.THOR_DATA_DIR || path.join(process.cwd(), '.data'),
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
} = {}) {
  const hasUrl = Boolean(supabaseUrl?.trim());
  const hasKey = Boolean(supabaseKey?.trim());
  if (hasUrl !== hasKey) throw storeError('Configure SUPABASE_URL e SUPABASE_SECRET_KEY juntas.');
  if (hasUrl) return supabaseStore(supabaseUrl, supabaseKey);
  if (process.env.VERCEL) {
    throw storeError('Na Vercel, configure o Supabase para persistir atividades e PDFs.');
  }
  return localStore(dataDir);
}
