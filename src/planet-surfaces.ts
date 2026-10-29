// Presentation only: shared, seamless maps projected by the existing globe renderer.
export const PLANET_TERRAINS = ['ocean', 'ice', 'volcanic', 'gas', 'cratered'] as const;
type Terrain = typeof PLANET_TERRAINS[number];
type RGB = readonly [number, number, number];

const colorAt = function (terrain: Terrain, longitude: number, latitude: number): RGB {
	const wave = Math.sin(longitude * 3 + Math.sin(latitude * 7))
		+ Math.sin(longitude * 7 - latitude * 11) * 0.5
		+ Math.cos(longitude * 13 + latitude * 19) * 0.22;
	const polar = Math.abs(latitude) > 1.18;
	switch (terrain) {
		case 'ocean':
			return polar ? [191, 220, 218] : wave > 0.45 ? [65, 113, 79] : wave > 0.25 ? [153, 157, 101] : [22, 77 + wave * 9, 117 + wave * 15];
		case 'ice':
			return Math.abs(wave) < 0.08 ? [54, 104, 133] : [157 + wave * 20, 198 + wave * 15, 216 + wave * 12];
		case 'volcanic':
			return Math.abs(wave) < 0.12 ? [246, 98 + wave * 120, 24] : [48 + wave * 9, 38 + wave * 4, 45 + wave * 5];
		case 'gas': {
			const bands = Math.sin(latitude * 32 + Math.sin(longitude * 4) * 0.6 + Math.sin(longitude * 9 + latitude * 12) * 0.15);
			return [176 + bands * 42, 133 + bands * 38, 98 + bands * 29];
		}
		case 'cratered': {
			let shade = 135 + wave * 12;
			for (let index = 0; index < 24; index++) {
				const center = index * 2.39996;
				const delta = Math.atan2(Math.sin(longitude - center), Math.cos(longitude - center));
				const vertical = latitude - Math.sin(index * 7.13) * 1.3;
				const distance = Math.hypot(delta * Math.cos(latitude), vertical);
				const radius = 0.07 + (index % 4) * 0.025;
				if (distance < radius) shade -= 34 * (1 - distance / radius);
				else if (distance < radius + 0.025) shade += 22;
			}
			return [shade, shade * 0.95, shade * 0.88];
		}
	}
};

export const createPlanetSurface = function (terrain: Terrain): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = 1024;
	canvas.height = 512;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Planet surfaces require Canvas 2D');
	const pixels = context.createImageData(canvas.width, canvas.height);
	for (let y = 0; y < canvas.height; y++) {
		for (let x = 0; x < canvas.width; x++) {
			const color = colorAt(terrain, x / canvas.width * Math.PI * 2, (y / canvas.height - 0.5) * Math.PI);
			const offset = (y * canvas.width + x) * 4;
			pixels.data[offset] = color[0];
			pixels.data[offset + 1] = color[1];
			pixels.data[offset + 2] = color[2];
			pixels.data[offset + 3] = 255;
		}
	}
	context.putImageData(pixels, 0, 0);
	return canvas;
};
