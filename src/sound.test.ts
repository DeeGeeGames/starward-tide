import { expect, test } from 'bun:test';
import { CONFIG } from './config';
import { createGame, planets, spawnShip, units, type Game } from './game';
import { captureConquestSave } from './game-save';
import { LAB_MAP, type StarMap } from './maps';
import { drainSounds } from './sound-events';
import { synthesizeSound } from './sound-design';

const map: StarMap = { width: 800, height: 800, planets: [
	['Home', 100, 100, 24, 'blue', 20, 0],
	['Rival', 600, 600, 24, 'red', 5, 0],
] };
const quietGame = async function (): Promise<Game> {
	const world = await createGame('skirmish', map, undefined, {
		seed: function (world, map): void {
			for (const [name, x, y, radius, owner, troops, rate] of map.planets)
				world.spawn({ planet: { name, x, y, radius, owner, troops, rate, guns: 0, production: 'troops', progress: 0 } });
		},
	});
	world.getResource('match').ai = false;
	return world;
};

test('orbital fire and lethal damage emit bounded cues, pause emits none, and restores never replay them', async function () {
	const world = await quietGame();
	try {
		const home = planets(world)[0];
		if (!home) throw new Error('Missing home');
		spawnShip(world, home.id, 'blue');
		spawnShip(world, home.id, 'red');
		const enemy = units(world).find(function (entry) { return entry.components.unit.owner === 'red'; });
		if (!enemy) throw new Error('Missing enemy');
		enemy.components.unit.hp = 0.01;
		world.getResource('match').paused = true;
		world.update(CONFIG.step);
		expect(drainSounds(world)).toEqual([]);
		world.getResource('match').paused = false;
		world.update(CONFIG.step);
		expect(drainSounds(world).map(function (event) { return event.kind; }).sort()).toEqual(['explosion', 'laser']);
		for (let index = 0; index < 40; index++) spawnShip(world, home.id, 'red');
		for (let index = 0; index < 4; index++) world.update(CONFIG.step);
		expect(world.getResource('soundEvents').pending.size).toBeLessThanOrEqual(2);
		const save = captureConquestSave(world, map, 'skirmish', 1, 'sound-test');
		const restored = await createGame('skirmish', map, save.game);
		try { expect(drainSounds(restored)).toEqual([]); } finally { await restored.dispose(); }
	} finally { await world.dispose(); }
});

test('a successful landing emits capture and victory once, without a destruction cue', async function () {
	const world = await quietGame();
	try {
		const target = planets(world).find(function (entry) { return entry.components.planet.owner === 'red'; });
		if (!target) throw new Error('Missing target');
		const p = target.components.planet;
		world.spawn({ unit: { owner: 'blue', kind: 'transport', phase: 'orbit', target: target.id, x: p.x, y: p.y, hp: 2, cargo: 10, age: 1 } });
		world.update(CONFIG.step);
		expect(p.owner).toBe('blue');
		expect(drainSounds(world).map(function (event) { return event.kind; })).toEqual(['capture', 'victory']);
		world.update(CONFIG.step);
		expect(drainSounds(world)).toEqual([]);
	} finally { await world.dispose(); }
});

test('platform damage sounds only report destruction when a whole platform is lost', async function () {
	const world = await quietGame();
	try {
		const home = planets(world)[0];
		if (!home) throw new Error('Missing home');
		home.components.planet.guns = 1;
		spawnShip(world, home.id, 'red');
		world.update(CONFIG.step);
		expect(drainSounds(world).map(function (event) { return event.kind; })).toEqual(['laser']);
		let explosions = 0;
		for (let tick = 0; tick < 60; tick++) {
			world.update(CONFIG.step);
			explosions += drainSounds(world).filter(function (event) { return event.kind === 'explosion'; }).length;
		}
		expect(home.components.planet.guns).toBe(0);
		expect(explosions).toBe(1);
	} finally { await world.dispose(); }
});

test('losing the final holding emits loss and defeat once', async function () {
	const world = await quietGame();
	try {
		const home = planets(world)[0];
		if (!home) throw new Error('Missing home');
		const p = home.components.planet;
		world.spawn({ unit: { owner: 'red', kind: 'transport', phase: 'orbit', target: home.id, x: p.x, y: p.y, hp: 2, cargo: 30, age: 1 } });
		world.update(CONFIG.step);
		expect(drainSounds(world).map(function (event) { return event.kind; })).toEqual(['loss', 'defeat']);
		world.update(CONFIG.step);
		expect(drainSounds(world)).toEqual([]);
	} finally { await world.dispose(); }
});

test('a draw emits its own result cue', async function () {
	const world = await quietGame();
	try {
		for (const entry of planets(world)) entry.components.planet.owner = 'neutral';
		world.update(CONFIG.step);
		expect(drainSounds(world).map(function (event) { return event.kind; })).toEqual(['draw']);
	} finally { await world.dispose(); }
});

test('bombardment sounds start at charge and discharge, with no charge replay after pause', async function () {
	const world = await createGame('skirmish', { ...LAB_MAP, carriers: true });
	try {
		world.getResource('match').ai = false;
		const carrier = planets(world).find(function (entry) { return entry.components.planet.carrier && entry.components.planet.owner === 'blue'; });
		const target = planets(world).find(function (entry) { return !entry.components.planet.carrier && entry.components.planet.owner === 'neutral'; });
		if (!carrier?.components.planet.carrier || !target) throw new Error('Missing bombardment fixture');
		const p = carrier.components.planet;
		const surface = target.components.planet;
		p.x = surface.x + p.radius + surface.radius + CONFIG.arrivalClearance;
		p.y = surface.y;
		const attack = { target: target.id, elapsed: 0 };
		carrier.components.planet.carrier.bombardment = attack;
		world.update(CONFIG.step);
		expect(drainSounds(world).map(function (event) { return event.kind; })).toEqual(['charge']);
		world.getResource('match').paused = true;
		world.update(CONFIG.step);
		expect(drainSounds(world)).toEqual([]);
		world.getResource('match').paused = false;
		attack.elapsed = CONFIG.bombardmentCharge - CONFIG.step;
		world.update(CONFIG.step);
		expect(drainSounds(world).map(function (event) { return event.kind; })).toEqual(['bombard']);
		expect(surface.owner).toBe('neutral');
		expect(surface.troops).toBe(0);
	} finally { await world.dispose(); }
});

test('every sound has audible finite samples, headroom, and quiet endpoints', function () {
	const cues = ['select', 'command', 'error', 'laser', 'explosion', 'charge', 'bombard', 'capture', 'loss', 'victory', 'defeat', 'draw'] as const;
	for (const cue of cues) {
		const samples = synthesizeSound(cue, 48000);
		expect(samples.length).toBeLessThan(48000 * 1.5);
		expect(samples.every(Number.isFinite)).toBe(true);
		const peak = samples.reduce(function (max, value) { return Math.max(max, Math.abs(value)); }, 0);
		expect(peak).toBeGreaterThan(0.03);
		expect(peak).toBeLessThan(0.85);
		expect(samples[0]).toBe(0);
		expect(samples.at(-1)).toBe(0);
	}
});
