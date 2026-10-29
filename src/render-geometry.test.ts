import { expect, test } from 'bun:test';
import { canvasViewport, dashedLine, shipDetailZoom, planetPlatformOrbitRadius } from './render-geometry';

test('viewport canvas cancels map CSS transform across pan, zoom and resize', function () {
	for (const camera of [{ x: 374.09, y: 130, scale: 0.443 }, { x: -1250, y: 542, scale: 3.7 },
		{ x: -2000, y: -2000, scale: 0.5 }, { x: 1500, y: 900, scale: 1 }]) {
		for (const [width, height] of [[1280, 800], [390, 844]]) {
			if (width === undefined || height === undefined) throw new Error('Missing test viewport');
			const box = canvasViewport(camera, width, height);
			expect(box.left * camera.scale + camera.x).toBeCloseTo(0);
			expect(box.top * camera.scale + camera.y).toBeCloseTo(0);
			expect(box.width * camera.scale).toBeCloseTo(width);
			expect(box.height * camera.scale).toBeCloseTo(height);
		}
	}
});

test('ship detail tiers preserve original zoom thresholds', function () {
	expect([0.5, 1, 1.749, 1.75, 2.499, 2.5, 5].map(shipDetailZoom)).toEqual([1, 1, 1, 2, 2, 3, 3]);
});

test('platform orbit clears transports and their silhouette', function () {
	for (const planetRadius of [25, 28, 36]) {
		expect(planetPlatformOrbitRadius(planetRadius)).toBeGreaterThan(planetRadius + 32 + 11);
	}
});

test('pending routes retain screen-space dashes even when endpoints are offscreen', function () {
	const segments = dashedLine({ x: -10, y: 5 }, { x: 15, y: 5 }, 8, 5);
	expect(segments).toEqual([[{ x: -10, y: 5 }, { x: -2, y: 5 }], [{ x: 3, y: 5 }, { x: 11, y: 5 }]]);
	expect(dashedLine({ x: 0, y: 0 }, { x: 0, y: 10 }, 8, 5)).toEqual([[{ x: 0, y: 0 }, { x: 0, y: 8 }]]);
	expect(dashedLine({ x: 1, y: 1 }, { x: 1, y: 1 }, 8, 5)).toEqual([]);
});
