import ECSpresso from 'ecspresso';
import { createInputPlugin } from 'ecspresso/plugins/input/input';
import type { GamepadLike, GamepadState } from 'ecspresso/plugins/input/input';

export type GamepadAction = 'confirm' | 'back' | 'dispatch' | 'multi' |
	'previousTarget' | 'nextTarget' | 'pause' | 'menu';
export type GamepadDirection = 'up' | 'down' | 'left' | 'right';

export interface GamepadController {
	readonly slot: number;
	readonly id: string;
}

export interface GamepadStatus {
	readonly phase: 'unclaimed' | 'arming' | 'active' | 'disconnected';
	readonly controller: GamepadController | undefined;
	readonly available: number;
}

export interface GamepadFrame {
	readonly actions: readonly GamepadAction[];
	readonly directions: readonly GamepadDirection[];
	readonly moveX: number;
	readonly moveY: number;
	readonly panX: number;
	readonly panY: number;
	readonly zoom: number;
}

export interface GamepadInput {
	update(dt: number): GamepadFrame;
	status(): GamepadStatus;
	/** Suppress held controls until the owning controller returns to neutral. */
	suspend(): void;
	dispose(): Promise<void>;
}

interface GamepadInputOptions {
	/** Injected pads must use the standard browser controller layout. */
	poll?: () => ReadonlyArray<GamepadLike | null>;
	onActivity?: () => void;
	onClaim?: (controller: GamepadController) => void;
	onDisconnect?: (controller: GamepadController) => void;
}

const buttons = [
	['confirm', 0], ['back', 1], ['dispatch', 2], ['multi', 3],
	['previousTarget', 4], ['nextTarget', 5], ['pause', 9], ['menu', 8],
] as const;
const emptyFrame: GamepadFrame = {
	actions: [], directions: [], moveX: 0, moveY: 0, panX: 0, panY: 0, zoom: 0,
};

const browserPads = function (): ReadonlyArray<GamepadLike | null> {
	if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
	try {
		return Array.from(navigator.getGamepads(), function (pad) {
			return pad?.mapping === 'standard' ? pad : null;
		});
	} catch {
		// Embedded browser policy can make the Gamepad API unavailable.
		return [];
	}
};

const bounded = function (value: number): number {
	return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
};

const neutral = function (pad: GamepadState): boolean {
	return Array.from({ length: 17 }, function (_, button) {
		return !pad.isDown(button) && pad.buttonValue(button) <= 0.1;
	}).every(Boolean) && Array.from({ length: 4 }, function (_, axis) {
		return Math.abs(bounded(pad.axis(axis))) < 0.05;
	}).every(Boolean);
};

const direction = function (pad: GamepadState): GamepadDirection | undefined {
	if (pad.isDown(12)) return 'up';
	if (pad.isDown(13)) return 'down';
	if (pad.isDown(14)) return 'left';
	if (pad.isDown(15)) return 'right';
	const x = bounded(pad.axis(0));
	const y = bounded(pad.axis(1));
	if (Math.max(Math.abs(x), Math.abs(y)) < 0.55) return undefined;
	if (Math.abs(x) > Math.abs(y)) return x < 0 ? 'left' : 'right';
	return y < 0 ? 'up' : 'down';
};

// The framework owns polling, button edges, deadzones, and resource cleanup.
// This adapter owns one controller's deliberate claim and UI repeat policy.
export const createGamepadInput = async function (
	options: GamepadInputOptions = {},
): Promise<GamepadInput> {
	const ecs = ECSpresso.create()
		.withPlugin(createInputPlugin({
			// Existing application keyboard/pointer handlers remain the sole owners.
			target: new EventTarget(),
			gamepad: { deadzone: 0.2, poll: options.poll ?? browserPads },
		}))
		.build();
	await ecs.initialize();
	const input = ecs.getResource('inputState');
	let owner: GamepadController | undefined;
	let phase: GamepadStatus['phase'] = 'unclaimed';
	let available = 0;
	let recovering = false;
	let disposed = false;
	let lastDirection: GamepadDirection | undefined;
	let repeatRemaining = 0;
	const readyAfterDisconnect = new Map<number, string>();
	const resetRepeat = function (): void {
		lastDirection = undefined;
		repeatRemaining = 0;
	};
	const disconnect = function (controller: GamepadController): void {
		owner = undefined;
		phase = 'disconnected';
		recovering = true;
		readyAfterDisconnect.clear();
		resetRepeat();
		options.onDisconnect?.(controller);
	};
	return {
		status: function (): GamepadStatus {
			return { phase, controller: owner, available };
		},
		update: function (dt: number): GamepadFrame {
			if (disposed) return emptyFrame;
			const elapsed = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
			ecs.update(elapsed);
			available = input.gamepads.filter(function (pad) { return pad.connected; }).length;
			if (!owner) {
				for (const [slot, pad] of input.gamepads.entries()) {
					if (!pad.connected || pad.id === null) {
						readyAfterDisconnect.delete(slot);
						continue;
					}
					if (recovering && neutral(pad)) readyAfterDisconnect.set(slot, pad.id);
					if (recovering && readyAfterDisconnect.get(slot) !== pad.id) continue;
					if (!pad.justPressed(0) && !pad.justPressed(9)) continue;
					owner = { slot, id: pad.id };
					phase = 'arming';
					recovering = false;
					resetRepeat();
					options.onClaim?.(owner);
					options.onActivity?.();
					break;
				}
				// Claiming is never a game/menu action, including simultaneous buttons.
				return emptyFrame;
			}
			const pad = input.gamepads[owner.slot];
			if (!pad?.connected || pad.id !== owner.id) {
				disconnect(owner);
				return emptyFrame;
			}
			if (phase === 'arming') {
				if (neutral(pad)) phase = 'active';
				return emptyFrame;
			}
			const actions = buttons.flatMap(function ([action, button]) {
				return pad.justPressed(button) ? [action] : [];
			});
			const currentDirection = direction(pad);
			const directions: GamepadDirection[] = [];
			if (currentDirection !== lastDirection) {
				lastDirection = currentDirection;
				repeatRemaining = 0.34;
				if (currentDirection) directions.push(currentDirection);
			} else if (currentDirection) {
				repeatRemaining -= elapsed;
				if (repeatRemaining <= 0) {
					directions.push(currentDirection);
					repeatRemaining += 0.1;
				}
			}
			const zoom = bounded(pad.buttonValue(7) - pad.buttonValue(6));
			const frame: GamepadFrame = {
				actions, directions,
				moveX: bounded(pad.axis(0)), moveY: bounded(pad.axis(1)),
				panX: bounded(pad.axis(2)), panY: bounded(pad.axis(3)),
				zoom: Math.abs(zoom) > 0.1 ? zoom : 0,
			};
			if (actions.length > 0 || directions.length > 0 ||
				Math.max(Math.abs(frame.moveX), Math.abs(frame.moveY),
					Math.abs(frame.panX), Math.abs(frame.panY), Math.abs(frame.zoom)) > 0.05)
				options.onActivity?.();
			return frame;
		},
		suspend: function (): void {
			if (owner) phase = 'arming';
			resetRepeat();
		},
		dispose: async function (): Promise<void> {
			if (disposed) return;
			disposed = true;
			owner = undefined;
			phase = 'unclaimed';
			available = 0;
			resetRepeat();
			readyAfterDisconnect.clear();
			await ecs.dispose();
		},
	};
};
