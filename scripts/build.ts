import { copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import { generateSW } from 'workbox-build';

await rm('dist', { recursive: true, force: true });
const result = await Bun.build({
	entrypoints: ['index.html', 'src/register-pwa.ts'],
	outdir: 'dist',
	minify: true,
	sourcemap: 'external',
});
if (!result.success)
	throw new AggregateError(result.logs, 'Browser build failed');
// The player-card poster is an absolute production URL, so the filename must stay stable.
await copyFile('assets/x-card.jpg', 'dist/x-card.jpg');

// Keep PWA URLs relative so the same build works at a domain root or Pages subpath.
const manifest = {
	id: './',
	name: 'Galaxy Conquest',
	short_name: 'Galaxy Conquest',
	description: 'Conquer the star map in a single-player strategy game.',
	start_url: './',
	scope: './',
	display: 'standalone',
	background_color: '#0a101b',
	theme_color: '#0a101b',
	icons: [192, 512].map(function (size) {
		return {
			src: `icon-${size}.png`,
			sizes: `${size}x${size}`,
			type: 'image/png',
			purpose: 'any',
		};
	}),
};
for (const size of [180, 192, 512]) {
	await copyFile(`assets/icon-${size}.png`, `dist/icon-${size}.png`);
}
await writeFile('dist/manifest.webmanifest', JSON.stringify(manifest, null, '\t'));

// Register only production builds; development stays free of cached bundles.
const html = await readFile('dist/index.html', 'utf8');
await writeFile('dist/index.html', html.replace('</head>', `
<link rel="manifest" href="./manifest.webmanifest">
<link rel="apple-touch-icon" href="./icon-180.png">
<script src="./src/register-pwa.js" defer></script>
</head>`));

const { warnings } = await generateSW({
	globDirectory: 'dist',
	// Accepted opaque atlas master; included for offline gameplay.
	maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
	globPatterns: ['**/*.{html,js,css,svg,png,webmanifest}'],
	swDest: 'dist/sw.js',
	inlineWorkboxRuntime: true,
	sourcemap: false,
	cacheId: 'galaxy-conquest',
	// Let existing games finish before activating a new release.
	skipWaiting: false,
	// Claim existing pages on activation so an opted-in page can reload on controllerchange.
	clientsClaim: true,
});
if (warnings.length > 0) throw new Error(warnings.join('\n'));
