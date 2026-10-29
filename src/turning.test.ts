import { expect, test } from 'bun:test';
import { CARRIER_TURN_RATE, SHIP_TURN_RATE, turnToward } from './turning';

test('ships turn gradually and stop at their heading', function () {
	expect(turnToward(0, Math.PI / 2, SHIP_TURN_RATE, 0.1)).toBeCloseTo(Math.PI / 10);
	expect(turnToward(0, 0.1, SHIP_TURN_RATE, 1)).toBeCloseTo(0.1);
	expect(turnToward(0, 1, SHIP_TURN_RATE, 0)).toBe(0);
});

test('turns cross the angle boundary along the shortest arc', function () {
	expect(turnToward(Math.PI - 0.1, -Math.PI + 0.1, 1, 0.05)).toBeCloseTo(Math.PI - 0.05);
});

test('carrier reversal takes eighteen simulation seconds regardless of frame rate', function () {
	for (const frames of [30, 60, 120]) {
		let heading = 0;
		for (let frame = 0; frame < frames; frame++) heading = turnToward(heading, Math.PI, CARRIER_TURN_RATE, 1 / frames);
		expect(heading).toBeCloseTo(Math.PI / 18);
	}
	expect(turnToward(0, Math.PI, CARRIER_TURN_RATE, 18)).toBeCloseTo(Math.PI);
});
