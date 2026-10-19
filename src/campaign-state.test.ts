import { expect, test } from 'bun:test';
import { advanceCampaign, applyCampaignEncounterResult, cancelExpedition, campaignWinner, commitExpedition,
	expeditionArrival, isActiveExpedition, MINIMUM_CAMPAIGN_EVENT_SECONDS, neutralClaimMinimum, setCampaignPaused } from './campaign-state';
import type { CampaignEncounterResult, CampaignState, ExpeditionOrder } from './campaign-state';
import { createCampaign } from './campaign-scenario';

const initial = function (): CampaignState {
	const state = createCampaign();
	return { ...state, nextRivalTime: 10000 };
};
const order = function (id: string, points = 50): ExpeditionOrder {
	return { id, factionId: 'blue', sourceSystemId: 'sol', destinationSystemId: 'sirius', contributions: [{ planetId: 'sol:1', points }] };
};
const run = function (state: CampaignState, elapsed: number): CampaignState {
	return advanceCampaign(setCampaignPaused(state, false), elapsed);
};
const result = function (state: CampaignState, capture: boolean): CampaignEncounterResult {
	const encounter = state.encounter;
	if (!encounter) throw new Error('Expected encounter');
	return { encounterId: encounter.id,
		captureEvents: capture ? encounter.planets.filter(function (planet) { return planet.factionId !== encounter.attacker; })
			.map(function (planet) { return { planetId: planet.planetId, factionId: encounter.attacker }; }) : [],
		ownership: encounter.planets.map(function (planet) { return { planetId: planet.planetId, factionId: capture ? encounter.attacker : planet.factionId }; }) };
};

test('pause freezes all campaign state while orders remain available paused and running', function () {
	const state = initial();
	expect(advanceCampaign(state, 100)).toBe(state);
	const sent = commitExpedition(state, order('a'));
	expect(sent.planets[0]?.depletion).toBe(50);
	expect(commitExpedition(sent, order('a'))).toBe(sent);
	expect(function () { commitExpedition(sent, order('a', 20)); }).toThrow();
	expect(commitExpedition(setCampaignPaused(sent, false), order('b', 20)).expeditions).toHaveLength(2);
	expect(state.planets[0]?.depletion).toBe(0);
	for (const invalid of [-1, NaN, Infinity]) expect(function () { advanceCampaign(state, invalid); }).toThrow();
});

test('travel uses seconds and a minimum duration, stopping precisely at combat without replaying the frame remainder', function () {
	const state = initial();
	const longer = { ...state, systems: state.systems.map(function (system) { return system.id === 'sirius' ? { ...system, x: 355 } : system; }) };
	const sent = commitExpedition(longer, order('travel'));
	expect(sent.expeditions[0]?.arrivalTime).toBe(25.5);
	const before = run(sent, 25);
	expect(before.time).toBe(25);
	expect(before.phase).toBe('galaxy');
	const battle = advanceCampaign(before, 50);
	expect(battle.time).toBe(25.5);
	expect(battle.phase).toBe('encounter');
	expect(battle.paused).toBe(true);
	expect(advanceCampaign(battle, 100)).toBe(battle);
	expect(setCampaignPaused(battle, false)).toBe(battle);
	const returned = applyCampaignEncounterResult(battle, result(battle, false));
	expect(returned.time).toBe(25.5);
	expect(returned.paused).toBe(true);
	expect(run(returned, 1).time).toBe(26.5);
	expect(commitExpedition(state, order('minimum')).expeditions[0]?.arrivalTime).toBe(10);
});

test('same-time hostile arrivals resolve by identity exactly once with no growth during battles', function () {
	let state = commitExpedition(initial(), order('z', 20));
	state = commitExpedition(state, order('a', 20));
	const first = run(state, 100);
	expect(first.encounter?.expeditionId).toBe('a');
	const firstResult = result(first, false);
	const second = applyCampaignEncounterResult(first, firstResult);
	expect(second.encounter?.expeditionId).toBe('z');
	expect(second.time).toBe(10);
	expect(second.planets).toEqual(first.planets);
	expect(applyCampaignEncounterResult(second, firstResult)).toBe(second);
	const secondResult = result(second, true);
	const returned = applyCampaignEncounterResult(second, secondResult);
	expect(returned.phase).toBe('galaxy');
	expect(returned.time).toBe(10);
	expect(returned.resolvedEncounters).toHaveLength(2);
	expect(returned.expeditions.every(function (item) { return item.status === 'resolved'; })).toBe(true);
	expect(applyCampaignEncounterResult(returned, secondResult)).toBe(returned);
	expect(function () { applyCampaignEncounterResult(returned, { ...secondResult, captureEvents: [] }); }).toThrow();
	expect(campaignWinner(returned)).toBe('blue');
	expect(run(returned, 100).time).toBe(10);
});

