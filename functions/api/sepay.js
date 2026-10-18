import { setEnv } from '../../lib/vt.js';
import { handleSepay } from '../../lib/sepay.js';

export async function onRequest(context) {
  setEnv(context.env);
  return handleSepay(context.request);
}
