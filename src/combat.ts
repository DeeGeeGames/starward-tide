import type { SystemRegistrarOf } from 'ecspresso';
import { CONFIG, SIDES, isHostile } from './config';
import type { Side } from './config';
import type { Engagement, Game, GameOptions } from './game';
import { emitSound } from './sound-events';

// Return only scheduling capabilities so createGame owns the phase and edges.
type ScheduledSystem = Pick<
	ReturnType<SystemRegistrarOf<Game>['addSystem']>,
	'inPhase' | 'withRef' | 'after'
>;

type CombatDependencies = Pick<
	typeof import('./game'),
	'notify' | 'orbitalUnits' | 'shipsAt' | 'units'
>;
type UnitEntity = ReturnType<CombatDependencies['units']>[number];

const hurt = function (
	world: Game,
	entity: UnitEntity,
	damage: number,
	lost: Set<number>,
	notify: CombatDependencies['notify'],
): number {
	const unit = entity.components.unit;
	if (damage <= 0 || unit.hp <= 0) return damage;
	const taken = Math.min(unit.hp, damage);
	unit.hp -= taken;
	if (unit.hp <= 0) emitSound(world, 'explosion', unit);
	if (unit.hp <= 0 && unit.kind === 'transport' && !lost.has(entity.id)) {
		lost.add(entity.id);
		const match = world.getResource('match');
		match.transportsLost++;
		match.troopsLost += unit.cargo;
		const planet = world.getComponent(unit.target, 'planet');
		const place = planet ? planet.name : 'Transit';
		notify(
			world,
			`${place}: ${unit.cargo} ${unit.owner === 'blue' ? 'your' : 'enemy'} troops lost ${unit.phase === 'orbit' ? 'in orbit' : 'in transit'}`,
			unit.owner,
		);
	}
	return damage - taken;
};
const damageOrbit = function (
	world: Game,
	id: number,
	side: Side,
	damage: number,
	lost: Set<number>,
	{ notify, orbitalUnits }: CombatDependencies,
): void {
	const planet = world.getComponent(id, 'planet');
	if (!planet || damage <= 0) return;
	// Ships absorb fire before fixed defenses and exposed transports.
	const targets = orbitalUnits(world, id, side);
	for (const entity of targets.filter(function (entry) {
		return entry.components.unit.kind === 'ship';
	}))
		damage = hurt(world, entity, damage, lost, notify);
	if (planet.owner === side && planet.guns > 0) {
		const platforms = Math.ceil(planet.guns);
		const taken = Math.min(planet.guns * CONFIG.gunHealth, damage);
		planet.guns = Math.max(0, planet.guns - taken / CONFIG.gunHealth);
		if (platforms > Math.ceil(planet.guns)) emitSound(world, 'explosion', planet);
		damage -= taken;
	}
	for (const entity of targets.filter(function (entry) {
		return (
			entry.components.unit.kind === 'transport' &&
			entry.components.unit.age >= CONFIG.arrivalGrace
		);
	}))
		damage = hurt(world, entity, damage, lost, notify);
};
interface PassShot {
	shooterId: number;
	target: UnitEntity;
	damage: number;
	from: { x: number; y: number };
	to: { x: number; y: number };
	owner: Side;
}
type TargetCandidate = { entity: UnitEntity; dist: number };
const preferTarget = function (
	current: TargetCandidate | undefined,
	next: TargetCandidate,
): TargetCandidate {
	if (!current) return next;
	const currentShip = current.entity.components.unit.kind === 'ship';
	const nextShip = next.entity.components.unit.kind === 'ship';
	if (currentShip !== nextShip) return nextShip ? next : current;
	if (next.dist < current.dist) return next;
	if (next.dist === current.dist && next.entity.id < current.entity.id)
		return next;
	return current;
};
export const planPasses = function (
	world: Game,
	dt: number,
	units: CombatDependencies['units'],
	searchPadding = 0,
): PassShot[] {
	const travelers = units(world).filter(function (entity) {
		const unit = entity.components.unit;
		return unit.phase === 'travel' && unit.hp > 0;
	});
	const travelersById = new Map(
		travelers.map(function (entity) {
			return [entity.id, entity] as const;
		}),
	);
	const shooters = travelers
		.filter(function (entity) {
			return entity.components.unit.kind === 'ship';
		})
		.sort(function (a, b) {
			return a.id - b.id;
		});
	const spatialIndex = world.getResource('spatialIndex');
	const candidates: number[] = [];
	const volley: PassShot[] = [];
	for (const shooter of shooters) {
		const origin = shooter.components.unit;
		const from = { x: origin.x, y: origin.y };
		let best: { entity: UnitEntity; dist: number } | undefined;
		candidates.length = 0;
		spatialIndex.queryRadiusInto(
			from.x,
			from.y,
			CONFIG.engagementRange + searchPadding,
			candidates,
		);
		for (const targetId of candidates) {
			const target = travelersById.get(targetId);
			if (!target) continue;
			const unit = target.components.unit;
			if (
				target.id === shooter.id ||
				unit.hp <= 0 ||
				!isHostile(unit.owner, origin.owner)
			)
				continue;
			const dist = Math.hypot(from.x - unit.x, from.y - unit.y);
			if (dist > CONFIG.engagementRange) continue;
			best = preferTarget(best, { entity: target, dist });
		}
		if (!best) continue;
		const to = best.entity.components.unit;
		volley.push({
			shooterId: shooter.id,
			target: best.entity,
			damage: CONFIG.shipDamage * dt,
			from,
			to,
			owner: origin.owner,
		});
	}
	return volley;
};
const applyPassVolley = function (
	world: Game,
	volley: readonly PassShot[],
	lost: Set<number>,
	shots: Engagement[],
	notify: CombatDependencies['notify'],
): void {
	for (const shot of volley) {
		const before = shot.target.components.unit.hp;
		hurt(world, shot.target, shot.damage, lost, notify);
		if (shot.target.components.unit.hp < before) {
			emitSound(world, 'laser', shot.from);
			shots.push({
				x1: shot.from.x,
				y1: shot.from.y,
				x2: shot.to.x,
				y2: shot.to.y,
				owner: shot.owner,
			});
		}
	}
};

