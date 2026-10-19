import { expect, test } from 'bun:test';
import { createDefaultEncounterSetup, createLegacyCompatibleEncounterSetup, ENCOUNTER_COSTS, isLastActiveBeachhead, validateCampaignEncounterSetup } from './campaign-setup';
import type { CampaignEncounter } from './campaign-state';

const encounter: CampaignEncounter = {
	id: 'battle', expeditionId: 'expedition', systemId: 'away', attacker: 'blue', attackerPoints: 100,
	planets: [
		{ planetId: 'a', name: 'A', factionId: 'red', points: 100.5 },
		{ planetId: 'b', name: 'B', factionId: 'blue', points: 25 },
		{ planetId: 'c', name: 'C', factionId: null, points: 10 },
	],
};

test('default setup allocates both local factions independently and keeps neutral forces on the ground', function () {
	const setup = createDefaultEncounterSetup(encounter);
	expect(setup.costs).toEqual({ troops: 1, ships: 6, guns: 5 });
	expect(setup.defenders).toEqual([
		{ planetId: 'a', forces: { troops: 50, ships: 5, guns: 4 } },
		{ planetId: 'b', forces: { troops: 14, ships: 1, guns: 1 } },
		{ planetId: 'c', forces: { troops: 10, ships: 0, guns: 0 } },
	]);
	expect(setup.beachheads).toEqual([{ planetId: 'a', troops: 52, ships: 8 }]);
	expect(function () { validateCampaignEncounterSetup(encounter, setup); }).not.toThrow();
});

const rivalEncounter = function (id: string, attackerPoints = 100): CampaignEncounter {
	return { ...encounter, id, attacker: 'red', attackerPoints, planets: [
		{ planetId: 'rival', name: 'Rival', factionId: 'red', points: 40 },
		{ planetId: 'neutral', name: 'Neutral', factionId: null, points: 5 },
		{ planetId: 'weak', name: 'Weak', factionId: 'blue', points: 20 },
		{ planetId: 'strong', name: 'Strong', factionId: 'blue', points: 120 },
	] };
};

test('rival beachheads exclude neutrals and choose a valid defender-owned target independent of planet order', function () {
	const current = rivalEncounter('rival:stable');
	const setup = createDefaultEncounterSetup(current);
	expect(setup.beachheads).toHaveLength(1);
	const target = setup.beachheads[0];
	if (!target) throw new Error('Missing default rival beachhead');
	expect(['weak', 'strong']).toContain(target.planetId);
	expect(function () { validateCampaignEncounterSetup(current, setup); }).not.toThrow();
	const reversed = { ...current, planets: current.planets.toReversed() };
	expect(createDefaultEncounterSetup(reversed).beachheads).toEqual(setup.beachheads);
});

test('rival beachhead selection is stable per encounter and varies across encounters', function () {
	const ids = Array.from({ length: 64 }, function (_, index) { return `rival:${index}`; });
	const targets = ids.map(function (id) { return createDefaultEncounterSetup(rivalEncounter(id)).beachheads[0]?.planetId; });
	expect(new Set(targets).size).toBeGreaterThan(1);
	const current = rivalEncounter('rival:repeat');
	const first = createDefaultEncounterSetup(current);
	expect(createDefaultEncounterSetup(current).beachheads).toEqual(first.beachheads);
});

test('rival target weighting reflects the attack budget relative to planetary defense budgets', function () {
	const ids = Array.from({ length: 128 }, function (_, index) { return `budget:${index}`; });
	const weakTargets = function (attackerPoints: number): number {
		return ids.filter(function (id) {
			return createDefaultEncounterSetup(rivalEncounter(id, attackerPoints)).beachheads[0]?.planetId === 'weak';
		}).length;
	};
	expect(weakTargets(50)).toBeGreaterThan(weakTargets(500));
});

test('rival beachhead selection rejects encounters without a defender-owned planet', function () {
	const neutral = rivalEncounter('rival:neutral-only');
	const invalid = { ...neutral, planets: neutral.planets.map(function (planet) {
		return planet.factionId === 'blue' ? { ...planet, factionId: null } : planet;
	}) };
	expect(function () { createDefaultEncounterSetup(invalid); }).toThrow('An invasion requires a defender-owned planet');
});

test('legacy allocations keep their last active beachhead until a replacement is assigned', function () {
	const setup = createDefaultEncounterSetup(encounter);
	const legacy = { ...setup, beachheads: [{ planetId: 'c', troops: 1, ships: 0 }] };
	expect(isLastActiveBeachhead(legacy, 'c')).toBe(true);
	expect(isLastActiveBeachhead({ ...legacy, beachheads: [...legacy.beachheads, { planetId: 'a', troops: 1, ships: 0 }] }, 'c')).toBe(false);
	expect(isLastActiveBeachhead(legacy, 'a')).toBe(false);
});

test('legacy saves without an allocation can resume neutral-only beachheads', function () {
	const noOpposingPlanet = { ...encounter, planets: encounter.planets.map(function (planet) {
		return planet.factionId === 'red' ? { ...planet, factionId: 'blue' as const } : planet;
	}) };
	expect(function () { createDefaultEncounterSetup(noOpposingPlanet); }).toThrow('An invasion requires a defender-owned planet');
	const legacy = createLegacyCompatibleEncounterSetup(noOpposingPlanet);
	expect(legacy.beachheads[0]?.planetId).toBe('c');
	expect(function () { validateCampaignEncounterSetup(noOpposingPlanet, legacy, { allowLegacyBeachheads: true }); }).not.toThrow();
});

test('custom costs persist in setup and defaults never overspend', function () {
	const costs = { troops: 2, ships: 7, guns: 3 };
	const setup = createDefaultEncounterSetup(encounter, costs);
	expect(setup.costs).toEqual(costs);
	expect(setup.costs).not.toBe(costs);
	expect(function () { validateCampaignEncounterSetup(encounter, setup); }).not.toThrow();
	expect(function () { createDefaultEncounterSetup(encounter, { ...costs, ships: 0 }); }).toThrow();
});

test('setup rejects missing duplicate unknown and overspent defenses and shared invasion overspending', function () {
	const setup = createDefaultEncounterSetup(encounter);
	for (const defenders of [[], [...setup.defenders, ...setup.defenders],
		[{ planetId: 'missing', forces: { troops: 0, ships: 0, guns: 0 } }],
		setup.defenders.map(function (item) { return { ...item, forces: { ...item.forces, troops: 101 } }; }),
		setup.defenders.map(function (item) { return item.planetId === 'c' ? { ...item, forces: { troops: 0, ships: 1, guns: 0 } } : item; }),
	]) {
		expect(function () { validateCampaignEncounterSetup(encounter, { ...setup, defenders }); }).toThrow();
	}
	for (const planetId of ['b', 'c']) expect(function () {
		validateCampaignEncounterSetup(encounter, { ...setup, beachheads: [{ planetId, troops: 1, ships: 0 }] });
	}).toThrow('Beachheads must target planets owned by the opposing faction');
	expect(function () { validateCampaignEncounterSetup(encounter, { ...setup, costs: ENCOUNTER_COSTS, beachheads: [
		{ planetId: 'a', troops: 60, ships: 0 }, { planetId: 'b', troops: 60, ships: 0 },
	] }); }).toThrow();
});
