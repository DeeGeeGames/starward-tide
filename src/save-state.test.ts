import { expect, test } from 'bun:test';
import { CONFIG } from './config';
import { activeOrders, cancelOrder, createGame, dispatch, planets, spawnShip, units } from './game';
import type { Game } from './game';
import { captureConquestSave } from './game-save';
import { LAB_MAP } from './maps';
import { parseConquestSave } from './save-state';
import type { ConquestSave } from './save-state';

const named = function (world: Game, name: string): ReturnType<typeof planets>[number] {
	const entity = planets(world).find(function (entry) {
		return entry.components.planet.name === name;
	});
	if (!entity) throw new Error(`Missing ${name}`);
	return entity;
};
const advance = function (world: Game, count: number): void {
	for (let index = 0; index < count; index++) world.update(CONFIG.step);
};
const comparable = function (world: Game): unknown {
	const save = captureConquestSave(world, LAB_MAP, 'invasion', 1, 'test', 1);
	const planetNames = new Map(save.game.planets.map(function (entry) {
		return [entry.id, entry.planet.name] as const;
	}));
	const unitIndexes = new Map(save.game.units.map(function (entry, index) {
		return [entry.id, index] as const;
	}));
	return {
		match: { ...save.game.match, paused: true },
		planets: save.game.planets.map(function (entry) { return entry.planet; }),
		units: save.game.units.map(function (entry) {
			return { ...entry.unit, target: planetNames.get(entry.unit.target) };
		}),
		orders: save.game.orderBook.active.map(function (order) {
			return {
				...order,
				target: planetNames.get(order.target),
				departures: order.departures.map(function (departure) {
					return {
						...departure,
						unitId: unitIndexes.get(departure.unitId),
						source: planetNames.get(departure.source),
					};
				}),
			};
		}),
	};
};

test('loaded pending orders remap references and cancellation refunds each source exactly once', async function () {
	const original = await createGame('invasion');
	let restored: Game | undefined;
	try {
		const terra = named(original, 'Terra');
		const luna = named(original, 'Luna');
		luna.components.planet.owner = 'blue';
		luna.components.planet.troops = 27;
		original.getResource('match').paused = true;
		const beforeTerra = terra.components.planet.troops;
		const beforeLuna = luna.components.planet.troops;
		dispatch(original, [terra.id, luna.id], named(original, 'Sol').id, 0.5);
		const saved = captureConquestSave(original, LAB_MAP, 'invasion', 2, 'test');
		// Force remapping rather than accidentally relying on identical spawn IDs.
		for (const entry of saved.game.planets) entry.id += 10000;
		for (const entry of saved.game.units) {
			entry.id += 10000;
			entry.unit.target += 10000;
		}
		for (const order of saved.game.orderBook.active) {
			order.target += 10000;
			for (const departure of order.departures) {
				departure.source += 10000;
				departure.unitId += 10000;
			}
		}
		const valid = parseConquestSave(saved, 'test');
		restored = await createGame(valid.game.scenario, valid.game.map, valid.game);
		expect(restored.getResource('match').paused).toBe(true);
		const before = comparable(restored);
		advance(restored, 50);
		expect(comparable(restored)).toEqual(before);
		const order = activeOrders(restored)[0];
		if (!order) throw new Error('Missing restored pending order');
		expect(cancelOrder(restored, order.id)).toBe(true);
		expect(named(restored, 'Terra').components.planet.troops).toBe(beforeTerra);
		expect(named(restored, 'Luna').components.planet.troops).toBe(beforeLuna);
		expect(cancelOrder(restored, order.id)).toBe(false);
		expect(activeOrders(restored)).toHaveLength(0);
	} finally {
		await original.dispose();
		await restored?.dispose();
	}
});

test('travel, cargo, partial production, damage and recall continue with equivalent behavior after loading', async function () {
	const original = await createGame('invasion');
	let restored: Game | undefined;
	try {
		const terra = named(original, 'Terra');
		terra.components.planet.production = 'ships';
		terra.components.planet.progress = 2.75;
		dispatch(original, [terra.id], named(original, 'Sol').id, 0.5);
		advance(original, 25);
		const damaged = units(original).find(function (entry) {
			return entry.components.unit.kind === 'transport';
		});
		if (!damaged) throw new Error('Missing loaded transport');
		damaged.components.unit.hp = 0.75;
		const saved = parseConquestSave(captureConquestSave(original, LAB_MAP, 'invasion', 0.5, 'test'));
		restored = await createGame(saved.game.scenario, saved.game.map, saved.game);
		expect(comparable(restored)).toEqual(comparable(original));
		restored.getResource('match').paused = false;
		advance(original, 20);
		advance(restored, 20);
		expect(comparable(restored)).toEqual(comparable(original));
		const order = activeOrders(original)[0];
		if (!order) throw new Error('Missing traveling order');
		expect(cancelOrder(original, order.id)).toBe(true);
		expect(cancelOrder(restored, order.id)).toBe(true);
		expect(activeOrders(restored)[0]?.state).toBe('returning');
		const returning = parseConquestSave(captureConquestSave(restored, LAB_MAP, 'invasion', 1, 'test'));
		await restored.dispose();
		restored = await createGame('invasion', LAB_MAP, returning.game);
		restored.getResource('match').paused = false;
		advance(original, 250);
		advance(restored, 250);
		expect(comparable(restored)).toEqual(comparable(original));
		expect(activeOrders(restored)).toHaveLength(0);
	} finally {
		await original.dispose();
		await restored?.dispose();
	}
});

