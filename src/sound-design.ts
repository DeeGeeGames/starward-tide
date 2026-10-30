import type { WorldSound } from './sound-events';

export type SoundCue = WorldSound | 'select' | 'command' | 'error';
interface Layer {
	wave: 'sine' | 'triangle' | 'noise';
	start: number;
	duration: number;
	from: number;
	to: number;
	gain: number;
}
const tone = function (from: number, to: number, duration: number, gain: number, start = 0): Layer {
	return { wave: 'sine', from, to, duration, gain, start };
};
const noise = function (duration: number, gain: number, from: number, to: number): Layer {
	return { wave: 'noise', duration, gain, from, to, start: 0 };
};
const designs: Record<SoundCue, readonly Layer[]> = {
	select: [tone(740, 920, 0.07, 0.16), tone(1480, 1480, 0.055, 0.06, 0.025)],
	command: [tone(260, 520, 0.16, 0.2), tone(520, 1040, 0.18, 0.12, 0.07), noise(0.26, 0.12, 1400, 300)],
	error: [tone(180, 120, 0.16, 0.2), tone(180, 120, 0.12, 0.14, 0.12)],
	laser: [{ ...tone(1700, 180, 0.13, 0.14), wave: 'triangle' }, noise(0.08, 0.08, 3500, 700)],
	explosion: [noise(0.48, 0.34, 1600, 90), tone(110, 32, 0.36, 0.3)],
	charge: [tone(140, 820, 0.75, 0.22), tone(210, 1230, 0.75, 0.1)],
	bombard: [noise(1.15, 0.42, 2400, 65), tone(150, 26, 0.95, 0.38), tone(55, 32, 1.2, 0.18, 0.08)],
	capture: [tone(523, 523, 0.2, 0.18), tone(659, 659, 0.24, 0.18, 0.1), tone(784, 784, 0.38, 0.2, 0.2)],
	loss: [tone(392, 294, 0.28, 0.22), tone(261, 196, 0.4, 0.2, 0.18)],
	victory: [tone(523, 523, 0.4, 0.18), tone(659, 659, 0.5, 0.18, 0.16), tone(784, 784, 0.6, 0.18, 0.32), tone(1046, 1046, 0.75, 0.2, 0.48)],
	defeat: [tone(330, 294, 0.4, 0.2), tone(261, 220, 0.45, 0.2, 0.2), tone(196, 130, 0.7, 0.22, 0.4)],
	draw: [tone(440, 440, 0.4, 0.18), tone(523, 523, 0.5, 0.16, 0.16), tone(440, 440, 0.55, 0.16, 0.32)],
};

// Short, cached mono samples avoid oscillator/node churn during combat. Noise
// uses a local seed; audio never consumes gameplay randomness.
export const synthesizeSound = function (cue: SoundCue, sampleRate: number): Float32Array {
	const layers = designs[cue];
	const duration = Math.max(...layers.map(function (layer) { return layer.start + layer.duration; }));
	const samples = new Float32Array(Math.ceil(duration * sampleRate));
	let seed = 7301;
	for (const layer of layers) {
		let phase = 0;
		let filtered = 0;
		const start = Math.floor(layer.start * sampleRate);
		const length = Math.floor(layer.duration * sampleRate);
		for (let index = 0; index < length; index++) {
			const progress = index / length;
			const frequency = layer.from * Math.pow(layer.to / layer.from, progress);
			phase += frequency / sampleRate;
			let value = Math.sin(phase * Math.PI * 2);
			if (layer.wave === 'triangle') value = 2 / Math.PI * Math.asin(value);
			if (layer.wave === 'noise') {
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
				const white = seed / 0x80000000 - 1;
				filtered += (1 - Math.exp(-2 * Math.PI * frequency / sampleRate)) * (white - filtered);
				value = filtered;
			}
			const attack = Math.min(1, index / (sampleRate * 0.006));
			const tail = Math.min(1, (length - index - 1) / (sampleRate * 0.025));
			const envelope = attack * tail * Math.exp(-3 * progress);
			const target = start + index;
			samples[target] = (samples[target] ?? 0) + value * layer.gain * envelope;
		}
	}
	return samples;
};
