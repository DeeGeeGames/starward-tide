// Browser regression fixture: bundle into dist and load from a temporary HTML.
import { loadAtlasAssets } from '../src/atlas-assets';
const atlas = await loadAtlasAssets();
for (const variant of atlas.globes) {
	const context = variant.globe.getContext('2d');
	if (!context) throw new Error('Missing globe context');
	const pixels = function (): Uint8ClampedArray { return context.getImageData(0, 0, 128, 128).data; };
	const start = pixels();
	if (start[3] !== 0 || start[(64 * 128 + 64) * 4 + 3] !== 255) throw new Error('Invalid globe silhouette');
	if (variant.update(0)) throw new Error('Unchanged clock must not upload');
	variant.update(12);
	if (pixels().every(function (value, index) { return value === start[index]; })) throw new Error('Surface did not rotate');
	variant.update(48);
	if (!pixels().every(function (value, index) { return value === start[index]; })) throw new Error('Rotation did not wrap');
}
document.body.textContent = 'PASS: all three globes - alpha, stationary clock, rotation and full-revolution wrap';
