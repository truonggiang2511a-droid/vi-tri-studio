import { setEnv } from '../../lib/vt.js';
import { handleResolve } from '../../lib/resolve.js';

export async function onRequest(context) {
  setEnv(context.env);
  return handleResolve(context.request);
}
