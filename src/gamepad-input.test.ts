import { expect, test } from 'bun:test';
import type { GamepadLike } from 'ecspresso/plugins/input/input';
import { createGamepadInput } from './gamepad-input';
import type { GamepadController, GamepadInput } from './gamepad-input';

const pad = function (
	pressed: readonly number[] = [],
	axes: readonly number[] = [0, 0, 0, 0],
	id = 'Standard controller',
	triggers: Readonly<{ left?: number; right?: number }> = {},
): GamepadLike {
	return {
		id, connected: true, axes,
		buttons: Array.from({ length: 17 }, function (_, index) {
			const value = index === 6 ? triggers.left ?? 0 : index === 7 ? triggers.right ?? 0 : pressed.includes(index) ? 1 : 0;
			return { pressed: pressed.includes(index), value };
		}),
	};
};

const activate = function (input: GamepadInput, setPad: (pad: GamepadLike) => void): void {
	setPad(pad([0]));
	expect(input.update(0.016).actions).toEqual([]);
	setPad(pad());
	expect(input.update(0.016).actions).toEqual([]);
	expect(input.status().phase).toBe('active');
};

test('claim requires A or Start, consumes the claim, and waits for neutral buttons and sticks', async function () {
	let current = pad([], [0.12, -0.1, 0, 0]);
	const claimed: GamepadController[] = [];
	let activity = 0;
	const input = await createGamepadInput({
		poll: function () { return [current]; },
		onClaim: function (controller) { claimed.push(controller); },
		onActivity: function () { activity++; },
	});
	try {
		expect(input.update(0.016).moveX).toBe(0);
		expect(input.status()).toEqual({ phase: 'unclaimed', controller: undefined, available: 1 });
		expect(activity).toBe(0);
		current = pad([2]);
		input.update(0.016);
		expect(input.status().phase).toBe('unclaimed');
		current = pad([0, 2], [0.8, 0, 0, 0]);
		expect(input.update(0.016).actions).toEqual([]);
		expect(claimed).toEqual([{ slot: 0, id: 'Standard controller' }]);
		expect(input.status().phase).toBe('arming');
		expect(input.update(0.1).moveX).toBe(0);
		current = pad([], [0.8, 0, 0, 0]);
		input.update(0.016);
		expect(input.status().phase).toBe('arming');
		current = pad();
		input.update(0.016);
		expect(input.status().phase).toBe('active');
		current = pad([0]);
		expect(input.update(0.016).actions).toEqual(['confirm']);
		expect(input.update(0.016).actions).toEqual([]);
	} finally { await input.dispose(); }
});

test('one controller owns actions and analog input; other connected pads do not take over', async function () {
	let first = pad();
	let second = pad();
	const input = await createGamepadInput({ poll: function () { return [first, second]; } });
	try {
		activate(input, function (value) { first = value; });
		first = pad([], [0.1, -0.1, 0, 0], 'Standard controller', { left: 0.02, right: 0.06 });
		expect(input.update(0.016)).toEqual({ actions: [], directions: [], moveX: 0, moveY: 0, panX: 0, panY: 0, zoom: 0 });
		second = pad([0, 9, 12], [1, 0, 0, -1], 'Other controller', { right: 1 });
		expect(input.update(0.016)).toEqual({ actions: [], directions: [], moveX: 0, moveY: 0, panX: 0, panY: 0, zoom: 0 });
		expect(input.status().controller).toEqual({ slot: 0, id: 'Standard controller' });
		first = pad([1, 2, 3, 4, 5, 8, 9], [0.6, 0, 0, -0.8], 'Standard controller', { left: 0.2, right: 0.8 });
		const frame = input.update(0.016);
		expect(frame.actions).toEqual(['back', 'dispatch', 'multi', 'previousTarget', 'nextTarget', 'pause', 'menu']);
		expect(frame.moveX).toBeCloseTo(0.5);
		expect(frame.panY).toBeCloseTo(-0.75);
		expect(frame.zoom).toBeCloseTo(0.6);
	} finally { await input.dispose(); }
});

