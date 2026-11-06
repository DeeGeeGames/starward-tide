export type MusicState = 'menu' | 'exploration' | 'battle' | 'paused' | 'victory' | 'defeat' | 'silent';

interface Chord {
	readonly bass: number;
	readonly voices: readonly number[];
	readonly melody: readonly number[];
}

// An original, unhurried D-minor theme: Dm9 — Bbmaj9 — Fmaj9 — Csus2.
// Open voicings leave the middle of the mix clear for tactical feedback.
const home: Chord = { bass: 38, voices: [57, 60, 64, 65], melody: [74, 69, 76, 72] };
const progression: readonly Chord[] = [
	home,
	{ bass: 34, voices: [53, 57, 60, 62], melody: [72, 69, 74, 65] },
	{ bass: 41, voices: [57, 60, 64, 67], melody: [69, 72, 79, 76] },
	{ bass: 36, voices: [55, 60, 62, 67], melody: [74, 67, 72, 69] },
];
const resolution: Chord = { bass: 38, voices: [57, 61, 64, 66], melody: [74, 78, 81, 76] };
const beatLength = 60 / 72;
const melodyBeats = [1, 4, 6, 7] as const;
const levels: Readonly<Record<MusicState, number>> = {
	menu: 0.85, exploration: 0.7, battle: 0.8, paused: 0.3, victory: 0.85, defeat: 0.4, silent: 0,
};

interface Voice {
	readonly oscillators: readonly OscillatorNode[];
	readonly gain: GainNode;
	readonly pan: StereoPannerNode;
	readonly filter: BiquadFilterNode;
}

export interface MusicPlayer {
	setState(state: MusicState): void;
	setActive(active: boolean): void;
	dispose(): void;
}

/** A bounded look-ahead sequencer. It never schedules missed notes after suspension. */
export const createMusicPlayer = function (context: AudioContext, output: AudioNode): MusicPlayer {
	const bed = context.createGain();
	const pulse = context.createGain();
	bed.gain.value = levels.menu;
	pulse.gain.value = 0;
	bed.connect(output);
	pulse.connect(output);
	const voices = new Set<Voice>();
	let state: MusicState = 'menu';
	let active = false;
	let disposed = false;
	let timer: ReturnType<typeof setInterval> | undefined;
	let beat = 0;
	let nextNote = 0;
	const release = function (voice: Voice): void {
		if (!voices.delete(voice)) return;
		for (const oscillator of voice.oscillators) { oscillator.onended = null; oscillator.disconnect(); }
		voice.gain.disconnect(); voice.pan.disconnect(); voice.filter.disconnect();
	};
	const stop = function (): void {
		if (timer !== undefined) { clearInterval(timer); timer = undefined; }
		for (const voice of voices) {
			for (const oscillator of voice.oscillators) oscillator.stop();
			release(voice);
		}
	};
	const note = function (
		pitch: number, when: number, duration: number, volume: number,
		pan: number, kind: 'pad' | 'bell' | 'pulse',
	): void {
		const gain = context.createGain();
		const panner = context.createStereoPanner();
		const filter = context.createBiquadFilter();
		const frequency = 440 * 2 ** ((pitch - 69) / 12);
		const attack = kind === 'pad' ? 1.8 : kind === 'bell' ? 0.025 : 0.04;
		panner.pan.value = pan;
		filter.type = 'lowpass';
		filter.frequency.value = kind === 'pad' ? 1100 : kind === 'bell' ? 1900 : 240;
		filter.Q.value = 0.35;
		gain.gain.setValueAtTime(0, when);
		gain.gain.linearRampToValueAtTime(volume, when + attack);
		if (kind === 'pad') gain.gain.setValueAtTime(volume, when + duration - 2.6);
		gain.gain.exponentialRampToValueAtTime(0.0001, when + duration - 0.03);
		gain.gain.linearRampToValueAtTime(0, when + duration);
		gain.connect(filter).connect(panner).connect(kind === 'pulse' ? pulse : bed);
		const detunes = kind === 'pad' ? [-3, 3] : [0];
		const oscillators = detunes.map(function (detune): OscillatorNode {
			const oscillator = context.createOscillator();
			oscillator.type = kind === 'pulse' ? 'triangle' : 'sine';
			oscillator.frequency.value = frequency;
			oscillator.detune.value = detune;
			oscillator.connect(gain);
			return oscillator;
		});
		const voice: Voice = { oscillators, gain, pan: panner, filter };
		voices.add(voice);
		for (const oscillator of oscillators) {
			oscillator.onended = function (): void { release(voice); };
			oscillator.start(when);
			oscillator.stop(when + duration);
		}
	};
	const schedule = function (): void {
		if (!active || disposed || state === 'silent' || context.state !== 'running') return;
		const now = context.currentTime;
		if (nextNote < now - 0.5) {
			// A throttled/background timer resumes at a new phrase, without a burst of old notes.
			beat = Math.ceil(beat / 8) * 8;
			nextNote = now + 0.06;
		}
		while (nextNote < now + 0.3) {
			const phrase = Math.floor(beat / 8);
			const chord = state === 'victory' ? resolution : progression[phrase % progression.length] ?? home;
			const position = beat % 8;
			if (position === 0) {
				note(chord.bass, nextNote, beatLength * 8 + 2.5, 0.042, 0, 'pad');
				for (const [index, pitch] of chord.voices.entries()) {
					note(pitch, nextNote + index * 0.08, beatLength * 8 + 2.5, 0.018, (index - 1.5) * 0.3, 'pad');
				}
			}
			const melodyIndex = melodyBeats.findIndex(function (value) { return value === position; });
			const melody = chord.melody[melodyIndex];
			if (melody !== undefined && state !== 'paused' && state !== 'defeat') {
				// Alternate phrases leave more air between the motif's final two notes.
				if (phrase % 2 === 0 || melodyIndex < 2)
					note(melody, nextNote, 2.9, 0.044, melodyIndex % 2 === 0 ? -0.25 : 0.25, 'bell');
			}
			if (state === 'battle' && position % 2 === 0) {
				note(chord.bass + 12, nextNote, 0.7, 0.07, 0, 'pulse');
				note(chord.bass + 19, nextNote + beatLength * 0.75, 0.4, 0.022, 0.18, 'pulse');
			}
			beat++;
			nextNote += beatLength;
		}
	};
	const start = function (): void {
		if (!active || disposed || state === 'silent' || timer !== undefined || context.state !== 'running') return;
		beat = Math.ceil(beat / 8) * 8;
		nextNote = context.currentTime + 0.06;
		schedule();
		timer = setInterval(schedule, 180);
	};
	return {
		setState: function (value): void {
			if (disposed || state === value) return;
			state = value;
			bed.gain.setTargetAtTime(levels[value], context.currentTime, 0.65);
			pulse.gain.setTargetAtTime(value === 'battle' ? 1 : 0, context.currentTime, 0.3);
			if (state === 'silent') stop();
			else start();
		},
		setActive: function (value): void {
			if (disposed || active === value) return;
			active = value;
			if (active) start();
			else stop();
		},
		dispose: function (): void {
			if (disposed) return;
			disposed = true;
			stop(); bed.disconnect(); pulse.disconnect();
		},
	};
};