test('combat, AI decision timing and victory survive loading without offline simulation', async function () {
	const original = await createGame('invasion');
	let restored: Game | undefined;
	try {
		const combatant = spawnShip(original, named(original, 'Sol').id, 'blue');
		if (!combatant) throw new Error('Missing combatant');
		advance(original, 10);
		expect(combatant.components.unit.hp).toBeLessThan(CONFIG.shipHealth);
		const match = original.getResource('match');
		match.ai = true;
		match.aiClock = CONFIG.aiInterval - CONFIG.step;
		const saved = parseConquestSave(captureConquestSave(original, LAB_MAP, 'invasion', 1, 'test', 1));
		restored = await createGame('invasion', LAB_MAP, saved.game);
		expect(restored.getResource('match').time).toBe(match.time);
		expect(comparable(restored)).toEqual(comparable(original));
		restored.getResource('match').paused = false;
		advance(original, 1);
		advance(restored, 1);
		expect(restored.getResource('match').aiClock).toBe(0);
		expect(restored.getResource('orderBook').nextId).toBe(original.getResource('orderBook').nextId);
		expect(planets(restored).map(function (entry) { return entry.components.planet; }))
			.toEqual(planets(original).map(function (entry) { return entry.components.planet; }));
		match.winner = 'blue';
		const won = parseConquestSave(captureConquestSave(original, LAB_MAP, 'invasion', 1, 'test'));
		await restored.dispose();
		restored = await createGame('invasion', LAB_MAP, won.game);
		expect(restored.getResource('match').winner).toBe('blue');
		restored.getResource('match').paused = false;
		const before = comparable(restored);
		advance(restored, 100);
		expect(comparable(restored)).toEqual(before);
	} finally {
		await original.dispose();
		await restored?.dispose();
	}
});

test('invalid versions, cross-profile data, missing targets and duplicated live departures are rejected', async function () {
	const original = await createGame('invasion');
	try {
		original.getResource('match').paused = true;
		dispatch(original, [named(original, 'Terra').id], named(original, 'Sol').id, 0.5);
		const saved = captureConquestSave(original, LAB_MAP, 'invasion', 1, 'test');
		expect(function () { parseConquestSave({ ...saved, schemaVersion: 99 }); }).toThrow();
		expect(function () { parseConquestSave(saved, 'other'); }).toThrow();
		const missing = structuredClone(saved);
		const unit = missing.game.units[0];
		if (!unit) throw new Error('Missing unit');
		unit.unit.target = 999999;
		expect(function () { parseConquestSave(missing); }).toThrow();
		const duplicate = structuredClone(saved);
		const order = duplicate.game.orderBook.active[0];
		const departure = order?.departures[0];
		if (!order || !departure) throw new Error('Missing pending departure');
		order.departures.push(structuredClone(departure));
		expect(function () { parseConquestSave(duplicate); }).toThrow();
	} finally {
		await original.dispose();
	}
});

test('casualties do not leave dangling saved references and captured snapshots do not alias live orders', async function () {
	const original = await createGame('invasion');
	let restored: Game | undefined;
	try {
		dispatch(original, [named(original, 'Terra').id], named(original, 'Sol').id, 0.5);
		const order = original.getResource('orderBook').active[0];
		const dead = order?.departures[0];
		if (!order || !dead) throw new Error('Missing dispatch');
		original.removeEntity(dead.unitId);
		const saved = captureConquestSave(original, LAB_MAP, 'invasion', 1, 'test');
		const captured = structuredClone(saved);
		const liveDeparture = order.departures[1];
		if (!liveDeparture) throw new Error('Missing surviving departure');
		liveDeparture.x += 100;
		expect(saved).toEqual(captured);
		expect(saved.game.orderBook.active[0]?.departures.some(function (departure) {
			return departure.unitId === dead.unitId;
		})).toBe(false);
		parseConquestSave(saved);
		restored = await createGame('invasion', LAB_MAP, saved.game);
		expect(activeOrders(restored)).toHaveLength(1);
	} finally {
		await original.dispose();
		await restored?.dispose();
	}
});

