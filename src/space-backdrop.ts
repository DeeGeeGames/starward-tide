// This field is deliberately fixed to the viewport. Camera movement belongs to
// the tactical map; distant stars must not slide with the command surface.
const hash = function (x: number, y: number): number {
	let value = Math.imul(x, 374761393) + Math.imul(y, 668265263);
	value = Math.imul(value ^ value >>> 13, 1274126177);
	return ((value ^ value >>> 16) >>> 0) / 4294967295;
};

const noise = function (x: number, y: number): number {
	const left = Math.floor(x);
	const top = Math.floor(y);
	const dx = x - left;
	const dy = y - top;
	const u = dx * dx * (3 - 2 * dx);
	const v = dy * dy * (3 - 2 * dy);
	const a = hash(left, top) * (1 - u) + hash(left + 1, top) * u;
	const b = hash(left, top + 1) * (1 - u) + hash(left + 1, top + 1) * u;
	return a * (1 - v) + b * v;
};

export const createSpaceBackdrop = function (width: number, height: number): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	const ratio = Math.min(1, 1600 / Math.max(width, height));
	canvas.width = Math.max(1, Math.round(width * ratio));
	canvas.height = Math.max(1, Math.round(height * ratio));
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Star field requires Canvas 2D');

	// Generate low-frequency dust once at resize, then let the canvas interpolate
	// it. No per-frame pixels, gameplay randomness, or texture uploads are needed.
	const dust = document.createElement('canvas');
	dust.width = Math.min(384, canvas.width);
	dust.height = Math.max(1, Math.round(dust.width * canvas.height / canvas.width));
	const dustContext = dust.getContext('2d');
	if (!dustContext) throw new Error('Nebula requires Canvas 2D');
	const pixels = dustContext.createImageData(dust.width, dust.height);
	for (let y = 0; y < dust.height; y++) {
		for (let x = 0; x < dust.width; x++) {
			const nx = x / dust.width;
			const ny = y / dust.height;
			const grain = noise(nx * 5 + 19, ny * 5 + 13) * 0.58
				+ noise(nx * 13 + 23, ny * 13 + 7) * 0.28
				+ noise(nx * 31, ny * 31) * 0.14;
			const lane = ny - (0.76 - nx * 0.55 + Math.sin(nx * 5) * 0.06);
			const veil = Math.exp(-lane * lane * 15) * Math.pow(grain, 1.8);
			const indigo = Math.exp(-((nx - 0.85) ** 2 + (ny - 0.16) ** 2) * 5);
			const offset = (y * dust.width + x) * 4;
			pixels.data[offset] = 5 + veil * 14 + indigo * 5;
			pixels.data[offset + 1] = 11 + veil * 28 + indigo * 2;
			pixels.data[offset + 2] = 19 + veil * 35 + indigo * 13;
			pixels.data[offset + 3] = 255;
		}
	}
	dustContext.putImageData(pixels, 0, 0);
	context.drawImage(dust, 0, 0, canvas.width, canvas.height);

	const count = Math.min(900, Math.max(100, Math.round(width * height / 1800)));
	for (let index = 0; index < count; index++) {
		const x = hash(index, 71) * canvas.width;
		const y = hash(index, 113) * canvas.height;
		const depth = hash(index, 197);
		const radius = (0.35 + depth * depth * 0.8) * ratio;
		const alpha = 0.18 + depth * 0.48;
		context.fillStyle = index % 7 === 0 ? `rgba(236,211,165,${alpha})` : `rgba(168,203,224,${alpha})`;
		context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill();
		if (depth > 0.985) {
			const glow = context.createRadialGradient(x, y, 0, x, y, 5 * ratio);
			glow.addColorStop(0, '#b4d8ef38'); glow.addColorStop(1, '#b4d8ef00');
			context.fillStyle = glow;
			context.fillRect(x - 5 * ratio, y - 5 * ratio, 10 * ratio, 10 * ratio);
		}
	}
	const vignette = context.createRadialGradient(canvas.width / 2, canvas.height / 2, 0,
		canvas.width / 2, canvas.height / 2, Math.hypot(canvas.width, canvas.height) * 0.6);
	vignette.addColorStop(0.3, '#02071000'); vignette.addColorStop(1, '#02071099');
	context.fillStyle = vignette; context.fillRect(0, 0, canvas.width, canvas.height);
	return canvas;
};
