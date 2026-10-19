import { availablePoints } from './campaign-points';
import type { Side } from './config';

export interface CampaignEconomyPolicy {
	/** Points per galaxy-simulation second for each planet-value unit. */
	readonly generationPerValueSecond: number;
	/** Whole points charged for each combined value unit in a neutral system. */
	readonly neutralClaimPointsPerValue: number;
}

export interface PlanetEconomy {
	readonly factionId: Side | null;
	readonly points: number;
	readonly value: number;
}

const requireAmount = function (value: number, name: string): void {
	if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
		throw new Error(`${name} must be finite, nonnegative, and within the safe numeric range.`);
};

const validatePolicy = function (policy: CampaignEconomyPolicy): void {
	requireAmount(policy.generationPerValueSecond, 'Point generation rate');
	requireAmount(policy.neutralClaimPointsPerValue, 'Neutral claim cost');
};

export const planetGenerationRate = function (value: number, policy: CampaignEconomyPolicy): number {
	requireAmount(value, 'Planet value');
	validatePolicy(policy);
	const rate = value * policy.generationPerValueSecond;
	requireAmount(rate, 'Planet point generation rate');
	return rate;
};

/** Add owned-planet production over galaxy time, preserving fractional points. */
export const advancePlanetPoints = function <T extends PlanetEconomy>(
	planet: T,
	elapsedSeconds: number,
	policy: CampaignEconomyPolicy,
): T {
	availablePoints(planet.points);
	planetGenerationRate(planet.value, policy);
	requireAmount(elapsedSeconds, 'Galaxy duration');
	if (planet.factionId === null || elapsedSeconds === 0) return planet;
	const produced = planetGenerationRate(planet.value, policy) * elapsedSeconds;
	requireAmount(produced, 'Generated campaign points');
	const points = planet.points + produced;
	requireAmount(points, 'Planet balance');
	if (produced > 0 && points <= planet.points) throw new Error('Generated campaign points cannot be represented safely at this balance.');
	return { ...planet, points };
};

/** Claim prices scale with a system's combined planet value and spend whole points. */
export const neutralClaimMinimum = function (
	planetValues: readonly number[],
	policy: CampaignEconomyPolicy,
): number {
	validatePolicy(policy);
	if (planetValues.length === 0) throw new Error('Neutral claim requires at least one planet.');
	let totalValue = 0;
	for (const value of planetValues) {
		requireAmount(value, 'Planet value');
		totalValue += value;
		requireAmount(totalValue, 'Combined system value');
	}
	const rawMinimum = totalValue * policy.neutralClaimPointsPerValue;
	requireAmount(rawMinimum, 'Neutral claim price');
	const minimum = Math.max(1, Math.ceil(rawMinimum));
	if (!Number.isSafeInteger(minimum)) throw new Error('Neutral claim price exceeds the safe numeric range.');
	return minimum;
};

/** Reset the balance only when ownership actually changes. */
export const changePlanetOwnership = function <T extends PlanetEconomy>(planet: T, factionId: string | null): T {
	if (planet.factionId === factionId) return planet;
	return { ...planet, factionId, points: 0 };
};
