import { expect, test } from 'bun:test';
import { advancePlanetPoints, changePlanetOwnership, neutralClaimMinimum, planetGenerationRate } from './campaign-economy';
import { CAMPAIGN_RULES } from './campaign-state';
import type { CampaignPlanet } from './campaign-state';

const policy = CAMPAIGN_RULES.economy;
const planet: CampaignPlanet = Object.freeze({ id: 'sol:1', systemId: 'sol', name: 'Terra', factionId: 'blue', points: 0, value: 1.8 });

test('owned planets generate from value without a gameplay cap and preserve fractional points', function () {
	const whole = advancePlanetPoints(planet, 1000, policy);
	expect(whole.points).toBeCloseTo(180);
	let partitioned = planet;
	for (let tick = 0; tick < 1000; tick++) partitioned = advancePlanetPoints(partitioned, 1, policy);
	expect(partitioned.points).toBeCloseTo(whole.points);
	expect(advancePlanetPoints(planet, 0.25, policy).points).toBeCloseTo(0.045);
	expect(advancePlanetPoints({ ...planet, points: 500 }, 1000, policy).points).toBeCloseTo(680);
	expect(planet.points).toBe(0);
});

test('generation rate follows each planet value and neutral planets do not generate', function () {
	expect(planetGenerationRate(1.5, policy)).toBeCloseTo(0.15);
	expect(planetGenerationRate(2.2, policy)).toBeCloseTo(0.22);
	const neutral = { ...planet, factionId: null, points: 4.5 };
	expect(advancePlanetPoints(neutral, 100, policy)).toBe(neutral);
});

test('ownership changes reset only the affected planet balance and same-owner results are idempotent', function () {
	const owned = { ...planet, points: 25.75 };
	const captured = changePlanetOwnership(owned, 'red');
	expect(captured.points).toBe(0);
	expect(captured.factionId).toBe('red');
	expect(changePlanetOwnership(captured, 'red')).toBe(captured);
	expect(changePlanetOwnership(captured, null).points).toBe(0);
});

test('neutral claim cost scales with combined planet value and rounds up to whole points', function () {
	expect(neutralClaimMinimum([1.8, 2.2, 1.5], policy)).toBe(30);
	expect(neutralClaimMinimum([1.8, 2.2, 1.5].map(function (value) { return value * 1.7 / 2.6; }), policy)).toBe(20);
	expect(neutralClaimMinimum([1.8, 2.2, 1.5].map(function (value) { return value * 3.4 / 2.6; }), policy)).toBe(40);
	expect(neutralClaimMinimum([0.01], { ...policy, neutralClaimPointsPerValue: 0 })).toBe(1);
	expect(function () { neutralClaimMinimum([], policy); }).toThrow();
});

test('economy rejects invalid balances, values, durations and unsafe output', function () {
	for (const points of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
		expect(function () { advancePlanetPoints({ ...planet, points }, 1, policy); }).toThrow();
	for (const value of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
		expect(function () { planetGenerationRate(value, policy); }).toThrow();
		expect(function () { advancePlanetPoints({ ...planet, value }, 1, policy); }).toThrow();
	}
	for (const elapsedSeconds of [-1, NaN, Infinity])
		expect(function () { advancePlanetPoints(planet, elapsedSeconds, policy); }).toThrow();
	expect(function () { advancePlanetPoints({ ...planet, points: Number.MAX_SAFE_INTEGER }, 1, policy); }).toThrow();
	expect(function () { planetGenerationRate(1, { ...policy, generationPerValueSecond: Infinity }); }).toThrow();
});