test('restoring travelers rebuilds combat spatial data before their first resumed step', async function () {
	const original = await createGame();
	let restored: Game | undefined;
	try {
		original.getResource('match').ai = false;
		for (const entry of units(original)) original.removeEntity(entry.id);
		for (const [owner, x, destination] of [
			['blue', 400, 'Vega'],
			['red', 420, 'Terra'],
		] as const) {
			original.spawn({
				localTransform: { x, y: 350, rotation: 0, scaleX: 1, scaleY: 1 },
				circleCollider: { radius: 0 },
				unit: {
					owner, kind: 'ship', x, y: 350,
					target: named(original, destination).id, phase: 'travel',
					hp: CONFIG.shipHealth, cargo: 0, age: 0,
				},
			});
		}
		const saved = parseConquestSave(captureConquestSave(original, LAB_MAP, 'skirmish', 1, 'test'));
		restored = await createGame('skirmish', LAB_MAP, saved.game);
		restored.getResource('match').paused = false;
		advance(original, 1);
		advance(restored, 1);
		expect(comparable(restored)).toEqual(comparable(original));
		for (const entry of units(restored)) {
			expect(entry.components.unit.hp).toBeLessThan(CONFIG.shipHealth);
			expect(entry.components.unit.y).toBe(350);
		}
	} finally {
		await original.dispose();
		await restored?.dispose();
	}
});

test('malformed numeric state is rejected before it can stall production or dispatch', async function () {
	const original = await createGame('invasion');
	try {
		dispatch(original, [named(original, 'Terra').id], named(original, 'Sol').id, 0.5);
		const saved = captureConquestSave(original, LAB_MAP, 'invasion', 1, 'test');
		parseConquestSave(saved);
		const changes: ((copy: ConquestSave) => void)[] = [
			function (copy): void {
				const planet = copy.game.planets[0];
				if (!planet) throw new Error('Missing planet');
				planet.planet.troops = 1e308;
			},
			function (copy): void {
				const planet = copy.game.planets[0];
				if (!planet) throw new Error('Missing planet');
				planet.planet.troops = Number.MAX_SAFE_INTEGER;
			},
			function (copy): void {
				const planet = copy.game.planets[0];
				if (!planet) throw new Error('Missing planet');
				planet.planet.troops = 1.5;
			},
			function (copy): void {
				const planet = copy.game.planets[0];
				if (!planet) throw new Error('Missing planet');
				planet.planet.progress = 1e308;
			},
			function (copy): void {
				const planet = copy.game.planets[0];
				if (!planet) throw new Error('Missing planet');
				planet.planet.rate = 1e308;
				copy.game.map = {
					...copy.game.map,
					planets: copy.game.map.planets.map(function (seed) {
						return seed[0] === planet.planet.name
							? [seed[0], seed[1], seed[2], seed[3], seed[4], seed[5], 1e308] as const
							: seed;
					}),
				};
			},
			function (copy): void {
				const transport = copy.game.units.find(function (entry) {
					return entry.unit.kind === 'transport';
				});
				if (!transport) throw new Error('Missing transport');
				transport.unit.cargo = 1.5;
			},
			function (copy): void {
				const traveler = copy.game.units.find(function (entry) {
					return entry.unit.phase === 'travel';
				});
				if (!traveler) throw new Error('Missing traveler');
				traveler.unit.x = 1e308;
			},
			function (copy): void {
				const planet = copy.game.planets[0];
				if (!planet) throw new Error('Missing planet');
				planet.planet.x = 1e308;
				copy.game.map = {
					...copy.game.map,
					planets: copy.game.map.planets.map(function (seed) {
						return seed[0] === planet.planet.name
							? [seed[0], 1e308, seed[2], seed[3], seed[4], seed[5], seed[6]] as const
							: seed;
					}),
				};
			},
		];
		for (const change of changes) {
			const copy = structuredClone(saved);
			change(copy);
			expect(function () { parseConquestSave(copy); }).toThrow();
		}
	} finally {
		await original.dispose();
	}
});

test('schema parsing preserves extension fields and fractional state without coercing malformed saves', async function () {
	const world = await createGame('invasion');
	try {
		const saved = captureConquestSave(world, LAB_MAP, 'invasion', 1, 'test');
		const row = saved.game.planets[0];
		if (!row) throw new Error('Missing planet');
		row.planet.guns = 0.5;
		row.planet.progress = 0.25;
		const extended = {
			...saved,
			extension: { enabled: true },
			game: {
				...saved.game,
				match: { ...saved.game.match, extension: 'retained' },
				planets: [{ ...row, planet: { ...row.planet, extension: 123 } }, ...saved.game.planets.slice(1)],
			},
		};
		expect(parseConquestSave(extended, 'test')).toEqual(extended);
		const malformed: unknown[] = [
			{ ...saved, savedAt: String(saved.savedAt) },
			{ ...saved, game: { ...saved.game, match: { ...saved.game.match, winner: undefined } } },
			{ ...saved, game: { ...saved.game, match: { ...saved.game.match, time: Infinity } } },
			{ ...saved, game: { ...saved.game, map: {
				...saved.game.map,
				planets: saved.game.map.planets.map(function (seed) { return [...seed, 'extra']; }),
			} } },
		];
		for (const input of malformed) {
			const before = structuredClone(input);
			expect(function () { parseConquestSave(input); }).toThrow(
				'Could not validate this saved conquest. Its profile data was kept unchanged.',
			);
			expect(input).toEqual(before);
		}
	} finally {
		await world.dispose();
	}
});
