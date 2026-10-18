import { expect, test } from 'bun:test';
import { describeCampaignTransition, describeEncounterOutcome } from './campaign-report';
import { createCampaign } from './campaign-scenario';
import { applyCampaignEncounterResult, commitExpedition, advanceCampaign, setCampaignPaused } from './campaign-state';
import type { CampaignEncounterResult, CampaignState } from './campaign-state';

const campaign = function (): CampaignState { return { ...createCampaign(), nextRivalTime: 1e9 }; };

const commit = function (state: CampaignState, id: string, destinationSystemId = 'sirius', points = 30): CampaignState {
	return commitExpedition(state, { id, factionId: 'blue', sourceSystemId: 'sol', destinationSystemId,
		contributions: [{ planetId: 'sol:1', points }] });
};
const finish = function (state: CampaignState): CampaignState {
	return advanceCampaign(setCampaignPaused(state, false), 10);
};
const unchangedResult = function (state: CampaignState): CampaignEncounterResult {
	const encounter = state.encounter;
	if (!encounter) throw new Error('Missing encounter');
	return { encounterId: encounter.id, captureEvents: [], ownership: encounter.planets.map(function (planet) {
		return { planetId: planet.planetId, factionId: planet.factionId };
	}) };
};

test('outcomes replay capture and recapture without recovery, refills or later arrivals', function () {
	const initial = campaign();
	const developed = { ...initial, planets: initial.planets.map(function (planet) {
		return planet.systemId === 'sirius' ? { ...planet, developmentBonusPoints: 20, depletion: 115 } : planet;
	}) };
	const battle = finish(commit(developed, 'invasion'));
	const prior = structuredClone(battle);
	const result = { ...unchangedResult(battle), captureEvents: [
		{ planetId: 'sirius:1', factionId: 'blue' as const }, { planetId: 'sirius:1', factionId: 'red' as const },
	] };
	const report = describeEncounterOutcome(battle, result, 'red');
	expect(report.systemName).toBe('Sirius');
	expect(report.attackerPoints).toBe(30);
	expect(report.attacker).toBe('blue');
	expect(report.winner).toBe('red');
	const captured = report.planets.find(function (planet) { return planet.after.planetId === 'sirius:1'; });
	expect(captured?.before.developmentBonusPoints).toBe(20);
	expect(captured?.after.developmentBonusPoints).toBe(5);
	expect(captured?.after.maximumPoints).toBe(105);
	expect(captured?.after.depletion).toBe(103);
	expect(captured?.after.availablePoints).toBe(2);
	expect(captured?.after.factionId).toBe('red');
	expect(battle).toEqual(prior);
	const resolved = applyCampaignEncounterResult(battle, result);
	const transition = describeCampaignTransition(battle, resolved, report);
	expect(transition.timeAdvanced).toBe(false);
	expect(transition.fromTime).toBe(10);
	expect(transition.toTime).toBe(10);
	expect(transition.outcome).toEqual(report);
	expect(transition.planets.find(function (planet) { return planet.after.planetId === 'sirius:1'; })?.after.depletion).toBe(103);
	// Applying a battle result never advances galaxy time or recovers depletion.
	expect(report.planets[0]?.after.depletion).toBe(103);
});

test('defeat preserves ownership and balances while reporting the spent expedition budget', function () {
	const battle = finish(commit(campaign(), 'defeat', 'sirius', 40));
	const result = unchangedResult(battle);
	const report = describeEncounterOutcome(battle, result, 'red');
	expect(report.attackerPoints).toBe(40);
	expect(report.planets.every(function (planet) { return JSON.stringify(planet.before) === JSON.stringify(planet.after); })).toBe(true);
	expect(report.planets.every(function (planet) { return planet.after.factionId === 'red'; })).toBe(true);
	expect(battle.planets.find(function (planet) { return planet.id === 'sol:1'; })?.depletion).toBeCloseTo(29.9);
	expect(function () { describeEncounterOutcome(battle, { ...result, ownership: [] }, 'red'); }).toThrow();
	expect(function () { describeEncounterOutcome(battle, { ...result, captureEvents: [{ planetId: 'sirius:1', factionId: 'red' }] }, 'red'); }).toThrow();
});

