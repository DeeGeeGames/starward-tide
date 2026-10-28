import { expect, test } from 'bun:test';
import { CONFIG } from './config';
import { arrivalFraction, destinationFor, raceDestinations, type Destination } from './objectives';
import { carrierSeeds, generateMap, LAB_MAP, type StarMap } from './maps';
import { createGame, dispatch, dockedShips, launchCarrierShips, moveCarrier, planets, setProduction, units, type Game } from './game';
import { CARRIER_SPEED } from './movement';
import { captureConquestSave } from './game-save';
import { parseConquestSave } from './save-state';

const raceModes = ['center-race', 'crossing-race'] as const;
const getCarrier = function (world: Game, owner: 'blue' | 'red'): ReturnType<typeof planets>[number] {
	const entity = planets(world).find(function (entry) { return entry.components.planet.carrier && entry.components.planet.owner === owner; });
	if (!entity) throw new Error(`Missing ${owner} carrier`);
	return entity;
};
const getDestination = function (world: Game, owner: 'blue' | 'red'): Destination {
	const destination = destinationFor(world.getResource('objectives'), owner);
	if (!destination) throw new Error(`Missing ${owner} destination`);
	return destination;
};
const advance = function (world: Game, seconds: number): void {
	for (let i = 0; i < Math.round(seconds / CONFIG.step); i++) world.update(CONFIG.step);
};

