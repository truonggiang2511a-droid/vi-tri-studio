import { setEnv } from '../../lib/vt.js';
import { handleConfig } from '../../lib/config.js';
export async function onRequest(context) { setEnv(context.env); return handleConfig(context.request); }
