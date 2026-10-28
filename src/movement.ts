import type { SystemRegistrarOf } from 'ecspresso';
import { CONFIG } from './config';
import { planPasses } from './combat';
import type { Game, Planet, Unit } from './game';
import type { Point } from './camera';
import { interceptPoint } from './interception';
import { arrivalFraction, destinationFor } from './objectives';

// Below the slowest ordinary unit (transport = 0.5 travel speed), at every pace.
export const CARRIER_SPEED = CONFIG.travelSpeed * 0.25;
export const CARRIER_ARRIVAL_TOLERANCE = 0.01;

// Shared by steering and presentation so hulls and routes show the actual lead.
export const travelAim = function (unit: Unit, target: Planet): Point {
	const destination = target.carrier?.destination;
	if (!destination) return target;
	const dx = destination.x - target.x;
	const dy = destination.y - target.y;
	const remaining = Math.hypot(dx, dy);
	if (remaining <= CARRIER_ARRIVAL_TOLERANCE) return destination;
	const velocity = { x: dx / remaining * CARRIER_SPEED, y: dy / remaining * CARRIER_SPEED };
	const speed = CONFIG.travelSpeed * (unit.kind === 'transport' ? 0.5 : 1);
	const projected = interceptPoint(unit, speed, target, velocity);
	// Once the target stops, interception is at that fixed destination.
	return Math.hypot(projected.x - target.x, projected.y - target.y) > remaining
		? destination : projected;
};

// Return only scheduling capabilities so createGame owns the phase and edges.
type ScheduledSystem = Pick<
	ReturnType<SystemRegistrarOf<Game>['addSystem']>,
	'inPhase' | 'withRef' | 'after'
>;

type MovementDependencies = {
	active: () => boolean;
	units: typeof import('./game')['units'];
	syncUnitPosition: (world: Game, unitId: number, x: number, y: number) => void;
};

export const registerMovement = function (
	systems: SystemRegistrarOf<Game>,
	{ active, units, syncUnitPosition }: MovementDependencies,
): ScheduledSystem {
	return systems
		.addSystem('travel')
		.withResources(['objectives'])
		.addQuery('hosts', { with: ['planet'], mutates: ['planet'] })
		.addQuery('units', { with: ['unit'], mutates: ['unit'] })
		.setProcess(function ({ queries, dt, ecs, resources: { objectives } }) {
			if (!active()) return;
			objectives.arrivals = [];
			for (const { id, components: { planet: p } } of queries.hosts) {
				const from = { x: p.x, y: p.y };
				const carrier = p.carrier;
				if (!carrier) continue;
				if (carrier.destination) {
					const dx = carrier.destination.x - p.x, dy = carrier.destination.y - p.y;
					const distance = Math.hypot(dx, dy);
					if (distance <= CARRIER_ARRIVAL_TOLERANCE || distance <= CARRIER_SPEED * dt) {
						p.x = carrier.destination.x; p.y = carrier.destination.y; carrier.destination = null;
					} else {
						carrier.heading = Math.atan2(dy, dx);
						p.x += dx / distance * CARRIER_SPEED * dt; p.y += dy / distance * CARRIER_SPEED * dt;
					}
				}
				if (p.owner === 'neutral') continue;
				const destination = destinationFor(objectives, p.owner);
				const crossing = destination ? arrivalFraction(from, p, destination) : undefined;
				const fraction = crossing === undefined ? undefined : crossing * Math.min(1, Math.hypot(p.x - from.x, p.y - from.y) / (CARRIER_SPEED * dt));
				if (fraction !== undefined) objectives.arrivals.push({ carrierId: id, owner: p.owner, fraction });
			}
			// Decide from one position snapshot so iteration order cannot release a ship.
			const fighting = new Set(planPasses(ecs, 0, units).map(function (shot) {
				return shot.shooterId;
			}));
			for (const entity of queries.units) {
				const u = entity.components.unit;
				const p = ecs.getComponent(u.target, 'planet');
				if (!p) {
					ecs.commands.removeEntity(entity.id);
					continue;
				}
				if (u.phase === 'docked' || u.phase === 'orbit') {
					if (p.carrier) { u.x = p.x; u.y = p.y; syncUnitPosition(ecs, entity.id, p.x, p.y); }
					u.age += dt;
					continue;
				}
				const speed = CONFIG.travelSpeed * (u.kind === 'transport' ? 0.5 : 1);
				const aim = travelAim(u, p);
				const dx = aim.x - u.x, dy = aim.y - u.y;
				const distance = Math.hypot(dx, dy);
				if (Math.hypot(p.x - u.x, p.y - u.y) <= p.radius + CONFIG.arrivalClearance) {
					u.phase = 'orbit';
					u.age = 0;
					continue;
				}
				if (fighting.has(entity.id)) continue;
				const reach = p.radius + CONFIG.arrivalClearance;
				const travel = Math.min(distance, speed * dt);
				if (distance === 0) continue;
				u.x += (dx / distance) * travel;
				u.y += (dy / distance) * travel;
				syncUnitPosition(ecs, entity.id, u.x, u.y);
				if (Math.hypot(p.x - u.x, p.y - u.y) <= reach) {
					u.phase = 'orbit';
					u.age = 0;
				}
			}
		});
};

export const registerTravelerCleanup = function (systems: SystemRegistrarOf<Game>): ScheduledSystem {
	return systems
		.addSystem('traveler-spatial-cleanup')
		.setProcessEach(
			{ with: ['unit', 'circleCollider'] },
			function ({ entity, ecs }) {
				if (
					entity.components.unit.phase !== 'travel' &&
					entity.components.unit.hp > 0
				)
					ecs.commands.removeComponent(entity.id, 'circleCollider');
			},
		);
};
