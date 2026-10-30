import type { Game } from './game';

export type WorldSound = 'laser' | 'explosion' | 'capture' | 'loss' | 'charge' | 'bombard' | 'victory' | 'defeat' | 'draw';
export interface SoundEvent {
	kind: WorldSound;
	point?: { x: number; y: number };
}
export interface SoundEvents {
	pending: Map<WorldSound, SoundEvent>;
}

// Transient presentation data is excluded from saves. Coalesce each cue per
// rendered frame so fixed-step catch-up and large battles cannot flood audio.
export const emitSound = function (world: Game, kind: WorldSound, point?: { x: number; y: number }): void {
	const pending = world.getResource('soundEvents').pending;
	if (!pending.has(kind)) pending.set(kind, { kind, point: point ? { x: point.x, y: point.y } : undefined });
};

export const drainSounds = function (world: Game): SoundEvent[] {
	const pending = world.getResource('soundEvents').pending;
	const events = [...pending.values()];
	pending.clear();
	return events;
};