test('chronological timestamps take priority over expedition identities', function () {
	const sent = commitExpedition(initial(), order('z', 20));
	const later = commitExpedition(run(sent, 1), order('a', 20));
	expect(run(later, 100).encounter?.expeditionId).toBe('z');
});

test('neutral claim uses baseline minimum and enables immediate orders from the new system', function () {
	const state = initial();
	expect(neutralClaimMinimum(state, 'deneb')).toBe(30);
	const claim = { ...order('claim', 30), destinationSystemId: 'deneb' };
	expect(function () { commitExpedition(state, { ...claim, contributions: [{ planetId: 'sol:1', points: 29 }] }); }).toThrow();
	const returned = run(commitExpedition(state, claim), 10);
	expect(returned.encounter).toBeNull();
	expect(returned.planets.filter(function (planet) { return planet.systemId === 'deneb'; })
		.every(function (planet) { return planet.factionId === 'blue' && planet.capturedTime === 10 && planet.developmentBonusPoints === 0; })).toBe(true);
	expect(commitExpedition(returned, { ...order('new', 10), sourceSystemId: 'deneb', contributions: [{ planetId: 'deneb:1', points: 10 }] }).expeditions).toHaveLength(2);
});

test('friendly arrivals replenish depletion without importing extra campaign capacity', function () {
	const state = initial();
	const friendly = { ...state, planets: state.planets.map(function (planet) {
		return planet.systemId === 'deneb' ? { ...planet, factionId: 'blue' as const, depletion: 100 } : planet;
	}) };
	const arrived = run(commitExpedition(friendly, { ...order('friendly', 50), destinationSystemId: 'deneb' }), 10);
	expect(arrived.expeditions[0]?.status).toBe('resolved');
	expect(arrived.planets.filter(function (planet) { return planet.systemId === 'deneb'; }).reduce(function (sum, planet) { return sum + planet.depletion; }, 0)).toBeCloseTo(219.7);
});

test('friendly arrivals into systems with neutral planets replenish owned planets without starting an encounter', function () {
	const state = initial();
	const mixed = { ...state, planets: state.planets.map(function (planet) {
		if (planet.systemId !== 'deneb') return planet;
		return planet.id === 'deneb:1' ? { ...planet, factionId: 'blue' as const, depletion: 100 }
			: { ...planet, factionId: null };
	}) };
	const arrived = run(commitExpedition(mixed, { ...order('friendly-mixed', 50), destinationSystemId: 'deneb' }), 10);
	expect(arrived.encounter).toBeNull();
	expect(arrived.expeditions.find(function (item) { return item.id === 'friendly-mixed'; })?.status).toBe('resolved');
	expect(arrived.planets.find(function (planet) { return planet.id === 'deneb:1'; })?.depletion).toBeLessThan(100);
	expect(arrived.planets.filter(function (planet) { return planet.systemId === 'deneb' && planet.id !== 'deneb:1'; })
		.every(function (planet) { return planet.factionId === null; })).toBe(true);
});

test('instant cancellation refunds once and elapsed travel recalls only to original still-owned sources', function () {
	const state = initial();
	const committed = commitExpedition(state, order('cancel'));
	const cancelled = cancelExpedition(committed, 'cancel', 'blue');
	expect(cancelled.planets[0]?.depletion).toBe(0);
	expect(cancelled.expeditions.filter(isActiveExpedition)).toHaveLength(0);
	expect(cancelExpedition(cancelled, 'cancel', 'blue')).toBe(cancelled);
	expect(cancelExpedition(committed, 'cancel', 'red')).toBe(committed);
	const split = { ...order('recall'), contributions: [{ planetId: 'sol:1', points: 30 }, { planetId: 'sol:2', points: 20 }] };
	const elapsed = run(commitExpedition(state, split), 3.5);
	const recalled = cancelExpedition(elapsed, 'recall', 'blue');
	const expedition = recalled.expeditions[0];
	if (!expedition) throw new Error('Expected recall');
	expect(expeditionArrival(expedition)).toBe(7);
	expect(expedition.status).toBe('returning');
	const lost = { ...recalled, planets: recalled.planets.map(function (planet) { return planet.id === 'sol:2' ? { ...planet, factionId: 'red' as const } : planet; }) };
	const arrived = advanceCampaign(lost, 3.5);
	expect(arrived.expeditions[0]?.status).toBe('resolved');
	expect(arrived.planets[0]?.depletion).toBe(0);
	expect(arrived.planets[1]?.depletion).toBeGreaterThan(12);
});

