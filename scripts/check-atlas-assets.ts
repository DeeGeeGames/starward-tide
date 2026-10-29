// Browser regression fixture: bundle into dist and load from a temporary HTML.
import { loadAtlasAssets } from '../src/atlas-assets';
const atlas = await loadAtlasAssets();
const context = atlas.globe.getContext('2d');
if (!context) throw new Error('Missing globe context');
const pixels = function (): Uint8ClampedArray { return context.getImageData(0, 0, 128, 128).data; };
const start = pixels();
if (start[3] !== 0 || start[(64 * 128 + 64) * 4 + 3] !== 255) throw new Error('Invalid globe silhouette');
if (atlas.update(0)) throw new Error('Unchanged clock must not upload');
atlas.update(12);
if (pixels().every(function (value, index) { return value === start[index]; })) throw new Error('Surface did not rotate');
atlas.update(48);
if (!pixels().every(function (value, index) { return value === start[index]; })) throw new Error('Rotation did not wrap');
document.body.textContent = 'PASS: alpha, stationary clock, rotation and full-revolution wrap';
