import type { Point } from './camera';
import { CONFIG, isHostile } from './config';
import { orderUnits, units, type Game, type Order } from './game';
import { interceptPoint } from './interception';
import { travelAim } from './movement';
import { planPasses } from './combat';

export const travelingGroups = function (world: Game): {
	order: Order;
	members: ReturnType<typeof orderUnits>;
}[] {
	const travelers = new Map(units(world).filter(function (entity) {
		const unit = entity.components.unit;
		return unit.phase === 'travel' && unit.hp > 0;
	}).map(function (entity) { return [entity.id, entity] as const; }));
	return world.getResource('orderBook').active.flatMap(function (order) {
		const members = order.departures.flatMap(function (departure) {
			const entity = travelers.get(departure.unitId);
			const target = order.state === 'returning' ? departure.source : order.target;
			return entity && entity.components.unit.owner === order.owner && entity.components.unit.target === target ? [entity] : [];
		});
		return members.length > 0 ? [{ order, members }] : [];
	});
};

// Run before steering. A completed target order may already have been pruned.
// Keep each departure's source so multi-source sorties return independently.
export const returnInterceptors = function (world: Game): void {
	const interceptors = world.getResource('orderBook').active.filter(function (order) { return order.interceptOrder !== undefined; });
	if (interceptors.length === 0) return;
	const groups = new Map(travelingGroups(world).map(function (group) {
		return [group.order.id, group] as const;
	}));
	for (const order of interceptors) {
		if (order.interceptOrder === undefined) continue;
		const target = groups.get(order.interceptOrder);
		if (target && isHostile(order.owner, target.order.owner)) continue;
		const departures = new Map(order.departures.map(function (departure) {
			return [departure.unitId, departure] as const;
		}));
		for (const entity of orderUnits(world, order)) {
			const departure = departures.get(entity.id);
			if (!departure) continue;
			entity.components.unit.target = departure.source;
		}
		order.state = 'returning';
		delete order.interceptOrder;
	}
};

// Both steering and presentation consume this snapshot. Lead the nearest living
// member of the chosen group; combat retains its own normal targeting priority.
export const interceptionAims = function (world: Game, fighting?: ReadonlySet<number>): Map<number, Point> {
	const aims = new Map<number, Point>();
	if (!world.getResource('orderBook').active.some(function (order) { return order.interceptOrder !== undefined; })) return aims;
	const stopped = fighting ?? new Set(planPasses(world, 0, units).map(function (shot) { return shot.shooterId; }));
	const groups = travelingGroups(world);
	const byId = new Map(groups.map(function (group) { return [group.order.id, group] as const; }));
	for (const group of groups) {
		const target = group.order.interceptOrder === undefined ? undefined : byId.get(group.order.interceptOrder);
		if (!target || !isHostile(group.order.owner, target.order.owner)) continue;
		for (const pursuer of group.members) {
			const unit = pursuer.components.unit;
			let nearest: typeof target.members[number] | undefined;
			let distance = Infinity;
			for (const candidate of target.members) {
				const other = candidate.components.unit;
				const separation = Math.hypot(other.x - unit.x, other.y - unit.y);
				if (separation < distance || (separation === distance && candidate.id < (nearest?.id ?? Infinity))) {
					nearest = candidate;
					distance = separation;
				}
			}
			if (!nearest) continue;
			const other = nearest.components.unit;
			const destination = world.getComponent(other.target, 'planet');
			if (!destination) continue;
			const course = travelAim(other, destination);
			const dx = course.x - other.x, dy = course.y - other.y;
			const remaining = Math.hypot(dx, dy);
			const speed = stopped.has(nearest.id) ? 0 : CONFIG.travelSpeed * (other.kind === 'transport' ? 0.5 : 1);
			const velocity = remaining === 0 ? { x: 0, y: 0 } : { x: dx / remaining * speed, y: dy / remaining * speed };
			const projected = interceptPoint(unit, CONFIG.travelSpeed, other, velocity, CONFIG.engagementRange);
			// Do not chase an extrapolation beyond the group's route.
			aims.set(pursuer.id, Math.hypot(projected.x - other.x, projected.y - other.y) > remaining ? course : projected);
		}
	}
	return aims;
};
