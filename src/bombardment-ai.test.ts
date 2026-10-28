import { expect, test } from 'bun:test';
import { runAI } from './ai';
import { CONFIG } from './config';
import {
	availableShips, bombardPlanet, createGame, dispatch, dockedShips, isBlockaded,
	moveCarrier, planets, setProduction, shipsAt, spawnShip, units, type Game,
} from './game';
import type { StarMap } from './maps';
import { CARRIER_SPEED } from './movement';
import { destinationFor } from './objectives';
import type { OpponentSettings } from './opponent';

const map: StarMap = {
	width: 1400, height: 1000, carriers: true,
	planets: [
		['Player', 150, 150, 30, 'blue', 20, 0],
		['Rival', 1100, 150, 30, 'red', 0, 0],
		['Fortress', 600, 600, 30, 'neutral', 120, 0],
	],
};
type Host = ReturnType<typeof planets>[number];
const named = function (world: Game, name: string): Host {
	const host = planets(world).find(function (entity) { return entity.components.planet.name === name; });
	if (!host) throw new Error(`Missing ${name}`);
	return host;
};
const setup = async function (options: { mode?: StarMap['mode']; opponent?: OpponentSettings } = {}): Promise<Game> {
	const world = await createGame('skirmish', { ...map, mode: options.mode }, undefined, {
		opponent: options.opponent,
		evaluateWinner: function () { return null; },
	});
	world.getResource('match').ai = false;
	for (const entry of planets(world)) entry.components.planet.rate = 0;
	for (const entry of units(world)) world.removeEntity(entry.id);
	return world;
};
const advance = function (world: Game, seconds: number): void {
	for (let tick = 0; tick < Math.round(seconds / CONFIG.step); tick++) world.update(CONFIG.step);
};
const decide = function (world: Game): void {
	runAI(world, { moveCarrier, bombardPlanet, dispatch, isBlockaded, planets, setProduction, shipsAt, units, availableShips, dockedShips });
};
const cargoTo = function (world: Game, target: number): number {
	return units(world).reduce(function (sum, entry) {
		const unit = entry.components.unit;
		return sum + (unit.owner === 'red' && unit.kind === 'transport' && unit.target === target ? unit.cargo : 0);
	}, 0);
};

test('conquest carrier approaches and retains charge and crew across repeated AI decisions', async function () {
	const world = await setup();
	try {
		const carrier = named(world, 'Red carrier').components.planet;
		const target = named(world, 'Fortress');
		carrier.x = 900; carrier.y = 600;
		const crew = carrier.troops;
		decide(world);
		const bombardment = carrier.carrier?.bombardment;
		const destination = carrier.carrier?.destination;
		expect(bombardment?.target).toBe(target.id);
		expect(destination).toEqual({ x: 676, y: 600 });
		advance(world, 3);
		decide(world);
		expect(carrier.x).toBeCloseTo(900 - 3 * CARRIER_SPEED, 6);
		expect(carrier.carrier?.destination).toEqual(destination);
		expect(carrier.carrier?.bombardment).toBe(bombardment);
		for (let think = 0; think < 14; think++) { advance(world, 3); decide(world); }
		expect(carrier.carrier?.destination).toBeNull();
		expect(carrier.carrier?.bombardment).toBe(bombardment);
		if (!bombardment) throw new Error('Missing bombardment');
		const charge = bombardment.elapsed;
		expect(charge).toBeGreaterThan(5);
		decide(world);
		decide(world);
		expect(carrier.carrier?.bombardment?.elapsed).toBe(charge);
		expect(carrier.troops).toBe(crew);
		expect(cargoTo(world, target.id)).toBe(0);
	} finally { await world.dispose(); }
});

test('ordinary worlds expand during bombardment and occupy the empty world after firing', async function () {
	const world = await setup();
	try {
		const carrier = named(world, 'Red carrier');
		const target = named(world, 'Fortress');
		const source = named(world, 'Rival');
		carrier.components.planet.x = 676; carrier.components.planet.y = 600;
		source.components.planet.troops = 30;
		const expansion = world.spawn({ planet: {
			name: 'Expansion', x: 1100, y: 400, radius: 30, owner: 'neutral',
			troops: 1, guns: 0, rate: 0, production: 'troops', progress: 0,
		} });
		spawnShip(world, target.id, 'red');
		decide(world);
		expect(carrier.components.planet.carrier?.bombardment?.target).toBe(target.id);
		expect(cargoTo(world, target.id)).toBe(0);
		expect(cargoTo(world, expansion.id)).toBeGreaterThan(1);
		advance(world, CONFIG.bombardmentCharge + 0.1);
		expect(target.components.planet.owner).toBe('neutral');
		expect(target.components.planet.troops).toBe(0);
		// Isolate follow-up occupation from the earlier expansion's arriving army.
		for (const entry of units(world)) if (entry.components.unit.kind === 'transport') world.removeEntity(entry.id);
		expansion.components.planet.owner = 'red';
		source.components.planet.troops = 10;
		decide(world);
		expect(cargoTo(world, target.id)).toBeGreaterThan(0);
		advance(world, 80);
		expect(target.components.planet.owner).toBe('red');
		expect(carrier.components.planet.troops).toBe(20);
	} finally { await world.dispose(); }
});

