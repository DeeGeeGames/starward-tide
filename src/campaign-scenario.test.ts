import { expect, test } from 'bun:test';
import { campaignWinner, commitCampaignRival, createCampaign, createGeneratedCampaign } from './campaign-scenario';
import { generateMap, MAP_SIZES } from './maps';
import { parseCampaignSave } from './campaign-save';
import { applyCampaignEncounterResult, commitExpedition, advanceCampaign, setCampaignPaused } from './campaign-state';
import type { CampaignState } from './campaign-state';

const finish = function (state: CampaignState): CampaignState {
	return advanceCampaign(setCampaignPaused(state, false), 10);
};

test('fixture has two owned and two unclaimed three-planet systems and round-trips campaign validation', function () {
	const state = createCampaign();
	expect(state.systems).toHaveLength(4);
	expect(state.planets).toHaveLength(12);
	expect(state.planets.filter(function (planet) { return planet.factionId === 'blue'; })).toHaveLength(3);
	expect(state.planets.filter(function (planet) { return planet.factionId === 'red'; })).toHaveLength(3);
	expect(state.planets.filter(function (planet) { return planet.factionId === null; })).toHaveLength(6);
	expect(state.systems.filter(function (system) { return system.id === 'deneb' || system.id === 'arcturus'; })
		.every(function (system) { return system.map.planets.every(function (seed) { return seed[4] === 'neutral'; }); })).toBe(true);
	expect(state.systems.map(function (system) { return [system.id, system.x, system.y]; })).toEqual([
		['sol', 100, 100], ['sirius', 200, 100], ['deneb', 100, 200], ['arcturus', 200, 200],
	]);
	expect(state.planets.every(function (planet) { return planet.baselinePoints === 100; })).toBe(true);
	const save = { schemaVersion: 2, mode: 'campaign' as const, profileId: 'p', savedAt: 100, campaign: state };
	expect(parseCampaignSave(save)).toEqual(save);
	expect(createCampaign()).toEqual(state);
});

test('rival commits half its source budget once, using stable planets without overspending', function () {
	const start = createCampaign();
	const next = commitCampaignRival(start);
	expect(next.expeditions).toHaveLength(1);
	expect(next.expeditions[0]?.id).toBe('rival:10');
	expect(next.expeditions[0]?.points).toBe(150);
	expect(next.expeditions[0]?.arrivalTime).toBe(10);
	expect(next.expeditions[0]?.destinationSystemId).toBe('arcturus');
	expect(next.expeditions[0]?.contributions).toEqual([{ planetId: 'sirius:1', points: 100 }, { planetId: 'sirius:2', points: 50 }]);
	expect(commitCampaignRival(next)).toBe(next);
	expect(start.planets.every(function (planet) { return planet.depletion === 0; })).toBe(true);
});

test('rival targets nearest hostile system and breaks equal distances with stable identities', function () {
	const start = createCampaign();
	const home = start.systems.find(function (system) { return system.id === 'sol'; });
	if (!home) throw new Error('Missing fixture home');
	const tied = { ...start, systems: [...start.systems, { ...home, id: 'alpha', name: 'Alpha', x: 200, y: 200 }],
		planets: [...start.planets, ...start.planets.filter(function (planet) { return planet.systemId === 'sol'; }).map(function (planet) {
			return { ...planet, id: `alpha:${planet.id}`, systemId: 'alpha' };
		})] };
	expect(commitCampaignRival(tied).expeditions[0]?.destinationSystemId).toBe('alpha');
	const nearer = { ...tied, systems: tied.systems.map(function (system) { return system.id === 'sol' ? { ...system, x: 190 } : system; }) };
	expect(commitCampaignRival(nearer).expeditions[0]?.destinationSystemId).toBe('sol');
});

test('zero and individually unspendable fractional budgets produce no order', function () {
	const state = createCampaign();
	for (const remainder of [0, 0.9]) {
		const depleted = { ...state, planets: state.planets.map(function (planet) { return { ...planet, depletion: 100 - remainder }; }) };
		expect(commitCampaignRival(depleted)).toBe(depleted);
	}
});

test('rival floors odd balances and schedules only one decision per interval', function () {
	const start = createCampaign();
	const odd = { ...start, planets: start.planets.map(function (planet) {
		return planet.id === 'sirius:1' ? { ...planet, depletion: 1 } : planet;
	}) };
	expect(commitCampaignRival(odd).expeditions[0]?.points).toBe(149);
	const before = advanceCampaign(setCampaignPaused(start, false), 9.9);
	expect(before.expeditions).toHaveLength(0);
	const first = advanceCampaign(before, 0.1);
	expect(first.expeditions).toHaveLength(1);
	expect(first.expeditions[0]?.id).toBe('rival:10');
	expect(first.expeditions[0]?.departureTime).toBe(10);
	expect(first.expeditions[0]?.arrivalTime).toBe(20);
	const next = advanceCampaign(first, 10);
	expect(next.expeditions).toHaveLength(2);
	expect(next.expeditions.at(-1)?.id).toBe('rival:20');
	expect(next.nextRivalTime).toBe(30);
	expect(parseCampaignSave({ schemaVersion: 2, mode: 'campaign', profileId: 'rival', savedAt: 100, campaign: next }).campaign).toEqual(next);
});

