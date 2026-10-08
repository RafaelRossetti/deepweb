import { createApp } from '../lib/http.mjs';
import { createStore } from '../lib/store.mjs';

let handler;
export default function api(req, res) {
  handler ||= createApp({ store: createStore(), allowLocalTeacher: false });
  return handler(req, res);
}
