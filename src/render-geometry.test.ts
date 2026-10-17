import { expect, test } from 'bun:test';
import { canvasViewport, visibleMapViewport, mapClipInsets, dashedLine, shipDetailZoom } from './render-geometry';

test('map backing bounds preserve projection at fit, partial pan, full viewport and offscreen', function () {
	for (const camera of [{ x: 374.09, y: 130, scale: 0.443 }, { x: -1250, y: -542, scale: 3.7 },
		{ x: -100, y: 200, scale: 0.5 }, { x: -2000, y: -2000, scale: 0.5 }, { x: 1500, y: 900, scale: 1 }]) {
		const frame = visibleMapViewport(camera, 1280, 800, 1200, 1320);
		const localCamera = { ...camera, x: camera.x - frame.x, y: camera.y - frame.y };
		const box = canvasViewport(localCamera, frame.width, frame.height);
		expect(frame.width).toBeGreaterThanOrEqual(1);
		expect(frame.height).toBeGreaterThanOrEqual(1);
		expect(frame.width).toBeLessThanOrEqual(1280);
		expect(frame.height).toBeLessThanOrEqual(800);
		// A world point must agree in the DOM and in the cropped Pixi surface.
		for (const point of [{ x: 0, y: 0 }, { x: 514, y: 570 }, { x: 1200, y: 1320 }]) {
			expect((box.left + point.x) * camera.scale + camera.x).toBeCloseTo(frame.x + point.x * camera.scale);
			expect(frame.x + localCamera.x + point.x * camera.scale).toBeCloseTo(camera.x + point.x * camera.scale);
			expect(frame.y + localCamera.y + point.y * camera.scale).toBeCloseTo(camera.y + point.y * camera.scale);
		}
	}
	expect(visibleMapViewport({ x: 374.09, y: 130, scale: 0.443 }, 1280, 800, 1200, 1320))
		.toEqual({ x: 374, y: 130, width: 532, height: 585 });
});

test('viewport canvas cancels map CSS transform across pan, zoom and resize', function () {
	for (const camera of [{ x: 374.09, y: 130, scale: 0.443 }, { x: -1250, y: 542, scale: 3.7 }]) {
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

test('pending routes retain screen-space dashes even when endpoints are offscreen', function () {
	const segments = dashedLine({ x: -10, y: 5 }, { x: 15, y: 5 }, 8, 5);
	expect(segments).toEqual([[{ x: -10, y: 5 }, { x: -2, y: 5 }], [{ x: 3, y: 5 }, { x: 11, y: 5 }]]);
	expect(dashedLine({ x: 0, y: 0 }, { x: 0, y: 10 }, 8, 5)).toEqual([[{ x: 0, y: 0 }, { x: 0, y: 8 }]]);
	expect(dashedLine({ x: 1, y: 1 }, { x: 1, y: 1 }, 8, 5)).toEqual([]);
});

test('canvas clip retains the logical map edge when panned beyond its bounds', function () {
	expect(mapClipInsets({ x: 100, y: 200, scale: 0.5 }, 800, 600, 1200, 600))
		.toEqual({ top: 400, left: 200, right: 200, bottom: 200 });
	expect(mapClipInsets({ x: -100, y: -200, scale: 2 }, 800, 600, 1200, 1320))
		.toEqual({ top: 0, left: 0, right: 0, bottom: 0 });
});
