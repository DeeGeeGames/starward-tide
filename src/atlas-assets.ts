import surfaceUrl from '../docs/visual-directions/asset-proof/planet-surface.png';
import transportUrl from '../assets/stellar-atlas/transport.png';
import platformUrl from '../assets/stellar-atlas/platform.png';
import ochreUrl from '../assets/stellar-atlas/ochre-surface.png';
import mineralUrl from '../assets/stellar-atlas/mineral-surface.png';
import warshipUrl from '../docs/visual-directions/asset-proof/warship-sprite.png';

const loadImage = async function (url: string): Promise<HTMLImageElement> {
	const image = new Image();
	image.src = url;
	await image.decode();
	return image;
};

// Each of the three terrain variants shares one globe across all its worlds.
// No per-planet sampling, additional RAF, or persisted presentation state.
const createGlobe = function (surface: HTMLImageElement) {
	const sampling = document.createElement('canvas');
	sampling.width = 1024; sampling.height = 512;
	const sampler = sampling.getContext('2d', { willReadFrequently: true });
	const globe = document.createElement('canvas');
	globe.width = 128; globe.height = 128;
	const context = globe.getContext('2d');
	if (!sampler || !context) throw new Error('Atlas artwork requires Canvas 2D');
	sampler.drawImage(surface, 0, 0, 1024, 512);
	const pixels = sampler.getImageData(0, 0, 1024, 512).data;
	const frame = context.createImageData(128, 128);
	const lookup: { offset: number; u: number; row: number; light: number; alpha: number }[] = [];
	for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
		const nx = (x + 0.5 - 64) / 63;
		const ny = (y + 0.5 - 64) / 63;
		const r2 = nx * nx + ny * ny;
		if (r2 >= 1) continue;
		const nz = Math.sqrt(1 - r2);
		const dot = Math.max(0, nx * -0.56 + ny * -0.42 + nz * 0.71);
		lookup.push({ offset: (y * 128 + x) * 4,
			u: Math.atan2(nx, nz) / (2 * Math.PI) + 0.5,
			row: Math.min(511, Math.floor((Math.asin(ny) / Math.PI + 0.5) * 512)),
			light: dot > 0.55 ? 1 : dot > 0.18 ? 0.78 : 0.43,
			alpha: Math.min(1, (1 - Math.sqrt(r2)) * 64) * 255 });
	}
	let lastTick = -1;
	const update = function (seconds: number): boolean {
		const tick = Math.floor(seconds * 24);
		if (tick === lastTick) return false;
		lastTick = tick;
		const phase = (tick / 24 / 48) % 1;
		for (const point of lookup) {
			const source = (point.row * 1024 + Math.floor(((point.u + phase) % 1) * 1024)) * 4;
			frame.data[point.offset] = 12 + ((pixels[source] ?? 12) - 12) * point.light;
			frame.data[point.offset + 1] = 42 + ((pixels[source + 1] ?? 42) - 42) * point.light;
			frame.data[point.offset + 2] = 49 + ((pixels[source + 2] ?? 49) - 49) * point.light;
			frame.data[point.offset + 3] = point.alpha;
		}
		context.putImageData(frame, 0, 0);
		return true;
	};
	update(0);
	return { globe, update };
};

export const loadAtlasAssets = async function () {
	const [surface, ochre, mineral, warship, transport, platform] = await Promise.all([
		loadImage(surfaceUrl), loadImage(ochreUrl), loadImage(mineralUrl),
		loadImage(warshipUrl), loadImage(transportUrl), loadImage(platformUrl),
	]);
	const original = createGlobe(surface);
	const globes = [original, createGlobe(ochre), createGlobe(mineral)];
	return { globe: original.globe, globes, warship, transport, platform,
		update: function (seconds: number): boolean { return original.update(seconds); } };
};
