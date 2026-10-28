import { expect, test } from 'bun:test';
import { CONFIG } from './config';
import { activeOrders, cancelOrder, createGame, dispatch, dispatchIntercept, orderUnits, planets, spawnShip, units, type Game, type Order } from './game';
import { interceptionAims, travelingGroups } from './fleet-interception';
import { captureConquestSave } from './game-save';
import type { StarMap } from './maps';
import { parseConquestSave } from './save-state';

const map: StarMap = { width: 1200, height: 1000, planets: [
	['Home', 300, 500, 24, 'blue', 30, 0],
	['Rival', 600, 200, 24, 'red', 20, 0],
	['Destination', 600, 900, 24, 'neutral', 0, 0],
	['Second home', 100, 700, 24, 'blue', 10, 0],
] };

const named = function (world: Game, name: string): ReturnType<typeof planets>[number] {
	const found = planets(world).find(function (entity) { return entity.components.planet.name === name; });
	if (!found) throw new Error(`Missing ${name}`);
	return found;
};
const sortie = function (world: Game): Order {
	const order = activeOrders(world).find(function (entry) { return entry.interceptOrder !== undefined; });
	if (!order) throw new Error('Missing intercept order');
	return order;
};
const setup = async function (): Promise<{ world: Game; target: Order }> {
	const world = await createGame('skirmish', map);
	world.getResource('match').ai = false;
	for (const entity of units(world)) world.removeEntity(entity.id);
	spawnShip(world, named(world, 'Rival').id, 'red');
	spawnShip(world, named(world, 'Rival').id, 'red');
	dispatch(world, [named(world, 'Rival').id], named(world, 'Destination').id, 1, 'combined', 'red');
	const target = world.getResource('orderBook').active[0];
	if (!target) throw new Error('Missing target order');
	for (let i = 0; i < 4; i++) spawnShip(world, named(world, 'Home').id, 'blue');
	return { world, target };
};

test('interception launches only the selected fraction of warships and permits a group heading to the source', async function () {
	const { world, target } = await setup();
	try {
		const home = named(world, 'Home');
		const troops = home.components.planet.troops;
		// This inbound route used to be rejected by ordinary same-planet dispatch.
		const inbound = orderUnits(world, target);
		target.target = home.id;
		for (const entity of inbound) entity.components.unit.target = home.id;
		const before = units(world).length;
		expect(dispatchIntercept(world, [home.id, home.id], target.id, 0.5)).toBe(2);
		expect(home.components.planet.troops).toBe(troops);
		expect(units(world)).toHaveLength(before);
		expect(orderUnits(world, sortie(world)).every(function (entity) { return entity.components.unit.kind === 'ship'; })).toBe(true);
		expect(dispatchIntercept(world, [home.id], target.id, NaN)).toBe(0);
		expect(dispatchIntercept(world, [home.id], sortie(world).id, 1)).toBe(0);
		expect(dispatchIntercept(world, [home.id], 99999, 1)).toBe(0);
	} finally { await world.dispose(); }
});

test('pursuit leads a crossing group, survives loss of its first member, fights in normal range, and returns after destruction', async function () {
	const { world, target } = await setup();
	try {
		const home = named(world, 'Home');
		const members = orderUnits(world, target);
		for (const entity of members) { entity.components.unit.x = 600; entity.components.unit.y = 500; }
		expect(dispatchIntercept(world, [home.id], target.id, 1)).toBe(4);
		const order = sortie(world);
		const interceptor = orderUnits(world, order)[0];
		if (!interceptor) throw new Error('Missing interceptor');
		const aim = interceptionAims(world).get(interceptor.id);
		expect(aim?.y).toBeGreaterThan(500);
		const lost = members[0];
		if (!lost) throw new Error('Missing target');
		world.removeEntity(lost.id);
		expect(interceptionAims(world).has(interceptor.id)).toBe(true);
		// Put the real group within ordinary combat range. One step synchronizes
		// the teleported fixture; the next rebuild indexes those coordinates.
		for (const entity of orderUnits(world, order)) { entity.components.unit.x = 575; entity.components.unit.y = 500; }
		const enemy = orderUnits(world, target).find(function (entity) { return entity.components.unit.kind === 'ship'; });
		if (!enemy) throw new Error('Missing hostile ship');
		const initialHP = enemy.components.unit.hp;
		world.update(CONFIG.step);
		world.update(CONFIG.step);
		expect(enemy.components.unit.hp).toBeLessThan(initialHP);
		expect(world.getResource('match').engagements.length).toBeGreaterThan(0);
		for (const entity of orderUnits(world, target)) world.removeEntity(entity.id);
		world.update(CONFIG.step);
		expect(order.state).toBe('returning');
		expect(order.interceptOrder).toBeUndefined();
		expect(interceptor.components.unit.target).toBe(home.id);
		for (let tick = 0; tick < 400; tick++) world.update(CONFIG.step);
		expect(interceptor.components.unit.phase).toBe('orbit');
		expect(activeOrders(world)).toHaveLength(0);
	} finally { await world.dispose(); }
});

