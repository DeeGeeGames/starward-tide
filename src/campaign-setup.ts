import { validateAttackerAllocation, validateDefenderAllocation } from './campaign-allocation';
import type { AllocationCosts, BeachheadAllocation, DefenseForces } from './campaign-allocation';
import type { CampaignEncounter, CampaignState } from './campaign-state';

export const ENCOUNTER_COSTS: Readonly<AllocationCosts> = { troops: 1, ships: 6, guns: 5 };

export interface CampaignEncounterSetup {
	readonly costs: Readonly<AllocationCosts>;
	readonly defenders: readonly { readonly planetId: string; readonly forces: Readonly<DefenseForces> }[];
	readonly beachheads: readonly Readonly<BeachheadAllocation>[];
}

export interface CampaignEncounterSetupValidationOptions {
	readonly allowLegacyBeachheads?: boolean;
}

export const isLastActiveBeachhead = function (setup: CampaignEncounterSetup, planetId: string): boolean {
	const active = setup.beachheads.filter(function (beachhead) { return beachhead.troops > 0 || beachhead.ships > 0; });
	return active.length === 1 && active[0]?.planetId === planetId;
};

export const hasIneligibleBeachheadTarget = function (encounter: CampaignEncounter, setup: CampaignEncounterSetup): boolean {
	const targetable = new Set(encounter.planets.filter(function (planet) {
		return planet.factionId !== null && planet.factionId !== encounter.attacker;
	}).map(function (planet) { return planet.planetId; }));
	return setup.beachheads.some(function (beachhead) { return !targetable.has(beachhead.planetId); });
};

export const validateCampaignEncounterSetup = function (
	encounter: CampaignEncounter,
	setup: CampaignEncounterSetup,
	options: Readonly<CampaignEncounterSetupValidationOptions> = {},
): void {
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
	const targetable = new Set(encounter.planets.filter(function (planet) {
		return planet.factionId !== null && planet.factionId !== encounter.attacker;
	}).map(function (planet) { return planet.planetId; }));
	if (!options.allowLegacyBeachheads && hasIneligibleBeachheadTarget(encounter, setup))
		throw new Error('Beachheads must target planets owned by the opposing faction');
	const invasion = validateAttackerAllocation(encounter.attackerPoints, setup.beachheads,
		options.allowLegacyBeachheads ? encounter.planets.map(function (planet) { return planet.planetId; }) : [...targetable], setup.costs);
	if (!invasion.valid) throw new Error(invasion.reason);
};

const stableFraction = function (value: string): number {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
	hash ^= hash >>> 16;
	hash = Math.imul(hash, 0x7feb352d);
	hash ^= hash >>> 15;
	hash = Math.imul(hash, 0x846ca68b);
	hash ^= hash >>> 16;
	return (hash >>> 0) / 0x1_0000_0000;
};

const selectRivalBeachhead = function (
	encounter: CampaignEncounter,
	candidates: readonly CampaignEncounter['planets'][number][],
): CampaignEncounter['planets'][number] {
	const attackBudget = Math.max(encounter.attackerPoints, 1);
	// Planet points fund its default defenses; weaker defenses relative to this invasion budget get higher weight.
	const weighted = candidates.toSorted(function (a, b) {
		return a.planetId < b.planetId ? -1 : a.planetId > b.planetId ? 1 : 0;
	}).map(function (planet) {
		return { planet, weight: 1 / (1 + planet.points / attackBudget) };
	});
	const totalWeight = weighted.reduce(function (total, candidate) { return total + candidate.weight; }, 0);
	// The encounter ID fixes the draw, and sorting keeps it independent of planet-array order.
	let remaining = stableFraction(encounter.id) * totalWeight;
	for (const candidate of weighted) {
		remaining -= candidate.weight;
		if (remaining < 0) return candidate.planet;
	}
	const last = weighted[weighted.length - 1];
	if (!last) throw new Error('A rival invasion requires a defender-owned beachhead');
	return last.planet;
};

