import { describe, expect, test } from 'bun:test';
import { CONFIG } from './config';
import {
	createGame,
	dispatch,
	isBlockaded,
	orbitalUnits,
	planets,
	setProduction,
	shipsAt,
	spawnShip,
	units,
} from './game';
import type { Game } from './game';

const planet = function (world: Game, name: string) {
	const found = planets(world).find(function (e) {
		return e.components.planet.name === name;
	});
	if (!found) throw new Error(`No ${name}`);
	return found;
};
const advance = function (world: Game, seconds: number) {
	for (let i = 0; i < Math.round(seconds / CONFIG.step); i++)
		world.update(CONFIG.step);
};
const fixture = async function (
	run: (world: Game) => void | Promise<void>,
	scenario: 'skirmish' | 'blockade' | 'invasion' = 'skirmish',
) {
	const world = await createGame(scenario);
	world.getResource('match').ai = false;
	try {
		await run(world);
	} finally {
		await world.dispose();
	}
};

describe('core playable loop', function () {
	test('half-send auto-packs troops, preserves guns, and captures a neutral within seconds', async function () {
		await fixture(function (world) {
			const home = planet(world, 'Terra'),
				luna = planet(world, 'Luna');
			home.components.planet.guns = 2;
			expect(dispatch(world, [home.id], luna.id, 0.5)).toBe(5); // 2 ships and 3 transports
			expect(home.components.planet.troops).toBe(22);
			expect(home.components.planet.guns).toBe(2);
			const transports = units(world).filter(function (e) {
				return e.components.unit.kind === 'transport';
			});
			expect(
				transports.map(function (e) {
					return e.components.unit.cargo;
				}),
			).toEqual([10, 10, 2]);
			advance(world, 4);
			expect(luna.components.planet.owner).toBe('blue');
			expect(luna.components.planet.troops).toBeGreaterThanOrEqual(14);
			expect(world.getResource('match').firstCapture).toBeLessThan(4);
			expect(
				units(world).some(function (e) {
					return e.components.unit.kind === 'transport';
				}),
			).toBe(false);
		});
	});
	test('production switching discards partial work and preserves existing stock', async function () {
		await fixture(function (world) {
			const home = planet(world, 'Terra');
			setProduction(world, [home.id], 'ships');
			advance(world, 1);
			expect(home.components.planet.progress).toBeGreaterThan(2);
			setProduction(world, [home.id], 'guns');
			expect(home.components.planet.progress).toBe(0);
			advance(world, 2);
			expect(home.components.planet.guns).toBe(1);
			expect(home.components.planet.troops).toBe(44);
			expect(shipsAt(world, home.id, 'blue')).toHaveLength(3);
		});
	});
	test('blockade prevents surface departure but allows production, reinforcement and orbital redeployment', async function () {
		await fixture(function (world) {
			const sol = planet(world, 'Sol'),
				vega = planet(world, 'Vega'),
				home = planet(world, 'Terra');
			expect(isBlockaded(world, sol.id)).toBe(true);
			expect(dispatch(world, [sol.id], home.id, 1, 'combined', 'red')).toBe(0);
			advance(world, 1);
			expect(sol.components.planet.troops).toBeGreaterThan(18);
			expect(dispatch(world, [vega.id], sol.id, 1, 'ships', 'red')).toBe(3);
			expect(dispatch(world, [sol.id], home.id, 0.5, 'ships')).toBe(2);
			expect(shipsAt(world, sol.id, 'blue')).toHaveLength(2);
			expect(sol.components.planet.owner).toBe('red');
		}, 'blockade');
	});
	test('ships win orbit without capturing ground; troops subsequently capture', async function () {
		await fixture(function (world) {
			const sol = planet(world, 'Sol'),
				home = planet(world, 'Terra');
			advance(world, 2);
			expect(sol.components.planet.owner).toBe('red');
			expect(isBlockaded(world, sol.id)).toBe(true);
			home.components.planet.troops = 80;
			dispatch(world, [home.id], sol.id, 1, 'troops');
			advance(world, 4);
			expect(sol.components.planet.owner).toBe('blue');
			expect(isBlockaded(world, sol.id)).toBe(false);
		}, 'blockade');
	});
	test('unescorted transports wait, suffer losses, and fail to capture a defended world', async function () {
		await fixture(function (world) {
			const sol = planet(world, 'Sol'),
				home = planet(world, 'Terra');
			dispatch(world, [home.id], sol.id, 1, 'troops');
			advance(world, 8);
			expect(sol.components.planet.owner).toBe('red');
			expect(world.getResource('match').transportsLost).toBe(5);
			expect(world.getResource('match').troopsLost).toBe(44);
		}, 'invasion');
	});
	test('combined escort clears guns and ships before the surviving transports land', async function () {
		await fixture(function (world) {
			const sol = planet(world, 'Sol'),
				home = planet(world, 'Terra');
			dispatch(world, [home.id], sol.id, 1, 'combined');
			advance(world, 12);
			expect(sol.components.planet.owner).toBe('blue');
			expect(sol.components.planet.guns).toBe(0);
			expect(world.getResource('match').transportsLost).toBe(0);
		}, 'invasion');
	});
	test('arrival grace protects a transport from small escort timing differences', async function () {
		await fixture(function (world) {
			const sol = planet(world, 'Sol');
			const carrier = world.spawn({
				unit: {
					owner: 'blue',
					kind: 'transport',
					target: sol.id,
					x: 300,
					y: 300,
					phase: 'orbit',
					hp: 2,
					cargo: 10,
					age: 0,
				},
			});
			advance(world, 0.5);
			expect(carrier.components.unit.hp).toBe(2);
			advance(world, 0.5);
			expect(carrier.components.unit.hp).toBeLessThan(2);
		}, 'invasion');
	});
	test('external reinforcements break a blockade, while freshly produced ships fight it', async function () {
		await fixture(function (world) {
			const sol = planet(world, 'Sol'),
				vega = planet(world, 'Vega');
			for (let i = 0; i < 10; i++) spawnShip(world, vega.id, 'red');
			setProduction(world, [sol.id], 'ships', 'red');
			dispatch(world, [vega.id], sol.id, 1, 'ships', 'red');
			advance(world, 14);
			expect(sol.components.planet.owner).toBe('red');
			expect(shipsAt(world, sol.id, 'blue')).toHaveLength(0);
			expect(shipsAt(world, sol.id, 'red').length).toBeGreaterThan(0);
			expect(isBlockaded(world, sol.id)).toBe(false);
		}, 'blockade');
	});
	test('pause freezes movement, economy, combat and AI together', async function () {
		await fixture(function (world) {
			const home = planet(world, 'Terra'),
				luna = planet(world, 'Luna');
			dispatch(world, [home.id], luna.id, 0.5);
			const before = JSON.stringify(units(world));
			const troops = home.components.planet.troops;
			world.getResource('match').paused = true;
			advance(world, 5);
			expect(world.getResource('match').time).toBe(0);
			expect(home.components.planet.troops).toBe(troops);
			expect(JSON.stringify(units(world))).toBe(before);
		});
	});
	test('multi-source dispatch deduplicates sources and invalid fractions do nothing', async function () {
		await fixture(function (world) {
			const home = planet(world, 'Terra'),
				luna = planet(world, 'Luna'),
				ceres = planet(world, 'Ceres');
			luna.components.planet.owner = 'blue';
			expect(dispatch(world, [home.id], ceres.id, NaN)).toBe(0);
			expect(
				dispatch(world, [home.id, home.id, luna.id], ceres.id, 1, 'troops'),
			).toBe(6);
			expect(home.components.planet.troops).toBe(0);
			expect(luna.components.planet.troops).toBe(0);
		});
	});
	test('AI expands without player input and victory requires surface ownership', async function () {
		await fixture(function (world) {
			world.getResource('match').ai = true;
			advance(world, 15);
			expect(
				planets(world).filter(function (e) {
					return e.components.planet.owner === 'red';
				}).length,
			).toBeGreaterThan(1);
			expect(world.getResource('match').winner).toBeNull();
			for (const e of planets(world))
				if (e.components.planet.owner === 'red')
					e.components.planet.owner = 'blue';
			advance(world, 0.1);
			expect(world.getResource('match').winner).toBe('blue');
		});
	});
	test('AI builds enough ships to challenge fortified targets instead of stopping at four', async function () {
		await fixture(function (world) {
			for (const e of planets(world)) {
				if (e.components.planet.owner === 'red') continue;
				e.components.planet.owner = 'blue';
				e.components.planet.troops = 100;
				e.components.planet.guns = 8;
				e.components.planet.rate = 0;
			}
			world.getResource('match').ai = true;
			advance(world, 20);
			const home = planet(world, 'Vega');
			expect(home.components.planet.production).toBe('ships');
			expect(shipsAt(world, home.id, 'red').length).toBeGreaterThan(4);
		});
	});
	test('equal opposing ships exchange damage simultaneously', async function () {
		await fixture(function (world) {
			const sol = planet(world, 'Sol');
			const blue = spawnShip(world, sol.id, 'blue'),
				red = spawnShip(world, sol.id, 'red');
			if (!blue || !red) throw new Error('Expected ships');
			advance(world, 1);
			expect(blue.components.unit.hp).toBeCloseTo(red.components.unit.hp, 6);
			expect(orbitalUnits(world, sol.id)).toHaveLength(2);
		});
	});
});