test('capture and recapture apply ordered bonus penalties without tactical currency or recovery', function () {
	const battle = run(commitExpedition(initial(), order('battle')), 10);
	const target = battle.encounter?.planets[0];
	if (!target) throw new Error('Expected target');
	const unchanged = result(battle, false);
	const outcome = { ...unchanged, captureEvents: [{ planetId: target.planetId, factionId: 'blue' as const }, { planetId: target.planetId, factionId: 'red' as const }] };
	const returned = applyCampaignEncounterResult(battle, outcome);
	expect(returned.planets.find(function (planet) { return planet.id === target.planetId; })?.developmentBonusPoints).toBeCloseTo(0.5);
	expect(returned.time).toBe(battle.time);
	expect(function () { applyCampaignEncounterResult(battle, { ...outcome, ownership: [] }); }).toThrow();
	expect(cancelExpedition(battle, 'battle', 'blue')).toBe(battle);
});

test('arrival before a coincident rival decision prevents spending until galaxy resumes', function () {
	const state = createCampaign();
	const battle = run(commitExpedition(state, order('battle')), 10);
	expect(battle.encounter?.expeditionId).toBe('battle');
	expect(battle.expeditions).toHaveLength(1);
	const returned = applyCampaignEncounterResult(battle, result(battle, false));
	expect(returned.expeditions).toHaveLength(1);
	const resumed = run(returned, 0.1);
	expect(resumed.expeditions.at(-1)?.id).toBe('rival:10');
	expect(resumed.nextRivalTime).toBe(20);
});

test('clock partitioning preserves AI cadence, travel, balances and ownership', function () {
	const state = setCampaignPaused(createCampaign(), false);
	const whole = advanceCampaign(state, 28);
	let partitioned = state;
	for (let tick = 0; tick < 112; tick++) partitioned = advanceCampaign(partitioned, 0.25);
	expect(partitioned.time).toBe(whole.time);
	expect(partitioned.expeditions).toEqual(whole.expeditions);
	for (const [index, planet] of whole.planets.entries()) {
		expect(partitioned.planets[index]?.depletion).toBeCloseTo(planet.depletion);
		expect(partitioned.planets[index]?.developmentBonusPoints).toBeCloseTo(planet.developmentBonusPoints);
	}
});

test('invalid routes, ownership and overspending fail atomically without altering balances', function () {
	const state = initial();
	const invalid: readonly ExpeditionOrder[] = [
		{ ...order('empty'), id: '' },
		{ ...order('missing'), destinationSystemId: 'missing' },
		{ ...order('same'), destinationSystemId: 'sol' },
		{ ...order('source'), sourceSystemId: 'missing' },
		{ ...order('enemy'), contributions: [{ planetId: 'sirius:1', points: 20 }] },
		{ ...order('overspend'), contributions: [{ planetId: 'sol:1', points: 101 }] },
		{ ...order('duplicate'), contributions: [{ planetId: 'sol:1', points: 10 }, { planetId: 'sol:1', points: 10 }] },
		{ ...order('fraction'), contributions: [{ planetId: 'sol:1', points: 1.5 }] },
		{ ...order('zero'), contributions: [] },
	];
	const snapshot = structuredClone(state);
	for (const item of invalid) {
		expect(function () { commitExpedition(state, item); }).toThrow();
		expect(state).toEqual(snapshot);
	}
	const battle = run(commitExpedition(state, order('battle')), 10);
	expect(function () { commitExpedition(battle, order('frozen')); }).toThrow();
});

