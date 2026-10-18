import { setEnv } from '../../lib/vt.js';
import { handleTts } from '../../lib/tts.js';

export async function onRequest(context) {
  setEnv(context.env);
  return handleTts(context.request);
}