test('the whole selected group must leave transit before a multi-source sortie returns to its individual sources', async function () {
	const { world, target } = await setup();
	try {
		const home = named(world, 'Home');
		const second = named(world, 'Second home');
		spawnShip(world, second.id, 'blue');
		dispatchIntercept(world, [home.id, second.id], target.id, 1);
		const order = sortie(world);
		const targets = orderUnits(world, target);
		const first = targets[0];
		if (!first) throw new Error('Missing target');
		first.components.unit.phase = 'orbit';
		world.update(CONFIG.step);
		expect(order.interceptOrder).toBe(target.id);
		for (const entity of targets) entity.components.unit.phase = 'orbit';
		world.update(CONFIG.step);
		expect(order.state).toBe('returning');
		for (const departure of order.departures) expect(world.getComponent(departure.unitId, 'unit')?.target).toBe(departure.source);
	} finally { await world.dispose(); }
});

test('a launched sortie reaches a moving group through steering, fights, and returns without manual redirection', async function () {
	const { world, target } = await setup();
	try {
		for (const entity of orderUnits(world, target)) { entity.components.unit.x = 500; entity.components.unit.y = 350; }
		dispatchIntercept(world, [named(world, 'Home').id], target.id, 1);
		const order = sortie(world);
		let fought = false;
		let returned = false;
		for (let tick = 0; tick < 1000; tick++) {
			world.update(CONFIG.step);
			fought ||= world.getResource('match').engagements.some(function (shot) { return shot.owner === 'blue'; });
			returned ||= order.state === 'returning';
		}
		expect(fought).toBe(true);
		expect(returned).toBe(true);
		expect(activeOrders(world)).toHaveLength(0);
		expect(units(world).filter(function (entity) { return entity.components.unit.owner === 'blue' && entity.components.unit.phase === 'orbit'; }).length).toBeGreaterThan(0);
	} finally { await world.dispose(); }
});

test('paused interception can be cancelled, and an outbound interception can be recalled', async function () {
	const { world, target } = await setup();
	try {
		const home = named(world, 'Home');
		world.getResource('match').paused = true;
		dispatchIntercept(world, [home.id], target.id, 1);
		const pending = sortie(world);
		const before = orderUnits(world, pending).map(function (entity) { return { ...entity.components.unit }; });
		world.update(CONFIG.step);
		expect(orderUnits(world, pending).map(function (entity) { return entity.components.unit; })).toEqual(before);
		expect(cancelOrder(world, pending.id)).toBe(true);
		expect(units(world).filter(function (entity) { return entity.components.unit.owner === 'blue' && entity.components.unit.phase === 'orbit'; })).toHaveLength(4);
		world.getResource('match').paused = false;
		dispatchIntercept(world, [home.id], target.id, 1);
		const outbound = sortie(world);
		world.update(CONFIG.step);
		expect(cancelOrder(world, outbound.id)).toBe(true);
		expect(outbound.interceptOrder).toBeUndefined();
		expect(outbound.state).toBe('returning');
		expect(interceptionAims(world).size).toBe(0);
	} finally { await world.dispose(); }
});

test('interception respects blockades and can launch from a friendly orbital ring over a rival world', async function () {
	const { world, target } = await setup();
	try {
		const home = named(world, 'Home');
		spawnShip(world, home.id, 'red');
		for (const entity of units(world)) {
			const unit = entity.components.unit;
			if (unit.owner === 'blue' && unit.target === home.id) world.removeEntity(entity.id);
		}
		expect(dispatchIntercept(world, [home.id], target.id, 1)).toBe(0);
		const rival = named(world, 'Rival');
		spawnShip(world, rival.id, 'blue');
		expect(dispatchIntercept(world, [rival.id], target.id, 1)).toBe(1);
		expect(orderUnits(world, sortie(world))).toHaveLength(1);
	} finally { await world.dispose(); }
});

