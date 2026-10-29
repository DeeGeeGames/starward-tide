import type { Camera, Point } from './camera';

export const shipDetailZoom = function (zoom: number): 1 | 2 | 3 {
	if (zoom >= 2.5) return 3;
	if (zoom >= 1.75) return 2;
	return 1;
};

export const planetPlatformOrbitRadius = function (planetRadius: number): number {
	return Math.max((planetRadius + 20) * 1.5, planetRadius + 54);
};

// Cancel the DOM map transform for a viewport-sized backing canvas. The Pixi
// root applies that same camera in logical CSS pixels; planets keep the DOM map.
export const canvasViewport = function (camera: Camera, width: number, height: number): {
	left: number; top: number; width: number; height: number;
} {
	return { left: -camera.x / camera.scale, top: -camera.y / camera.scale,
		width: width / camera.scale, height: height / camera.scale };
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