test('carrier sends escorts against a bombardment target and launches local defenders without giving away crew', async function () {
	const world = await setup();
	try {
		const carrier = named(world, 'Red carrier');
		const target = named(world, 'Fortress');
		target.components.planet.owner = 'blue';
		for (let ship = 0; ship < 5; ship++) spawnShip(world, carrier.id, 'red');
		spawnShip(world, target.id, 'blue');
		decide(world);
		expect(units(world).filter(function (entry) {
			return entry.components.unit.owner === 'red' && entry.components.unit.target === target.id && entry.components.unit.phase === 'travel';
		})).toHaveLength(3);
		expect(carrier.components.planet.troops).toBe(20);
		spawnShip(world, carrier.id, 'blue');
		const order = carrier.components.planet.carrier?.bombardment;
		decide(world);
		expect(dockedShips(world, carrier.id, 'red')).toHaveLength(0);
		expect(shipsAt(world, carrier.id, 'red')).toHaveLength(2);
		expect(carrier.components.planet.carrier?.bombardment).toBe(order);
		expect(carrier.components.planet.production).toBe('ships');
		expect(carrier.components.planet.troops).toBe(20);
	} finally { await world.dispose(); }
});

for (const mode of ['conquest', 'center-race'] as const) {
	for (const charging of [false, true]) test(`${mode}: AI boards a ${charging ? 'charging' : 'approaching'} player carrier threatening a red world`, async function () {
		const world = await setup({ mode });
		try {
			const player = named(world, 'Blue carrier');
			const source = named(world, 'Rival');
			const rival = named(world, 'Red carrier');
			source.components.planet.troops = 40;
			player.components.planet.x = charging ? 1024 : 950;
			player.components.planet.y = 150;
			for (let ship = 0; ship < 2; ship++) spawnShip(world, player.id, 'blue');
			for (let ship = 0; ship < 5; ship++) spawnShip(world, source.id, 'red');
			expect(bombardPlanet(world, player.id, source.id)).toBe(true);
			if (charging) advance(world, 1);
			decide(world);
			expect(cargoTo(world, player.id)).toBeGreaterThan(player.components.planet.troops);
			expect(units(world).filter(function (entry) {
				return entry.components.unit.owner === 'red' && entry.components.unit.kind === 'ship' && entry.components.unit.target === player.id;
			})).toHaveLength(5);
			expect(rival.components.planet.troops).toBe(20);
			if (mode === 'center-race') {
				const destination = destinationFor(world.getResource('objectives'), 'red');
				if (!destination) throw new Error('Missing race destination');
				expect(rival.components.planet.carrier?.destination).toEqual({ x: destination.x, y: destination.y });
				expect(rival.components.planet.carrier?.bombardment).toBeUndefined();
			}
			if (charging) {
				advance(world, 12);
				expect(player.components.planet.owner).toBe('red');
				expect(player.components.planet.carrier?.bombardment).toBeUndefined();
				expect(source.components.planet.owner).toBe('red');
			}
		} finally { await world.dispose(); }
	});
}

test('AI does not send a boarding force without enough escorts for the docked defenders', async function () {
	const world = await setup();
	try {
		const player = named(world, 'Blue carrier');
		const source = named(world, 'Rival');
		source.components.planet.troops = 40;
		for (let ship = 0; ship < 4; ship++) spawnShip(world, player.id, 'blue');
		spawnShip(world, source.id, 'red');
		bombardPlanet(world, player.id, source.id);
		decide(world);
		expect(cargoTo(world, player.id)).toBe(0);
		expect(player.components.planet.owner).toBe('blue');
		expect(source.components.planet.production).toBe('ships');
		expect(source.components.planet.troops).toBe(40);
	} finally { await world.dispose(); }
});

test('a carrier-only AI reoccupies a bombarded world using surplus crew and retains its defense reserve', async function () {
	const world = await setup();
	try {
		const carrier = named(world, 'Red carrier');
		const target = named(world, 'Fortress');
		named(world, 'Rival').components.planet.owner = 'blue';
		carrier.components.planet.x = 676;
		carrier.components.planet.y = 600;
		carrier.components.planet.troops = 21;
		expect(bombardPlanet(world, carrier.id, target.id, 'red')).toBe(true);
		advance(world, CONFIG.bombardmentCharge);
		expect(target.components.planet.troops).toBe(0);
		decide(world);
		expect(cargoTo(world, target.id)).toBe(1);
		expect(carrier.components.planet.troops).toBe(20);
		advance(world, 10);
		expect(target.components.planet.owner).toBe('red');
	} finally { await world.dispose(); }
});

test('carrier bombardment keeps opponent target preferences', async function () {
	for (const style of ['expansionist', 'aggressive', 'defensive'] as const) {
		const world = await setup({ opponent: { difficulty: 'standard', style } });
		try {
			const carrier = named(world, 'Red carrier').components.planet;
			carrier.x = 500; carrier.y = 150;
			const neutral = named(world, 'Fortress');
			neutral.components.planet.x = 850; neutral.components.planet.y = 150;
			neutral.components.planet.troops = 20;
			decide(world);
			expect(carrier.carrier?.bombardment?.target).toBe(style === 'aggressive' ? named(world, 'Player').id : neutral.id);
		} finally { await world.dispose(); }
	}
});