for (const mode of raceModes) {
	for (const size of ['small', 'medium', 'large'] as const) {
		test(`${mode}: ${size} destinations are clear, deterministic and fair across seeds`, function () {
			for (let seed = 0; seed < 80; seed++) {
				const map: StarMap = { ...generateMap(size, seed), mode };
				const destinations = raceDestinations(map);
				const [blue, red] = carrierSeeds(map);
				if (!blue || !red) throw new Error('Missing starting carriers');
				expect(destinations).toHaveLength(mode === 'center-race' ? 1 : 2);
				expect(raceDestinations(map)).toEqual(destinations);
				const own = destinations.find(function (point) { return point.owner === 'blue' || point.owner === 'neutral'; });
				const rival = destinations.find(function (point) { return point.owner === 'red' || point.owner === 'neutral'; });
				if (!own || !rival) throw new Error('Missing destinations');
				expect(Math.hypot(own.x - blue[1], own.y - blue[2])).toBeCloseTo(Math.hypot(rival.x - red[1], rival.y - red[2]), 8);
				if (mode === 'crossing-race') expect(Math.hypot(own.x - red[1], own.y - red[2])).toBeLessThan(Math.hypot(own.x - blue[1], own.y - blue[2]));
				for (const point of destinations) {
					expect(point.x - point.radius).toBeGreaterThan(0);
					expect(point.y - point.radius).toBeGreaterThan(0);
					expect(point.x + point.radius).toBeLessThan(map.width);
					expect(point.y + point.radius).toBeLessThan(map.height);
					for (const world of [...map.planets, ...carrierSeeds(map)]) expect(Math.hypot(point.x - world[1], point.y - world[2])).toBeGreaterThanOrEqual(point.radius + world[3] + 44 - 1e-8);
				}
			}
		});
	}

	test(`${mode}: real movement wins, pause holds, and the result freezes simulation`, async function () {
		const world = await createGame('skirmish', { ...LAB_MAP, mode });
		try {
			const match = world.getResource('match');
			match.ai = false;
			const carrier = getCarrier(world, 'blue');
			const p = carrier.components.planet;
			const destination = getDestination(world, 'blue');
			p.x = destination.x - destination.radius - 1;
			p.y = destination.y;
			moveCarrier(world, carrier.id, destination);
			match.paused = true;
			advance(world, 2);
			expect(match.winner).toBeNull();
			expect(p.x).toBe(destination.x - destination.radius - 1);
			match.paused = false;
			advance(world, 0.25);
			expect(match.winner).toBe('blue');
			const time = match.time;
			const x = p.x;
			advance(world, 2);
			expect(match.time).toBe(time);
			expect(p.x).toBe(x);
			expect(moveCarrier(world, carrier.id, { x: 0, y: 0 })).toBe(false);
		} finally { await world.dispose(); }
	});

	test(`${mode}: close finishes use crossing time, not carrier/entity order`, async function () {
		const world = await createGame('skirmish', { ...LAB_MAP, mode });
		try {
			world.getResource('match').ai = false;
			for (const owner of ['blue', 'red'] as const) {
				const carrier = getCarrier(world, owner);
				const destination = getDestination(world, owner);
				carrier.components.planet.x = destination.x - destination.radius - (owner === 'blue' ? 0.2 : 0.1);
				carrier.components.planet.y = destination.y;
				moveCarrier(world, carrier.id, destination, owner);
			}
			world.update(CONFIG.step);
			expect(world.getResource('match').winner).toBe('red');
		} finally { await world.dispose(); }
	});

	test(`${mode}: exact simultaneous arrivals draw and stop further commands`, async function () {
		const map: StarMap = { ...LAB_MAP, mode };
		const world = await createGame('skirmish', map);
		try {
			const match = world.getResource('match');
			match.ai = false;
			for (const owner of ['blue', 'red'] as const) {
				const carrier = getCarrier(world, owner);
				const destination = getDestination(world, owner);
				carrier.components.planet.x = destination.x - destination.radius - 0.1;
				carrier.components.planet.y = destination.y;
				moveCarrier(world, carrier.id, destination, owner);
			}
			world.update(CONFIG.step);
			expect(match.draw).toBe(true);
			expect(match.winner).toBeNull();
			const blue = getCarrier(world, 'blue');
			const red = getCarrier(world, 'red');
			expect(moveCarrier(world, blue.id, red.components.planet)).toBe(false);
			expect(dispatch(world, [blue.id], red.id, 1)).toBe(0);
			expect(launchCarrierShips(world, blue.id)).toBe(0);
			setProduction(world, [blue.id], 'ships');
			expect(blue.components.planet.production).toBe('troops');
			const time = match.time;
			advance(world, 1);
			expect(match.time).toBe(time);
			const save = parseConquestSave(captureConquestSave(world, map, 'skirmish', 1, 'race-test'));
			expect(save.game.match.draw).toBe(true);
		} finally { await world.dispose(); }
	});

	test(`${mode}: the AI moves its carrier and can finish without player commands`, async function () {
		const world = await createGame('skirmish', { ...LAB_MAP, mode });
		try {
			const red = getCarrier(world, 'red');
			const destination = getDestination(world, 'red');
			red.components.planet.x = destination.x - destination.radius - 5;
			red.components.planet.y = destination.y;
			advance(world, 3);
			expect(red.components.planet.carrier?.destination).toEqual({ x: destination.x, y: destination.y });
			expect(red.components.planet.troops).toBeGreaterThanOrEqual(20);
			expect(dockedShips(world, red.id, 'red')).toHaveLength(3);
			advance(world, 2);
			expect(world.getResource('match').winner).toBe('red');
		} finally { await world.dispose(); }
	});

	test(`${mode}: save/load/restart preserve mode, destinations, routes and result`, async function () {
		const map: StarMap = { ...generateMap('small', 17), mode };
		const world = await createGame('skirmish', map);
		let restored: Game | undefined;
		let restarted: Game | undefined;
		try {
			world.getResource('match').ai = false;
			const blue = getCarrier(world, 'blue');
			const destination = getDestination(world, 'blue');
			blue.components.planet.x = destination.x - destination.radius - 10;
			blue.components.planet.y = destination.y;
			moveCarrier(world, blue.id, destination);
			advance(world, 0.5);
			const save = parseConquestSave(captureConquestSave(world, map, 'skirmish', 1, 'race-test'));
			restored = await createGame(save.game.scenario, save.game.map, save.game);
			expect(restored.getResource('objectives').destinations).toEqual(world.getResource('objectives').destinations);
			restored.getResource('match').paused = false;
			advance(restored, 2);
			expect(restored.getResource('match').winner).toBe('blue');
			const won = parseConquestSave(captureConquestSave(restored, map, 'skirmish', 1, 'race-test'));
			expect(won.game.match.winner).toBe('blue');
			restarted = await createGame('skirmish', map);
			expect(restarted.getResource('match').winner).toBeNull();
			expect(restarted.getResource('objectives').destinations).toEqual(world.getResource('objectives').destinations);
		} finally { await restarted?.dispose(); await restored?.dispose(); await world.dispose(); }
	});
}

