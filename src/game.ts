import ECSpresso, { defineSystemRef } from 'ecspresso';
import { CONFIG } from './config';
import type {
	DispatchFilter,
	Owner,
	Production,
	Scenario,
	Side,
} from './config';

export interface Planet {
	name: string;
	x: number;
	y: number;
	radius: number;
	owner: Owner;
	troops: number;
	guns: number;
	rate: number;
	production: Production;
	progress: number;
}
export interface Unit {
	owner: Side;
	kind: 'ship' | 'transport';
	x: number;
	y: number;
	target: number;
	phase: 'travel' | 'orbit';
	hp: number;
	cargo: number;
	age: number;
}
export interface Notice {
	text: string;
	time: number;
	side: Owner;
}
export interface Engagement {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	owner: Side;
}
interface Match {
	time: number;
	paused: boolean;
	winner: Side | null;
	ai: boolean;
	aiClock: number;
	orders: number;
	captures: number;
	transportsLost: number;
	troopsLost: number;
	firstCapture: number | null;
	notices: Notice[];
	engagements: Engagement[];
}
const makeWorld = function () {
	const match: Match = {
		time: 0,
		paused: false,
		winner: null,
		ai: true,
		aiClock: 0,
		orders: 0,
		captures: 0,
		transportsLost: 0,
		troopsLost: 0,
		firstCapture: null,
		notices: [],
		engagements: [],
	};
	return ECSpresso.create()
		.withComponentTypes<{ planet: Planet; unit: Unit }>()
		.withResource('match', match)
		.withFixedTimestep(CONFIG.step)
		.build();
};
export type Game = ReturnType<typeof makeWorld>;
export const planets = function (world: Game) {
	return world.getEntitiesWithQuery(['planet']);
};
export const units = function (world: Game) {
	return world.getEntitiesWithQuery(['unit']);
};
export const orbitalUnits = function (
	world: Game,
	planetId: number,
	side?: Side,
) {
	return units(world).filter(function ({ components: { unit } }) {
		return (
			unit.target === planetId &&
			unit.phase === 'orbit' &&
			unit.hp > 0 &&
			(!side || unit.owner === side)
		);
	});
};
export const shipsAt = function (world: Game, planetId: number, side: Side) {
	return orbitalUnits(world, planetId, side).filter(function (entity) {
		return entity.components.unit.kind === 'ship';
	});
};
export const unitPoint = function (
	unit: Unit,
	planet: Planet,
	time: number,
	id: number,
) {
	if (unit.phase !== 'orbit') {
		return {
			x: unit.x,
			y: unit.y,
			angle: Math.atan2(planet.y - unit.y, planet.x - unit.x),
		};
	}
	const orbitAngle =
		time * (unit.owner === 'blue' ? 0.45 : -0.45) + id * 2.399;
	const reach = planet.radius + (unit.kind === 'ship' ? 20 : 32);
	return {
		x: planet.x + Math.cos(orbitAngle) * reach,
		y: planet.y + Math.sin(orbitAngle) * reach,
		angle: orbitAngle + Math.PI / 2,
	};
};
export const opponent = function (side: Side): Side {
	return side === 'blue' ? 'red' : 'blue';
};
export const isBlockaded = function (world: Game, planetId: number) {
	const planet = world.getComponent(planetId, 'planet');
	if (!planet || planet.owner === 'neutral') return false;
	return (
		shipsAt(world, planetId, opponent(planet.owner)).length > 0 &&
		shipsAt(world, planetId, planet.owner).length === 0 &&
		planet.guns <= 0
	);
};
export const notify = function (
	world: Game,
	text: string,
	side: Owner = 'neutral',
) {
	const match = world.getResource('match');
	match.notices = [{ text, time: match.time, side }, ...match.notices].slice(
		0,
		5,
	);
};
export const spawnShip = function (world: Game, planetId: number, owner: Side) {
	const p = world.getComponent(planetId, 'planet');
	if (!p) return;
	return world.spawn({
		unit: {
			owner,
			kind: 'ship',
			x: p.x,
			y: p.y,
			target: planetId,
			phase: 'orbit',
			hp: CONFIG.shipHealth,
			cargo: 0,
			age: 0,
		},
	});
};
export const setProduction = function (
	world: Game,
	ids: readonly number[],
	production: Production,
	side: Side = 'blue',
) {
	for (const id of ids) {
		const p = world.getComponent(id, 'planet');
		if (!p || p.owner !== side || p.production === production) continue;
		p.production = production;
		p.progress = 0;
	}
};
export const dispatch = function (
	world: Game,
	sources: readonly number[],
	target: number,
	fraction: number,
	filter: DispatchFilter = 'combined',
	side: Side = 'blue',
) {
	const match = world.getResource('match');
	if (
		match.winner ||
		!Number.isFinite(fraction) ||
		fraction <= 0 ||
		fraction > 1 ||
		!world.getComponent(target, 'planet')
	)
		return 0;
	let sent = 0;
	for (const id of new Set(sources)) {
		const p = world.getComponent(id, 'planet');
		if (!p || id === target) continue;
		if (p.owner === side && isBlockaded(world, id)) {
			if (side === 'blue')
				notify(world, `${p.name}: blockade prevents departure`, side);
			continue;
		}
		const available = shipsAt(world, id, side);
		if (filter !== 'troops') {
			for (const entity of available.slice(
				0,
				Math.ceil(available.length * fraction),
			)) {
				Object.assign(entity.components.unit, {
					target,
					phase: 'travel',
					age: 0,
					x: p.x + Math.cos(entity.id * 2.399) * 16,
					y: p.y + Math.sin(entity.id * 2.399) * 16,
				});
				sent++;
			}
		}
		if (p.owner !== side || filter === 'ships') continue;
		let cargo = Math.floor(p.troops * fraction);
		p.troops -= cargo;
		while (cargo > 0) {
			const count = Math.min(cargo, CONFIG.dropshipCapacity);
			world.spawn({
				unit: {
					owner: side,
					kind: 'transport',
					x: p.x + Math.cos(sent * 2.399) * 16,
					y: p.y + Math.sin(sent * 2.399) * 16,
					target,
					phase: 'travel',
					hp: CONFIG.transportHealth,
					cargo: count,
					age: 0,
				},
			});
			cargo -= count;
			sent++;
		}
	}
	if (sent > 0 && side === 'blue') match.orders++;
	return sent;
};

