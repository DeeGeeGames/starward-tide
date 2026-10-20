import { expect, test } from 'bun:test';
import { advanceCampaign, applyCampaignEncounterResult, cancelExpedition, campaignWinner, commitExpedition,
	expeditionArrival, isActiveExpedition, MINIMUM_CAMPAIGN_EVENT_SECONDS, neutralClaimMinimum, setCampaignPaused } from './campaign-state';
import type { CampaignEncounterResult, CampaignState, ExpeditionOrder } from './campaign-state';
import { createCampaign, commitCampaignRival } from './campaign-scenario';

const initial = function (): CampaignState {
	const state = createCampaign();
	return { ...state, nextRivalTime: 10000, planets: state.planets.map(function (planet) {
		return planet.id === 'sol:1' || planet.id === 'sol:2' || planet.id === 'sirius:1' || planet.id === 'sirius:2'
			? { ...planet, points: 100 } : planet;
	}) };
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

test('home reserves grow by value while neutral planets stay at zero', function () {
	const opening = createCampaign();
	const state = { ...opening, nextRivalTime: 10000 };
	const advanced = run(state, 1000);
	expect(advanced.planets.find(function (planet) { return planet.id === 'sol:1'; })?.points).toBeCloseTo(201);
	expect(advanced.planets.find(function (planet) { return planet.id === 'sol:2'; })?.points).toBeCloseTo(246);
	expect(advanced.planets.filter(function (planet) { return planet.factionId === null; })
		.every(function (planet) { return planet.points === 0; })).toBe(true);
	expect(advanced.planets.some(function (planet) { return planet.points > 120; })).toBe(true);
	expect(advanceCampaign(state, 100)).toBe(state);
});

test('pause freezes point generation while orders remain available and fractional balances cannot fund whole points', function () {
	const state = initial();
	expect(advanceCampaign(state, 100)).toBe(state);
	const sent = commitExpedition(state, order('a'));
	expect(sent.planets.find(function (planet) { return planet.id === 'sol:1'; })?.points).toBe(50);
	expect(commitExpedition(sent, order('a'))).toBe(sent);
	expect(function () { commitExpedition(sent, order('a', 51)); }).toThrow();
	expect(commitExpedition(setCampaignPaused(sent, false), order('b', 20)).expeditions).toHaveLength(2);
	expect(state.planets.find(function (planet) { return planet.id === 'sol:1'; })?.points).toBe(100);
	const fractional = { ...state, planets: state.planets.map(function (planet) {
		return planet.id === 'sol:1' ? { ...planet, points: 0.9 } : planet;
	}) };
	expect(function () { commitExpedition(fractional, order('fraction', 1)); }).toThrow();
	for (const invalid of [-1, NaN, Infinity]) expect(function () { run(state, invalid); }).toThrow();
});

test('travel uses seconds and freezes point generation exactly at combat', function () {
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
	const frozen = structuredClone(battle.planets);
	const returned = applyCampaignEncounterResult(battle, result(battle, false));
	expect(returned.time).toBe(25.5);
	expect(returned.paused).toBe(true);
	expect(returned.planets).toEqual(frozen);
	expect(run(returned, 1).time).toBe(26.5);
	expect(commitExpedition(state, order('minimum')).expeditions[0]?.arrivalTime).toBe(10);
});

test('same-time hostile arrivals resolve once in identity order without generation during combat', function () {
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

test('neutral claim price follows system planet values and a successful claim resets every captured planet', function () {
	const state = initial();
	const minimum = neutralClaimMinimum(state, 'deneb');
	expect(minimum).toBe(20);
	const claim = { ...order('claim', minimum), destinationSystemId: 'deneb' };
	expect(function () { commitExpedition(state, { ...claim, contributions: [{ planetId: 'sol:1', points: minimum - 1 }] }); }).toThrow();
	const returned = run(commitExpedition(state, claim), 10);
	expect(returned.encounter).toBeNull();
	expect(returned.planets.filter(function (planet) { return planet.systemId === 'deneb'; })
		.every(function (planet) { return planet.factionId === 'blue' && planet.points === 0; })).toBe(true);
	const fundedClaim = { ...returned, planets: returned.planets.map(function (planet) {
		return planet.id === 'deneb:1' ? { ...planet, points: 1 } : planet;
	}) };
	const next = commitExpedition(fundedClaim, { ...order('new', 1), sourceSystemId: 'deneb', contributions: [{ planetId: 'deneb:1', points: 1 }] });
	expect(next.expeditions).toHaveLength(2);
});

test('friendly arrivals into systems with neutral planets add points only to owned planets', function () {
	const state = initial();
	const mixed = { ...state, planets: state.planets.map(function (planet) {
		if (planet.systemId !== 'deneb') return planet;
		return planet.id === 'deneb:1' ? { ...planet, factionId: 'blue' as const, points: 100 }
			: { ...planet, factionId: null };
	}) };
	const arrived = run(commitExpedition(mixed, { ...order('friendly-mixed', 50), destinationSystemId: 'deneb' }), 10);
	expect(arrived.encounter).toBeNull();
	expect(arrived.expeditions.find(function (item) { return item.id === 'friendly-mixed'; })?.status).toBe('resolved');
	expect(arrived.planets.find(function (planet) { return planet.id === 'deneb:1'; })?.points).toBeGreaterThan(150);
	expect(arrived.planets.filter(function (planet) { return planet.systemId === 'deneb' && planet.id !== 'deneb:1'; })
		.every(function (planet) { return planet.factionId === null; })).toBe(true);
});

test('friendly reinforcements add points across owned destination planets without a capacity ceiling', function () {
	const state = { ...initial(), planets: initial().planets.map(function (planet) {
		return planet.systemId === 'deneb' ? { ...planet, factionId: 'blue' as const, points: 200 } :
			planet.id === 'sol:1' ? { ...planet, points: 200 } : planet;
	}) };
	const orderToFriendly = { ...order('friendly', 200), destinationSystemId: 'deneb', contributions: [{ planetId: 'sol:1', points: 200 }] };
	const arrived = run(commitExpedition(state, orderToFriendly), 10);
	const destination = arrived.planets.filter(function (planet) { return planet.systemId === 'deneb'; });
	expect(arrived.expeditions[0]?.status).toBe('resolved');
	expect(destination.reduce(function (sum, planet) { return sum + planet.points; }, 0)).toBeCloseTo(600 + 3.596153846153846 + 200);
	expect(destination.every(function (planet) { return planet.points > 200; })).toBe(true);
	const valueless = { ...initial(), planets: initial().planets.map(function (planet) {
		if (planet.systemId === 'deneb') return { ...planet, factionId: 'blue' as const, points: 0, value: 0 };
		return planet.id === 'sol:1' ? { ...planet, points: 10 } : planet;
	}) };
	const evenlyDistributed = run(commitExpedition(valueless, { ...order('zero-value-reinforcement', 10),
		destinationSystemId: 'deneb' }), 10).planets.filter(function (planet) { return planet.systemId === 'deneb'; });
	expect(evenlyDistributed.every(function (planet) { return Math.abs(planet.points - 10 / 3) < 1e-12; })).toBe(true);
});

test('immediate cancellation and delayed recall refund only their original still-owned planets', function () {
	const state = initial();
	const committed = commitExpedition(state, order('cancel'));
	const cancelled = cancelExpedition(committed, 'cancel', 'blue');
	expect(cancelled.planets.find(function (planet) { return planet.id === 'sol:1'; })?.points).toBe(100);
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
	expect(arrived.planets.find(function (planet) { return planet.id === 'sol:1'; })?.points).toBeGreaterThan(70);
	expect(arrived.planets.find(function (planet) { return planet.id === 'sol:2'; })?.points).toBeGreaterThan(70);
});

test('recall refunds reject system totals beyond the safe numeric range', function () {
	const base = createCampaign();
	const maximum = Number.MAX_SAFE_INTEGER;
	const state = { ...base, nextRivalTime: 10000,
		rules: { ...base.rules, economy: { ...base.rules.economy, generationPerValueSecond: 0 } },
		planets: base.planets.map(function (planet) {
			if (planet.id === 'sol:1') return { ...planet, points: maximum - 100 };
			if (planet.id === 'sol:2') return { ...planet, points: 50 };
			if (planet.id === 'deneb:1') return { ...planet, factionId: 'blue' as const, points: 60 };
			return planet;
		}),
	};
	const outbound = commitExpedition(state, { ...order('z-recall', 60), destinationSystemId: 'deneb' });
	const friendly = commitExpedition(outbound, { id: 'a-friendly', factionId: 'blue', sourceSystemId: 'deneb', destinationSystemId: 'sol',
		contributions: [{ planetId: 'deneb:1', points: 60 }] });
	const elapsed = run(friendly, 5);
	const recalled = cancelExpedition(elapsed, 'z-recall', 'blue');
	expect(function () { advanceCampaign(recalled, 5); }).toThrow('Campaign point total exceeds the safe numeric range.');
	expect(state.planets.find(function (planet) { return planet.id === 'sol:1'; })?.points).toBe(maximum - 100);
});

test('captures and recaptures clear only the planet whose ownership changes', function () {
	const battle = run(commitExpedition(initial(), order('battle')), 10);
	const target = battle.encounter?.planets[0];
	if (!target) throw new Error('Expected target');
	const unchanged = result(battle, false);
	const outcome = { ...unchanged, captureEvents: [
		{ planetId: target.planetId, factionId: 'blue' as const },
		{ planetId: target.planetId, factionId: 'red' as const },
	] };
	const returned = applyCampaignEncounterResult(battle, outcome);
	expect(returned.planets.find(function (planet) { return planet.id === target.planetId; })?.points).toBe(0);
	expect(returned.planets.filter(function (planet) { return planet.systemId === 'sirius' && planet.id !== target.planetId; })
		.every(function (planet) { return planet.points > 0; })).toBe(true);
	expect(returned.time).toBe(battle.time);
	expect(function () { applyCampaignEncounterResult(battle, { ...outcome, ownership: [] }); }).toThrow();
	expect(cancelExpedition(battle, 'battle', 'blue')).toBe(battle);
});

test('rival expands from zero after generation and budgets only whole available points', function () {
	const opening = createCampaign();
	const empty = { ...opening, planets: opening.planets.map(function (planet) { return { ...planet, points: 0 }; }) };
	expect(commitCampaignRival(empty)).toBe(empty);
	const firstDecision = advanceCampaign(setCampaignPaused(empty, false), 10);
	expect(firstDecision.expeditions).toHaveLength(1);
	expect(firstDecision.expeditions[0]?.points).toBe(3);
	expect(firstDecision.expeditions[0]?.departureTime).toBe(10);
	expect(firstDecision.expeditions[0]?.arrivalTime).toBe(20);
	const funded = { ...empty, planets: empty.planets.map(function (planet) {
		return planet.factionId === 'red' ? { ...planet, points: 100 } : planet;
	}) };
	const next = commitCampaignRival(funded);
	expect(next.expeditions[0]?.points).toBe(150);
	expect(next.expeditions[0]?.contributions).toEqual([{ planetId: 'sirius:1', points: 100 }, { planetId: 'sirius:2', points: 50 }]);
});

test('clock partitioning preserves generation, rival cadence, travel, and ownership', function () {
	const state = setCampaignPaused(createCampaign(), false);
	const whole = advanceCampaign(state, 28);
	let partitioned = state;
	for (let tick = 0; tick < 112; tick++) partitioned = advanceCampaign(partitioned, 0.25);
	expect(partitioned.time).toBe(whole.time);
	expect(partitioned.expeditions).toEqual(whole.expeditions);
	for (const [index, planet] of whole.planets.entries())
		expect(partitioned.planets[index]?.points).toBeCloseTo(planet.points);
});

test('invalid routes, ownership, spending and unsafe point totals fail without mutation', function () {
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
	const unsafe = { ...state, planets: state.planets.map(function (planet) {
		return planet.systemId === 'sol' ? { ...planet, points: 4_000_000_000_000_000, value: 0 } : planet;
	}) };
	expect(function () { run(unsafe, 1); }).toThrow('Campaign point total');
});

test('opposing same-time arrivals claim first then fight the new owner', function () {
	const state = initial();
	const equalRoutes = { ...state, systems: state.systems.map(function (system) {
		return system.id === 'sirius' ? { ...system, x: 100, y: 300 } : system;
	}) };
	const claimPrice = neutralClaimMinimum(equalRoutes, 'deneb');
	const blue = commitExpedition(equalRoutes, { ...order('a-claim', claimPrice), destinationSystemId: 'deneb' });
	const both = commitExpedition(blue, { id: 'z-attack', factionId: 'red', sourceSystemId: 'sirius', destinationSystemId: 'deneb',
		contributions: [{ planetId: 'sirius:1', points: claimPrice }] });
	const battle = run(both, 100);
	expect(battle.time).toBe(10);
	expect(battle.expeditions[0]?.status).toBe('resolved');
	expect(battle.encounter?.expeditionId).toBe('z-attack');
	expect(battle.encounter?.planets.every(function (planet) { return planet.factionId === 'blue'; })).toBe(true);
});

test('same-time returns obey encounter ordering and are refunded once after combat', function () {
	for (const returnFirst of [true, false]) {
		const state = initial();
		const id = returnFirst ? 'a-return' : 'z-return';
		const outbound = commitExpedition(state, { ...order(id, 30), destinationSystemId: 'deneb' });
		const invaded = commitExpedition(outbound, { id: 'm-invasion', factionId: 'red', sourceSystemId: 'sirius', destinationSystemId: 'sol',
			contributions: [{ planetId: 'sirius:1', points: 10 }] });
		const recalled = cancelExpedition(run(invaded, 5), id, 'blue');
		const battle = advanceCampaign(recalled, 20);
		expect(battle.time).toBe(10);
		expect(battle.expeditions.find(function (item) { return item.id === id; })?.status).toBe(returnFirst ? 'resolved' : 'returning');
		const outcome = result(battle, false);
		const returned = applyCampaignEncounterResult(battle, outcome);
		expect(returned.expeditions.find(function (item) { return item.id === id; })?.status).toBe('resolved');
		expect(returned.planets.find(function (planet) { return planet.id === 'sol:1'; })?.points).toBeGreaterThan(70);
		expect(applyCampaignEncounterResult(returned, outcome)).toBe(returned);
	}
});

test('unsafe timing rules are rejected before scheduling or advancing galaxy time', function () {
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