test('transition reports friendly arrival and continuous recovery before arrival without inventing transfer refunds', function () {
	const initial = campaign();
	const friendly = { ...initial, planets: initial.planets.map(function (planet) {
		if (planet.systemId !== 'deneb') return planet;
		return { ...planet, factionId: 'blue' as const, depletion: planet.id === 'deneb:1' ? 40 : planet.id === 'deneb:2' ? 80 : 0 };
	}) };
	const before = commit(friendly, 'supplies', 'deneb', 50);
	const after = finish(before);
	const report = describeCampaignTransition(before, after);
	expect(report.timeAdvanced).toBe(true);
	expect(report.phase).toBe('galaxy');
	expect(report.resolvedExpeditions).toEqual([{ expeditionId: 'supplies', systemId: 'deneb', factionId: 'blue', points: 50, kind: 'friendly' }]);
	expect(report.planets.find(function (planet) { return planet.after.planetId === 'deneb:2'; })?.before.depletion).toBe(80);
	expect(report.planets.find(function (planet) { return planet.after.planetId === 'deneb:2'; })?.after.depletion).toBeCloseTo(19.9);
	expect(report.planets.find(function (planet) { return planet.after.planetId === 'sol:1'; })?.after.depletion).toBeCloseTo(39.9);
});

test('next encounter keeps galaxy time frozen and reports only the completed battle', function () {
	const before = finish(commit(commit(campaign(), 'a'), 'z'));
	const result = unchangedResult(before);
	const outcome = describeEncounterOutcome(before, result, 'red');
	const after = applyCampaignEncounterResult(before, result);
	const report = describeCampaignTransition(before, after, outcome);
	expect(after.encounter?.expeditionId).toBe('z');
	expect(report.timeAdvanced).toBe(false);
	expect(report.phase).toBe('encounter');
	expect(report.fromTime).toBe(report.toTime);
	expect(report.resolvedExpeditions).toEqual([{ expeditionId: 'a', systemId: 'sirius', factionId: 'blue', points: 30, kind: 'encounter' }]);
	expect(report.planets.every(function (planet) { return planet.before.depletion === planet.after.depletion; })).toBe(true);
});

test('ordered arrival summaries distinguish a neutral claim from a subsequent friendly supply arrival', function () {
	const before = commit(commit(campaign(), 'a', 'deneb'), 'z', 'deneb');
	const after = finish(before);
	const report = describeCampaignTransition(before, after);
	expect(report.resolvedExpeditions.map(function (item) { return item.kind; })).toEqual(['claim', 'friendly']);
	expect(report.focusSystemId).toBe('deneb');
	expect(report.planets.filter(function (planet) { return planet.after.systemId === 'deneb'; })
		.every(function (planet) { return planet.before.factionId === null && planet.after.factionId === 'blue'; })).toBe(true);
});

test('a claim followed by a hostile arrival reports the claim while the new encounter freezes further recovery', function () {
	const initial = campaign();
	const fast = { ...initial, rules: { ...initial.rules, travelSpeed: 200 } };
	const blue = commit(fast, 'a', 'deneb');
	const before = commitExpedition(blue, { id: 'z', factionId: 'red', sourceSystemId: 'sirius', destinationSystemId: 'deneb',
		contributions: [{ planetId: 'sirius:1', points: 30 }] });
	const after = finish(before);
	const report = describeCampaignTransition(before, after);
	expect(report.timeAdvanced).toBe(true);
	expect(report.phase).toBe('encounter');
	expect(after.encounter?.expeditionId).toBe('z');
	expect(report.resolvedExpeditions).toEqual([{ expeditionId: 'a', systemId: 'deneb', factionId: 'blue', points: 30, kind: 'claim' }]);
	expect(report.planets.find(function (planet) { return planet.after.planetId === 'sol:1'; })?.after.depletion).toBeCloseTo(19.9);
	expect(report.planets.filter(function (planet) { return planet.after.systemId === 'deneb'; })
		.every(function (planet) { return planet.after.factionId === 'blue' && planet.after.developmentBonusPoints === 0; })).toBe(true);
});