const createEncounterSetup = function (
	encounter: CampaignEncounter,
	costs: Readonly<AllocationCosts>,
	allowLegacyBeachheads: boolean,
): CampaignEncounterSetup {
	const costCheck = validateDefenderAllocation(0, { troops: 0, ships: 0, guns: 0 }, costs);
	if (!costCheck.valid) throw new Error(costCheck.reason);
	const defenders = encounter.planets.map(function (planet) {
		const ships = planet.factionId === null ? 0 : Math.floor(planet.points * 0.3 / costs.ships);
		const guns = planet.factionId === null ? 0 : Math.floor(planet.points * 0.2 / costs.guns);
		const troops = Math.floor((planet.points - ships * costs.ships - guns * costs.guns) / costs.troops);
		return { planetId: planet.planetId, forces: { troops, ships, guns } };
	});
	const targets = encounter.planets.filter(function (planet) {
		return planet.factionId !== null && planet.factionId !== encounter.attacker;
	});
	if (targets.length === 0 && !allowLegacyBeachheads) throw new Error('An invasion requires a defender-owned planet');
	const target = targets.length > 0
		? encounter.attacker === 'red' ? selectRivalBeachhead(encounter, targets) : targets[0]
		: encounter.planets.find(function (planet) { return planet.factionId !== encounter.attacker; });
	if (!target) throw new Error('An invasion requires a defender-owned planet');
	const ships = Math.floor(encounter.attackerPoints * 0.5 / costs.ships);
	const troops = Math.floor((encounter.attackerPoints - ships * costs.ships) / costs.troops);
	const setup: CampaignEncounterSetup = { costs: { ...costs }, defenders,
		beachheads: [{ planetId: target.planetId, troops, ships }] };
	validateCampaignEncounterSetup(encounter, setup, { allowLegacyBeachheads });
	return setup;
};

export const createDefaultEncounterSetup = function (
	encounter: CampaignEncounter,
	costs: Readonly<AllocationCosts> = ENCOUNTER_COSTS,
): CampaignEncounterSetup {
	return createEncounterSetup(encounter, costs, false);
};

/** Used only when opening a pre-allocation save whose active encounter had no stored setup. */
export const createLegacyCompatibleEncounterSetup = function (
	encounter: CampaignEncounter,
	costs: Readonly<AllocationCosts> = ENCOUNTER_COSTS,
): CampaignEncounterSetup {
	return createEncounterSetup(encounter, costs, true);
};

/** Debit owned planetary defenses once, retaining the original encounter budgets. */
export const commitEncounterDefenses = function (
	state: CampaignState,
	setup: CampaignEncounterSetup,
	options: Readonly<CampaignEncounterSetupValidationOptions> = {},
): CampaignState {
	const encounter = state.encounter;
	if (state.phase !== 'encounter' || !encounter) throw new Error('No encounter is active');
	validateCampaignEncounterSetup(encounter, setup, options);
	const commitments = encounter.planets.filter(function (planet) { return planet.factionId !== null; }).map(function (planet) {
		const defender = setup.defenders.find(function (item) { return item.planetId === planet.planetId; });
		if (!defender) throw new Error('Defense allocation is missing');
		const result = validateDefenderAllocation(planet.points, defender.forces, setup.costs);
		if (!result.valid) throw new Error(result.reason);
		const balance = state.planets.find(function (item) { return item.id === planet.planetId; });
		if (!balance) throw new Error('Defense planet is missing');
		return { planetId: planet.planetId, points: result.spent, originalPoints: balance.points };
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
		const points = planet.points - debit.points;
		if (!Number.isFinite(points) || points < 0 || points > Number.MAX_SAFE_INTEGER) throw new Error('Defense spending exceeds the safe range');
		return { ...planet, points };
	});
	return { ...state, planets, encounter: { ...encounter, defenseCommitments: commitments } };
};
