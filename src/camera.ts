export interface Point {
	readonly x: number;
	readonly y: number;
}
export interface Camera extends Point {
	readonly scale: number;
}
export interface ViewportArea extends Point {
	readonly width: number;
	readonly height: number;
}
export const fitCamera = function (map: { readonly width: number; readonly height: number }, area: ViewportArea): Camera {
	const scale = Math.max(0.05, Math.min(area.width / map.width, area.height / map.height));
	return {
		x: area.x + (area.width - map.width * scale) / 2,
		y: area.y + (area.height - map.height * scale) / 2,
		scale,
	};
};

// Pan just enough to keep a selected world's ring and labels clear of HUD panels.
export const revealPoint = function (camera: Camera, point: Point, area: ViewportArea): Camera {
	const margin = Math.min(64, area.width / 3, area.height / 3);
	const x = camera.x + point.x * camera.scale;
	const y = camera.y + point.y * camera.scale;
	const visibleX = Math.max(area.x + margin, Math.min(area.x + area.width - margin, x));
	const visibleY = Math.max(area.y + margin, Math.min(area.y + area.height - margin, y));
	return { ...camera, x: camera.x + visibleX - x, y: camera.y + visibleY - y };
};
