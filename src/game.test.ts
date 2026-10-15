import { expect, test } from 'bun:test';
import {
	createGame,
	dispatch,
	planets,
	setProduction,
	spawnShip,
	units,
} from './game';
import { CONFIG } from './config';
import type { Game } from './game';

const snapshot = function (world: Game) {
	return structuredClone({
		match: world.getResource('match'),
		planets: planets(world),
		units: units(world),
	});
};

test('paused commands reserve units and change production while all action waits for resume', async function () {
	const world = await createGame('invasion');
	try {
		const terra = planets(world).find(function (entity) {
			return entity.components.planet.name === 'Terra';
		});
		const sol = planets(world).find(function (entity) {
			return entity.components.planet.name === 'Sol';
		});
		if (!terra || !sol) throw new Error('Missing scenario planets');
		// Include active combat and an AI decision due on the next step.
		spawnShip(world, sol.id, 'blue');
		const match = world.getResource('match');
		match.ai = true;
		match.aiClock = CONFIG.aiInterval;
		match.paused = true;
		const before = snapshot(world);
		for (let step = 0; step < 100; step++) world.update(CONFIG.step);
		expect(snapshot(world)).toEqual(before);

		setProduction(world, [terra.id], 'ships');
		expect(terra.components.planet.production).toBe('ships');
		expect(dispatch(world, [terra.id], sol.id, 0.5, 'troops')).toBe(3);
		expect(terra.components.planet.troops).toBe(22);
		expect(dispatch(world, [terra.id], sol.id, 0.5, 'troops')).toBe(2);
		expect(terra.components.planet.troops).toBe(11);
		expect(match.orders).toBe(2);
		const ordered = snapshot(world);
		for (let step = 0; step < 100; step++) world.update(CONFIG.step);
		expect(snapshot(world)).toEqual(ordered);

		match.paused = false;
		world.update(CONFIG.step);
		expect(match.time).toBeCloseTo(CONFIG.step);
		expect(terra.components.planet.progress).toBeGreaterThan(0);
		expect(match.aiClock).toBe(0);
		const moving = units(world).filter(function (entity) {
			return (
				entity.components.unit.kind === 'transport' &&
				entity.components.unit.owner === 'blue'
			);
		});
		expect(moving).toHaveLength(5);
		for (const entity of moving) {
			const frozen = ordered.units.find(function (unit) {
				return unit.id === entity.id;
			});
			if (!frozen) throw new Error('Missing dispatched transport');
			expect(entity.components.unit.y).toBeLessThan(frozen.components.unit.y);
		}
		expect(snapshot(world).units).not.toEqual(ordered.units);
	} finally {
		await world.dispose();
	}
});
