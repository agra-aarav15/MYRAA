// Myraa Event Bus — §50
import { EventEmitter } from 'events';
export const bus = new EventEmitter();
export const MyraaEvents = ['task:started','task:progress','tool:invoked','tool:completed','agent:started','agent:completed','confirm:requested','error','recovery','device:changed','task:completed','task:cancelled'];
export function emit(event, payload){ bus.emit(event,{ ts:new Date().toISOString(), event, ...payload }); }
