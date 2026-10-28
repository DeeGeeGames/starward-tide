import { expect, test } from 'bun:test';
import { CONFIG } from './config';
import { bombardPlanet, cancelBombardment, createGame, moveCarrier, planets, type Game } from './game';
import { captureConquestSave } from './game-save';
import { LAB_MAP } from './maps';
import { parseConquestSave } from './save-state';

const map = { ...LAB_MAP, carriers: true };
type Host = ReturnType<typeof planets>[number];
const setup = async function (): Promise<{ world: Game; carrier: Host; target: Host; home: Host }> {
	const world = await createGame('skirmish', map, undefined, { evaluateWinner: function () { return null; } });
	world.getResource('match').ai = false;
	const all = planets(world);
	const carrier = all.find(function (entry) { return entry.components.planet.carrier && entry.components.planet.owner === 'blue'; });
	const target = all.find(function (entry) { return !entry.components.planet.carrier && entry.components.planet.owner === 'neutral'; });
	const home = all.find(function (entry) { return !entry.components.planet.carrier && entry.components.planet.owner === 'blue'; });
	if (!carrier || !target || !home) { await world.dispose(); throw new Error('Missing bombardment fixture'); }
	return { world, carrier, target, home };
};
const advance = function (world: Game, seconds: number): void {
	for (let tick = 0; tick < Math.round(seconds / CONFIG.step); tick++) world.update(CONFIG.step);
};

test('bombardment commands target ordinary nonfriendly worlds and approach without clearing troops', async function () {
	const { world, carrier, target, home } = await setup();
	try {
		expect(bombardPlanet(world, carrier.id, home.id)).toBe(false);
		expect(bombardPlanet(world, carrier.id, carrier.id)).toBe(false);
		expect(bombardPlanet(world, home.id, target.id)).toBe(false);
		expect(bombardPlanet(world, carrier.id, target.id, 'red')).toBe(false);
		expect(bombardPlanet(world, carrier.id, -1)).toBe(false);
		const troops = target.components.planet.troops;
		expect(bombardPlanet(world, carrier.id, target.id)).toBe(true);
		expect(carrier.components.planet.carrier?.bombardment).toEqual({ target: target.id, elapsed: 0 });
		expect(carrier.components.planet.carrier?.destination).not.toBeNull();
		advance(world, CONFIG.step);
		expect(target.components.planet.troops).toBe(troops);
	} finally { await world.dispose(); }
});

test('movement and explicit cancellation discard a bombardment command, including while paused', async function () {
	const { world, carrier, target } = await setup();
	try {
		world.getResource('match').paused = true;
		expect(bombardPlanet(world, carrier.id, target.id)).toBe(true);
		const before = structuredClone(carrier.components.planet);
		advance(world, 5);
		expect(carrier.components.planet).toEqual(before);
		expect(cancelBombardment(world, carrier.id, 'red')).toBe(false);
		expect(cancelBombardment(world, carrier.id)).toBe(true);
		expect(carrier.components.planet.carrier?.bombardment).toBeUndefined();
		expect(carrier.components.planet.carrier?.destination).toBeNull();
		expect(bombardPlanet(world, carrier.id, target.id)).toBe(true);
		expect(moveCarrier(world, carrier.id, { x: 500, y: 500 })).toBe(true);
		expect(carrier.components.planet.carrier?.bombardment).toBeUndefined();
	} finally { await world.dispose(); }
});

