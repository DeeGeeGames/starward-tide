import { expect, test } from 'bun:test';
import { CONFIG } from './config';
import { createGame, dispatch, planets, shipsAt } from './game';
import { generateMap, MAP_SIZES } from './maps';
import type { PlanetSeed } from './maps';

for (const size of ['small', 'medium', 'large'] as const) {
	test(`${size} scatters most worlds beyond the original grid jitter`, function () {
		const { width, height, columns, rows } = MAP_SIZES[size];
		const map = generateMap(size, 8041);
		const scattered = map.planets.filter(function ([, x, y]) {
			const cellWidth = width / columns;
			const cellHeight = height / rows;
			const columnCenter = (Math.floor(x / cellWidth) + 0.5) * cellWidth;
			const rowCenter = (Math.floor(y / cellHeight) + 0.5) * cellHeight;
			return Math.abs(x - columnCenter) > 40 || Math.abs(y - rowCenter) > 40;
		});
		expect(scattered.length).toBeGreaterThan(map.planets.length / 2);
	});
	test(`${size} maps have the requested count, spacing, bounds, and fair paired starts across seeds`, function () {
		for (let seed = 0; seed < 200; seed++) {
			const map = generateMap(size, seed);
			expect(map.planets).toHaveLength(MAP_SIZES[size].count);
			expect(
				new Set(
					map.planets.map(function ([name]) {
						return name;
					}),
				).size,
			).toBe(map.planets.length);
			for (const [index, planet] of map.planets.entries()) {
				const [, x, y, radius, owner, troops, rate] = planet;
				expect(x - radius).toBeGreaterThan(60);
				expect(y - radius).toBeGreaterThan(60);
				expect(x + radius).toBeLessThan(map.width - 60);
				expect(y + radius).toBeLessThan(map.height - 60);
				for (const other of map.planets.slice(index + 1)) {
					expect(Math.hypot(x - other[1], y - other[2])).toBeGreaterThanOrEqual(
						216,
					);
				}
				const mirror = map.planets.find(function (other) {
					return (
						Math.abs(other[1] - (map.width - x)) < 0.001 &&
						Math.abs(other[2] - (map.height - y)) < 0.001
					);
				});
				if (!mirror) throw new Error('Missing mirrored world');
				expect(mirror[3]).toBe(radius);
				expect(mirror[5]).toBe(troops);
				expect(mirror[6]).toBe(rate);
				expect(mirror[4]).toBe(
					owner === 'blue' ? 'red' : owner === 'red' ? 'blue' : 'neutral',
				);
			}
			for (const side of ['blue', 'red'] as const) {
				expect(
					map.planets.filter(function (planet) {
						return planet[4] === side;
					}),
				).toHaveLength(1);
			}
		}
	});
	test(`${size} launches the exact preview, supports commands, and restarts without mutating its map`, async function () {
		const preview = generateMap(size, 8041);
		const before = structuredClone(preview);
		const world = await createGame('skirmish', preview);
		try {
			expect(
				planets(world).map(function ({ components: { planet } }): PlanetSeed {
					return [
						planet.name,
						planet.x,
						planet.y,
						planet.radius,
						planet.owner,
						planet.troops,
						planet.rate,
					];
				}),
			).toEqual([...preview.planets]);
			const home = planets(world).find(function ({ components: { planet } }) {
				return planet.owner === 'blue';
			});
			const neutral = planets(world).find(function ({
				components: { planet },
			}) {
				return planet.owner === 'neutral';
			});
			if (!home || !neutral) throw new Error('Missing playable worlds');
			expect(shipsAt(world, home.id, 'blue')).toHaveLength(3);
			expect(
				dispatch(world, [home.id], neutral.id, 0.5, 'combined'),
			).toBeGreaterThan(0);
			world.update(CONFIG.step);
			expect(world.getResource('match').time).toBeCloseTo(CONFIG.step);
			expect(preview).toEqual(before);
		} finally {
			await world.dispose();
		}
		const restarted = await createGame('skirmish', preview);
		try {
			expect(
				planets(restarted).map(function ({ components: { planet } }) {
					return planet.troops;
				}),
			).toEqual(
				before.planets.map(function (planet) {
					return planet[5];
				}),
			);
			expect(restarted.getResource('match').time).toBe(0);
		} finally {
			await restarted.dispose();
		}
	});
}

test('seeds reproduce maps and rerolls vary the layout', function () {
	expect(generateMap('medium', 8041)).toEqual(generateMap('medium', 8041));
	expect(generateMap('medium', 8042).planets).not.toEqual(
		generateMap('medium', 8041).planets,
	);
});