test('a carrier finish precedes a capture later in the same simulation step', async function () {
	const world = await createGame('skirmish', { ...LAB_MAP, mode: 'center-race' });
	try {
		world.getResource('match').ai = false;
		const blue = getCarrier(world, 'blue');
		const red = getCarrier(world, 'red');
		const destination = getDestination(world, 'blue');
		for (const [carrier, gap] of [[blue, 0.1], [red, 0.2]] as const) {
			const p = carrier.components.planet;
			p.x = destination.x - destination.radius - gap;
			p.y = destination.y;
			moveCarrier(world, carrier.id, destination, p.owner === 'blue' ? 'blue' : 'red');
		}
		const p = blue.components.planet;
		p.troops = 1;
		world.spawn({ unit: { owner: 'red', kind: 'transport', x: p.x, y: p.y, target: blue.id, phase: 'orbit', hp: 2, cargo: 2, age: 1 } });
		world.update(CONFIG.step);
		expect(p.owner).toBe('red');
		expect(world.getResource('match').winner).toBe('blue');
	} finally { await world.dispose(); }
});

test('crossing race ignores the rival zone and ordinary planets/ships cannot finish', async function () {
	const world = await createGame('skirmish', { ...LAB_MAP, mode: 'crossing-race' });
	try {
		world.getResource('match').ai = false;
		const blue = getCarrier(world, 'blue');
		const rival = getDestination(world, 'red');
		blue.components.planet.x = rival.x;
		blue.components.planet.y = rival.y;
		world.update(CONFIG.step);
		expect(world.getResource('match').winner).toBeNull();
		const own = getDestination(world, 'blue');
		const ordinary = planets(world).find(function (entity) { return !entity.components.planet.carrier && entity.components.planet.owner === 'blue'; });
		if (!ordinary) throw new Error('Missing ordinary world');
		ordinary.components.planet.x = own.x;
		ordinary.components.planet.y = own.y;
		for (const entity of units(world)) { entity.components.unit.x = own.x; entity.components.unit.y = own.y; }
		world.update(CONFIG.step);
		expect(world.getResource('match').winner).toBeNull();
	} finally { await world.dispose(); }
});

test('capture changes who can finish and transfers docked ships', async function () {
	const world = await createGame('skirmish', { ...LAB_MAP, mode: 'crossing-race' });
	try {
		world.getResource('match').ai = false;
		const blue = getCarrier(world, 'blue');
		const p = blue.components.planet;
		p.troops = 1;
		world.spawn({ unit: { owner: 'red', kind: 'transport', x: p.x, y: p.y, target: blue.id, phase: 'orbit', hp: 2, cargo: 2, age: 1 } });
		world.update(CONFIG.step);
		expect(p.owner).toBe('red');
		expect(dockedShips(world, blue.id, 'red')).toHaveLength(3);
		const wrong = getDestination(world, 'blue');
		p.x = wrong.x; p.y = wrong.y;
		world.update(CONFIG.step);
		expect(world.getResource('match').winner).toBeNull();
		const correct = getDestination(world, 'red');
		p.x = correct.x; p.y = correct.y;
		world.update(CONFIG.step);
		expect(world.getResource('match').winner).toBe('red');
	} finally { await world.dispose(); }
});

test('swept arrival handles through-crossings, misses, boundaries and stopped carriers', function () {
	const destination = { x: 100, y: 100, radius: 10, owner: 'neutral', label: 'Finish' } as const;
	expect(arrivalFraction({ x: 80, y: 100 }, { x: 120, y: 100 }, destination)).toBe(0.25);
	expect(arrivalFraction({ x: 80, y: 111 }, { x: 120, y: 111 }, destination)).toBeUndefined();
	expect(arrivalFraction({ x: 90, y: 100 }, { x: 90, y: 100 }, destination)).toBe(0);
	expect(arrivalFraction({ x: 80, y: 100 }, { x: 80, y: 100 }, destination)).toBeUndefined();
	expect(CARRIER_SPEED * CONFIG.step).toBeLessThan(1);
});

test('ordinary maps retain conquest and malformed race saves are rejected', async function () {
	const world = await createGame('skirmish', LAB_MAP);
	try {
		expect(world.getResource('objectives').mode).toBe('conquest');
		expect(world.getResource('objectives').destinations).toEqual([]);
		const save = captureConquestSave(world, LAB_MAP, 'skirmish', 1, 'race-test');
		expect(parseConquestSave(save).game.map.mode).toBeUndefined();
		for (const mode of ['invalid', 'center-race', 'crossing-race']) {
			const invalid = structuredClone(save);
			Object.assign(invalid.game.map, { mode });
			expect(function () { parseConquestSave(invalid); }).toThrow();
		}
		const impossible: StarMap = { width: 50, height: 50, planets: LAB_MAP.planets, mode: 'center-race' };
		await expect(createGame('skirmish', impossible)).rejects.toThrow('no clear carrier destinations');
	} finally { await world.dispose(); }
});
