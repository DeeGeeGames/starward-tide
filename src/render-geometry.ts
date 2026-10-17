import type { Camera, Point } from './camera';

export const shipDetailZoom = function (zoom: number): 1 | 2 | 3 {
	if (zoom >= 2.5) return 3;
	if (zoom >= 1.75) return 2;
	return 1;
};

// Cancel the DOM map transform for a viewport-sized backing canvas. The Pixi
// root applies that same camera in logical CSS pixels; planets keep the DOM map.
export const canvasViewport = function (camera: Camera, width: number, height: number): {
	left: number; top: number; width: number; height: number;
} {
	return { left: -camera.x / camera.scale, top: -camera.y / camera.scale,
		width: width / camera.scale, height: height / camera.scale };
};

// Allocate only the map/viewport intersection, rounded outward to device-neutral
// CSS pixels. Keep DPR unchanged; the existing clip removes the fractional rim.
export const visibleMapViewport = function (camera: Camera, width: number, height: number, mapWidth: number, mapHeight: number): {
	x: number; y: number; width: number; height: number;
} {
	const x = Math.floor(Math.max(0, Math.min(width, camera.x)));
	const y = Math.floor(Math.max(0, Math.min(height, camera.y)));
	const right = Math.ceil(Math.max(0, Math.min(width, camera.x + mapWidth * camera.scale)));
	const bottom = Math.ceil(Math.max(0, Math.min(height, camera.y + mapHeight * camera.scale)));
	return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
};

export const dashedLine = function (
	from: Point,
	to: Point,
	dash: number,
	gap: number,
): readonly (readonly [Point, Point])[] {
	const length = Math.hypot(to.x - from.x, to.y - from.y);
	if (!length) return [];
	const segments: (readonly [Point, Point])[] = [];
	for (let start = 0; start < length; start += dash + gap) {
		const end = Math.min(start + dash, length);
		segments.push([
			{ x: from.x + (to.x - from.x) * start / length, y: from.y + (to.y - from.y) * start / length },
			{ x: from.x + (to.x - from.x) * end / length, y: from.y + (to.y - from.y) * end / length },
		]);
	}
	return segments;
};

// Insets are in the canvas element's CSS coordinates, before the map transform.
export const mapClipInsets = function (camera: Camera, width: number, height: number, mapWidth: number, mapHeight: number): {
	top: number; right: number; bottom: number; left: number;
} {
	return { top: Math.max(0, camera.y / camera.scale), left: Math.max(0, camera.x / camera.scale),
		right: Math.max(0, (width - camera.x) / camera.scale - mapWidth),
		bottom: Math.max(0, (height - camera.y) / camera.scale - mapHeight) };
};
