import { expect, test } from 'bun:test';
import { createGame, dispatch, orderUnits, planets, previewDispatch, spawnShip, units } from './game';
import { LAB_MAP } from './maps';
import type { DispatchFilter } from './config';

for (const filter of ['combined', 'ships', 'troops'] as const satisfies readonly DispatchFilter[]) {
	test(`dispatch preview matches actual paused launch for ${filter}, including docked carrier ships and rounding`, async function () {
		const world = await createGame('skirmish', { ...LAB_MAP, carriers: true });
		try {
			world.getResource('match').paused = true;
			const sources = planets(world).filter(function (entity) { return entity.components.planet.owner === 'blue'; }).map(function (entity) { return entity.id; });
			const target = planets(world).find(function (entity) { return entity.components.planet.name === 'Astra'; });
			if (!target) throw new Error('Missing Astra');
			const before = previewDispatch(world, [...sources, ...sources], 0.25, filter);
			dispatch(world, sources, target.id, 0.25, filter);
			const order = world.getResource('orderBook').active[0];
			if (!order) throw new Error('Missing launched order');
			const members = orderUnits(world, order);
			expect(before.troops).toBe(members.reduce(function (sum, entity) { return sum + entity.components.unit.cargo; }, 0));
			expect(before.ships).toBe(members.filter(function (entity) { return entity.components.unit.kind === 'ship'; }).length);
			expect(before.blockedSources).toBe(0);
		} finally { await world.dispose(); }
	});
}

test('preview excludes blockaded owned worlds and preserves enemy-surface orbital dispatch', async function () {
	const world = await createGame('blockade');
	try {
		const terra = planets(world).find(function (entity) { return entity.components.planet.name === 'Terra'; });
		const sol = planets(world).find(function (entity) { return entity.components.planet.name === 'Sol'; });
		if (!terra || !sol) throw new Error('Missing lab worlds');
		for (const entity of units(world)) {
			if (entity.components.unit.target === terra.id) world.removeEntity(entity.id);
		}
		spawnShip(world, terra.id, 'red');
		expect(previewDispatch(world, [terra.id], 0.5)).toEqual({ troops: 0, ships: 0, blockedSources: 1 });
		expect(previewDispatch(world, [sol.id], 0.5, 'ships')).toEqual({ troops: 0, ships: 2, blockedSources: 0 });
	} finally { await world.dispose(); }
});
