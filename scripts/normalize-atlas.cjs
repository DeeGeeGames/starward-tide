// Run with Playwright available via PLAYWRIGHT_MODULE; serve repo root on3129.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const crypto = require('node:crypto');
const normalize = async function () {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.goto('http://127.0.0.1:3129/');
		const records = [];
		for (const name of ['transport', 'carrier', 'platform', 'ochre-surface', 'mineral-surface']) {
			const result = await page.evaluate(async function (name) {
				const image = new Image();
				image.src = `/assets/stellar-atlas/masters/${name === 'transport' ? 'transport-v2' : name}.png`;
				await image.decode();
				const canvas = document.createElement('canvas');
				canvas.width = image.width; canvas.height = image.height;
				const context = canvas.getContext('2d');
				context.drawImage(image, 0, 0);
				const output = document.createElement('canvas');
				const surface = name.endsWith('surface');
				output.width = surface ? 1024 : 256; output.height = surface ? 512 : 256;
				let bounds = [0, 0, image.width, image.height];
				if (!surface) {
					const data = context.getImageData(0, 0, image.width, image.height).data;
					let left = image.width, right = 0, top = image.height, bottom = 0;
					for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
						if (data[(y * image.width + x) * 4 + 3] < 16) continue;
						left = Math.min(left, x); right = Math.max(right, x);
						top = Math.min(top, y); bottom = Math.max(bottom, y);
					}
					bounds = [left, top, right - left + 1, bottom - top + 1];
				}
				const painter = output.getContext('2d');
				const [left, top, width, height] = bounds;
				const scale = surface ? 1 : 224 / Math.max(width, height);
				const dw = surface ? 1024 : width * scale, dh = surface ? 512 : height * scale;
				painter.drawImage(image, left, top, width, height, (output.width - dw) / 2, (output.height - dh) / 2, dw, dh);
				return { bounds, width: output.width, height: output.height, png: output.toDataURL('image/png').split(',')[1] };
			}, name);
			const bytes = Buffer.from(result.png, 'base64');
			const path = `assets/stellar-atlas/${name}.png`;
			fs.writeFileSync(path, bytes);
			records.push({ path, bounds: result.bounds, width: result.width, height: result.height, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
		}
		fs.writeFileSync('docs/stellar-atlas-adoption/exports.json', JSON.stringify(records, null, 2));
	} finally { await browser.close(); }
};
normalize().catch(function (error) { console.error(error); process.exitCode = 1; });
