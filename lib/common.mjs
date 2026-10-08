import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

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
export function event(state, message, now, teamIds = []) {
  state.events.push({ id: id(), text: message, at: now, teamIds });
  if (state.events.length > 300) state.events.splice(0, state.events.length - 300);
}
