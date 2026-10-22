import { setEnv } from '../../lib/vt.js';
import { handleCapi } from '../../lib/capi.js';
export async function onRequest(context) { setEnv(context.env); return handleCapi(context.request); }
