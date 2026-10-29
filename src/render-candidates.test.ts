import { expect, test } from 'bun:test';
import { createRenderCandidates, worldViewport } from './render-candidates';
import { createGame, units, unitPoint, planets, dispatch } from './game';
import { createCrowdedBaseline } from './performance-scenario';
import type { Camera } from './camera';
import type { Game } from './game';

// Compare index results to exhaustive displayed positions, including silhouettes.
const exhaustive = function (world: Game, camera: Camera, width: number, height: number): number[] {
	return units(world).filter(function ({ id, components: { unit } }) {
		const target = world.getComponent(unit.target, 'planet');
		if (!target || unit.hp <= 0) return false;
		const point = unitPoint(unit, target, world.getResource('match').time, id);
		const screenX = point.x * camera.scale + camera.x;
		const screenY = point.y * camera.scale + camera.y;
		const radius = Math.max(45 * camera.scale, unit.kind === 'transport' ? Math.max(20, String(unit.cargo).length * 7 + 2) / 2 : 0);
		return screenX + radius >= 0 && screenX - radius <= width && screenY + radius >= 0 && screenY - radius <= height;
	}).map(function (entity) { return entity.id; });
};

test('indexed orbit and traveler candidates match exhaustive positions through desktop/mobile pan and zoom', async function () {
	const snapshot = createCrowdedBaseline();
	const world = await createGame('skirmish', snapshot.map, snapshot);
	const index = await createRenderCandidates();
	try {
		for (const time of [0, 3, 11]) {
			world.getResource('match').time = time;
			for (const [width, height] of [[1280, 800], [390, 844]]) {
				if (width === undefined || height === undefined) throw new Error('Missing dimensions');
				for (const scale of [0.22, 0.443, 1, 2.216]) {
					for (let x = -1300; x <= 400; x += 170) {
						const camera = { x, y: -260, scale };
						const selected = index.select(world, camera, width, height, true);
						expect(selected.visible.map(function (e) { return e.id; })).toEqual(exhaustive(world, camera, width, height));
					}
				}
			}
		}
		const selected = index.select(world, { x: -520, y: -180, scale: 2.216 }, 390, 844, true);
		expect(selected.entries).toBe(302); // 300 travelers + two orbit bounds, not 1500 render colliders.
		expect(selected.candidates).toBeLessThan(1500);
	} finally { await index.dispose(); await world.dispose(); }
});

test('fresh render queries handle paused dispatch, arrival, movement, death, empty/reset and replacement without gameplay mutation', async function () {
	const snapshot = createCrowdedBaseline();
	const world = await createGame('skirmish', snapshot.map, snapshot);
	const index = await createRenderCandidates();
	const camera = { x: -300, y: -900, scale: 1 };
	const check = function (): void {
		const before = structuredClone(units(world));
		const combatEntries = world.getResource('spatialIndex').queryRect(-10000, -10000, 10000, 10000);
		const selected = index.select(world, camera, 390, 844, true);
		expect(selected.visible.map(function (e) { return e.id; })).toEqual(exhaustive(world, camera, 390, 844));
		expect(units(world)).toEqual(before);
		expect(world.getResource('spatialIndex').queryRect(-10000, -10000, 10000, 10000)).toEqual(combatEntries);
	};
	try {
		world.getResource('match').paused = true;
		check();
		const home = planets(world).find(function (e) { return e.components.planet.owner === 'blue'; });
		const target = planets(world).find(function (e) { return e.components.planet.owner === 'red'; });
		if (!home || !target) throw new Error('Missing homes');
		dispatch(world, [home.id], target.id, 0.5, 'ships');
		check(); // No simulation tick; dispatch already changed phase/target.
		const traveler = units(world).find(function (e) { return e.components.unit.phase === 'travel'; });
		if (!traveler) throw new Error('Missing traveler');
		traveler.components.unit.x = 320; traveler.components.unit.y = 950;
		check();
		traveler.components.unit.phase = 'orbit';
		traveler.components.unit.target = home.id;
		check();
		traveler.components.unit.hp = 0;
		check();
		for (const entity of units(world)) world.removeEntity(entity.id);
		check();
		index.reset();
		const replacement = await createGame('skirmish', snapshot.map, snapshot);
		try {
			expect(index.select(replacement, camera, 390, 844, true).visible.map(function (e) { return e.id; }))
				.toEqual(exhaustive(replacement, camera, 390, 844));
		} finally { await replacement.dispose(); }
	} finally { await index.dispose(); await world.dispose(); }
});

test('screen-space cargo and silhouette margins retain ships at all four viewport edges', async function () {
	const snapshot = createCrowdedBaseline();
	const world = await createGame('skirmish', snapshot.map, snapshot);
	const index = await createRenderCandidates();
	try {
		for (const entity of units(world)) world.removeEntity(entity.id);
		const home = planets(world)[0];
		if (!home) throw new Error('Missing planet');
		for (const [x, y] of [[-50, 50], [150, 50], [50, -50], [50, 150]]) {
			if (x === undefined || y === undefined) throw new Error('Missing position');
			world.spawn({ unit: { x, y, target: home.id, phase: 'travel', kind: 'transport', cargo: 123456789012345, hp: 10, owner: 'blue', age: 0 } });
		}
		expect(index.select(world, { x: 0, y: 0, scale: 1 }, 100, 100, true).visible).toHaveLength(4);
		expect(index.select(world, { x: 0, y: 0, scale: 1 }, 100, 100, false).visible).toHaveLength(0);
		expect(worldViewport({ x: -100, y: 50, scale: 2 }, 390, 844))
			.toEqual({ left: 50, top: -25, right: 245, bottom: 397 });
	} finally { await index.dispose(); await world.dispose(); }
});

test('full-map fit bypass avoids index maintenance and close zoom rebuilds fresh bounds', async function () {
	const snapshot = createCrowdedBaseline();
	const world = await createGame('skirmish', snapshot.map, snapshot);
	const index = await createRenderCandidates();
	try {
		const close = { x: -545.545, y: -218, scale: 2.216 };
		expect(index.select(world, close, 1280, 800, true, snapshot.map).entries).toBe(302);
		const fit = index.select(world, { x: 374.09, y: 130, scale: 0.443 }, 1280, 800, false, snapshot.map);
		expect(fit.entries).toBe(0);
		expect(fit.visible).toHaveLength(1500);
		expect(index.select(world, close, 1280, 800, true, snapshot.map).visible.map(function (e) { return e.id; }))
			.toEqual(exhaustive(world, close, 1280, 800));
	} finally { await index.dispose(); await world.dispose(); }
});