test('save restore remaps bombardment target IDs and preserves partial charge; old carriers remain loadable', async function () {
	const { world, carrier, target } = await setup();
	try {
		expect(bombardPlanet(world, carrier.id, target.id)).toBe(true);
		const attack = carrier.components.planet.carrier?.bombardment;
		if (!attack) throw new Error('Missing attack');
		attack.elapsed = 7.5;
		const save = captureConquestSave(world, map, 'skirmish', 1, 'bombard-test');
		// Change all persisted identities so restoration cannot accidentally reuse target IDs.
		for (const row of save.game.planets) {
			row.id += 10000;
			if (row.planet.carrier?.bombardment) row.planet.carrier.bombardment.target += 10000;
		}
		for (const row of save.game.units) { row.id += 10000; row.unit.target += 10000; }
		expect(parseConquestSave(save)).toBe(save);
		const restored = await createGame('skirmish', map, save.game);
		try {
			const restoredCarrier = planets(restored).find(function (entry) { return entry.components.planet.name === carrier.components.planet.name; });
			const restoredTarget = planets(restored).find(function (entry) { return entry.components.planet.name === target.components.planet.name; });
			if (!restoredCarrier || !restoredTarget) throw new Error('Missing restored holding');
			expect(restoredCarrier.components.planet.carrier?.bombardment).toEqual({ target: restoredTarget.id, elapsed: 7.5 });
			expect(restored.getResource('match').paused).toBe(true);
		} finally { await restored.dispose(); }
		for (const row of save.game.planets) if (row.planet.carrier) delete row.planet.carrier.bombardment;
		expect(parseConquestSave(save)).toBe(save);
	} finally { await world.dispose(); }
});

test('saved bombardment rejects invalid charge and missing, friendly, or carrier targets', async function () {
	const { world, carrier, target, home } = await setup();
	try {
		bombardPlanet(world, carrier.id, target.id);
		const save = captureConquestSave(world, map, 'skirmish', 1, 'bombard-test');
		for (const elapsed of [-1, NaN, Infinity, CONFIG.bombardmentCharge]) {
			const invalid = structuredClone(save);
			const row = invalid.game.planets.find(function (entry) { return entry.id === carrier.id; });
			if (!row?.planet.carrier?.bombardment) throw new Error('Missing attack');
			row.planet.carrier.bombardment.elapsed = elapsed;
			expect(function () { parseConquestSave(invalid); }).toThrow();
		}
		for (const targetId of [-1, 999999, carrier.id, home.id]) {
			const invalid = structuredClone(save);
			const row = invalid.game.planets.find(function (entry) { return entry.id === carrier.id; });
			if (!row?.planet.carrier?.bombardment) throw new Error('Missing attack');
			row.planet.carrier.bombardment.target = targetId;
			expect(function () { parseConquestSave(invalid); }).toThrow();
		}
	} finally { await world.dispose(); }
});

const enterOrbit = function (world: Game, carrier: Host, target: Host): void {
	carrier.components.planet.x = target.components.planet.x + carrier.components.planet.radius + target.components.planet.radius + CONFIG.arrivalClearance;
	carrier.components.planet.y = target.components.planet.y;
	if (!bombardPlanet(world, carrier.id, target.id)) throw new Error('Cannot enter bombardment orbit');
};

test('a full stationary charge fires through hostile ships, platforms and carrier blockade, neutralizing only the surface', async function () {
	const { world, carrier, target } = await setup();
	try {
		target.components.planet.owner = 'red';
		target.components.planet.troops = 100;
		target.components.planet.guns = 3;
		target.components.planet.progress = 0.5;
		world.spawn({ unit: { owner: 'red', kind: 'ship', phase: 'orbit', target: target.id, x: target.components.planet.x, y: target.components.planet.y, hp: CONFIG.shipHealth, cargo: 0, age: 0 } });
		world.spawn({ unit: { owner: 'red', kind: 'ship', phase: 'orbit', target: carrier.id, x: carrier.components.planet.x, y: carrier.components.planet.y, hp: CONFIG.shipHealth, cargo: 0, age: 0 } });
		enterOrbit(world, carrier, target);
		advance(world, CONFIG.bombardmentCharge - CONFIG.step);
		expect(target.components.planet.owner).toBe('red');
		expect(target.components.planet.troops).toBeGreaterThanOrEqual(100);
		world.getResource('match').paused = true;
		advance(world, 3);
		expect(target.components.planet.owner).toBe('red');
		world.getResource('match').paused = false;
		advance(world, CONFIG.step);
		expect(world.getComponent(target.id, 'planet')?.owner).toBe('neutral');
		expect(target.components.planet.troops).toBe(0);
		expect(target.components.planet.progress).toBe(0);
		expect(target.components.planet.guns).toBe(3);
		expect(carrier.components.planet.carrier?.bombardment).toBeUndefined();
		advance(world, 30);
		expect(target.components.planet.troops).toBe(0);
		expect(world.getResource('match').captures).toBe(0);
	} finally { await world.dispose(); }
});

