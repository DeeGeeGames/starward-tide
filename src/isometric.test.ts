import { expect, test } from 'bun:test';
import { OrthographicCamera, Vector3 } from 'three';
import { projectMap, unprojectMap, fitIsometricCamera, mapSegmentVisible } from './isometric';
import { syncIsometricCamera } from './isometric-camera';
import { revealPoint } from './camera';

test('map commands round-trip through the isometric plane including negative projected coordinates', function () {
	for (const point of [{ x: 0, y: 0 }, { x: 1200, y: 1320 }, { x: 50, y: 1000 }, { x: -20, y: 900 }]) {
		const recovered = unprojectMap(projectMap(point));
		expect(recovered.x).toBeCloseTo(point.x, 10);
		expect(recovered.y).toBeCloseTo(point.y, 10);
	}
});

test('Three projection and DOM targets agree through pan, zoom, resize, and hull elevation', function () {
	const view = new OrthographicCamera(-1, 1, 1, -1, 1, 50000);
	for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
		for (const camera of [{ x: 800, y: 100, scale: 0.6 }, { x: -500, y: -200, scale: 2.7 }]) {
			syncIsometricCamera(view, camera, viewport.width, viewport.height);
			for (const point of [{ x: 100, y: 1200 }, { x: 800, y: 500 }]) for (const elevation of [0, 20]) {
				const projected = projectMap(point, elevation);
				const actual = new Vector3(point.x, elevation, point.y).project(view);
				expect((actual.x + 1) * viewport.width / 2).toBeCloseTo(camera.x + projected.x * camera.scale, 8);
				expect((1 - actual.y) * viewport.height / 2).toBeCloseTo(camera.y + projected.y * camera.scale, 8);
			}
		}
	}
});

test('fit and selection reveal keep every projected map corner inside the available area', function () {
	const map = { width: 1200, height: 1320 };
	const area = { x: 20, y: 150, width: 350, height: 640 };
	const camera = fitIsometricCamera(map, area);
	for (const x of [0, map.width]) for (const y of [0, map.height]) {
		const point = projectMap({ x, y });
		expect(camera.x + point.x * camera.scale).toBeGreaterThanOrEqual(area.x - 0.001);
		expect(camera.x + point.x * camera.scale).toBeLessThanOrEqual(area.x + area.width + 0.001);
		expect(camera.y + point.y * camera.scale).toBeGreaterThanOrEqual(area.y - 0.001);
		expect(camera.y + point.y * camera.scale).toBeLessThanOrEqual(area.y + area.height + 0.001);
	}
	const point = projectMap({ x: 1200, y: 1320 });
	const sheetArea = { ...area, height: 200 };
	const revealed = revealPoint(camera, point, sheetArea);
	const nextY = revealed.y + point.y * revealed.scale;
		expect(nextY).toBeLessThanOrEqual(sheetArea.y + sheetArea.height - 60);
		expect(revealed.scale).toBe(camera.scale);
});

test('zoomed crossing beams remain visible with both endpoints offscreen', function () {
	const camera = { x: 400, y: -500, scale: 4 };
	const from = unprojectMap({ x: -400, y: 200 });
	const to = unprojectMap({ x: 800, y: 200 });
	expect(mapSegmentVisible(from, to, camera, 800, 600)).toBe(true);
	expect(mapSegmentVisible(unprojectMap({ x: -400, y: -200 }), unprojectMap({ x: 800, y: -200 }), camera, 800, 600)).toBe(false);
	expect(mapSegmentVisible(from, to, { ...camera, y: -1500 }, 800, 600)).toBe(false);
});
