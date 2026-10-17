import ECSpresso, {
	defineSystemRef,
	type FilteredEntity,
	type WithComponents,
	type WithResources,
} from 'ecspresso';
import {
	createSpatialIndexPlugin,
	spatialIndexSystems,
} from 'ecspresso/plugins/spatial/spatial-index';
import { CONFIG } from './config';
import { runAI } from './ai';
import { initializeLabScenario, seedFreshGame } from './game-scenario';
import { LAB_MAP } from './maps';
import type { StarMap } from './maps';
import type {
	DispatchFilter,
	Owner,
	Production,
	Scenario,
	Side,
} from './config';
import type { GameSnapshot } from './save-state';

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
export interface Departure {
	unitId: number;
	source: number;
	x: number;
	y: number;
	age: number;
}
export interface Order {
	id: number;
	owner: Side;
	target: number;
	state: 'pending' | 'outbound' | 'returning';
	departures: Departure[];
}
export interface OrderBook {
	nextId: number;
	active: Order[];
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
export interface Match {
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
const economySystem = defineSystemRef('economy');
const movementSystem = defineSystemRef('movement');
const combatSystem = defineSystemRef('combat');
const strategySystem = defineSystemRef('strategy');
const spatialIndexPlugin = createSpatialIndexPlugin({
	cellSize: 64,
	phases: ['fixedUpdate'],
	ordering: { fixedUpdate: { after: [economySystem], before: [movementSystem] } },
});
type SpatialIndexConfig = NonNullable<typeof spatialIndexPlugin['_cfg']>;
type GameConfig = WithResources<
	WithComponents<SpatialIndexConfig, { planet: Planet; unit: Unit }>,
	{ match: Match; orderBook: OrderBook }
>;
export type Game = ECSpresso<GameConfig>;
type PlanetEntity = FilteredEntity<GameConfig['components'], 'planet'>;
type UnitEntity = FilteredEntity<GameConfig['components'], 'unit'>;
type UnitPoint = { x: number; y: number; angle: number };
type LocalTransform = GameConfig['components']['localTransform'];

const localTransformAt = function (x: number, y: number): LocalTransform {
	return { x, y, rotation: 0, scaleX: 1, scaleY: 1 };
};
const syncUnitPosition = function (
	world: Game,
	unitId: number,
	x: number,
	y: number,
): void {
	const localTransform = world.getComponent(unitId, 'localTransform');
	if (localTransform) {
		localTransform.x = x;
		localTransform.y = y;
		return;
	}
	world.addComponent(unitId, 'localTransform', localTransformAt(x, y));
};
const makeWorld = function (): Game {
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
	const orderBook: OrderBook = { nextId: 1, active: [] };
	return ECSpresso.create()
		.withPlugin(spatialIndexPlugin)
		.withComponentTypes<{ planet: Planet; unit: Unit }>()
		.withResource('match', match)
		.withResource('orderBook', orderBook)
		.withFixedTimestep(CONFIG.step)
		.build();
};
const restoreSnapshot = function (world: Game, snapshot: GameSnapshot): void {
	const planetIds = new Map<number, number>();
	const entityIds = new Map<number, number>();
	for (const saved of snapshot.planets) {
		const restored = world.spawn({ planet: structuredClone(saved.planet) });
		planetIds.set(saved.id, restored.id);
		entityIds.set(saved.id, restored.id);
	}
	for (const saved of snapshot.units) {
		const target = planetIds.get(saved.unit.target);
		if (target === undefined) throw new Error('Saved unit target is missing');
		const unit = structuredClone(saved.unit);
		unit.target = target;
		const restored = world.spawn({
			unit,
			localTransform: localTransformAt(unit.x, unit.y),
			...(unit.phase === 'travel' ? { circleCollider: { radius: 0 } } : {}),
		});
		entityIds.set(saved.id, restored.id);
	}
	const match = world.getResource('match');
	Object.assign(match, structuredClone(snapshot.match), {
		paused: true,
		engagements: [],
	});
	const orderBook = world.getResource('orderBook');
	orderBook.nextId = snapshot.orderBook.nextId;
	orderBook.active = snapshot.orderBook.active.map(function (savedOrder) {
		const target = planetIds.get(savedOrder.target);
		if (target === undefined) throw new Error('Saved order target is missing');
		return {
			...structuredClone(savedOrder),
			target,
			departures: savedOrder.departures.map(function (savedDeparture) {
				const source = planetIds.get(savedDeparture.source);
				const unitId = entityIds.get(savedDeparture.unitId);
				if (source === undefined || unitId === undefined)
					throw new Error('Saved order reference is missing');
				return { ...savedDeparture, source, unitId };
			}),
		};
	});
	// Rebuild the plugin's derived spatial data with gameplay paused.
	world.update(CONFIG.step);
};
export const planets = function (world: Game): PlanetEntity[] {
	return world.getEntitiesWithQuery(['planet']);
};
export const units = function (world: Game): UnitEntity[] {
	return world.getEntitiesWithQuery(['unit']);
};
export const orbitalUnits = function (
	world: Game,
	planetId: number,
	side?: Side,
): UnitEntity[] {
	return units(world).filter(function ({ components: { unit } }) {
		return (
			unit.target === planetId &&
			unit.phase === 'orbit' &&
			unit.hp > 0 &&
			(!side || unit.owner === side)
		);
	});
};
export const shipsAt = function (
	world: Game,
	planetId: number,
	side: Side,
): UnitEntity[] {
	return orbitalUnits(world, planetId, side).filter(function (entity) {
		return entity.components.unit.kind === 'ship';
	});
};
export const unitPoint = function (
	unit: Unit,
	planet: Planet,
	time: number,
	id: number,
): UnitPoint {
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
export const isBlockaded = function (world: Game, planetId: number): boolean {
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
): void {
	const match = world.getResource('match');
	match.notices = [{ text, time: match.time, side }, ...match.notices].slice(
		0,
		5,
	);
};
export const spawnShip = function (
	world: Game,
	planetId: number,
	owner: Side,
): UnitEntity | undefined {
	const p = world.getComponent(planetId, 'planet');
	if (!p) return;
	return world.spawn({
		localTransform: localTransformAt(p.x, p.y),
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
): void {
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
): number {
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
	const departures: Departure[] = [];
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
				const unit = entity.components.unit;
				departures.push({
					unitId: entity.id,
					source: id,
					x: unit.x,
					y: unit.y,
					age: unit.age,
				});
				// A redirected escort belongs only to its newest order.
				for (const order of world.getResource('orderBook').active)
					order.departures = order.departures.filter(function (departure) {
						return departure.unitId !== entity.id;
					});
				Object.assign(unit, {
					target,
					phase: 'travel',
					age: 0,
					x: p.x + Math.cos(entity.id * 2.399) * 16,
					y: p.y + Math.sin(entity.id * 2.399) * 16,
				});
				syncUnitPosition(world, entity.id, unit.x, unit.y);
				world.addComponent(entity.id, 'circleCollider', { radius: 0 });
				sent++;
			}
		}
		if (p.owner !== side || filter === 'ships') continue;
		let cargo = Math.floor(p.troops * fraction);
		p.troops -= cargo;
		while (cargo > 0) {
			const count = Math.min(cargo, CONFIG.dropshipCapacity);
			const transport = world.spawn({
				localTransform: localTransformAt(
					p.x + Math.cos(sent * 2.399) * 16,
					p.y + Math.sin(sent * 2.399) * 16,
				),
				circleCollider: { radius: 0 },
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
			departures.push({
				unitId: transport.id,
				source: id,
				x: p.x,
				y: p.y,
				age: 0,
			});
			cargo -= count;
			sent++;
		}
	}
	if (sent > 0) {
		const book = world.getResource('orderBook');
		book.active.push({
			id: book.nextId++,
			owner: side,
			target,
			state: match.paused ? 'pending' : 'outbound',
			departures,
		});
		if (side === 'blue') match.orders++;
	}
	pruneOrders(world);
	return sent;
};

// Completed ships remain part of an escorted order while transports are waiting
// to land. Once every surviving member has arrived, the order leaves the drawer.
export const orderUnits = function (world: Game, order: Order): UnitEntity[] {
	const departures = new Map(
		order.departures.map(function (departure) {
			return [departure.unitId, departure] as const;
		}),
	);
	return units(world).filter(function ({ id, components: { unit } }) {
		const departure = departures.get(id);
		if (!departure) return false;
		const target =
			order.state === 'returning' ? departure.source : order.target;
		return unit.hp > 0 && unit.owner === order.owner && unit.target === target;
	});
};
export const activeOrders = function (
	world: Game,
	planetIds: readonly number[] = [],
	side: Side = 'blue',
): Order[] {
	return world.getResource('orderBook').active.filter(function (order) {
		if (order.owner !== side) return false;
		const members = orderUnits(world, order);
		const active = members.some(function ({ components: { unit } }) {
			return unit.phase === 'travel' || unit.kind === 'transport';
		});
		return (
			active &&
			(planetIds.length === 0 ||
				planetIds.includes(order.target) ||
				order.departures.some(function (departure) {
					return planetIds.includes(departure.source);
				}))
		);
	});
};
const pruneOrders = function (world: Game): void {
	const book = world.getResource('orderBook');
	const live = new Set([
		...activeOrders(world),
		...activeOrders(world, [], 'red'),
	]);
	book.active = book.active.filter(function (order) {
		return live.has(order);
	});
};
export const cancelOrder = function (
	world: Game,
	orderId: number,
	side: Side = 'blue',
): boolean {
	if (world.getResource('match').winner) return false;
	const order = activeOrders(world, [], side).find(function (candidate) {
		return candidate.id === orderId;
	});
	if (!order || order.state === 'returning') return false;
	for (const entity of orderUnits(world, order)) {
		const departure = order.departures.find(function (entry) {
			return entry.unitId === entity.id;
		});
		if (!departure) continue;
		const unit = entity.components.unit;
		const source = world.getComponent(departure.source, 'planet');
		if (!source) continue;
		if (order.state === 'pending') {
			if (unit.kind === 'transport') {
				source.troops += unit.cargo;
				world.removeEntity(entity.id);
			} else {
				Object.assign(unit, {
					target: departure.source,
					phase: 'orbit',
					x: departure.x,
					y: departure.y,
					age: departure.age,
				});
				syncUnitPosition(world, entity.id, unit.x, unit.y);
				world.removeComponent(entity.id, 'circleCollider');
			}
		} else {
			// Orbit positions are rendered from time, rather than the stored arrival
			// coordinates. Start a recalled waiting transport/escort at that point.
			const destination = world.getComponent(unit.target, 'planet');
			if (!destination) continue;
			const point = unitPoint(
				unit,
				destination,
				world.getResource('match').time,
				entity.id,
			);
			Object.assign(unit, {
				target: departure.source,
				phase: 'travel',
				x: point.x,
				y: point.y,
				age: 0,
			});
			syncUnitPosition(world, entity.id, unit.x, unit.y);
			world.addComponent(entity.id, 'circleCollider', { radius: 0 });
		}
	}
	if (order.state === 'pending') {
		const book = world.getResource('orderBook');
		book.active = book.active.filter(function (candidate) {
			return candidate !== order;
		});
	} else order.state = 'returning';
	return true;
};

const hurt = function (
	world: Game,
	entity: UnitEntity,
	damage: number,
	lost: Set<number>,
): number {
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
const damageOrbit = function (
	world: Game,
	id: number,
	side: Side,
	damage: number,
	lost: Set<number>,
): void {
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
const planPasses = function (
	world: Game,
	dt: number,
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
				unit.owner === origin.owner
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
): void {
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

const aiDependencies = {
	dispatch,
	isBlockaded,
	planets,
	setProduction,
	shipsAt,
	units,
};

export const createGame = async function (
	scenario: Scenario = 'skirmish',
	map: StarMap = LAB_MAP,
	snapshot?: GameSnapshot,
): Promise<Game> {
	const world = makeWorld();
	const active = function (): boolean {
		const m = world.getResource('match');
		return !m.paused && !m.winner;
	};
	world
		.addSystem('production')
		.inPhase('fixedUpdate')
		.withRef(economySystem)
		.addQuery('planets', { with: ['planet'], mutates: ['planet'] })
		.withResources(['match', 'orderBook'])
		.setProcess(function ({ queries, dt, ecs, resources: { match, orderBook } }) {
			if (!active()) return;
			for (const order of orderBook.active)
				if (order.state === 'pending') order.state = 'outbound';
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
		.withRef(movementSystem)
		.after(spatialIndexSystems.rebuild.fixedUpdate)
		.addQuery('units', { with: ['unit'], mutates: ['unit'] })
		.setProcess(function ({ queries, dt, ecs }) {
			if (!active()) return;
			// Decide from one position snapshot so iteration order cannot release a ship.
			const fighting = new Set(planPasses(ecs, 0).map(function (shot) {
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
				const travel = Math.min(distance, CONFIG.travelSpeed * dt);
				u.x += (dx / distance) * travel;
				u.y += (dy / distance) * travel;
				syncUnitPosition(ecs, entity.id, u.x, u.y);
				if (distance - travel <= reach) {
					u.phase = 'orbit';
					u.age = 0;
				}
			}
		});
	world
		.addSystem('combat-and-landing')
		.inPhase('fixedUpdate')
		.withRef(combatSystem)
		.after(movementSystem)
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
				const blueDamage =
					shipsAt(ecs, id, 'blue').length * CONFIG.shipDamage +
					(p.owner === 'blue' ? p.guns * CONFIG.gunDamage : 0);
				const redDamage =
					shipsAt(ecs, id, 'red').length * CONFIG.shipDamage +
					(p.owner === 'red' ? p.guns * CONFIG.gunDamage : 0);
				damageOrbit(ecs, id, 'blue', redDamage * dt, lost);
				damageOrbit(ecs, id, 'red', blueDamage * dt, lost);
			}
			// The index holds pre-movement positions; include one step of target travel.
			const volley = planPasses(ecs, dt, CONFIG.travelSpeed * dt);
			applyPassVolley(ecs, volley, lost, shots);
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
		.withRef(strategySystem)
		.after(combatSystem)
		.withResources(['match'])
		.setProcess(function ({ ecs, dt, resources: { match } }) {
			if (!active()) return;
			pruneOrders(ecs);
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
				runAI(ecs, aiDependencies);
			}
		});
	world
		.addSystem('traveler-spatial-cleanup')
		.inPhase('fixedUpdate')
		.after(strategySystem)
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
	await world.initialize();
	if (snapshot) {
		restoreSnapshot(world, snapshot);
		return world;
	}
	seedFreshGame(world, map, spawnShip);
	initializeLabScenario(world, scenario, { notify, planets, spawnShip });
	return world;
};
