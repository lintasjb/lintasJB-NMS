import { EventEmitter } from 'node:events';

/** Process-wide realtime bus (consumed by the SSE endpoint). */
export const bus = new EventEmitter();
bus.setMaxListeners(100);

export function emitEvent(type, payload) {
  bus.emit('event', { type, payload, ts: new Date().toISOString() });
}
