import { expect, test } from 'bun:test';
import {
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
import type { Side } from './config';
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

const quietWorld = async function () {
	const world = await createGame();
	world.getResource('match').ai = false;
	return world;
};
const named = function (world: Game, name: string) {
	const found = planets(world).find(function (entity) {
		return entity.components.planet.name === name;
	});
	if (!found) throw new Error(`Missing ${name}`);
	return found;
};
const step = function (world: Game, count: number) {
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
) {
	return world.spawn({
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
const along = function (
	from: { x: number; y: number },
	to: { x: number; y: number },
	fraction: number,
) {
	return {
		x: from.x + (to.x - from.x) * fraction,
		y: from.y + (to.y - from.y) * fraction,
	};
};

test('traveling ships exchange fire and still arrive at their original planets', async function () {
	const world = await quietWorld();
	try {
		const altair = named(world, 'Altair');
		const io = named(world, 'Io');
		const blueAt = along(altair.components.planet, io.components.planet, 0.3);
		const redAt = along(altair.components.planet, io.components.planet, 0.7);
		const blue = spawnTraveler(
			world,
			'blue',
			'ship',
			blueAt.x,
			blueAt.y,
			io.id,
		);
		const red = spawnTraveler(
			world,
			'red',
			'ship',
			redAt.x,
			redAt.y,
			altair.id,
		);
		expect(
			Math.hypot(blueAt.x - redAt.x, blueAt.y - redAt.y),
		).toBeGreaterThan(CONFIG.engagementRange);
		let sawShots = false;
		let separated = false;
		for (
			let i = 0;
			i < 400 &&
			(blue.components.unit.phase !== 'orbit' ||
				red.components.unit.phase !== 'orbit');
			i++
		) {
			const beforeBlue = blue.components.unit.hp;
			const beforeRed = red.components.unit.hp;
			world.update(CONFIG.step);
			const gap = Math.hypot(
				blue.components.unit.x - red.components.unit.x,
				blue.components.unit.y - red.components.unit.y,
			);
			if (gap <= CONFIG.engagementRange && blue.components.unit.phase === 'travel') {
				expect(blue.components.unit.hp).toBeLessThan(beforeBlue);
				expect(red.components.unit.hp).toBeLessThan(beforeRed);
				expect(blue.components.unit.target).toBe(io.id);
				expect(red.components.unit.target).toBe(altair.id);
				expect(world.getResource('match').engagements.length).toBeGreaterThan(0);
				sawShots = true;
			}
			if (
				sawShots &&
				gap > CONFIG.engagementRange &&
				blue.components.unit.phase === 'travel' &&
				red.components.unit.phase === 'travel'
			) {
				expect(world.getResource('match').engagements).toEqual([]);
				separated = true;
				break;
			}
		}
		expect(sawShots).toBe(true);
		expect(separated).toBe(true);
		expect(blue.components.unit.hp).toBeGreaterThan(0);
		expect(blue.components.unit.hp).toBeLessThan(CONFIG.shipHealth);
		for (
			let i = 0;
			i < 800 &&
			(blue.components.unit.phase !== 'orbit' ||
				red.components.unit.phase !== 'orbit');
			i++
		)
			world.update(CONFIG.step);
		expect(blue.components.unit.phase).toBe('orbit');
		expect(red.components.unit.phase).toBe('orbit');
		expect(blue.components.unit.target).toBe(io.id);
		expect(red.components.unit.target).toBe(altair.id);
		expect(shipsAt(world, altair.id, 'blue')).toHaveLength(0);
		expect(shipsAt(world, io.id, 'red')).toHaveLength(0);
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
		expect(passer.components.unit.hp).toBeLessThan(CONFIG.shipHealth);

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

test('a ship inside the arrival ring and weapon range takes each defender damage once', async function () {
	const world = await quietWorld();
	try {
		const sol = named(world, 'Sol');
		const lyra = named(world, 'Lyra');
		const guard = spawnShip(world, sol.id, 'blue');
		if (!guard) throw new Error('Missing guard');
		const at = unitPoint(
			guard.components.unit,
			sol.components.planet,
			CONFIG.step,
			guard.id,
		);
		const inwardX = sol.components.planet.x - at.x;
		const inwardY = sol.components.planet.y - at.y;
		const inward = Math.hypot(inwardX, inwardY);
		const passer = spawnTraveler(
			world,
			'red',
			'ship',
			at.x + (inwardX / inward) * 1,
			at.y + (inwardY / inward) * 1,
			lyra.id,
		);
		world.update(CONFIG.step);
		const tick = CONFIG.shipDamage * CONFIG.step;
		expect(passer.components.unit.hp).toBeCloseTo(CONFIG.shipHealth - tick);
		expect(guard.components.unit.hp).toBeCloseTo(CONFIG.shipHealth - tick);
		expect(passer.components.unit.phase).toBe('travel');
		expect(passer.components.unit.target).toBe(lyra.id);
		expect(shipsAt(world, sol.id, 'red')).toHaveLength(0);
	} finally {
		await world.dispose();
	}
});

test('orbiting ships do not add passing fire on top of the orbit exchange', async function () {
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
		expect(world.getResource('match').time).toBeCloseTo(align);
	} finally {
		await world.dispose();
	}
});

test('guns fire inside the arrival ring and passing ships do not damage them', async function () {
	const world = await quietWorld();
	try {
		const sol = named(world, 'Sol');
		const lyra = named(world, 'Lyra');
		sol.components.planet.owner = 'blue';
		sol.components.planet.guns = 2;
		const inside = spawnTraveler(
			world,
			'red',
			'ship',
			sol.components.planet.x,
			sol.components.planet.y,
			lyra.id,
		);
		world.update(CONFIG.step);
		expect(inside.components.unit.hp).toBeCloseTo(
			CONFIG.shipHealth - 2 * CONFIG.gunDamage * CONFIG.step,
		);
		expect(sol.components.planet.guns).toBe(2);
		expect(inside.components.unit.phase).toBe('travel');
		const outsideDist =
			sol.components.planet.radius + CONFIG.arrivalClearance + 30;
		const outside = spawnTraveler(
			world,
			'red',
			'ship',
			sol.components.planet.x + outsideDist,
			sol.components.planet.y,
			lyra.id,
		);
		const hp = outside.components.unit.hp;
		world.update(CONFIG.step);
		expect(outside.components.unit.hp).toBe(hp);
		expect(sol.components.planet.guns).toBe(2);
	} finally {
		await world.dispose();
	}
});

test('a garrison already fighting in orbit does not also shoot a passer', async function () {
	const world = await quietWorld();
	try {
		const sol = named(world, 'Sol');
		const lyra = named(world, 'Lyra');
		const planet = sol.components.planet;
		planet.owner = 'blue';
		planet.guns = 2;
		const blue = spawnShip(world, sol.id, 'blue');
		const red = spawnShip(world, sol.id, 'red');
		if (!blue || !red) throw new Error('Missing ships');
		const combatTime = CONFIG.step;
		const points = [blue, red].map(function (ship) {
			return unitPoint(ship.components.unit, planet, combatTime, ship.id);
		});
		let best: { x: number; y: number; clearance: number } | undefined;
		const dist = planet.radius + CONFIG.arrivalClearance - 10;
		for (let i = 0; i < 72; i++) {
			const angle = (i / 72) * Math.PI * 2;
			const x = planet.x + Math.cos(angle) * dist;
			const y = planet.y + Math.sin(angle) * dist;
			let clearance = Infinity;
			for (const point of points) {
				const gap = Math.hypot(point.x - x, point.y - y);
				if (gap < clearance) clearance = gap;
			}
			if (!best || clearance > best.clearance) best = { x, y, clearance };
		}
		if (
			!best ||
			best.clearance <= CONFIG.engagementRange + CONFIG.travelSpeed * CONFIG.step
		)
			throw new Error(`No safe passer slot (${best?.clearance ?? 'none'})`);
		const passer = spawnTraveler(world, 'red', 'ship', best.x, best.y, lyra.id);
		world.update(CONFIG.step);
		const tick = CONFIG.shipDamage * CONFIG.step;
		const gunTick = planet.guns * CONFIG.gunDamage * CONFIG.step;
		expect(red.components.unit.hp).toBeCloseTo(CONFIG.shipHealth - tick - gunTick);
		expect(blue.components.unit.hp).toBeCloseTo(CONFIG.shipHealth - tick);
		expect(passer.components.unit.hp).toBe(CONFIG.shipHealth);
		expect(passer.components.unit.phase).toBe('travel');
		expect(passer.components.unit.target).toBe(lyra.id);
		expect(shipsAt(world, sol.id, 'red')).toHaveLength(1);
	} finally {
		await world.dispose();
	}
});

test('passing fire does not skip transport arrival grace', async function () {
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

test('a lethal arrival-ring hit still leaves the traveler a return shot', async function () {
	const world = await quietWorld();
	try {
		const sol = named(world, 'Sol');
		const lyra = named(world, 'Lyra');
		const planet = sol.components.planet;
		planet.owner = 'blue';
		const guard = spawnShip(world, sol.id, 'blue');
		if (!guard) throw new Error('Missing guard');
		guard.components.unit.hp = 0.05;
		const at = unitPoint(guard.components.unit, planet, CONFIG.step, guard.id);
		const inwardX = planet.x - at.x;
		const inwardY = planet.y - at.y;
		const inward = Math.hypot(inwardX, inwardY);
		const startX = at.x + (inwardX / inward) * 1;
		const startY = at.y + (inwardY / inward) * 1;
		const dx = lyra.components.planet.x - startX;
		const dy = lyra.components.planet.y - startY;
		const distance = Math.hypot(dx, dy);
		const travel = Math.min(distance, CONFIG.travelSpeed * CONFIG.step);
		const combatX = startX + (dx / distance) * travel;
		const combatY = startY + (dy / distance) * travel;
		expect(
			Math.hypot(combatX - planet.x, combatY - planet.y),
		).toBeLessThanOrEqual(planet.radius + CONFIG.arrivalClearance);
		expect(Math.hypot(combatX - at.x, combatY - at.y)).toBeLessThanOrEqual(
			CONFIG.engagementRange,
		);
		const passer = spawnTraveler(world, 'red', 'ship', startX, startY, lyra.id);
		passer.components.unit.hp = 0.05;
		world.update(CONFIG.step);
		expect(
			units(world).some(function (entity) {
				return entity.id === guard.id || entity.id === passer.id;
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