test('rival skips unaffordable neutral colonization without increasing its half-budget', function () {
	const initial = createCampaign();
	const state = { ...initial, planets: initial.planets.map(function (planet) {
		return planet.factionId === 'red' ? { ...planet, depletion: 90 } : planet;
	}) };
	const sent = commitCampaignRival(state);
	expect(sent.expeditions[0]?.points).toBe(15);
	expect(sent.expeditions[0]?.destinationSystemId).toBe('sol');
	expect(function () { finish(sent); }).not.toThrow();
});

test('rival skips systems with only its own planets and neutral planets', function () {
	const state = createCampaign();
	const noHostileTargets = { ...state, planets: state.planets.map(function (planet) {
		if (planet.systemId === 'sirius') return planet;
		return planet.id.endsWith(':1') ? { ...planet, factionId: 'red' as const } : { ...planet, factionId: null };
	}) };
	expect(commitCampaignRival(noHostileTargets)).toBe(noHostileTargets);
});

test('planet loss does not eliminate a faction while relief remains in flight or an encounter is active', function () {
	const start = createCampaign();
	const sent = commitCampaignRival(start);
	const lost = { ...sent, planets: sent.planets.map(function (planet) { return { ...planet, factionId: 'blue' as const }; }) };
	expect(campaignWinner(lost)).toBeNull();
	const resolved = { ...lost, expeditions: lost.expeditions.map(function (item) { return { ...item, status: 'resolved' as const }; }) };
	expect(campaignWinner(resolved)).toBe('blue');
	expect(campaignWinner({ ...resolved, phase: 'encounter' })).toBeNull();
	expect(campaignWinner({ ...resolved, planets: resolved.planets.map(function (planet) { return { ...planet, factionId: 'red' as const }; }) })).toBe('red');
});

test('the last encounter result returns paused and declares campaign victory', function () {
	const start = createCampaign();
	const state = finish(commitExpedition(start, { id: 'attack', factionId: 'blue', sourceSystemId: 'sol', destinationSystemId: 'sirius',
		contributions: [{ planetId: 'sol:1', points: 100 }] }));
	expect(campaignWinner(state)).toBeNull();
	const target = state.planets.filter(function (planet) { return planet.systemId === 'sirius'; });
	const final = applyCampaignEncounterResult(state, { encounterId: 'encounter:attack',
		captureEvents: target.map(function (planet) { return { planetId: planet.id, factionId: 'blue' as const }; }),
		ownership: target.map(function (planet) { return { planetId: planet.id, factionId: 'blue' as const }; }) });
	expect(final.phase).toBe('galaxy');
	expect(campaignWinner(final)).toBe('blue');
});

for (const size of ['small', 'medium', 'large'] as const) {
	test(`${size} campaign launches the generated arrangement with equal starting systems and persists it`, function () {
		for (const seed of [0, 8041, 8042, 4294967295]) {
			const layout = generateMap(size, seed);
			const preview = structuredClone(layout);
			const campaign = createGeneratedCampaign(layout);
			expect(campaign.systems).toHaveLength(MAP_SIZES[size].count);
			expect(campaign.planets).toHaveLength(MAP_SIZES[size].count * 3);
			expect(new Set(campaign.systems.map(function (system) { return system.id; })).size).toBe(campaign.systems.length);
			expect(campaign.systems.map(function (system) { return [system.name, system.x, system.y]; }))
				.toEqual(layout.planets.map(function ([name, x, y]) { return [name, x, y]; }));
			for (const side of ['blue', 'red'] as const) {
				const owned = campaign.planets.filter(function (planet) { return planet.factionId === side; });
				expect(owned).toHaveLength(3);
				expect(new Set(owned.map(function (planet) { return planet.systemId; })).size).toBe(1);
				expect(owned.every(function (planet) { return planet.baselinePoints === 100; })).toBe(true);
			}
			expect(campaign.planets.filter(function (planet) { return planet.factionId === null; }))
				.toHaveLength((MAP_SIZES[size].count - 2) * 3);
			const save = { schemaVersion: 2, mode: 'campaign' as const, profileId: 'generated', savedAt: 100, campaign };
			expect(parseCampaignSave(save)).toEqual(save);
			expect(createGeneratedCampaign(preview)).toEqual(campaign);
			expect(layout).toEqual(preview);
			const ordered = commitCampaignRival(campaign);
			expect(ordered.expeditions).toHaveLength(1);
			expect(function () { finish(ordered); }).not.toThrow();
		}
	});
}
