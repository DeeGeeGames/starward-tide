import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, LineBasicMaterial, LineSegments } from 'three';
import type { Point } from './camera';
interface SpaceLines {
	object: LineSegments;
	line(from: Point, to: Point, tint: string, strength?: number, elevation?: number): void;
	clear(): void;
	circle(center: Point, radius: number, tint: string, strength?: number, start?: number, end?: number): void;
	flush(): void;
	dispose(): void;
}

// Reuse GPU buffers; line/effect counts can change without leaking geometries.
export const createSpaceLines = function (opacity: number): SpaceLines {
	const geometry = new BufferGeometry();
	const material = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false });
	const object = new LineSegments(geometry, material);
	object.frustumCulled = false;
	let positions: number[] = [];
	let colors: number[] = [];
	let capacity = 0;
	const color = new Color();
	const line = function (from: Point, to: Point, tint: string, strength = 1, elevation = 0): void {
		positions.push(from.x, elevation, from.y, to.x, elevation, to.y);
		color.set(tint).multiplyScalar(strength);
		colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
	};
	return {
		object, line,
		clear: function (): void { positions = []; colors = []; },
		circle: function (center: Point, radius: number, tint: string, strength = 1, start = 0, end = Math.PI * 2): void {
			const steps = Math.max(2, Math.ceil((end - start) * 12));
			for (let i = 0; i < steps; i++) {
				const a = start + (end - start) * i / steps;
				const b = start + (end - start) * (i + 1) / steps;
				line({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius },
					{ x: center.x + Math.cos(b) * radius, y: center.y + Math.sin(b) * radius }, tint, strength);
			}
		},
		flush: function (): void {
			if (positions.length > capacity) {
				// Release the currently uploaded attributes before replacing them.
				// Three can then upload the new buffers on the next render.
				geometry.dispose();
				capacity = Math.max(1024, 2 ** Math.ceil(Math.log2(positions.length)));
				geometry.setAttribute('position', new BufferAttribute(new Float32Array(capacity), 3).setUsage(DynamicDrawUsage));
				geometry.setAttribute('color', new BufferAttribute(new Float32Array(capacity), 3).setUsage(DynamicDrawUsage));
			}
			const position = geometry.getAttribute('position');
			const tint = geometry.getAttribute('color');
			if (position && tint) {
				position.array.set(positions); tint.array.set(colors);
				position.needsUpdate = true; tint.needsUpdate = true;
			}
			geometry.setDrawRange(0, positions.length / 3);
		},
		dispose: function (): void { object.removeFromParent(); geometry.dispose(); material.dispose(); },
	};
};
