import { expect, test } from 'bun:test';
import { advanceDevelopment, captureDevelopment, developmentMaximum } from './campaign-development';
import type { PlanetDevelopment } from './campaign-development';
import { CAMPAIGN_RULES } from './campaign-state';

const policy = CAMPAIGN_RULES.development;
const recovery = CAMPAIGN_RULES.recovery;
const planet: PlanetDevelopment = Object.freeze({ baselinePoints: 100, developmentBonusPoints: 0, depletion: 200,
	factionId: 'blue', capturedTime: null, lastAppliedTime: 0 });

test('continuous growth integrates recovery through the cap independently of frame partitions', function () {
	const whole = advanceDevelopment(planet, 150, policy, recovery);
	let partitioned = planet;
	for (let time = 0.5; time <= 150; time += 0.5) partitioned = advanceDevelopment(partitioned, time, policy, recovery);
	expect(whole.developmentBonusPoints).toBe(20);
	expect(whole.depletion).toBeCloseTo(30);
	expect(partitioned.developmentBonusPoints).toBeCloseTo(whole.developmentBonusPoints);
	expect(partitioned.depletion).toBeCloseTo(whole.depletion);
	expect(developmentMaximum(whole)).toBe(120);
	expect(planet.depletion).toBe(200);
});

test('capture and recapture preserve depletion and halve bonus immediately at the same timestamp', function () {
	const developed = advanceDevelopment(planet, 100, policy, recovery);
	const captured = captureDevelopment(developed, 'red', 100, policy);
	const recaptured = captureDevelopment(captured, 'blue', 100, policy);
	expect(captured.developmentBonusPoints).toBe(10);
	expect(recaptured.developmentBonusPoints).toBe(5);
	expect(recaptured.depletion).toBe(developed.depletion);
	expect(recaptured.capturedTime).toBe(100);
	expect(captureDevelopment(recaptured, 'blue', 100, policy)).toBe(recaptured);
	expect(advanceDevelopment(recaptured, 110, policy, recovery).developmentBonusPoints).toBe(7);
});

test('neutral planets recover without growth and development replay is idempotent', function () {
	const neutral = advanceDevelopment({ ...planet, factionId: null }, 10, policy, recovery);
	expect(neutral.developmentBonusPoints).toBe(0);
	expect(neutral.depletion).toBe(190);
	expect(advanceDevelopment(neutral, 10, policy, recovery)).toBe(neutral);
	expect(function () { advanceDevelopment(neutral, 9, policy, recovery); }).toThrow();
	expect(function () { captureDevelopment(neutral, 'red', 9, policy); }).toThrow();
});

test('malformed balances, clocks, and policies are rejected', function () {
	for (const invalid of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
		for (const field of ['baselinePoints', 'developmentBonusPoints', 'depletion', 'lastAppliedTime', 'capturedTime'] as const)
			expect(function () { advanceDevelopment({ ...planet, [field]: invalid }, 10, policy, recovery); }).toThrow();
		expect(function () { advanceDevelopment(planet, invalid, policy, recovery); }).toThrow();
	}
	for (const invalid of [-0.1, 1.1, NaN, Infinity]) {
		for (const field of ['growthFraction', 'capFraction', 'captureLossFraction'] as const)
			expect(function () { captureDevelopment(planet, 'red', 10, { ...policy, [field]: invalid }); }).toThrow();
		expect(function () { advanceDevelopment(planet, 0, policy, { fractionOfMaximum: invalid }); }).toThrow();
	}
	expect(function () { captureDevelopment(planet, '', 0, policy); }).toThrow();
	expect(function () { advanceDevelopment({ ...planet, developmentBonusPoints: 21 }, 1, policy, recovery); }).toThrow();
	expect(function () { developmentMaximum({ ...planet, baselinePoints: Number.MAX_SAFE_INTEGER, developmentBonusPoints: 1 }); }).toThrow();
});
