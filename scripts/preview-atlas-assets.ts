// Inspection-only contact sheet: bundle to dist and load in a temporary page.
import carrierUrl from '../assets/stellar-atlas/carrier.png';
import { loadAtlasAssets } from '../src/atlas-assets';
const atlas = await loadAtlasAssets();
document.body.style.cssText = 'margin:16px;background:#eee5cf;color:#153e46;font:14px sans-serif';
for (const [index, variant] of atlas.globes.entries()) {
	const row = document.createElement('div');
	const heading = document.createElement('p');
	heading.textContent = `Terrain ${index + 1} · phases 0 / 8 / 16 / 24 / 32 / 40 / 48 seconds`;
	row.style.display = 'flex';
	document.body.append(heading, row);
	for (const seconds of [0, 8, 16, 24, 32, 40, 48]) {
		variant.update(seconds);
		const copy = document.createElement('canvas');
		copy.width = 128; copy.height = 128;
		copy.getContext('2d')?.drawImage(variant.globe, 0, 0);
		row.append(copy);
	}
}
const carrier = new Image();
carrier.src = carrierUrl;
await carrier.decode();
for (const background of ['#eee5cf', '#153e46']) {
	for (const scale of [1, 3]) {
		const row = document.createElement('div'); row.style.background = background;
		row.style.padding = '12px';
		const label = document.createElement('span');
		label.textContent = `${scale}× unit scale `;
		label.style.color = background === '#eee5cf' ? '#153e46' : '#eee5cf';
		row.append(label);
		for (const [image, width] of [[atlas.warship, 32], [atlas.transport, 32], [carrier, 84], [atlas.platform, 24]] as const) {
			const copy = image.cloneNode();
			if (copy instanceof HTMLImageElement) { copy.style.width = `${width * scale}px`; row.append(copy); }
		}
		document.body.append(row);
	}
}
