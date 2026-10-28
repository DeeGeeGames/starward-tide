import { expect, test } from 'bun:test';
import { CONFIG, SIDES } from './config';
import { activeOrders, createGame, dispatch, isBlockaded, matchEnded, planets, shipsAt, spawnShip, units, type Game } from './game';
import { captureConquestSave } from './game-save';
import { carrierSeeds, generateMap, MAP_SIZES, type StarMap } from './maps';
import { raceDestinations } from './objectives';
import { parseConquestSave } from './save-state';

const advance = function (world: Game, seconds: number): void {
	for (let tick = 0; tick < Math.round(seconds / CONFIG.step); tick++) world.update(CONFIG.step);
};
const arena: StarMap = {
	width: 1200, height: 1000,
	planets: [
		['Player', 100, 900, 31, 'blue', 44, 0],
		['Red', 400, 100, 31, 'red', 44, 0],
		['Green', 600, 100, 31, 'green', 1, 0],
		['Purple', 1100, 900, 31, 'purple', 44, 0],
	],
};

for (const size of ['small', 'medium', 'large'] as const) test(`${size}: multiple factions have equal starts, clear carriers and equal race distances across seeds`, function () {
		for (const count of [2, 3]) for (let seed = 0; seed < 50; seed++) {
			const map = { ...generateMap(size, seed, count), carriers: true };
			expect(map).toEqual({ ...generateMap(size, seed, count), carriers: true });
			expect(map.planets).toHaveLength(MAP_SIZES[size].count);
			const homes = map.planets.filter(function (planet) { return planet[4] !== 'neutral'; });
			expect(new Set(homes.map(function (home) { return home[4]; })).size).toBe(count + 1);
			for (const home of homes) expect([home[3], home[5], home[6]]).toEqual([31, 44, 2.6]);
			const carriers = carrierSeeds(map);
			expect(carriers).toHaveLength(count + 1);
			for (const carrier of carriers) for (const other of [...map.planets, ...carriers]) {
				if (carrier === other) continue;
				expect(Math.hypot(carrier[1] - other[1], carrier[2] - other[2])).toBeGreaterThanOrEqual(carrier[3] + other[3] + 64);
			}
			for (const mode of ['center-race', 'crossing-race'] as const) {
				const destinations = raceDestinations({ ...map, mode });
				expect(destinations).toHaveLength(mode === 'center-race' ? 1 : count + 1);
				const distances = carriers.map(function (carrier) {
					const destination = destinations.find(function (destination) { return destination.owner === 'neutral' || destination.owner === carrier[4]; });
					if (!destination) throw new Error('Missing destination');
					return Math.hypot(carrier[1] - destination.x, carrier[2] - destination.y);
				});
				expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(1e-8);
			}
		}
});

test('each AI makes its own orders and attacks other AI factions', async function () {
	for (const side of SIDES.slice(1)) {
		const world = await createGame('skirmish', arena, undefined, { opponent: { difficulty: 'standard', style: 'aggressive' } });
		try {
			for (const entity of units(world)) if (entity.components.unit.owner !== side) world.removeEntity(entity.id);
			for (const entity of planets(world)) entity.components.planet.troops = entity.components.planet.owner === side ? 44 : 1;
			advance(world, 3);
			const order = activeOrders(world, [], side)[0];
			expect(order).toBeDefined();
			if (side === 'red') {
				expect(world.getComponent(order?.target ?? -1, 'planet')?.owner).toBe('green');
				advance(world, 20);
				expect(planets(world).find(function (entry) { return entry.components.planet.name === 'Green'; })?.components.planet.owner).toBe('red');
			}
		} finally { await world.dispose(); }
	}
});

