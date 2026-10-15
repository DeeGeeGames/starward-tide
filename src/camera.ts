export interface Point {
	readonly x: number;
	readonly y: number;
}
export interface Camera extends Point {
	readonly scale: number;
}
export const zoomCamera = function (
	camera: Camera,
	anchor: Point,
	factor: number,
	minimum: number,
	maximum: number,
): Camera {
	const scale = Math.min(maximum, Math.max(minimum, camera.scale * factor));
	const ratio = scale / camera.scale;
	return {
		x: anchor.x - (anchor.x - camera.x) * ratio,
		y: anchor.y - (anchor.y - camera.y) * ratio,
		scale,
	};
};
