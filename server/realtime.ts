/**
 * Realtime push via Pusher Channels. Works from Vercel serverless functions
 * (no persistent connection needed on the publish side) — the browser holds
 * the actual WebSocket connection to Pusher directly.
 *
 * If PUSHER_* env vars aren't set, notify() is a no-op and the frontend
 * falls back to its periodic REST polling.
 */

import Pusher from 'pusher';

const CHANNEL = 'qr-ordering';

let _pusher: Pusher | null | undefined;

function getPusher(): Pusher | null {
  if (_pusher !== undefined) return _pusher;

  const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env;
  if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET || !PUSHER_CLUSTER) {
    console.warn('[Realtime] PUSHER_* env vars not set — realtime push disabled, clients will poll');
    _pusher = null;
    return _pusher;
  }

  _pusher = new Pusher({
    appId: PUSHER_APP_ID,
    key: PUSHER_KEY,
    secret: PUSHER_SECRET,
    cluster: PUSHER_CLUSTER,
    useTLS: true,
  });
  return _pusher;
}

export type RealtimeResource = 'orders' | 'tables' | 'categories' | 'menu' | 'cafe' | 'service_requests';

export function notifyResourceChanged(resource: RealtimeResource): void {
  const pusher = getPusher();
  if (!pusher) return;
  pusher.trigger(CHANNEL, 'resource-updated', { resource }).catch((err) => {
    console.error('[Realtime] Failed to publish event:', err.message);
  });
}
