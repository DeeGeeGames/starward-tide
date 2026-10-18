import type { SystemRegistrarOf } from 'ecspresso';
import { CONFIG } from './config';
import { planPasses } from './combat';
import type { Game } from './game';

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
		.addQuery('units', { with: ['unit'], mutates: ['unit'] })
		.setProcess(function ({ queries, dt, ecs }) {
			if (!active()) return;
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
				if (u.phase === 'orbit') {
					u.age += dt;
					continue;
				}
				const dx = p.x - u.x,
					dy = p.y - u.y;
				const distance = Math.hypot(dx, dy);
				if (distance <= p.radius + CONFIG.arrivalClearance) {
					u.phase = 'orbit';
					u.age = 0;
					continue;
				}
				if (fighting.has(entity.id)) continue;
				const reach = p.radius + CONFIG.arrivalClearance;
				const speed = CONFIG.travelSpeed * (u.kind === 'transport' ? 0.5 : 1);
				const travel = Math.min(distance, speed * dt);
				u.x += (dx / distance) * travel;
				u.y += (dy / distance) * travel;
				syncUnitPosition(ecs, entity.id, u.x, u.y);
				if (distance - travel <= reach) {
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
					entity.components.unit.phase === 'orbit' &&
					entity.components.unit.hp > 0
				)
					ecs.commands.removeComponent(entity.id, 'circleCollider');
			},
		);
};