test('rendered interception prediction stops leading a ship held in combat', async function () {
	const { world, target } = await setup();
	try {
		const members = orderUnits(world, target);
		const enemy = members[0];
		if (!enemy) throw new Error('Missing enemy');
		for (const entity of members.slice(1)) world.removeEntity(entity.id);
		enemy.components.unit.x = 600; enemy.components.unit.y = 430;
		const blocker = spawnShip(world, named(world, 'Destination').id, 'blue');
		if (!blocker) throw new Error('Missing blocker');
		Object.assign(blocker.components.unit, { x: 625, y: 430, phase: 'travel' });
		world.addComponent(blocker.id, 'circleCollider', { radius: 0 });
		world.update(CONFIG.step);
		world.update(CONFIG.step);
		dispatchIntercept(world, [named(world, 'Home').id], target.id, 1);
		const interceptor = orderUnits(world, sortie(world))[0];
		if (!interceptor) throw new Error('Missing interceptor');
		expect(interceptionAims(world).get(interceptor.id)).toEqual({ x: enemy.components.unit.x, y: enemy.components.unit.y });
	} finally { await world.dispose(); }
});

test('interception launches docked carrier ships and paused cancellation restores docking', async function () {
	const world = await createGame('skirmish', { ...map, carriers: true });
	try {
		world.getResource('match').paused = true;
		const rival = named(world, 'Rival');
		dispatch(world, [rival.id], named(world, 'Destination').id, 1, 'ships', 'red');
		const target = world.getResource('orderBook').active[0];
		const carrier = planets(world).find(function (entity) { return entity.components.planet.carrier && entity.components.planet.owner === 'blue'; });
		if (!target || !carrier) throw new Error('Missing carrier fixture');
		expect(dispatchIntercept(world, [carrier.id], target.id, 1)).toBe(3);
		const order = sortie(world);
		expect(cancelOrder(world, order.id)).toBe(true);
		for (const departure of order.departures) expect(world.getComponent(departure.unitId, 'unit')?.phase).toBe('docked');
	} finally { await world.dispose(); }
});

test('interception save/load preserves group identity across entity remapping and rejects invalid contracts', async function () {
	const { world, target } = await setup();
	let restored: Game | undefined;
	try {
		dispatchIntercept(world, [named(world, 'Home').id], target.id, 1);
		const save = captureConquestSave(world, map, 'skirmish', 1, 'interception-test');
		for (const row of save.game.planets) row.id += 10000;
		for (const row of save.game.units) { row.id += 10000; row.unit.target += 10000; }
		for (const order of save.game.orderBook.active) {
			order.target += 10000;
			for (const departure of order.departures) { departure.source += 10000; departure.unitId += 10000; }
		}
		const valid = parseConquestSave(save, save.profileId);
		restored = await createGame('skirmish', map, valid.game);
		const order = sortie(restored);
		expect(order.interceptOrder).toBe(target.id);
		expect(interceptionAims(restored).size).toBe(4);
		restored.getResource('match').paused = false;
		const restoredTarget = travelingGroups(restored).find(function (group) { return group.order.id === target.id; });
		if (!restoredTarget) throw new Error('Missing restored target');
		for (const entity of restoredTarget.members) restored.removeEntity(entity.id);
		restored.update(CONFIG.step);
		expect(order.state).toBe('returning');
		const invalid = structuredClone(save);
		const invalidOrder = invalid.game.orderBook.active.find(function (entry) { return entry.interceptOrder !== undefined; });
		if (!invalidOrder) throw new Error('Missing invalid order');
		invalidOrder.interceptOrder = invalidOrder.id;
		expect(function () { parseConquestSave(invalid, invalid.profileId); }).toThrow();
		invalidOrder.interceptOrder = -1;
		expect(function () { parseConquestSave(invalid, invalid.profileId); }).toThrow();
	} finally { await world.dispose(); await restored?.dispose(); }
});
