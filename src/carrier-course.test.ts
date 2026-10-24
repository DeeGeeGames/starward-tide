import { expect, test } from 'bun:test';
import { CONFIG } from './config';
import { createGame, moveCarrier, planets, unitPoint, type Unit } from './game';
import { LAB_MAP } from './maps';
import { CARRIER_SPEED, travelAim } from './movement';

for (const kind of ['ship', 'transport'] as const) {
	test(`${kind} steering and displayed heading lead a crossing carrier and update on turn/stop`, async function () {
		const world = await createGame('skirmish', { ...LAB_MAP, carriers: true });
		try {
			world.getResource('match').ai = false;
			const host = planets(world).find(function (entry) { return entry.components.planet.name === 'Blue carrier'; });
			if (!host) throw new Error('Missing carrier');
			const target = host.components.planet;
			target.x = 600; target.y = 600;
			moveCarrier(world, host.id, { x: 600, y: 1200 });
			const unit: Unit = { owner: 'blue', kind, x: 300, y: 600, target: host.id, phase: 'travel', hp: 2, cargo: 0, age: 0 };
			const traveler = world.spawn({ unit, localTransform: { x: unit.x, y: unit.y, rotation: 0, scaleX: 1, scaleY: 1 }, circleCollider: { radius: 0 } });
			const projected = travelAim(unit, target);
			const speed = CONFIG.travelSpeed * (kind === 'transport' ? 0.5 : 1);
			const time = Math.hypot(projected.x - unit.x, projected.y - unit.y) / speed;
			expect(projected.x).toBe(600);
			expect(projected.y).toBeCloseTo(600 + time * CARRIER_SPEED);
			expect(unitPoint(unit, target, 0, traveler.id).angle).toBeCloseTo(Math.atan2(projected.y - unit.y, projected.x - unit.x));
			const before = { x: unit.x, y: unit.y };
			world.update(CONFIG.step);
			// Broadside pursuit would barely change y; predictive steering leads by
			// 14 degrees (ships) or 30 degrees (transports) from the first step.
			const angle = Math.atan2(unit.y - before.y, unit.x - before.x);
			expect(angle).toBeGreaterThan(0.2);
			expect(unitPoint(unit, target, 0, traveler.id).angle).toBeCloseTo(angle, 2);
			// Paused course changes must update the display before the next movement tick.
			world.getResource('match').paused = true;
			moveCarrier(world, host.id, { x: 600, y: 100 });
			expect(travelAim(unit, target).y).toBeLessThan(target.y);
			expect(unitPoint(unit, target, 0, traveler.id).angle).toBeLessThan(0);
			moveCarrier(world, host.id, { x: target.x, y: target.y });
			expect(travelAim(unit, target)).toEqual({ x: target.x, y: target.y });
			moveCarrier(world, host.id, { x: target.x, y: target.y + 1 });
			expect(travelAim(unit, target)).toEqual({ x: target.x, y: target.y + 1 });
		} finally { await world.dispose(); }
	});
}