test('orbital combat, platform resistance, and landing work between AI factions', async function () {
	const world = await createGame('skirmish', arena);
	try {
		world.getResource('match').ai = false;
		const green = planets(world).find(function (entry) { return entry.components.planet.owner === 'green'; });
		const red = planets(world).find(function (entry) { return entry.components.planet.owner === 'red'; });
		if (!green || !red) throw new Error('Missing homes');
		for (const entity of units(world)) if (entity.components.unit.owner === 'green') world.removeEntity(entity.id);
		green.components.planet.guns = 1;
		expect(dispatch(world, [red.id], green.id, 1, 'troops', 'red')).toBeGreaterThan(0);
		advance(world, 15);
		expect(green.components.planet.owner).toBe('green');
		expect(green.components.planet.troops).toBe(1);
		for (let i = 0; i < 8; i++) spawnShip(world, green.id, 'purple');
		advance(world, 5);
		expect(green.components.planet.guns).toBe(0);
		expect(isBlockaded(world, green.id)).toBe(true);
		expect(shipsAt(world, green.id, 'purple').length).toBeGreaterThan(0);
	} finally { await world.dispose(); }
});

test('three-way orbital damage is simultaneous and distributed between enemies', async function () {
	const world = await createGame('skirmish', arena);
	try {
		world.getResource('match').ai = false;
		const host = planets(world)[0];
		if (!host) throw new Error('Missing host');
		for (const entity of units(world)) world.removeEntity(entity.id);
		const fleet = ['red', 'green', 'purple'] as const;
		for (const side of fleet) spawnShip(world, host.id, side);
		advance(world, CONFIG.step);
		for (const side of fleet) expect(shipsAt(world, host.id, side)[0]?.components.unit.hp).toBeCloseTo(CONFIG.shipHealth - CONFIG.shipDamage * CONFIG.step, 8);
	} finally { await world.dispose(); }
});

test('victory waits for every rival and player defeat ends a match with multiple surviving rivals', async function () {
	const world = await createGame('skirmish', arena);
	try {
		world.getResource('match').ai = false;
		for (const entity of planets(world)) if (entity.components.planet.owner === 'red') entity.components.planet.owner = 'blue';
		advance(world, CONFIG.step);
		expect(matchEnded(world.getResource('match'))).toBe(false);
		for (const entity of planets(world)) if (entity.components.planet.owner !== 'blue') entity.components.planet.owner = 'blue';
		advance(world, CONFIG.step);
		expect(world.getResource('match').winner).toBe('blue');
	} finally { await world.dispose(); }
	const lost = await createGame('skirmish', arena);
	try {
		lost.getResource('match').ai = false;
		for (const entity of planets(lost)) if (entity.components.planet.owner === 'blue') entity.components.planet.owner = 'red';
		advance(lost, CONFIG.step);
		expect(lost.getResource('match').defeated).toBe(true);
		expect(matchEnded(lost.getResource('match'))).toBe(true);
		expect(parseConquestSave(captureConquestSave(lost, arena, 'skirmish', 1, 'test')).game.match.defeated).toBe(true);
	} finally { await lost.dispose(); }
});

test('multiple opponents, carriers, race destinations and orders survive validated save and restore', async function () {
	for (const mode of ['conquest', 'center-race', 'crossing-race'] as const) {
		const map = { ...generateMap('medium', 100, 3), carriers: true, mode };
		const world = await createGame('skirmish', map);
		try {
			advance(world, 3);
			const saved = parseConquestSave(captureConquestSave(world, map, 'skirmish', 1, 'test'));
			const restored = await createGame('skirmish', map, saved.game);
			try {
				const state = function (game: Game) {
					return planets(game).map(function (entry) {
						const p = entry.components.planet;
						const attack = p.carrier?.bombardment;
						return { ...p, carrier: p.carrier ? { ...p.carrier, bombardment: attack ? { ...attack, target: game.getComponent(attack.target, 'planet')?.name } : undefined } : undefined };
					});
				};
				expect(state(restored)).toEqual(state(world));
				for (const side of SIDES.slice(1)) expect(activeOrders(restored, [], side).length).toBe(activeOrders(world, [], side).length);
				expect(restored.getResource('objectives').destinations).toEqual(world.getResource('objectives').destinations);
			} finally { await restored.dispose(); }
		} finally { await world.dispose(); }
	}
});
