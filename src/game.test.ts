import { expect, test } from 'bun:test';
import {
	activeOrders,
	cancelOrder,
	orderUnits,
	createGame,
	dispatch,
	isBlockaded,
	planets,
	setProduction,
	shipsAt,
	spawnShip,
	unitPoint,
	units,
} from './game';
import { CONFIG } from './config';
import { LAB_MAP, generateMap } from './maps';
import type { Side } from './config';
import type { Game, Unit } from './game';

type MatchSnapshot = Game['getResource'] extends (
	name: 'match',
) => infer Resource
	? Resource
	: never;
type GameSnapshot = {
	match: MatchSnapshot;
	planets: ReturnType<typeof planets>;
	units: ReturnType<typeof units>;
};
const snapshot = function (world: Game): GameSnapshot {
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

const quietWorld = async function (): Promise<Game> {
	const world = await createGame();
	world.getResource('match').ai = false;
	return world;
};
const named = function (
	world: Game,
	name: string,
): ReturnType<typeof planets>[number] {
	const found = planets(world).find(function (entity) {
		return entity.components.planet.name === name;
	});
	if (!found) throw new Error(`Missing ${name}`);
	return found;
};

test('generated maps seed their exact planets and starting fleets', async function () {
	const map = generateMap('small', 301);
	const world = await createGame('skirmish', map);
	try {
		expect(
			planets(world).map(function (entity) {
				return entity.components.planet;
			}),
		).toEqual(
			map.planets.map(function (
				[name, x, y, radius, owner, troops, rate],
			) {
				return {
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
				};
			}),
		);
		for (const { id, components: { planet } } of planets(world)) {
			const expectedShips = planet.owner === 'neutral' ? 0 : 3;
			const blueShips = shipsAt(world, id, 'blue');
			const redShips = shipsAt(world, id, 'red');
			expect(blueShips.length).toBe(planet.owner === 'blue' ? expectedShips : 0);
			expect(redShips.length).toBe(planet.owner === 'red' ? expectedShips : 0);
			for (const { components: { unit } } of [...blueShips, ...redShips]) {
				expect(unit).toMatchObject({
					kind: 'ship',
					phase: 'orbit',
					hp: CONFIG.shipHealth,
					cargo: 0,
					x: planet.x,
					y: planet.y,
				});
			}
		}
		expect(world.getResource('match')).toMatchObject({
			ai: true,
			aiClock: 0,
			notices: [],
		});
	} finally {
		await world.dispose();
	}
});

test('blockade lab scenario preserves its planet overrides, units, AI flag, and notice', async function () {
	const world = await createGame('blockade', LAB_MAP);
	try {
		const sol = named(world, 'Sol');
		expect(sol.components.planet).toMatchObject({
			owner: 'red',
			troops: 18,
			guns: 0,
			production: 'troops',
		});
		expect(shipsAt(world, sol.id, 'blue')).toHaveLength(4);
		expect(shipsAt(world, sol.id, 'red')).toHaveLength(0);
		expect(shipsAt(world, named(world, 'Terra').id, 'blue')).toHaveLength(3);
		expect(shipsAt(world, named(world, 'Vega').id, 'red')).toHaveLength(3);
		expect(world.getResource('match')).toMatchObject({
			ai: false,
			notices: [
				{
					text: 'Sol: your ships hold orbit; land troops to take the surface',
					time: 0,
					side: 'blue',
				},
			],
		});
	} finally {
		await world.dispose();
	}
});

test('invasion lab scenario preserves its defenses, escorts, AI flag, and notice', async function () {
	const world = await createGame('invasion', LAB_MAP);
	try {
		const sol = named(world, 'Sol');
		const terra = named(world, 'Terra');
		expect(sol.components.planet).toMatchObject({
			owner: 'red',
			troops: 18,
			guns: 2,
			production: 'troops',
		});
		expect(shipsAt(world, sol.id, 'red')).toHaveLength(1);
		expect(shipsAt(world, sol.id, 'blue')).toHaveLength(0);
		expect(shipsAt(world, terra.id, 'blue')).toHaveLength(8);
		expect(shipsAt(world, named(world, 'Vega').id, 'red')).toHaveLength(3);
		expect(world.getResource('match')).toMatchObject({
			ai: false,
			notices: [
				{
					text: 'Sol is defended: compare troops alone with an escorted invasion',
					time: 0,
					side: 'neutral',
				},
			],
		});
	} finally {
		await world.dispose();
	}
});

const clearUnits = function (world: Game): void {
	for (const entity of units(world)) world.removeEntity(entity.id);
};
const decideOnce = function (world: Game): void {
	world.getResource('match').aiClock = CONFIG.aiInterval - CONFIG.step;
	world.update(CONFIG.step);
};
const redCargoTo = function (world: Game, planetId: number): number {
	return units(world).reduce(function (sum, entity) {
		const unit = entity.components.unit;
		if (
			unit.owner !== 'red' ||
			unit.kind !== 'transport' ||
			unit.target !== planetId
		)
			return sum;
		return sum + unit.cargo;
	}, 0);
};
const redShipsBoundFor = function (world: Game, planetId: number): number {
	return units(world).filter(function (entity) {
		const unit = entity.components.unit;
		return (
			unit.owner === 'red' &&
			unit.kind === 'ship' &&
			unit.phase === 'travel' &&
			unit.target === planetId
		);
	}).length;
};

test('AI selects its lowest scoring target and dispatches at its configured interval', async function () {
	const map = {
		width: 300,
		height: 200,
		planets: [
			['Red', 25, 100, 20, 'red', 40, 0],
			['Neutral', 60, 100, 20, 'neutral', 5, 0],
			['Distant', 140, 100, 20, 'neutral', 8, 0],
			['Blue', 275, 100, 20, 'blue', 30, 0],
		],
	} as const;
	const world = await createGame('skirmish', map);
	try {
		const source = named(world, 'Red');
		const target = named(world, 'Neutral');
		step(world, Math.ceil(CONFIG.aiInterval / CONFIG.step));
		expect(source.components.planet.troops).toBe(40);
		expect(world.getResource('match').aiClock).toBeCloseTo(
			CONFIG.aiInterval,
			6,
		);
		expect(activeOrders(world, [], 'red')).toHaveLength(0);

		world.update(CONFIG.step);

		expect(world.getResource('match').aiClock).toBe(0);
		expect(source.components.planet).toMatchObject({
			troops: 10,
			production: 'ships',
		});
		expect(shipsAt(world, source.id, 'red')).toHaveLength(0);
		expect(
			units(world).filter(function ({ components: { unit } }) {
				return unit.target === target.id;
			}),
		).toHaveLength(6);
		expect(activeOrders(world, [], 'red')).toHaveLength(1);
	} finally {
		await world.dispose();
	}
});

test('AI sends enough troops to capture and does not launch a short invasion', async function () {
	const map = {
		width: 800,
		height: 400,
		planets: [
			['Vega', 100, 200, 31, 'red', 55, 0],
			['Terra', 700, 200, 31, 'blue', 44, 0],
		],
	} as const;
	const world = await createGame('skirmish', map);
	try {
		clearUnits(world);
		decideOnce(world);
		const vega = named(world, 'Vega');
		const sent = 55 - vega.components.planet.troops;
		expect(sent).toBeGreaterThan(44);
		expect(redCargoTo(world, named(world, 'Terra').id)).toBe(sent);
		step(world, Math.ceil(70 / CONFIG.step));
		expect(named(world, 'Terra').components.planet.owner).toBe('red');
		expect(named(world, 'Terra').components.planet.troops).toBeGreaterThan(0);
	} finally {
		await world.dispose();
	}
});

test('AI keeps a fleet at a world that is still fighting in orbit', async function () {
	const map = {
		width: 800,
		height: 300,
		planets: [
			['Vega', 80, 150, 31, 'red', 40, 0],
			['Neutral', 220, 150, 25, 'neutral', 5, 0],
			['Terra', 700, 150, 31, 'blue', 20, 0],
		],
	} as const;
	const world = await createGame('skirmish', map);
	try {
		clearUnits(world);
		const vega = named(world, 'Vega');
		for (let n = 0; n < 6; n++) spawnShip(world, vega.id, 'red');
		for (let n = 0; n < 6; n++) spawnShip(world, vega.id, 'blue');
		decideOnce(world);
		expect(shipsAt(world, vega.id, 'red')).toHaveLength(6);
		expect(vega.components.planet.troops).toBe(40);
		expect(redShipsBoundFor(world, named(world, 'Neutral').id)).toBe(0);
	} finally {
		await world.dispose();
	}
});

test('AI does not launch troops while defense platforms still hold the orbit', async function () {
	const map = {
		width: 800,
		height: 300,
		planets: [
			['Vega', 100, 150, 31, 'red', 80, 0],
			['Terra', 700, 150, 31, 'blue', 30, 0],
		],
	} as const;
	const world = await createGame('skirmish', map);
	try {
		clearUnits(world);
		const terra = named(world, 'Terra');
		terra.components.planet.guns = 4;
		spawnShip(world, terra.id, 'red');
		decideOnce(world);
		expect(named(world, 'Vega').components.planet.troops).toBe(80);
		expect(redCargoTo(world, terra.id)).toBe(0);
	} finally {
		await world.dispose();
	}
});

test('AI breaks a blockade when another world can outnumber it', async function () {
	const map = {
		width: 1200,
		height: 400,
		planets: [
			['Vega', 80, 200, 31, 'red', 10, 0],
			['Held', 450, 200, 28, 'red', 20, 0],
			['Terra', 1100, 200, 31, 'blue', 40, 0],
		],
	} as const;
	const world = await createGame('skirmish', map);
	try {
		clearUnits(world);
		const vega = named(world, 'Vega');
		const held = named(world, 'Held');
		for (let n = 0; n < 6; n++) spawnShip(world, vega.id, 'red');
		spawnShip(world, held.id, 'blue');
		spawnShip(world, held.id, 'blue');
		decideOnce(world);
		expect(redShipsBoundFor(world, held.id)).toBe(3);
		expect(shipsAt(world, vega.id, 'red')).toHaveLength(3);
		expect(isBlockaded(world, held.id)).toBe(true);
	} finally {
		await world.dispose();
	}
});

test('AI withholds a relief fleet that cannot outnumber the blockade', async function () {
	const map = {
		width: 1200,
		height: 400,
		planets: [
			['Vega', 80, 200, 31, 'red', 10, 0],
			['Held', 450, 200, 28, 'red', 20, 0],
			['Terra', 1100, 200, 31, 'blue', 40, 0],
		],
	} as const;
	const world = await createGame('skirmish', map);
	try {
		clearUnits(world);
		const vega = named(world, 'Vega');
		const held = named(world, 'Held');
		for (let n = 0; n < 2; n++) spawnShip(world, vega.id, 'red');
		for (let n = 0; n < 4; n++) spawnShip(world, held.id, 'blue');
		decideOnce(world);
		expect(redShipsBoundFor(world, held.id)).toBe(0);
		expect(shipsAt(world, vega.id, 'red')).toHaveLength(2);
	} finally {
		await world.dispose();
	}
});

test('AI does not pull ships off a world that is fighting to relieve another', async function () {
	const map = {
		width: 1200,
		height: 400,
		planets: [
			['Vega', 80, 200, 31, 'red', 10, 0],
			['Held', 450, 200, 28, 'red', 20, 0],
			['Terra', 1100, 200, 31, 'blue', 40, 0],
		],
	} as const;
	const world = await createGame('skirmish', map);
	try {
		clearUnits(world);
		const vega = named(world, 'Vega');
		const held = named(world, 'Held');
		for (let n = 0; n < 6; n++) spawnShip(world, vega.id, 'red');
		for (let n = 0; n < 6; n++) spawnShip(world, vega.id, 'blue');
		spawnShip(world, held.id, 'blue');
		spawnShip(world, held.id, 'blue');
		decideOnce(world);
		expect(redShipsBoundFor(world, held.id)).toBe(0);
		expect(shipsAt(world, vega.id, 'red')).toHaveLength(6);
	} finally {
		await world.dispose();
	}
});

test('AI leaves other worlds at home when one reserve already covers the garrison', async function () {
	const map = {
		width: 1000,
		height: 300,
		planets: [
			['Near', 400, 150, 28, 'red', 30, 0],
			['Far', 80, 150, 28, 'red', 30, 0],
			['Terra', 700, 150, 31, 'blue', 10, 0],
		],
	} as const;
	const world = await createGame('skirmish', map);
	try {
		clearUnits(world);
		spawnShip(world, named(world, 'Terra').id, 'red');
		decideOnce(world);
		expect(redCargoTo(world, named(world, 'Terra').id)).toBe(22);
		expect(named(world, 'Near').components.planet.troops).toBe(8);
		expect(named(world, 'Far').components.planet.troops).toBe(30);
	} finally {
		await world.dispose();
	}
});

test('AI pools troops from several worlds when no single reserve can capture', async function () {
	const map = {
		width: 1000,
		height: 300,
		planets: [
			['Near', 400, 150, 28, 'red', 20, 0],
			['Far', 80, 150, 28, 'red', 20, 0],
			['Terra', 700, 150, 31, 'blue', 30, 0],
		],
	} as const;
	const world = await createGame('skirmish', map);
	try {
		clearUnits(world);
		const terra = named(world, 'Terra');
		spawnShip(world, terra.id, 'red');
		decideOnce(world);
		expect(redCargoTo(world, terra.id)).toBe(35);
		expect(named(world, 'Near').components.planet.troops).toBe(0);
		expect(named(world, 'Far').components.planet.troops).toBe(5);
	} finally {
		await world.dispose();
	}
});

test('AI does not send a second landing wave while the first already exceeds the garrison', async function () {
	const map = {
		width: 800,
		height: 300,
		planets: [
			['Vega', 100, 150, 31, 'red', 40, 0],
			['Terra', 700, 150, 31, 'blue', 10, 0],
		],
	} as const;
	const world = await createGame('skirmish', map);
	try {
		clearUnits(world);
		spawnShip(world, named(world, 'Terra').id, 'red');
		decideOnce(world);
		expect(named(world, 'Vega').components.planet.troops).toBe(10);
		decideOnce(world);
		expect(named(world, 'Vega').components.planet.troops).toBe(10);
		expect(redCargoTo(world, named(world, 'Terra').id)).toBe(30);
	} finally {
		await world.dispose();
	}
});

const step = function (world: Game, count: number): void {
	for (let i = 0; i < count; i++) world.update(CONFIG.step);
};
const spawnTraveler = function (
	world: Game,
	owner: Side,
	kind: 'ship' | 'transport',
	x: number,
	y: number,
	target: number,
	cargo = 0,
): ReturnType<typeof units>[number] {
	return world.spawn({
		localTransform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
		circleCollider: { radius: 0 },
		unit: {
			owner,
			kind,
			x,
			y,
			target,
			phase: 'travel',
			hp: kind === 'ship' ? CONFIG.shipHealth : CONFIG.transportHealth,
			cargo,
			age: 0,
		},
	});
};

test('loaded and empty troop transports travel half as fast as ships for both sides', async function () {
	for (const owner of ['blue', 'red'] as const) {
		const world = await quietWorld();
		try {
			for (const entity of units(world)) world.removeEntity(entity.id);
			const target = named(world, owner === 'blue' ? 'Terra' : 'Vega');
			const x = target.components.planet.x + 200;
			const y = target.components.planet.y + 200;
			const ship = spawnTraveler(world, owner, 'ship', x, y, target.id);
			const loaded = spawnTraveler(world, owner, 'transport', x, y, target.id, 10);
			const empty = spawnTraveler(world, owner, 'transport', x, y, target.id);
			step(world, 20);
			const distanceTraveled = function (entity: ReturnType<typeof units>[number]): number {
				return Math.hypot(entity.components.unit.x - x, entity.components.unit.y - y);
			};
			expect(distanceTraveled(ship)).toBeCloseTo(23.75);
			expect(distanceTraveled(loaded)).toBeCloseTo(distanceTraveled(ship) / 2);
			expect(distanceTraveled(empty)).toBeCloseTo(distanceTraveled(ship) / 2);
		} finally {
			await world.dispose();
		}
	}
});

test('a same-tick AI redispatch keeps an arriving ship in the spatial index', async function () {
	const world = await createGame();
	try {
		for (const entity of units(world)) world.removeEntity(entity.id);
		const vega = named(world, 'Vega');
		const terra = named(world, 'Terra');
		const red = spawnTraveler(
			world,
			'red',
			'ship',
			vega.components.planet.x,
			vega.components.planet.y,
			vega.id,
		);
		const blue = spawnTraveler(
			world,
			'blue',
			'ship',
			vega.components.planet.x + 20,
			vega.components.planet.y,
			terra.id,
		);
		const match = world.getResource('match');
		match.ai = true;
		match.aiClock = CONFIG.aiInterval - CONFIG.step;

		world.update(CONFIG.step);

		expect(red.components.unit.phase).toBe('travel');
		expect(red.components.unit.target).not.toBe(vega.id);
		expect(world.getComponent(red.id, 'circleCollider')).toBeDefined();
		blue.components.unit.target = red.components.unit.target;
		blue.components.unit.x = red.components.unit.x + 12;
		blue.components.unit.y = red.components.unit.y;
		const blueTransform = world.getComponent(blue.id, 'localTransform');
		if (!blueTransform) throw new Error('Missing blue traveler transform');
		blueTransform.x = blue.components.unit.x;
		blueTransform.y = blue.components.unit.y;

		world.update(CONFIG.step);

		expect(red.components.unit.hp).toBeLessThan(CONFIG.shipHealth);
	} finally {
		await world.dispose();
	}
});

test('traveling ships stop during combat and survivors resume their original route', async function () {
	const world = await quietWorld();
	try {
		const lyra = named(world, 'Lyra');
		const terra = named(world, 'Terra');
		const blue = spawnTraveler(world, 'blue', 'ship', 600, 700, lyra.id);
		const red = spawnTraveler(world, 'red', 'ship', 620, 700, terra.id);
		red.components.unit.hp = CONFIG.shipDamage * CONFIG.step * 3;
		for (let tick = 0; tick < 3; tick++) {
			world.update(CONFIG.step);
			for (const [entity, x] of [[blue, 600], [red, 620]] as const) {
				expect(entity.components.unit.x).toBe(x);
				expect(entity.components.unit.y).toBe(700);
				if (entity.components.unit.hp > 0)
					expect(world.getComponent(entity.id, 'localTransform')?.x).toBe(x);
			}
			expect(blue.components.unit.hp).toBeLessThan(CONFIG.shipHealth);
			expect(world.getResource('match').engagements).toHaveLength(2);
		}
		expect(world.getComponent(red.id, 'unit')).toBeUndefined();
		world.update(CONFIG.step);
		expect(blue.components.unit.x).not.toBe(600);
		expect(blue.components.unit.target).toBe(lyra.id);
		expect(world.getResource('match').engagements).toEqual([]);
		step(world, 800);
		expect(blue.components.unit.phase).toBe('orbit');
		expect(blue.components.unit.target).toBe(lyra.id);
	} finally {
		await world.dispose();
	}
});

test('opposing routes enter combat range and then hold position', async function () {
	const world = await quietWorld();
	try {
		const altair = named(world, 'Altair');
		const io = named(world, 'Io');
		const from = altair.components.planet;
		const to = io.components.planet;
		const blue = spawnTraveler(world, 'blue', 'ship',
			from.x + (to.x - from.x) * 0.3, from.y + (to.y - from.y) * 0.3, io.id);
		const red = spawnTraveler(world, 'red', 'ship',
			from.x + (to.x - from.x) * 0.7, from.y + (to.y - from.y) * 0.7, altair.id);
		expect(Math.hypot(blue.components.unit.x - red.components.unit.x,
			blue.components.unit.y - red.components.unit.y)).toBeGreaterThan(CONFIG.engagementRange);
		for (let tick = 0; tick < 400 && world.getResource('match').engagements.length === 0; tick++)
			world.update(CONFIG.step);
		expect(world.getResource('match').engagements).toHaveLength(2);
		const positions = [blue, red].map(function (entity) {
			return { x: entity.components.unit.x, y: entity.components.unit.y };
		});
		step(world, 10);
		expect([blue, red].map(function (entity) {
			return { x: entity.components.unit.x, y: entity.components.unit.y };
		})).toEqual(positions);
	} finally {
		await world.dispose();
	}
});

test('friendly ships do not fire on each other', async function () {
	const world = await quietWorld();
	try {
		const lyra = named(world, 'Lyra');
		const first = spawnTraveler(world, 'blue', 'ship', 600, 700, lyra.id);
		const second = spawnTraveler(world, 'blue', 'ship', 610, 700, lyra.id);
		step(world, 10);
		expect(first.components.unit.hp).toBe(CONFIG.shipHealth);
		expect(second.components.unit.hp).toBe(CONFIG.shipHealth);
		expect(world.getResource('match').engagements).toEqual([]);
	} finally {
		await world.dispose();
	}
});

test('transports take passing fire without shooting or leaving their route', async function () {
	const world = await quietWorld();
	try {
		const lyra = named(world, 'Lyra');
		const origin = { x: 600, y: 700 };
		const dx = lyra.components.planet.x - origin.x;
		const dy = lyra.components.planet.y - origin.y;
		const len = Math.hypot(dx, dy);
		const transport = spawnTraveler(
			world,
			'blue',
			'transport',
			origin.x,
			origin.y,
			lyra.id,
			7,
		);
		const ship = spawnTraveler(
			world,
			'red',
			'ship',
			origin.x - (dx / len) * 12,
			origin.y - (dy / len) * 12,
			lyra.id,
		);
		let movedCloser = false;
		for (let i = 0; i < 40 && transport.components.unit.hp > 0; i++) {
			const before = Math.hypot(
				lyra.components.planet.x - transport.components.unit.x,
				lyra.components.planet.y - transport.components.unit.y,
			);
			world.update(CONFIG.step);
			expect(ship.components.unit.hp).toBe(CONFIG.shipHealth);
			if (transport.components.unit.hp <= 0) break;
			const after = Math.hypot(
				lyra.components.planet.x - transport.components.unit.x,
				lyra.components.planet.y - transport.components.unit.y,
			);
			expect(after).toBeLessThan(before);
			expect(transport.components.unit.phase).toBe('travel');
			expect(transport.components.unit.target).toBe(lyra.id);
			movedCloser = true;
		}
		expect(movedCloser).toBe(true);
		expect(transport.components.unit.hp).toBe(0);
		expect(ship.components.unit.x).toBe(origin.x - (dx / len) * 12);
		world.update(CONFIG.step);
		expect(ship.components.unit.x).not.toBe(origin.x - (dx / len) * 12);
		const match = world.getResource('match');
		expect(match.transportsLost).toBe(1);
		expect(match.troopsLost).toBe(7);
		expect(units(world).some(function (entity) {
			return entity.id === transport.id;
		})).toBe(false);
	} finally {
		await world.dispose();
	}
});

test('a ship resumes when a surviving transport escapes its range', async function () {
	const world = await quietWorld();
	try {
		const lyra = named(world, 'Lyra');
		const transport = spawnTraveler(world, 'blue', 'transport', 600, 700, lyra.id, 7);
		transport.components.unit.hp = 1000;
		const ship = spawnTraveler(world, 'red', 'ship', 600, 700, lyra.id);
		world.update(CONFIG.step);
		expect(ship.components.unit.x).toBe(600);
		expect(ship.components.unit.y).toBe(700);
		expect(transport.components.unit.hp).toBeLessThan(1000);
		step(world, 100);
		expect(transport.components.unit.hp).toBeGreaterThan(0);
		expect(ship.components.unit.x).not.toBe(600);
		expect(ship.components.unit.target).toBe(lyra.id);
	} finally {
		await world.dispose();
	}
});

test('a passing ship shoots the escort before the transport', async function () {
	const world = await quietWorld();
	try {
		const lyra = named(world, 'Lyra');
		const escort = spawnTraveler(world, 'blue', 'ship', 600, 700, lyra.id);
		const transport = spawnTraveler(
			world,
			'blue',
			'transport',
			630,
			700,
			lyra.id,
			3,
		);
		const attacker = spawnTraveler(world, 'red', 'ship', 600, 720, lyra.id);
		world.update(CONFIG.step);
		expect(escort.components.unit.hp).toBeCloseTo(
			CONFIG.shipHealth - CONFIG.shipDamage * CONFIG.step,
		);
		expect(transport.components.unit.hp).toBe(CONFIG.transportHealth);
		expect(attacker.components.unit.hp).toBeCloseTo(
			CONFIG.shipHealth - CONFIG.shipDamage * CONFIG.step,
		);
	} finally {
		await world.dispose();
	}
});

test('pause freezes a passing exchange', async function () {
	const world = await quietWorld();
	try {
		const lyra = named(world, 'Lyra');
		spawnTraveler(world, 'blue', 'ship', 600, 700, lyra.id);
		spawnTraveler(world, 'red', 'ship', 620, 700, lyra.id);
		world.update(CONFIG.step);
		const match = world.getResource('match');
		expect(match.engagements.length).toBeGreaterThan(0);
		match.paused = true;
		const frozen = snapshot(world);
		step(world, 30);
		expect(snapshot(world)).toEqual(frozen);
	} finally {
		await world.dispose();
	}
});

test('a ship passing a planet does not join its orbit, blockade, or landing', async function () {
	const world = await quietWorld();
	try {
		const terra = named(world, 'Terra');
		const vega = named(world, 'Vega');
		const sol = named(world, 'Sol');
		const beforeTroops = terra.components.planet.troops;
		const transport = world.spawn({
			unit: {
				owner: 'blue',
				kind: 'transport',
				x: terra.components.planet.x,
				y: terra.components.planet.y,
				target: terra.id,
				phase: 'orbit',
				hp: CONFIG.transportHealth,
				cargo: 4,
				age: CONFIG.arrivalGrace,
			},
		});
		const passer = spawnTraveler(
			world,
			'red',
			'ship',
			terra.components.planet.x,
			terra.components.planet.y,
			vega.id,
		);
		const blueShips = shipsAt(world, terra.id, 'blue').length;
		world.update(CONFIG.step);
		expect(
			units(world).some(function (entity) {
				return entity.id === transport.id;
			}),
		).toBe(false);
		expect(terra.components.planet.troops).toBe(beforeTroops + 4);
		expect(terra.components.planet.owner).toBe('blue');
		expect(passer.components.unit.phase).toBe('travel');
		expect(passer.components.unit.target).toBe(vega.id);
		expect(shipsAt(world, terra.id, 'red')).toHaveLength(0);
		expect(shipsAt(world, terra.id, 'blue')).toHaveLength(blueShips);
		expect(isBlockaded(world, terra.id)).toBe(false);
		expect(passer.components.unit.hp).toBe(CONFIG.shipHealth);

		sol.components.planet.owner = 'red';
		sol.components.planet.guns = 0;
		expect(spawnShip(world, sol.id, 'blue')).toBeTruthy();
		expect(spawnShip(world, sol.id, 'blue')).toBeTruthy();
		expect(isBlockaded(world, sol.id)).toBe(true);
		const visitor = spawnTraveler(
			world,
			'red',
			'ship',
			sol.components.planet.x,
			sol.components.planet.y,
			terra.id,
		);
		const guards = shipsAt(world, sol.id, 'blue').length;
		world.update(CONFIG.step);
		expect(isBlockaded(world, sol.id)).toBe(true);
		expect(shipsAt(world, sol.id, 'red')).toHaveLength(0);
		expect(shipsAt(world, sol.id, 'blue')).toHaveLength(guards);
		expect(visitor.components.unit.phase).toBe('travel');
		expect(visitor.components.unit.target).toBe(terra.id);
		expect(sol.components.planet.owner).toBe('red');
		expect(sol.components.planet.guns).toBe(0);
	} finally {
		await world.dispose();
	}
});

test('orbiting ships, transports, and guns are excluded from passing combat', async function () {
	const world = await quietWorld();
	try {
		const sol = named(world, 'Sol');
		const lyra = named(world, 'Lyra');
		const planet = sol.components.planet;
		planet.owner = 'blue';
		planet.guns = 2;
		const guard = spawnShip(world, sol.id, 'blue');
		if (!guard) throw new Error('Missing guard');
		const passerFor = function (defender: {
			id: number;
			components: { unit: Unit };
	}): ReturnType<typeof spawnTraveler> {
			const point = unitPoint(
				defender.components.unit,
				planet,
				CONFIG.step,
				defender.id,
			);
			const dx = point.x - planet.x;
			const dy = point.y - planet.y;
			const distance = Math.hypot(dx, dy);
			const passerDistance = Math.min(
				distance - 1,
				planet.radius + CONFIG.arrivalClearance - 1,
			);
			return spawnTraveler(
				world,
				'red',
				'ship',
				planet.x + (dx / distance) * passerDistance,
				planet.y + (dy / distance) * passerDistance,
				lyra.id,
			);
		};
		const passer = passerFor(guard);
		world.update(CONFIG.step);
		expect(guard.components.unit.hp).toBe(CONFIG.shipHealth);
		expect(passer.components.unit.hp).toBe(CONFIG.shipHealth);
		expect(planet.guns).toBe(2);
		expect(passer.components.unit.phase).toBe('travel');
		expect(passer.components.unit.target).toBe(lyra.id);
		expect(world.getResource('match').engagements).toEqual([]);

		world.removeEntity(guard.id);
		planet.owner = 'red';
		const transport = world.spawn({
			unit: {
				owner: 'blue',
				kind: 'transport',
				x: planet.x,
				y: planet.y,
				target: sol.id,
				phase: 'orbit',
				hp: CONFIG.transportHealth,
				cargo: 3,
				age: CONFIG.arrivalGrace,
			},
		});
		const transportPasser = passerFor(transport);
		world.update(CONFIG.step);
		expect(transport.components.unit.hp).toBeCloseTo(
			CONFIG.transportHealth - planet.guns * CONFIG.gunDamage * CONFIG.step,
		);
		expect(transportPasser.components.unit.hp).toBe(CONFIG.shipHealth);
		expect(transportPasser.components.unit.phase).toBe('travel');
		expect(world.getResource('match').engagements).toEqual([]);
	} finally {
		await world.dispose();
	}
});

test('orbiting ships still exchange fire during orbital combat', async function () {
	const world = await quietWorld();
	try {
		const sol = named(world, 'Sol');
		const blue = spawnShip(world, sol.id, 'blue');
		const red = spawnShip(world, sol.id, 'red');
		if (!blue || !red) throw new Error('Missing ships');
		const align = -(2.399 * (blue.id - red.id)) / 0.9;
		world.getResource('match').time = align - CONFIG.step;
		world.update(CONFIG.step);
		const tick = CONFIG.shipDamage * CONFIG.step;
		expect(blue.components.unit.hp).toBeCloseTo(CONFIG.shipHealth - tick);
		expect(red.components.unit.hp).toBeCloseTo(CONFIG.shipHealth - tick);
	} finally {
		await world.dispose();
	}
});

test('orbital combat preserves transport arrival grace', async function () {
	const world = await quietWorld();
	try {
		const sol = named(world, 'Sol');
		const transport = world.spawn({
			unit: {
				owner: 'blue',
				kind: 'transport',
				x: sol.components.planet.x,
				y: sol.components.planet.y,
				target: sol.id,
				phase: 'orbit',
				hp: CONFIG.transportHealth,
				cargo: 3,
				age: 0,
			},
		});
		const red = spawnShip(world, sol.id, 'red');
		if (!red) throw new Error('Missing ship');
		const align = -(2.399 * (transport.id - red.id)) / 0.9;
		const planet = sol.components.planet;
		const transportPoint = unitPoint(
			transport.components.unit,
			planet,
			align,
			transport.id,
		);
		const redPoint = unitPoint(red.components.unit, planet, align, red.id);
		const gap = Math.hypot(
			transportPoint.x - redPoint.x,
			transportPoint.y - redPoint.y,
		);
		expect(gap).toBeGreaterThan(0);
		expect(gap).toBeLessThanOrEqual(CONFIG.engagementRange);
		world.getResource('match').time = align - CONFIG.step;
		world.update(CONFIG.step);
		expect(transport.components.unit.hp).toBe(CONFIG.transportHealth);
		expect(transport.components.unit.phase).toBe('orbit');
		expect(red.components.unit.hp).toBe(CONFIG.shipHealth);
		expect(
			units(world).some(function (entity) {
				return entity.id === transport.id;
			}),
		).toBe(true);
	} finally {
		await world.dispose();
	}
});

test('a transport that crosses into the arrival ring keeps its grace', async function () {
	const world = await quietWorld();
	try {
		const sol = named(world, 'Sol');
		const planet = sol.components.planet;
		planet.owner = 'red';
		planet.guns = 2;
		const reach = planet.radius + CONFIG.arrivalClearance;
		const start = reach + 0.2;
		const healthy = spawnTraveler(
			world,
			'blue',
			'transport',
			planet.x + start,
			planet.y,
			sol.id,
			4,
		);
		const angle = 0.4;
		const fragile = spawnTraveler(
			world,
			'blue',
			'transport',
			planet.x + Math.cos(angle) * start,
			planet.y + Math.sin(angle) * start,
			sol.id,
			9,
		);
		fragile.components.unit.hp = 0.2;
		expect(
			Math.hypot(
				healthy.components.unit.x - planet.x,
				healthy.components.unit.y - planet.y,
			),
		).toBeGreaterThan(reach);
		world.update(CONFIG.step);
		for (const transport of [healthy, fragile]) {
			const unit = transport.components.unit;
			expect(
				Math.hypot(unit.x - planet.x, unit.y - planet.y),
			).toBeLessThanOrEqual(reach);
			expect(unit.phase).toBe('orbit');
			expect(unit.age).toBe(0);
			expect(
				units(world).some(function (entity) {
					return entity.id === transport.id;
				}),
			).toBe(true);
		}
		expect(healthy.components.unit.hp).toBe(CONFIG.transportHealth);
		expect(fragile.components.unit.hp).toBe(0.2);
		const match = world.getResource('match');
		expect(match.transportsLost).toBe(0);
		expect(match.troopsLost).toBe(0);
		expect(match.engagements).toEqual([]);
		expect(planet.guns).toBe(2);
		expect(planet.owner).toBe('red');
		expect(planet.troops).toBe(24);
	} finally {
		await world.dispose();
	}
});

test('a lethal passing hit still leaves the traveler a return shot', async function () {
	const world = await quietWorld();
	try {
		const lyra = named(world, 'Lyra');
		const blue = spawnTraveler(world, 'blue', 'ship', 600, 700, lyra.id);
		const red = spawnTraveler(world, 'red', 'ship', 620, 700, lyra.id);
		blue.components.unit.hp = 0.05;
		red.components.unit.hp = 0.05;
		world.update(CONFIG.step);
		expect(
			units(world).some(function (entity) {
				return entity.id === blue.id || entity.id === red.id;
			}),
		).toBe(false);
		const owners = world
			.getResource('match')
			.engagements.map(function (shot) {
				return shot.owner;
			})
			.sort();
		expect(owners).toEqual(['blue', 'red']);
	} finally {
		await world.dispose();
	}
});

test('cancelling one paused dispatch restores exact stock, leaves other reservations, and never launches cancelled units', async function () {
	const world = await quietWorld();
	try {
		const terra = named(world, 'Terra');
		const luna = named(world, 'Luna');
		const ceres = named(world, 'Ceres');
		world.getResource('match').paused = true;
		const initialShips = structuredClone(shipsAt(world, terra.id, 'blue'));
		dispatch(world, [terra.id], luna.id, 0.5);
		dispatch(world, [terra.id], ceres.id, 0.5);
		const [first, second] = activeOrders(world);
		if (!first || !second) throw new Error('Missing paused orders');
		expect(activeOrders(world, [luna.id])).toEqual([first]);
		expect(activeOrders(world, [terra.id])).toHaveLength(2);
		expect(activeOrders(world, [named(world, 'Sol').id])).toHaveLength(0);
		expect(cancelOrder(world, first.id, 'red')).toBe(false);
		expect(cancelOrder(world, first.id)).toBe(true);
		expect(cancelOrder(world, first.id)).toBe(false);
		expect(terra.components.planet.troops).toBe(33);
		expect(shipsAt(world, terra.id, 'blue')).toHaveLength(2);
		for (const ship of shipsAt(world, terra.id, 'blue')) {
			const original = initialShips.find(function (entry) {
				return entry.id === ship.id;
			});
			if (!original) throw new Error('Missing original ship');
			expect(ship.components.unit).toEqual(original.components.unit);
			expect(world.getComponent(ship.id, 'circleCollider')).toBeUndefined();
		}
		expect(activeOrders(world)).toEqual([second]);
		step(world, 50);
		expect(second.state).toBe('pending');
		expect(terra.components.planet.troops).toBe(33);
		world.getResource('match').paused = false;
		step(world, 1);
		expect(second.state).toBe('outbound');
		expect(
			units(world).filter(function (entity) {
				return entity.components.unit.target === luna.id;
			}),
		).toHaveLength(0);
	} finally {
		await world.dispose();
	}
});

test('recall turns surviving ships and cargo around in place, freezes during pause, and lands them at home', async function () {
	const world = await quietWorld();
	try {
		const terra = named(world, 'Terra');
		const luna = named(world, 'Luna');
		dispatch(world, [terra.id], luna.id, 0.5);
		step(world, 100);
		const [order] = activeOrders(world);
		if (!order) throw new Error('Missing order');
		const lost = orderUnits(world, order).find(function (entity) {
			return entity.components.unit.kind === 'ship';
		});
		if (!lost) throw new Error('Missing escort');
		world.removeEntity(lost.id);
		const before = structuredClone(orderUnits(world, order));
		const match = world.getResource('match');
		match.paused = true;
		expect(cancelOrder(world, order.id)).toBe(true);
		expect(order.state).toBe('returning');
		expect(cancelOrder(world, order.id)).toBe(false);
		for (const entity of orderUnits(world, order)) {
			const original = before.find(function (candidate) {
				return candidate.id === entity.id;
			});
			if (!original) throw new Error('Missing survivor');
			expect(entity.components.unit.x).toBe(original.components.unit.x);
			expect(entity.components.unit.y).toBe(original.components.unit.y);
			expect(entity.components.unit.hp).toBe(original.components.unit.hp);
			expect(entity.components.unit.cargo).toBe(original.components.unit.cargo);
			expect(entity.components.unit.target).toBe(terra.id);
		}
		expect(activeOrders(world, [luna.id])).toEqual([order]);
		expect(activeOrders(world, [terra.id])).toEqual([order]);
		const frozen = snapshot(world);
		step(world, 100);
		expect(snapshot(world)).toEqual(frozen);
		match.paused = false;
		step(world, 1);
		const moving = orderUnits(world, order)[0];
		const previous = before.find(function (entity) {
			return entity.id === moving?.id;
		});
		if (!moving || !previous) throw new Error('Missing returning unit');
		expect(moving.components.unit.y).toBeGreaterThan(
			previous.components.unit.y,
		);
		step(world, 150);
		expect(activeOrders(world)).toHaveLength(0);
		expect(shipsAt(world, terra.id, 'blue')).toHaveLength(2);
		expect(terra.components.planet.troops).toBeGreaterThanOrEqual(44);
		expect(luna.components.planet.owner).toBe('neutral');
	} finally {
		await world.dispose();
	}
});

test('multi-source recall returns each contingent to its own departure world', async function () {
	const world = await quietWorld();
	try {
		const terra = named(world, 'Terra');
		const luna = named(world, 'Luna');
		const ceres = named(world, 'Ceres');
		luna.components.planet.owner = 'blue';
		luna.components.planet.troops = 20;
		spawnShip(world, luna.id, 'blue');
		dispatch(world, [terra.id, luna.id], ceres.id, 1);
		step(world, 80);
		const [order] = activeOrders(world);
		if (!order) throw new Error('Missing multi-source order');
		expect(cancelOrder(world, order.id)).toBe(true);
		for (const departure of order.departures) {
			expect(world.getComponent(departure.unitId, 'unit')?.target).toBe(
				departure.source,
			);
		}
		step(world, 150);
		expect(activeOrders(world)).toHaveLength(0);
		expect(shipsAt(world, terra.id, 'blue')).toHaveLength(3);
		expect(shipsAt(world, luna.id, 'blue')).toHaveLength(1);
		expect(terra.components.planet.troops).toBeGreaterThanOrEqual(44);
		expect(luna.components.planet.troops).toBeGreaterThanOrEqual(20);
	} finally {
		await world.dispose();
	}
});

test('arrived or destroyed orders disappear and redirected escorts cannot be recalled by an old order', async function () {
	const world = await quietWorld();
	try {
		const terra = named(world, 'Terra');
		const luna = named(world, 'Luna');
		const ceres = named(world, 'Ceres');
		dispatch(world, [terra.id], luna.id, 1, 'ships');
		const [old] = activeOrders(world);
		if (!old) throw new Error('Missing ships order');
		step(world, 400);
		expect(activeOrders(world)).toHaveLength(0);
		expect(cancelOrder(world, old.id)).toBe(false);
		dispatch(world, [luna.id], ceres.id, 1, 'ships');
		const [next] = activeOrders(world);
		if (!next) throw new Error('Missing redirected order');
		expect(activeOrders(world, [terra.id])).toHaveLength(0);
		for (const entity of orderUnits(world, next)) world.removeEntity(entity.id);
		expect(activeOrders(world)).toHaveLength(0);
		expect(cancelOrder(world, next.id)).toBe(false);
	} finally {
		await world.dispose();
	}
});

test('recalling a waiting invasion starts at rendered orbit positions and leaves redirected escorts alone', async function () {
	const world = await quietWorld();
	try {
		const terra = named(world, 'Terra');
		const luna = named(world, 'Luna');
		const ceres = named(world, 'Ceres');
		dispatch(world, [terra.id], luna.id, 1);
		const [invasion] = activeOrders(world);
		if (!invasion) throw new Error('Missing invasion');
		for (const entity of orderUnits(world, invasion)) entity.components.unit.phase = 'orbit';
		expect(activeOrders(world)).toEqual([invasion]);
		dispatch(world, [luna.id], ceres.id, 1, 'ships');
		const redirected = activeOrders(world).find(function (order) { return order !== invasion; });
		if (!redirected) throw new Error('Missing redirected order');
		const expected = orderUnits(world, invasion).map(function (entity) {
			return { id: entity.id, point: unitPoint(entity.components.unit, luna.components.planet, 0, entity.id) };
		});
		expect(cancelOrder(world, invasion.id)).toBe(true);
		for (const entry of expected) {
			const unit = world.getComponent(entry.id, 'unit');
			if (!unit) throw new Error('Missing recalled transport');
			expect(unit.x).toBe(entry.point.x);
			expect(unit.y).toBe(entry.point.y);
			expect(unit.target).toBe(terra.id);
			expect(world.getComponent(entry.id, 'circleCollider')).toBeDefined();
		}
		for (const escort of orderUnits(world, redirected)) expect(escort.components.unit.target).toBe(ceres.id);
	} finally {
		await world.dispose();
	}
});

test('recall to a captured departure planet uses normal combat instead of refunding cargo', async function () {
	const world = await quietWorld();
	try {
		const terra = named(world, 'Terra');
		const luna = named(world, 'Luna');
		dispatch(world, [terra.id], luna.id, 1);
		step(world, 100);
		const [order] = activeOrders(world);
		if (!order) throw new Error('Missing invasion');
		terra.components.planet.owner = 'red';
		terra.components.planet.troops = 100;
		// Keep another owned world so the match continues after the departure falls.
		named(world, 'Ceres').components.planet.owner = 'blue';
		expect(cancelOrder(world, order.id)).toBe(true);
		expect(terra.components.planet.troops).toBe(100);
		step(world, 200);
		expect(terra.components.planet.owner).toBe('red');
		expect(terra.components.planet.troops).toBeLessThan(100);
		expect(activeOrders(world)).toHaveLength(0);
	} finally {
		await world.dispose();
	}
});

test('passing fire includes the exact range boundary and breaks equal-distance ties by entity id', async function () {
	const world = await quietWorld();
	try {
		const lyra = named(world, 'Lyra');
		const blue = spawnTraveler(world, 'blue', 'ship', 600, 700, lyra.id);
		const first = spawnTraveler(world, 'red', 'ship', 600 - CONFIG.engagementRange, 700, lyra.id);
		const second = spawnTraveler(world, 'red', 'ship', 600 + CONFIG.engagementRange, 700, lyra.id);
		world.update(CONFIG.step);
		expect(blue.components.unit.x).toBe(600);
		expect(first.components.unit.x).toBe(600 - CONFIG.engagementRange);
		expect(second.components.unit.x).toBe(600 + CONFIG.engagementRange);
		expect(first.components.unit.hp).toBeCloseTo(CONFIG.shipHealth - CONFIG.shipDamage * CONFIG.step);
		expect(second.components.unit.hp).toBe(CONFIG.shipHealth);
		expect(blue.components.unit.hp).toBeCloseTo(CONFIG.shipHealth - 2 * CONFIG.shipDamage * CONFIG.step);
	} finally {
		await world.dispose();
	}
});

test('a transport entering range is found through the pre-movement spatial index', async function () {
	const world = await quietWorld();
	try {
		const lyra = named(world, 'Lyra');
		const planet = lyra.components.planet;
		// Blue halts for the transport ahead, which exits range this step. The
		// transport behind enters range, but its indexed position is still outside.
		const x = 600, y = 700;
		const length = Math.hypot(planet.x - x, planet.y - y);
		const dx = (planet.x - x) / length, dy = (planet.y - y) / length;
		const blue = spawnTraveler(world, 'blue', 'ship', x, y, lyra.id);
		const entering = spawnTraveler(world, 'red', 'transport',
			x - dx * (CONFIG.engagementRange + 0.5), y - dy * (CONFIG.engagementRange + 0.5), lyra.id, 7);
		const escaping = spawnTraveler(world, 'red', 'transport',
			x + dx * (CONFIG.engagementRange - 0.5), y + dy * (CONFIG.engagementRange - 0.5), lyra.id, 1);
		world.update(CONFIG.step);
		expect(blue.components.unit.x).toBe(x);
		expect(blue.components.unit.y).toBe(y);
		expect(entering.components.unit.hp).toBeCloseTo(CONFIG.transportHealth - CONFIG.shipDamage * CONFIG.step);
		expect(escaping.components.unit.hp).toBe(CONFIG.transportHealth);
	} finally {
		await world.dispose();
	}
});

test('an escorted invasion clears defenses, lands cargo, and retires its pending order', async function () {
	const world = await createGame('invasion');
	try {
		const terra = named(world, 'Terra');
		const sol = named(world, 'Sol');
		const match = world.getResource('match');
		match.paused = true;
		expect(dispatch(world, [terra.id], sol.id, 1, 'combined')).toBeGreaterThan(8);
		const order = activeOrders(world)[0];
		if (!order) throw new Error('Missing invasion order');
		expect(order.state).toBe('pending');
		match.paused = false;
		world.update(CONFIG.step);
		expect(order.state).toBe('outbound');
		step(world, 2000);
		expect(sol.components.planet.owner).toBe('blue');
		expect(sol.components.planet.guns).toBe(0);
		expect(sol.components.planet.troops).toBeGreaterThan(0);
		expect(match.captures).toBe(1);
		expect(match.firstCapture).not.toBeNull();
		expect(match.transportsLost).toBe(0);
		expect(match.troopsLost).toBe(0);
		expect(activeOrders(world)).toHaveLength(0);
	} finally {
		await world.dispose();
	}
});
