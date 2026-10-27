import { expect, test } from 'bun:test';
import { CONFIG } from './config';
import { activeOrders, createGame, planets, units } from './game';
import type { Game } from './game';
import { captureConquestSave } from './game-save';
import type { StarMap } from './maps';
import { DEFAULT_OPPONENT, resolveOpponent } from './opponent';
import type { OpponentSettings } from './opponent';
import { parseConquestSave } from './save-state';

const map: StarMap = {
	width: 1200, height: 1000,
	planets: [
		['Rival', 100, 100, 30, 'red', 50, 0],
		['Player', 500, 100, 30, 'blue', 1, 0],
		['Neutral', 500, 300, 30, 'neutral', 1, 0],
	],
};
const advance = function (world: Game, seconds: number): void {
	for (let tick = 0; tick < Math.round(seconds / CONFIG.step); tick++) world.update(CONFIG.step);
};
const targetName = function (world: Game): string | undefined {
	const order = activeOrders(world, [], 'red')[0];
	return planets(world).find(function (entry) { return entry.id === order?.target; })?.components.planet.name;
};

test('difficulty changes actual decision timing without changing starting resources', async function () {
	const worlds: Game[] = [];
	try {
		for (const difficulty of ['relaxed', 'standard', 'hard'] as const) {
			const world = await createGame('skirmish', map, undefined, { opponent: { difficulty, style: 'expansionist' } });
			worlds.push(world);
		}
		const initial = worlds.map(function (world) {
			const save = captureConquestSave(world, map, 'skirmish', 1, 'test');
			return { planets: save.game.planets, units: save.game.units };
		});
		expect(initial[0]).toEqual(initial[1]);
		expect(initial[1]).toEqual(initial[2]);
		for (const world of worlds) {
			advance(world, 1.5);
			expect(targetName(world)).toBe(world.getResource('match').opponent?.difficulty === 'hard' ? 'Neutral' : undefined);
			advance(world, 1.5);
			expect(targetName(world)).toBe(world.getResource('match').opponent?.difficulty === 'relaxed' ? undefined : 'Neutral');
			advance(world, 2.75);
			expect(targetName(world)).toBe('Neutral');
		}
	} finally {
		await Promise.all(worlds.map(function (world) { return world.dispose(); }));
	}
});

test('styles choose distinct targets and defensive worlds build platforms first', async function () {
	for (const style of ['expansionist', 'aggressive', 'defensive'] as const) {
		const world = await createGame('skirmish', map, undefined, { opponent: { difficulty: 'standard', style } });
		try {
			for (const entity of units(world)) {
				if (entity.components.unit.owner === 'blue') world.removeEntity(entity.id);
			}
			advance(world, 3);
			if (style === 'defensive') {
				expect(targetName(world)).toBeUndefined();
				const rival = planets(world).find(function (entry) { return entry.components.planet.owner === 'red'; });
				if (!rival) throw new Error('Missing rival');
				expect(rival.components.planet.production).toBe('guns');
				rival.components.planet.guns = 2;
				advance(world, 3);
			}
			expect(targetName(world)).toBe(style === 'aggressive' ? 'Player' : 'Neutral');
		} finally {
			await world.dispose();
		}
	}
});

test('relaxed waits for a larger troop margin while standard can launch a winning invasion', async function () {
	for (const difficulty of ['relaxed', 'standard'] as const) {
		const world = await createGame('skirmish', map, undefined, { opponent: { difficulty, style: 'expansionist' } });
		try {
			for (const entity of planets(world)) {
				if (entity.components.planet.owner === 'red') entity.components.planet.troops = 2;
			}
			advance(world, 6);
			expect(targetName(world)).toBe(difficulty === 'relaxed' ? undefined : 'Neutral');
		} finally {
			await world.dispose();
		}
	}
});

test('every opponent combination survives save/load with equivalent continued decisions', async function () {
	for (const difficulty of ['relaxed', 'standard', 'hard'] as const) {
		for (const style of ['expansionist', 'aggressive', 'defensive'] as const) {
			const opponent: OpponentSettings = { difficulty, style };
			const original = await createGame('skirmish', map, undefined, { opponent });
			let restored: Game | undefined;
			try {
				advance(original, 0.5);
				const save = parseConquestSave(captureConquestSave(original, map, 'skirmish', 1, 'test'));
				restored = await createGame('skirmish', save.game.map, save.game);
				expect(restored.getResource('match').opponent).toEqual(opponent);
				restored.getResource('match').paused = false;
				advance(original, 6);
				advance(restored, 6);
				const decisions = function (world: Game): unknown {
					const saved = captureConquestSave(world, map, 'skirmish', 1, 'test', 1);
					const name = function (id: number): string | undefined {
						return saved.game.planets.find(function (entry) { return entry.id === id; })?.planet.name;
					};
					return {
						match: saved.game.match,
						planets: saved.game.planets.map(function (entry) { return entry.planet; }),
						units: saved.game.units.map(function ({ unit }) {
							return { owner: unit.owner, kind: unit.kind, phase: unit.phase, cargo: unit.cargo, hp: unit.hp, target: name(unit.target) };
						}),
						orders: saved.game.orderBook.active.map(function (order) {
							return { owner: order.owner, state: order.state, target: name(order.target), sources: order.departures.map(function (departure) { return name(departure.source); }) };
						}),
					};
				};
				expect(decisions(restored)).toEqual(decisions(original));
			} finally {
				await original.dispose();
				await restored?.dispose();
			}
		}
	}
});

test('legacy saves retain standard behavior and invalid settings are rejected', async function () {
	const original = await createGame('skirmish', map);
	let restored: Game | undefined;
	try {
		const save = captureConquestSave(original, map, 'skirmish', 1, 'test');
		delete save.game.match.opponent;
		const legacy = parseConquestSave(save);
		restored = await createGame('skirmish', map, legacy.game);
		expect(restored.getResource('match').opponent).toEqual(DEFAULT_OPPONENT);
		for (const opponent of [null, {}, { difficulty: 'impossible', style: 'aggressive' }, { difficulty: 'hard', style: 'random' }]) {
			const invalid = { ...save, game: { ...save.game, match: { ...save.game.match, opponent } } };
			expect(function () { parseConquestSave(invalid); }).toThrow();
		}
	} finally {
		await original.dispose();
		await restored?.dispose();
	}
});

test('random resolves to a concrete style that can be replayed unchanged', async function () {
	const opponent = resolveOpponent('hard', 'random');
	expect(['expansionist', 'aggressive', 'defensive']).toContain(opponent.style);
	const world = await createGame('skirmish', map, undefined, { opponent });
	let replay: Game | undefined;
	try {
		const saved = parseConquestSave(captureConquestSave(world, map, 'skirmish', 1, 'test'));
		replay = await createGame('skirmish', map, undefined, { opponent: saved.game.match.opponent });
		expect(replay.getResource('match').opponent).toEqual(opponent);
	} finally {
		await world.dispose();
		await replay?.dispose();
	}
});