test('boarding on the firing tick takes the carrier and cancels its charged shot', async function () {
	const { world, carrier, target } = await setup();
	try {
		enterOrbit(world, carrier, target);
		advance(world, CONFIG.bombardmentCharge - CONFIG.step);
		world.spawn({ unit: { owner: 'red', kind: 'transport', phase: 'orbit', target: carrier.id, x: carrier.components.planet.x, y: carrier.components.planet.y, hp: CONFIG.transportHealth, cargo: 100, age: 0 } });
		advance(world, CONFIG.step);
		expect(carrier.components.planet.owner).toBe('red');
		expect(carrier.components.planet.carrier?.bombardment).toBeUndefined();
		expect(target.components.planet.troops).toBeGreaterThan(0);
	} finally { await world.dispose(); }
});

test('friendly capture on the firing tick cancels bombardment and preserves occupying troops', async function () {
	const { world, carrier, target } = await setup();
	try {
		enterOrbit(world, carrier, target);
		advance(world, CONFIG.bombardmentCharge - CONFIG.step);
		world.spawn({ unit: { owner: 'blue', kind: 'transport', phase: 'orbit', target: target.id, x: target.components.planet.x, y: target.components.planet.y, hp: CONFIG.transportHealth, cargo: target.components.planet.troops + 5, age: 0 } });
		advance(world, CONFIG.step);
		expect(target.components.planet.owner).toBe('blue');
		expect(target.components.planet.troops).toBe(5);
		expect(carrier.components.planet.carrier?.bombardment).toBeUndefined();
		expect(parseConquestSave(captureConquestSave(world, map, 'skirmish', 1, 'friendly-capture'))).toBeDefined();
	} finally { await world.dispose(); }
});

test('two carriers targeting one neutral world finish with no stale saved target', async function () {
	const { world, carrier, target } = await setup();
	try {
		const other = planets(world).find(function (entry) { return entry.id !== carrier.id && entry.components.planet.carrier; });
		if (!other) throw new Error('Missing second carrier');
		enterOrbit(world, carrier, target);
		other.components.planet.x = target.components.planet.x - other.components.planet.radius - target.components.planet.radius - CONFIG.arrivalClearance;
		other.components.planet.y = target.components.planet.y;
		expect(bombardPlanet(world, other.id, target.id, 'red')).toBe(true);
		advance(world, CONFIG.bombardmentCharge);
		expect(carrier.components.planet.carrier?.bombardment).toBeUndefined();
		expect(other.components.planet.carrier?.bombardment).toBeUndefined();
		expect(parseConquestSave(captureConquestSave(world, map, 'skirmish', 1, 'two-carriers'))).toBeDefined();
	} finally { await world.dispose(); }
});

test('neutralizing the final rival holding wins Conquest without occupying the planet', async function () {
	const world = await createGame('skirmish', map);
	try {
		world.getResource('match').ai = false;
		const carrier = planets(world).find(function (entry) { return entry.components.planet.carrier && entry.components.planet.owner === 'blue'; });
		const target = planets(world).find(function (entry) { return !entry.components.planet.carrier && entry.components.planet.owner === 'red'; });
		if (!carrier || !target) throw new Error('Missing final holding fixture');
		for (const entry of planets(world)) if (entry.id !== target.id && entry.components.planet.owner === 'red') entry.components.planet.owner = 'blue';
		enterOrbit(world, carrier, target);
		advance(world, CONFIG.bombardmentCharge);
		expect(world.getResource('match').winner).toBe('blue');
		expect(target.components.planet.owner).toBe('neutral');
		expect(target.components.planet.troops).toBe(0);
		expect(world.getResource('match').captures).toBe(0);
	} finally { await world.dispose(); }
});
