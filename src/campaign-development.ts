import { availablePoints, recoverDepletion } from './campaign-points';
import type { PointRecoveryPolicy } from './campaign-points';

export interface PlanetDevelopment {
	readonly baselinePoints: number;
	readonly developmentBonusPoints: number;
	readonly depletion: number;
	readonly factionId: string | null;
	readonly capturedTime: number | null;
	/** Galaxy timestamp through which growth and recovery have been applied. */
	readonly lastAppliedTime: number;
}

export interface DevelopmentPolicy {
	readonly growthFraction: number;
	readonly capFraction: number;
	readonly captureLossFraction: number;
}

const requireAmount = function (value: number): void {
	if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)
		throw new Error('Development points must be finite nonnegative numbers within the safe range.');
};

const requireTime = function (time: number): void {
	if (!Number.isFinite(time) || time < 0 || time > Number.MAX_SAFE_INTEGER)
		throw new Error('Galaxy time must be finite and nonnegative.');
};

const requireFaction = function (factionId: string | null): void {
	if (factionId !== null && !factionId.trim()) throw new Error('Faction identities must not be empty.');
};

const validatePolicy = function (policy: DevelopmentPolicy): void {
	for (const fraction of [policy.growthFraction, policy.capFraction, policy.captureLossFraction]) {
		if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1)
			throw new Error('Development policy fractions must be between zero and one.');
	}
};

export const developmentMaximum = function (planet: PlanetDevelopment): number {
	requireAmount(planet.baselinePoints);
	requireAmount(planet.developmentBonusPoints);
	const maximum = planet.baselinePoints + planet.developmentBonusPoints;
	requireAmount(maximum);
	return maximum;
};

const validatePlanet = function (planet: PlanetDevelopment, policy: DevelopmentPolicy): void {
	validatePolicy(policy);
	availablePoints(developmentMaximum(planet), planet.depletion);
	requireFaction(planet.factionId);
	requireTime(planet.lastAppliedTime);
	if (planet.capturedTime !== null) requireTime(planet.capturedTime);
	if (planet.developmentBonusPoints > planet.baselinePoints * policy.capFraction)
		throw new Error('Development bonus exceeds its configured cap.');
};

/** Each actual ownership change loses the configured share of accumulated bonus only. */
export const captureDevelopment = function (
	planet: PlanetDevelopment,
	factionId: string | null,
	time: number,
	policy: DevelopmentPolicy,
): PlanetDevelopment {
	validatePlanet(planet, policy);
	requireFaction(factionId);
	requireTime(time);
	if (time < planet.lastAppliedTime || (planet.capturedTime !== null && time < planet.capturedTime))
		throw new Error('Capture cannot move backwards in galaxy time.');
	if (planet.factionId === factionId) return planet;
	return {
		...planet,
		factionId,
		capturedTime: time,
		developmentBonusPoints: planet.developmentBonusPoints * (1 - policy.captureLossFraction),
	};
};

/** Integrate growth and recovery over galaxy seconds, including time beyond the growth cap. */
export const advanceDevelopment = function (
	planet: PlanetDevelopment,
	time: number,
	policy: DevelopmentPolicy,
	recoveryPolicy: PointRecoveryPolicy,
): PlanetDevelopment {
	validatePlanet(planet, policy);
	requireTime(time);
	recoverDepletion(planet.depletion, developmentMaximum(planet), recoveryPolicy);
	if (time < planet.lastAppliedTime || (planet.capturedTime !== null && time < planet.capturedTime))
		throw new Error('Development cannot move backwards in galaxy time.');
	if (time === planet.lastAppliedTime) return planet;
	const elapsed = time - planet.lastAppliedTime;
	const rate = planet.factionId === null ? 0 : planet.baselinePoints * policy.growthFraction;
	const cap = planet.baselinePoints * policy.capFraction;
	const growingSeconds = rate === 0 ? 0 : Math.min(elapsed, Math.max(0, cap - planet.developmentBonusPoints) / rate);
	const developmentBonusPoints = Math.min(cap, planet.developmentBonusPoints + rate * growingSeconds);
	const initialMaximum = developmentMaximum(planet);
	const capacityIntegral = initialMaximum * elapsed + rate * growingSeconds * (elapsed - growingSeconds / 2);
	return { ...planet, developmentBonusPoints,
		depletion: Math.max(0, planet.depletion - capacityIntegral * recoveryPolicy.fractionOfMaximum),
		lastAppliedTime: time };
};
