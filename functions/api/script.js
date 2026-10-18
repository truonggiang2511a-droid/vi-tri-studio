import { setEnv } from '../../lib/vt.js';
import { handleScript } from '../../lib/script.js';

export async function onRequest(context) {
  setEnv(context.env);
  return handleScript(context.request);
}