test('friendly replenishment uses highest depletion first, stable identity ties and discards surplus', function () {
	const state = initial();
	const friendly: CampaignState = { ...state, rules: { ...state.rules, recovery: { fractionOfMaximum: 0 } },
		planets: state.planets.map(function (planet) {
			return planet.systemId === 'deneb' ? { ...planet, factionId: 'blue' as const, depletion: planet.id === 'deneb:3' ? 80 : 50 } : planet;
		}) };
	const arrived = run(commitExpedition(friendly, { ...order('refill', 100), destinationSystemId: 'deneb' }), 10);
	expect(arrived.planets.filter(function (planet) { return planet.systemId === 'deneb'; })
		.map(function (planet) { return planet.depletion; })).toEqual([30, 50, 0]);
	const surplus = run(commitExpedition(friendly, { ...order('surplus'), destinationSystemId: 'deneb',
		contributions: [{ planetId: 'sol:1', points: 100 }, { planetId: 'sol:2', points: 100 }, { planetId: 'sol:3', points: 100 }] }), 10);
	expect(surplus.planets.filter(function (planet) { return planet.systemId === 'deneb'; })
		.every(function (planet) { return planet.depletion === 0 && planet.developmentBonusPoints === 2; })).toBe(true);
});

test('opposing same-time neutral arrivals claim first then fight the new owner', function () {
	const state = initial();
	const equalRoutes = { ...state, systems: state.systems.map(function (system) {
		return system.id === 'sirius' ? { ...system, x: 100, y: 300 } : system;
	}) };
	const blue = commitExpedition(equalRoutes, { ...order('a-claim', 30), destinationSystemId: 'deneb' });
	const both = commitExpedition(blue, { id: 'z-attack', factionId: 'red', sourceSystemId: 'sirius', destinationSystemId: 'deneb',
		contributions: [{ planetId: 'sirius:1', points: 30 }] });
	const battle = run(both, 100);
	expect(battle.time).toBe(10);
	expect(battle.expeditions[0]?.status).toBe('resolved');
	expect(battle.encounter?.expeditionId).toBe('z-attack');
	expect(battle.encounter?.planets.every(function (planet) { return planet.factionId === 'blue'; })).toBe(true);
});

test('same-time returns obey encounter ordering and are refunded once after combat', function () {
	for (const returnFirst of [true, false]) {
		const state = initial();
		const noRecovery = { ...state, rules: { ...state.rules, recovery: { fractionOfMaximum: 0 } } };
		const id = returnFirst ? 'a-return' : 'z-return';
		const outbound = commitExpedition(noRecovery, { ...order(id, 30), destinationSystemId: 'deneb' });
		const invaded = commitExpedition(outbound, { id: 'm-invasion', factionId: 'red', sourceSystemId: 'sirius', destinationSystemId: 'sol',
			contributions: [{ planetId: 'sirius:1', points: 10 }] });
		const recalled = cancelExpedition(run(invaded, 5), id, 'blue');
		const battle = advanceCampaign(recalled, 20);
		expect(battle.time).toBe(10);
		expect(battle.expeditions.find(function (item) { return item.id === id; })?.status).toBe(returnFirst ? 'resolved' : 'returning');
		expect(battle.planets[0]?.depletion).toBe(returnFirst ? 0 : 30);
		const outcome = result(battle, false);
		const returned = applyCampaignEncounterResult(battle, outcome);
		expect(returned.planets[0]?.depletion).toBe(0);
		expect(returned.expeditions.find(function (item) { return item.id === id; })?.status).toBe('resolved');
		expect(applyCampaignEncounterResult(returned, outcome)).toBe(returned);
	}
});


test('unsafe tiny timing rules are rejected before scheduling or advancing galaxy time', function () {
	const state = initial();
	for (const field of ['rivalInterval', 'minimumTravelTime'] as const) {
		for (const interval of [0, Number.MIN_VALUE, MINIMUM_CAMPAIGN_EVENT_SECONDS / 2, Infinity]) {
			const unsafe = { ...state, rules: { ...state.rules, [field]: interval } };
			expect(function () { advanceCampaign(unsafe, 0.1); }).toThrow('Campaign event intervals');
			expect(function () { run(unsafe, 0.1); }).toThrow('Campaign event intervals');
			expect(function () { commitExpedition(unsafe, order('unsafe')); }).toThrow('Campaign event intervals');
		}
	}
	const supported = { ...state, rules: { ...state.rules, minimumTravelTime: MINIMUM_CAMPAIGN_EVENT_SECONDS,
		rivalInterval: MINIMUM_CAMPAIGN_EVENT_SECONDS } };
	expect(function () { run(supported, 0.1); }).not.toThrow();
});
