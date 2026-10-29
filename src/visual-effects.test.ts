import { describe, expect, test } from 'bun:test';
import { createWeaponEffects } from './visual-effects';
import type { Engagement } from './game';

const shot: Engagement = { x1: 0, y1: 0, x2: 20, y2: 10, owner: 'blue' };

describe('weapon feedback lifecycle', function () {
	test('offscreen volleys cannot exhaust the visible effects budget', function () {
		const effects = createWeaponEffects();
		const volley = [...Array.from({ length: 100 }, function () { return { ...shot, x1: -500 }; }), shot];
		expect(effects.update(1, volley, function (entry) { return entry.x1 >= 0; })).toHaveLength(1);
	});
	test('persists between simulation ticks, freezes on pause, and expires', function () {
		const effects = createWeaponEffects();
		const volley = [shot];
		expect(effects.update(1, volley)).toHaveLength(1);
		expect(effects.update(1, volley)).toHaveLength(1);
		expect(effects.update(1.1, [])).toHaveLength(1);
		expect(effects.update(1.25, [])).toHaveLength(0);
		// An unchanged volley cannot be replayed by a redraw.
		expect(effects.update(1.3, volley)).toHaveLength(0);
	});
	test('limits sustained fire and clears feedback on world replacement', function () {
		const effects = createWeaponEffects();
		expect(effects.update(2, Array.from({ length: 100 }, function () { return shot; }))).toHaveLength(64);
		expect(effects.update(2.01, [shot])).toHaveLength(64);
		expect(effects.update(2.1, [shot])).toHaveLength(64);
		effects.reset();
		expect(effects.update(0, [])).toHaveLength(0);
		expect(effects.update(0.01, [shot])).toHaveLength(1);
	});
});