export const registerCombat = function (
	systems: SystemRegistrarOf<Game>,
	active: () => boolean,
	dependencies: CombatDependencies,
	onCapture?: GameOptions['onCapture'],
): ScheduledSystem {
	const { notify, orbitalUnits, shipsAt, units } = dependencies;
	return systems
		.addSystem('combat-and-landing')
		.addQuery('planets', { with: ['planet'], mutates: ['planet'] })
		.setProcess(function ({ queries, dt, ecs }) {
			if (!active()) return;
			const match = ecs.getResource('match');
			const shots: Engagement[] = [];
			const lost = new Set<number>();
			for (const {
				id,
				components: { planet: p },
			} of queries.planets) {
				const orbit = orbitalUnits(ecs, id);
				const forces = SIDES.map(function (side) {
					const present = orbit.some(function (entry) {
						return entry.components.unit.owner === side && entry.components.unit.hp > 0;
					}) || (p.owner === side && p.guns > 0);
					const damage = shipsAt(ecs, id, side).length * CONFIG.shipDamage +
						(p.owner === side ? p.guns * CONFIG.gunDamage : 0);
					return { side, present, damage };
				});
				// Snapshot all firepower before casualties; split it among enemies.
				for (const force of forces) {
					const targets = forces.filter(function (target) {
						return isHostile(force.side, target.side) && target.present;
					});
					for (const target of targets)
						damageOrbit(ecs, id, target.side, force.damage * dt / targets.length, lost, dependencies);
					if (force.damage > 0 && targets.length > 0) emitSound(ecs, 'laser', p);
				}
			}
			// The index holds pre-movement positions; include one step of target travel.
			const volley = planPasses(ecs, dt, units, CONFIG.travelSpeed * dt);
			applyPassVolley(ecs, volley, lost, shots, notify);
			match.engagements = shots;
			for (const {
				id,
				components: { planet: p },
			} of queries.planets) {
				for (const {
					id: unitId,
					components: { unit: u },
				} of orbitalUnits(ecs, id)) {
					if (u.kind !== 'transport' || u.hp <= 0) continue;
					const enemies = SIDES.filter(function (side) { return isHostile(u.owner, side); });
					if (
						enemies.some(function (side) { return shipsAt(ecs, id, side).length > 0; }) ||
						(isHostile(p.owner, u.owner) && p.guns > 0)
					)
						continue;
					if (p.owner === u.owner) p.troops += u.cargo;
					else if (u.cargo > p.troops) {
						const previousOwner = p.owner;
						p.troops = u.cargo - p.troops;
						p.owner = u.owner;
						if (u.owner === 'blue' || previousOwner === 'blue') emitSound(ecs, u.owner === 'blue' ? 'capture' : 'loss');
					if (p.carrier) {
						p.carrier.destination = null;
						delete p.carrier.bombardment;
						const transferred = new Set<number>();
						for (const entry of units(ecs)) {
							const stored = entry.components.unit;
							if (stored.target === id && stored.phase === 'docked') { stored.owner = u.owner; transferred.add(entry.id); }
						}
						const book = ecs.getResource('orderBook');
						for (const order of book.active) {
							order.departures = order.departures.filter(function (d) { return !transferred.has(d.unitId); });
							// Paused dispatch already reserves real units; detach old inventory control.
							if (order.owner === previousOwner && order.state === 'pending') order.departures = order.departures.filter(function (d) { return d.source !== id; });
						}
					}
						onCapture?.({ planetId: id, previousOwner, owner: u.owner }, ecs);
						p.progress = 0;
						p.production = 'troops';
						const match = ecs.getResource('match');
						match.captures++;
						if (u.owner === 'blue' && match.firstCapture === null)
							match.firstCapture = match.time;
						notify(ecs, `${p.name} captured`, u.owner);
					} else {
						p.troops -= u.cargo;
						notify(
							ecs,
							`${p.name}: ${u.cargo} troops met ground resistance`,
							u.owner,
						);
					}
					u.hp = 0;
					ecs.commands.removeEntity(unitId);
				}
			}
			// Resolve boarding first so a last-tick takeover cancels the shot.
			// Orbital resistance deliberately does not interrupt bombardment.
			for (const { components: { planet: p } } of queries.planets) {
				const carrier = p.carrier;
				const attack = carrier?.bombardment;
				if (!carrier || !attack) continue;
				const target = ecs.getComponent(attack.target, 'planet');
				if (!target || target.carrier || target.owner === p.owner ||
					(target.owner === 'neutral' && target.troops === 0)) {
					delete carrier.bombardment;
					carrier.destination = null;
					continue;
				}
				if (carrier.destination) continue;
				const reach = p.radius + target.radius + CONFIG.arrivalClearance;
				if (Math.abs(Math.hypot(p.x - target.x, p.y - target.y) - reach) > 0.01) {
					delete carrier.bombardment;
					continue;
				}
				if (attack.elapsed === 0) {
					notify(ecs, `${p.name} charging bombardment of ${target.name}: ${CONFIG.bombardmentCharge}s`, p.owner);
					emitSound(ecs, 'charge', p);
				}
				attack.elapsed += dt;
				if (attack.elapsed + 1e-9 < CONFIG.bombardmentCharge) continue;
				if (target.owner === 'blue') emitSound(ecs, 'loss');
				target.troops = 0;
				target.owner = 'neutral';
				target.progress = 0;
				target.production = 'troops';
				emitSound(ecs, 'bombard', target);
				ecs.markChanged(attack.target, 'planet');
				notify(ecs, `${target.name} bombarded: surface neutralized`, p.owner);
				delete carrier.bombardment;
			}
			// A shot may invalidate another carrier's target in this same step.
			for (const { components: { planet: p } } of queries.planets) {
				const attack = p.carrier?.bombardment;
				const target = attack ? ecs.getComponent(attack.target, 'planet') : undefined;
				if (p.carrier && attack && target && (target.owner === p.owner || (target.owner === 'neutral' && target.troops === 0))) {
					delete p.carrier.bombardment;
					p.carrier.destination = null;
				}
			}
			for (const { id, components: { planet: p } } of queries.planets) {
				if (!p.carrier || p.owner === 'neutral' || SIDES.some(function (side) { return isHostile(side, p.owner) && shipsAt(ecs, id, side).length > 0; })) continue;
				for (const entry of shipsAt(ecs, id, p.owner)) {
					entry.components.unit.phase = 'docked';
					entry.components.unit.x = p.x;
					entry.components.unit.y = p.y;
				}
			}
			for (const entity of units(ecs))
				if (entity.components.unit.hp <= 0)
					ecs.commands.removeEntity(entity.id);
		});
};