type UnitEntity = ReturnType<typeof units>[number];

const arrivalReach = function (planet: Planet) {
	return planet.radius + CONFIG.arrivalClearance;
};
const hurt = function (
	world: Game,
	entity: UnitEntity,
	damage: number,
	lost: Set<number>,
) {
	const unit = entity.components.unit;
	if (damage <= 0 || unit.hp <= 0) return damage;
	const taken = Math.min(unit.hp, damage);
	unit.hp -= taken;
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
// A defender already shooting in orbit spends that damage there. Envelope fire and
// passing fire share whatever is left, so one ship is not applied twice.
const orbitBusy = function (world: Game, planetId: number, side: Side) {
	const planet = world.getComponent(planetId, 'planet');
	if (!planet) return false;
	const enemy = opponent(side);
	if (shipsAt(world, planetId, enemy).length > 0) return true;
	if (planet.owner === enemy && planet.guns > 0) return true;
	return orbitalUnits(world, planetId, enemy).some(function (entity) {
		const unit = entity.components.unit;
		return unit.kind === 'transport' && unit.age >= CONFIG.arrivalGrace;
	});
};
const pointOf = function (world: Game, entity: UnitEntity, time: number) {
	const unit = entity.components.unit;
	const planet = world.getComponent(unit.target, 'planet');
	if (!planet) return { x: unit.x, y: unit.y };
	return unitPoint(unit, planet, time, entity.id);
};
const damageOrbit = function (
	world: Game,
	id: number,
	side: Side,
	damage: number,
	lost: Set<number>,
) {
	const planet = world.getComponent(id, 'planet');
	if (!planet || damage <= 0) return;
	// Ships absorb fire before fixed defenses and exposed transports.
	const targets = orbitalUnits(world, id, side);
	for (const entity of targets.filter(function (entry) {
		return entry.components.unit.kind === 'ship';
	}))
		damage = hurt(world, entity, damage, lost);
	if (planet.owner === side && planet.guns > 0) {
		const taken = Math.min(planet.guns * CONFIG.gunHealth, damage);
		planet.guns = Math.max(0, planet.guns - taken / CONFIG.gunHealth);
		damage -= taken;
	}
	for (const entity of targets.filter(function (entry) {
		return (
			entry.components.unit.kind === 'transport' &&
			entry.components.unit.age >= CONFIG.arrivalGrace
		);
	}))
		damage = hurt(world, entity, damage, lost);
};
const travelersInside = function (
	world: Game,
	planet: Planet,
	side: Side,
) {
	const reach = arrivalReach(planet);
	return units(world).filter(function (entity) {
		const unit = entity.components.unit;
		return (
			unit.owner === side &&
			unit.phase === 'travel' &&
			unit.hp > 0 &&
			Math.hypot(unit.x - planet.x, unit.y - planet.y) <= reach
		);
	});
};
const absorbTravelers = function (
	world: Game,
	targets: readonly UnitEntity[],
	damage: number,
	lost: Set<number>,
) {
	const hit: UnitEntity[] = [];
	for (const kind of ['ship', 'transport'] as const) {
		for (const entity of targets) {
			if (damage <= 0) return hit;
			if (entity.components.unit.kind !== kind) continue;
			const before = entity.components.unit.hp;
			damage = hurt(world, entity, damage, lost);
			if (entity.components.unit.hp < before) hit.push(entity);
		}
	}
	return hit;
};
const recordHits = function (
	world: Game,
	shots: Engagement[],
	from: { x: number; y: number },
	targets: readonly UnitEntity[],
	owner: Side,
	time: number,
) {
	for (const target of targets)
		shots.push({
			x1: from.x,
			y1: from.y,
			x2: pointOf(world, target, time).x,
			y2: pointOf(world, target, time).y,
			owner,
		});
};
const fireEnvelope = function (
	world: Game,
	planetId: number,
	planet: Planet,
	side: Side,
	spent: Set<number>,
	gunsSpent: Set<number>,
	lost: Set<number>,
	shots: Engagement[],
	time: number,
	dt: number,
) {
	const garrison = shipsAt(world, planetId, side).filter(function (entity) {
		return !spent.has(entity.id);
	});
	const guns =
		planet.owner === side && !gunsSpent.has(planetId) ? planet.guns : 0;
	if (garrison.length === 0 && guns <= 0) return;
	const incoming = travelersInside(world, planet, opponent(side));
	if (incoming.length === 0) return;
	const hit = absorbTravelers(
		world,
		incoming,
		(garrison.length * CONFIG.shipDamage + guns * CONFIG.gunDamage) * dt,
		lost,
	);
	for (const ship of garrison) spent.add(ship.id);
	if (guns > 0) gunsSpent.add(planetId);
	for (const ship of garrison)
		recordHits(world, shots, pointOf(world, ship, time), hit, side, time);
	if (guns > 0) recordHits(world, shots, planet, hit, side, time);
};
const preferTarget = function (
	current: { entity: UnitEntity; dist: number } | undefined,
	next: { entity: UnitEntity; dist: number },
) {
	if (!current) return next;
	const currentShip = current.entity.components.unit.kind === 'ship';
	const nextShip = next.entity.components.unit.kind === 'ship';
	if (currentShip !== nextShip) return nextShip ? next : current;
	if (next.dist < current.dist) return next;
	if (next.dist === current.dist && next.entity.id < current.entity.id)
		return next;
	return current;
};
const firePasses = function (
	world: Game,
	spent: Set<number>,
	lost: Set<number>,
	shots: Engagement[],
	time: number,
	dt: number,
) {
	const shooters = units(world)
		.filter(function (entity) {
			const unit = entity.components.unit;
			return unit.kind === 'ship' && unit.hp > 0 && !spent.has(entity.id);
		})
		.sort(function (a, b) {
			return a.id - b.id;
		});
	const volley: {
		target: UnitEntity;
		damage: number;
		from: { x: number; y: number };
		to: { x: number; y: number };
		owner: Side;
	}[] = [];
	for (const shooter of shooters) {
		const from = pointOf(world, shooter, time);
		const origin = shooter.components.unit;
		let best: { entity: UnitEntity; dist: number } | undefined;
		for (const target of units(world)) {
			const unit = target.components.unit;
			if (
				target.id === shooter.id ||
				unit.hp <= 0 ||
				unit.owner === origin.owner
			)
				continue;
			if (
				origin.phase === 'orbit' &&
				unit.phase === 'orbit' &&
				origin.target === unit.target
			)
				continue;
			// Arrival grace belongs to orbit combat. Passing fire must not skip it.
			if (
				unit.phase === 'orbit' &&
				unit.kind === 'transport' &&
				unit.age < CONFIG.arrivalGrace
			)
				continue;
			const to = pointOf(world, target, time);
			const dist = Math.hypot(from.x - to.x, from.y - to.y);
			if (dist > CONFIG.engagementRange) continue;
			best = preferTarget(best, { entity: target, dist });
		}
		if (!best) continue;
		const to = pointOf(world, best.entity, time);
		volley.push({
			target: best.entity,
			damage: CONFIG.shipDamage * dt,
			from,
			to,
			owner: origin.owner,
		});
	}
	for (const shot of volley) {
		const before = shot.target.components.unit.hp;
		hurt(world, shot.target, shot.damage, lost);
		if (shot.target.components.unit.hp < before)
			shots.push({
				x1: shot.from.x,
				y1: shot.from.y,
				x2: shot.to.x,
				y2: shot.to.y,
				owner: shot.owner,
			});
	}
};

const runAI = function (world: Game) {
	const all = planets(world);
	for (const source of all.filter(function (e) {
		return e.components.planet.owner === 'red';
	})) {
		const p = source.components.planet;
		const ships = shipsAt(world, source.id, 'red').length;
		const hostile = shipsAt(world, source.id, 'blue').length;
		if (isBlockaded(world, source.id)) {
			setProduction(world, [source.id], 'ships', 'red');
			continue;
		}
		const target = all
			.filter(function (e) {
				return (
					e.components.planet.owner !== 'red' &&
					!units(world).some(function (u) {
						return (
							u.components.unit.owner === 'red' &&
							u.components.unit.kind === 'transport' &&
							u.components.unit.target === e.id
						);
					})
				);
			})
			.sort(function (a, b) {
				const score = function (e: typeof a) {
					const t = e.components.planet;
					return (
						Math.hypot(p.x - t.x, p.y - t.y) +
						t.troops * 5 +
						(t.owner === 'blue' ? 70 : 0)
					);
				};
				return score(a) - score(b);
			})[0];
		if (!target) continue;
		const t = target.components.planet;
		const resistance = t.guns + shipsAt(world, target.id, 'blue').length;
		const desiredShips = Math.max(4, Math.ceil(resistance * 1.8) + 2);
		setProduction(
			world,
			[source.id],
			hostile > 0 || (p.troops >= 24 && ships < desiredShips)
				? 'ships'
				: 'troops',
			'red',
		);
		if (
			p.troops > t.troops + 10 &&
			(resistance === 0 || Math.ceil(ships * 0.75) > resistance * 1.4)
		) {
			dispatch(world, [source.id], target.id, 0.75, 'combined', 'red');
		} else if (ships >= Math.max(5, desiredShips))
			dispatch(world, [source.id], target.id, 0.75, 'ships', 'red');
	}
	// Redirect surviving blockaders when their planet becomes friendly; otherwise send invasions to them.
	for (const source of all.filter(function (e) {
		return (
			e.components.planet.owner !== 'red' &&
			shipsAt(world, e.id, 'red').length > 0
		);
	})) {
		const target = all.find(function (e) {
			return (
				e.components.planet.owner === 'red' &&
				e.components.planet.troops > source.components.planet.troops + 10 &&
				!isBlockaded(world, e.id)
			);
		});
		if (target) dispatch(world, [target.id], source.id, 0.75, 'troops', 'red');
	}
};

export const createGame = async function (scenario: Scenario = 'skirmish') {
	const world = makeWorld();
	const economy = defineSystemRef('economy');
	const movement = defineSystemRef('movement');
	const combat = defineSystemRef('combat');
	const active = function () {
		const m = world.getResource('match');
		return !m.paused && !m.winner;
	};
	world
		.addSystem('production')
		.inPhase('fixedUpdate')
		.withRef(economy)
		.addQuery('planets', { with: ['planet'], mutates: ['planet'] })
		.withResources(['match'])
		.setProcess(function ({ queries, dt, ecs, resources: { match } }) {
			if (!active()) return;
			match.time += dt;
			for (const {
				id,
				components: { planet: p },
			} of queries.planets) {
				if (p.owner === 'neutral') continue;
				p.progress +=
					p.rate * CONFIG.productionRateMultiplier * dt;
				const cost = CONFIG.cost[p.production];
				while (p.progress >= cost) {
					p.progress -= cost;
					if (p.production === 'troops') p.troops++;
					else if (p.production === 'guns') p.guns++;
					else spawnShip(ecs, id, p.owner);
				}
			}
		});
	world
		.addSystem('travel')
		.inPhase('fixedUpdate')
		.withRef(movement)
		.after(economy)
		.setProcessEach(
			{ with: ['unit'], mutates: ['unit'] },
			function ({ entity, dt, ecs }) {
				if (!active()) return false;
				const u = entity.components.unit;
				const p = ecs.getComponent(u.target, 'planet');
				if (!p) {
					ecs.commands.removeEntity(entity.id);
					return;
				}
				if (u.phase === 'orbit') {
					u.age += dt;
					return;
				}
				const dx = p.x - u.x,
					dy = p.y - u.y;
				const distance = Math.hypot(dx, dy);
				if (distance <= p.radius + CONFIG.arrivalClearance) {
					u.phase = 'orbit';
					u.age = 0;
					return;
				}
				const travel = Math.min(distance, CONFIG.travelSpeed * dt);
				u.x += (dx / distance) * travel;
				u.y += (dy / distance) * travel;
			},
		);
	world
		.addSystem('orbital-combat-and-landing')
		.inPhase('fixedUpdate')
		.withRef(combat)
		.after(movement)
		.addQuery('planets', { with: ['planet'], mutates: ['planet'] })
		.setProcess(function ({ queries, dt, ecs }) {
			if (!active()) return;
			const match = ecs.getResource('match');
			const shots: Engagement[] = [];
			const lost = new Set<number>();
			const spent = new Set<number>();
			const gunsSpent = new Set<number>();
			for (const {
				id,
				components: { planet: p },
			} of queries.planets) {
				if (orbitBusy(ecs, id, 'blue'))
					for (const ship of shipsAt(ecs, id, 'blue')) spent.add(ship.id);
				if (orbitBusy(ecs, id, 'red'))
					for (const ship of shipsAt(ecs, id, 'red')) spent.add(ship.id);
				if (p.owner !== 'neutral' && orbitBusy(ecs, id, p.owner))
					gunsSpent.add(id);
				const blueDamage =
					shipsAt(ecs, id, 'blue').length * CONFIG.shipDamage +
					(p.owner === 'blue' ? p.guns * CONFIG.gunDamage : 0);
				const redDamage =
					shipsAt(ecs, id, 'red').length * CONFIG.shipDamage +
					(p.owner === 'red' ? p.guns * CONFIG.gunDamage : 0);
				damageOrbit(ecs, id, 'blue', redDamage * dt, lost);
				damageOrbit(ecs, id, 'red', blueDamage * dt, lost);
			}
			for (const {
				id,
				components: { planet: p },
			} of queries.planets) {
				fireEnvelope(
					ecs,
					id,
					p,
					'blue',
					spent,
					gunsSpent,
					lost,
					shots,
					match.time,
					dt,
				);
				fireEnvelope(
					ecs,
					id,
					p,
					'red',
					spent,
					gunsSpent,
					lost,
					shots,
					match.time,
					dt,
				);
			}
			firePasses(ecs, spent, lost, shots, match.time, dt);
			match.engagements = shots;
			for (const {
				id,
				components: { planet: p },
			} of queries.planets) {
				for (const {
					id: unitId,
					components: { unit: u },
				} of orbitalUnits(ecs, id)) {
					if (u.kind !== 'transport') continue;
					const enemy = opponent(u.owner);
					if (
						shipsAt(ecs, id, enemy).length > 0 ||
						(p.owner === enemy && p.guns > 0)
					)
						continue;
					if (p.owner === u.owner) p.troops += u.cargo;
					else if (u.cargo > p.troops) {
						p.troops = u.cargo - p.troops;
						p.owner = u.owner;
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
			for (const entity of units(ecs))
				if (entity.components.unit.hp <= 0)
					ecs.commands.removeEntity(entity.id);
		});
	world
		.addSystem('strategy-and-victory')
		.inPhase('fixedUpdate')
		.after(combat)
		.withResources(['match'])
		.setProcess(function ({ ecs, dt, resources: { match } }) {
			if (!active()) return;
			const owners = new Set(
				planets(ecs).map(function (e) {
					return e.components.planet.owner;
				}),
			);
			if (!owners.has('red')) match.winner = 'blue';
			else if (!owners.has('blue')) match.winner = 'red';
			match.aiClock += dt;
			if (match.ai && match.aiClock >= CONFIG.aiInterval) {
				match.aiClock = 0;
				runAI(ecs);
			}
		});
	await world.initialize();
	const layout: readonly [
		string,
		number,
		number,
		number,
		Owner,
		number,
		number,
	][] = [
		['Polaris', 234, 180, 25, 'neutral', 8, 1.7],
		['Vega', 521, 198, 31, 'red', 44, 2.6],
		['Altair', 942, 165, 25, 'neutral', 8, 1.7],
		['Rhea', 277, 414, 25, 'neutral', 8, 1.7],
		['Deneb', 668, 418, 28, 'neutral', 14, 2.2],
		['Io', 930, 389, 25, 'neutral', 8, 1.7],
		['Nyx', 98, 600, 28, 'neutral', 14, 2.2],
		['Sol', 514, 570, 36, 'neutral', 24, 3.4],
		['Eris', 1077, 617, 28, 'neutral', 14, 2.2],
		['Tethys', 214, 801, 28, 'neutral', 14, 2.2],
		['Atlas', 535, 831, 36, 'neutral', 24, 3.4],
		['Dione', 1084, 841, 28, 'neutral', 14, 2.2],
		['Luna', 337, 991, 25, 'neutral', 8, 1.7],
		['Astra', 638, 1032, 28, 'neutral', 14, 2.2],
		['Ceres', 866, 1024, 25, 'neutral', 8, 1.7],
		['Mira', 244, 1192, 25, 'neutral', 8, 1.7],
		['Terra', 532, 1229, 31, 'blue', 44, 2.6],
		['Lyra', 1069, 1186, 25, 'neutral', 8, 1.7],
	];
	for (const [name, x, y, radius, owner, troops, rate] of layout) {
		const p = world.spawn({
			planet: {
				name,
				x,
				y,
				radius,
				owner,
				troops,
				rate,
				guns: 0,
				production: 'troops',
				progress: 0,
			},
		});
		if (owner !== 'neutral')
			for (let n = 0; n < 3; n++) spawnShip(world, p.id, owner);
	}
	if (scenario !== 'skirmish') {
		world.getResource('match').ai = false;
		const sol = planets(world).find(function (e) {
			return e.components.planet.name === 'Sol';
		});
		if (sol) {
			sol.components.planet.owner = 'red';
			sol.components.planet.troops = 18;
			sol.components.planet.production = 'troops';
			if (scenario === 'blockade') {
				for (let n = 0; n < 4; n++) spawnShip(world, sol.id, 'blue');
				notify(
					world,
					'Sol: your ships hold orbit; land troops to take the surface',
					'blue',
				);
			} else {
				sol.components.planet.guns = 2;
				spawnShip(world, sol.id, 'red');
				const terra = planets(world).find(function (e) {
					return e.components.planet.name === 'Terra';
				});
				if (terra)
					for (let n = 0; n < 5; n++) spawnShip(world, terra.id, 'blue');
				notify(
					world,
					'Sol is defended: compare troops alone with an escorted invasion',
					'neutral',
				);
			}
		}
	}
	return world;
};
