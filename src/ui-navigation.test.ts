import { expect, test } from 'bun:test';
import { nextFocusIndex } from './ui-navigation';

const rect = function (left: number, top: number, width = 100, height = 48): { left: number; top: number; width: number; height: number } {
	return { left, top, width, height };
};

test('directional navigation follows visual rows and columns rather than DOM order', function () {
	const controls = [rect(0, 0), rect(110, 0), rect(220, 0), rect(0, 60), rect(110, 60), rect(220, 60)];
	expect(nextFocusIndex(controls, 1, 'down')).toBe(4);
	expect(nextFocusIndex(controls, 4, 'up')).toBe(1);
	expect(nextFocusIndex(controls, 1, 'right')).toBe(2);
	expect(nextFocusIndex(controls, 1, 'left')).toBe(0);
});

test('aligned controls take precedence over closer diagonal actions', function () {
	const controls = [rect(0, 0), rect(110, 60), rect(0, 150)];
	expect(nextFocusIndex(controls, 0, 'down')).toBe(2);
});

test('a full-width action remains reachable beneath a segmented row', function () {
	const controls = [rect(0, 0), rect(110, 0), rect(220, 0), rect(0, 60, 320)];
	expect(nextFocusIndex(controls, 0, 'down')).toBe(3);
	expect(nextFocusIndex(controls, 2, 'down')).toBe(3);
	expect(nextFocusIndex(controls, 3, 'up')).toBe(1);
});

test('edges wrap within the current row or column', function () {
	const controls = [rect(0, 0), rect(110, 0), rect(0, 60), rect(110, 60), rect(0, 120), rect(110, 120)];
	expect(nextFocusIndex(controls, 1, 'right')).toBe(0);
	expect(nextFocusIndex(controls, 2, 'left')).toBe(3);
	expect(nextFocusIndex(controls, 5, 'down')).toBe(1);
	expect(nextFocusIndex(controls, 0, 'up')).toBe(4);
});

test('single-column menus preserve horizontal stepping and include offscreen rows', function () {
	const controls = [rect(0, -100), rect(0, 0), rect(0, 1000)];
	expect(nextFocusIndex(controls, 1, 'right')).toBe(2);
	expect(nextFocusIndex(controls, 1, 'left')).toBe(0);
	expect(nextFocusIndex(controls, 1, 'down')).toBe(2);
});

test('missing focus, empty menus, and a single control have deterministic results', function () {
	expect(nextFocusIndex([], -1, 'down')).toBeUndefined();
	expect(nextFocusIndex([rect(0, 0)], -1, 'up')).toBe(0);
	expect(nextFocusIndex([rect(0, 0)], 0, 'right')).toBe(0);
});

test('layout changes are reflected on the next navigation action', function () {
	const desktop = [rect(0, 0), rect(110, 0), rect(0, 60), rect(110, 60)];
	const mobile = [rect(0, 0), rect(0, 60), rect(0, 120), rect(0, 180)];
	expect(nextFocusIndex(desktop, 0, 'down')).toBe(2);
	expect(nextFocusIndex(mobile, 0, 'down')).toBe(1);
});