test('direction repeat is immediate then delayed, bounded after a long frame, and resets on release', async function () {
	let current = pad();
	const input = await createGamepadInput({ poll: function () { return [current]; } });
	try {
		activate(input, function (value) { current = value; });
		current = pad([13]);
		expect(input.update(0.016).directions).toEqual(['down']);
		for (let frame = 0; frame < 3; frame++) expect(input.update(0.1).directions).toEqual([]);
		expect(input.update(0.1).directions).toEqual(['down']);
		expect(input.update(20).directions).toEqual(['down']);
		current = pad();
		expect(input.update(0.016).directions).toEqual([]);
		current = pad([], [-1, 1, 0, 0]);
		expect(input.update(0.016).directions).toEqual(['down']);
		current = pad([], [-1, 0, 0, 0]);
		expect(input.update(0.016).directions).toEqual(['left']);
	} finally { await input.dispose(); }
});

test('disconnect emits once, clears input, and reconnect requires release then a fresh deliberate claim', async function () {
	let current: GamepadLike | null = pad();
	const lost: GamepadController[] = [];
	const input = await createGamepadInput({
		poll: function () { return [current]; },
		onDisconnect: function (controller) { lost.push(controller); },
	});
	try {
		activate(input, function (value) { current = value; });
		current = null;
		expect(input.update(0.016).actions).toEqual([]);
		expect(input.status().phase).toBe('disconnected');
		input.update(0.016);
		expect(lost).toEqual([{ slot: 0, id: 'Standard controller' }]);
		current = pad([0]);
		input.update(0.016);
		input.update(0.016);
		expect(input.status().phase).toBe('disconnected');
		current = pad();
		input.update(0.016);
		current = pad([9]);
		expect(input.update(0.016).actions).toEqual([]);
		expect(input.status().phase).toBe('arming');
		current = pad();
		input.update(0.016);
		current = pad([9]);
		expect(input.update(0.016).actions).toEqual(['pause']);
	} finally { await input.dispose(); }
});

test('a different controller in the same slot is a disconnect rather than silent ownership transfer', async function () {
	let current = pad();
	let disconnects = 0;
	const input = await createGamepadInput({
		poll: function () { return [current]; },
		onDisconnect: function () { disconnects++; },
	});
	try {
		activate(input, function (value) { current = value; });
		current = pad([0], [1, 0, 0, 0], 'Replacement');
		expect(input.update(0.016).moveX).toBe(0);
		expect(disconnects).toBe(1);
		expect(input.status().phase).toBe('disconnected');
		input.update(0.016);
		expect(input.status().phase).toBe('disconnected');
		current = pad([], [0, 0, 0, 0], 'Replacement');
		input.update(0.016);
		current = pad([0], [0, 0, 0, 0], 'Replacement');
		input.update(0.016);
		expect(input.status().controller?.id).toBe('Replacement');
	} finally { await input.dispose(); }
});

test('suspend prevents held controls from surviving external focus or visibility recovery', async function () {
	let current = pad();
	const input = await createGamepadInput({ poll: function () { return [current]; } });
	try {
		activate(input, function (value) { current = value; });
		current = pad([0], [0, 0, 1, 0]);
		input.update(0.016);
		input.suspend();
		expect(input.update(0.016)).toEqual({ actions: [], directions: [], moveX: 0, moveY: 0, panX: 0, panY: 0, zoom: 0 });
		current = pad();
		expect(input.update(0.016).actions).toEqual([]);
		current = pad([0]);
		expect(input.update(0.016).actions).toEqual(['confirm']);
	} finally { await input.dispose(); }
});

test('disposing input stops polling and callbacks and tolerates repeated disposal', async function () {
	let polls = 0;
	const input = await createGamepadInput({ poll: function () { polls++; return []; } });
	input.update(0.016);
	const before = polls;
	await input.dispose();
	await input.dispose();
	expect(input.update(0.016).actions).toEqual([]);
	expect(polls).toBe(before);
	expect(input.status()).toEqual({ phase: 'unclaimed', controller: undefined, available: 0 });
});
