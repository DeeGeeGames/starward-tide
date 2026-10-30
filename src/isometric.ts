import type { Camera, Point, ViewportArea } from './camera';

const horizontal = Math.SQRT1_2;
const vertical = 1 / Math.sqrt(6);

// Map coordinates occupy Three's X/Z plane. Looking along (1, 1, 1)
// gives equal foreshortening on all three axes, with no perspective distortion.
export const projectMap = function (point: Point, elevation = 0): Point {
	return { x: (point.x - point.y) * horizontal, y: (point.x + point.y - elevation * 2) * vertical };
};

export const unprojectMap = function (point: Point): Point {
	return { x: (point.x / horizontal + point.y / vertical) / 2,
		y: (point.y / vertical - point.x / horizontal) / 2 };
};

// Conservative projected segment bounds retain crossing beams even when both
// endpoints lie outside the viewport. False positives only cost a bounded pulse.
export const mapSegmentVisible = function (from: Point, to: Point, camera: Camera, width: number, height: number, margin = 20): boolean {
	const a = projectMap(from);
	const b = projectMap(to);
	return Math.max(a.x, b.x) * camera.scale + camera.x + margin >= 0 &&
		Math.min(a.x, b.x) * camera.scale + camera.x - margin <= width &&
		Math.max(a.y, b.y) * camera.scale + camera.y + margin >= 0 &&
		Math.min(a.y, b.y) * camera.scale + camera.y - margin <= height;
};

export const fitIsometricCamera = function (map: { readonly width: number; readonly height: number }, area: ViewportArea): Camera {
	const width = (map.width + map.height) * horizontal;
	const height = (map.width + map.height) * vertical;
	const scale = Math.max(0.05, Math.min(area.width / width, area.height / height));
	const center = projectMap({ x: map.width / 2, y: map.height / 2 });
	return { x: area.x + area.width / 2 - center.x * scale,
		y: area.y + area.height / 2 - center.y * scale, scale };
};
