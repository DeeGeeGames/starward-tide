import { validateAttackerAllocation, validateDefenderAllocation } from './campaign-allocation';
import type { AllocationCosts, BeachheadAllocation, DefenseForces } from './campaign-allocation';
import type { CampaignEncounter, CampaignState } from './campaign-state';

export const ENCOUNTER_COSTS: Readonly<AllocationCosts> = { troops: 1, ships: 6, guns: 5 };

export interface CampaignEncounterSetup {
	readonly costs: Readonly<AllocationCosts>;
	readonly defenders: readonly { readonly planetId: string; readonly forces: Readonly<DefenseForces> }[];
	readonly beachheads: readonly Readonly<BeachheadAllocation>[];
}

export const validateCampaignEncounterSetup = function (encounter: CampaignEncounter, setup: CampaignEncounterSetup): void {
	const seen = new Set<string>();
	for (const defender of setup.defenders) {
		const planet = encounter.planets.find(function (candidate) { return candidate.planetId === defender.planetId; });
		if (!planet || seen.has(defender.planetId)) throw new Error('Defense allocations require unique known planets');
		seen.add(defender.planetId);
		const result = validateDefenderAllocation(planet.points, defender.forces, setup.costs);
		if (!result.valid) throw new Error(result.reason);
		if (planet.factionId === null && (defender.forces.ships > 0 || defender.forces.guns > 0))
			throw new Error('Neutral planets can allocate only ground troops');
	}
	if (seen.size !== encounter.planets.length) throw new Error('Allocate every defending planet');
	const invasion = validateAttackerAllocation(encounter.attackerPoints, setup.beachheads,
		encounter.planets.map(function (planet) { return planet.planetId; }), setup.costs);
	if (!invasion.valid) throw new Error(invasion.reason);
};

export const createDefaultEncounterSetup = function (
	encounter: CampaignEncounter,
	costs: Readonly<AllocationCosts> = ENCOUNTER_COSTS,
): CampaignEncounterSetup {
	const costCheck = validateDefenderAllocation(0, { troops: 0, ships: 0, guns: 0 }, costs);
	if (!costCheck.valid) throw new Error(costCheck.reason);
	const defenders = encounter.planets.map(function (planet) {
		const ships = planet.factionId === null ? 0 : Math.floor(planet.points * 0.3 / costs.ships);
		const guns = planet.factionId === null ? 0 : Math.floor(planet.points * 0.2 / costs.guns);
		const troops = Math.floor((planet.points - ships * costs.ships - guns * costs.guns) / costs.troops);
		return { planetId: planet.planetId, forces: { troops, ships, guns } };
	});
	const target = encounter.planets.find(function (planet) { return planet.factionId !== encounter.attacker; });
	if (!target) throw new Error('An invasion requires a planet outside attacker ownership');
	const ships = Math.floor(encounter.attackerPoints * 0.5 / costs.ships);
	const troops = Math.floor((encounter.attackerPoints - ships * costs.ships) / costs.troops);
	const setup: CampaignEncounterSetup = { costs: { ...costs }, defenders,
		beachheads: [{ planetId: target.planetId, troops, ships }] };
	validateCampaignEncounterSetup(encounter, setup);
	return setup;
};

/** Debit owned planetary defenses once, retaining the original encounter budgets. */
export const commitEncounterDefenses = function (state: CampaignState, setup: CampaignEncounterSetup): CampaignState {
	const encounter = state.encounter;
	if (state.phase !== 'encounter' || !encounter) throw new Error('No encounter is active');
	validateCampaignEncounterSetup(encounter, setup);
	const commitments = encounter.planets.filter(function (planet) { return planet.factionId !== null; }).map(function (planet) {
		const defender = setup.defenders.find(function (item) { return item.planetId === planet.planetId; });
		if (!defender) throw new Error('Defense allocation is missing');
		const result = validateDefenderAllocation(planet.points, defender.forces, setup.costs);
		if (!result.valid) throw new Error(result.reason);
		const balance = state.planets.find(function (item) { return item.id === planet.planetId; });
		if (!balance) throw new Error('Defense planet is missing');
		return { planetId: planet.planetId, points: result.spent, originalDepletion: balance.depletion };
	});
	if (encounter.defenseCommitments) {
		if (commitments.length !== encounter.defenseCommitments.length || commitments.some(function (item) {
			return !encounter.defenseCommitments?.some(function (saved) { return saved.planetId === item.planetId && saved.points === item.points; });
		})) throw new Error('Launched defenses cannot be changed');
		return state;
	}
	const planets = state.planets.map(function (planet) {
		const debit = commitments.find(function (item) { return item.planetId === planet.id; });
		if (!debit) return planet;
		const depletion = planet.depletion + debit.points;
		if (!Number.isFinite(depletion) || depletion > Number.MAX_SAFE_INTEGER) throw new Error('Defense spending exceeds the safe range');
		return { ...planet, depletion };
	});
	return { ...state, planets, encounter: { ...encounter, defenseCommitments: commitments } };
};
