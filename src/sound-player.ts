import { synthesizeSound, type SoundCue } from './sound-design';

const MUTE_KEY = 'starward-tide.sound-muted';
const cooldown: Partial<Record<SoundCue, number>> = { laser: 0.14, explosion: 0.22, charge: 0.5, bombard: 0.5, capture: 0.25, loss: 0.25, select: 0.045 };
interface Voice {
	source: AudioBufferSourceNode;
	pan: StereoPannerNode;
	gain: GainNode;
}
export interface SoundPlayer {
	isMuted(): boolean;
	setMuted(muted: boolean): void;
	unlock(): void;
	setActive(active: boolean): void;
	play(cue: SoundCue, pan?: number, volume?: number): void;
	stop(): void;
	dispose(): Promise<void>;
}

export const createSoundPlayer = function (): SoundPlayer {
	let muted = false;
	try { muted = localStorage.getItem(MUTE_KEY) === 'true'; } catch { /* Storage is optional. */ }
	let active = true;
	let disposed = false;
	let context: AudioContext | undefined;
	let master: GainNode | undefined;
	let resuming = false;
	const buffers = new Map<SoundCue, AudioBuffer>();
	const lastPlayed = new Map<SoundCue, number>();
	const voices = new Set<Voice>();
	const release = function (voice: Voice): void {
		voice.source.disconnect(); voice.pan.disconnect(); voice.gain.disconnect();
		voices.delete(voice);
	};
	const stop = function (): void {
		for (const voice of voices) { voice.source.stop(); release(voice); }
		lastPlayed.clear();
	};
	const unlock = function (): void {
		if (disposed || muted || !active || typeof AudioContext === 'undefined') return;
		try {
			if (!context) {
				context = new AudioContext({ latencyHint: 'interactive' });
				master = context.createGain();
				master.gain.value = 0.55;
				master.connect(context.destination);
				context.addEventListener('statechange', function () {
					if (context?.state !== 'running') stop();
				});
			}
			if (context.state !== 'running' && context.state !== 'closed' && (!resuming || navigator.userActivation?.isActive)) {
				resuming = true;
				void context.resume().catch(function () {}).finally(function () { resuming = false; });
			}
		} catch { /* Audio availability must not prevent play. */ }
	};
	return {
		isMuted: function (): boolean { return muted; },
		setMuted: function (value): void {
			muted = value;
			if (muted) stop();
			else unlock();
			try { localStorage.setItem(MUTE_KEY, String(muted)); } catch { /* Keep the session setting. */ }
		},
		unlock,
		setActive: function (value): void {
			if (active === value) return;
			active = value;
			if (!active) stop();
		},
		play: function (cue, pan = 0, volume = 1): void {
			// Never queue cues behind browser autoplay restrictions or tab suspension.
			if (disposed || muted || !active || !context || !master || context.state !== 'running') return;
			const now = context.currentTime;
			if (now - (lastPlayed.get(cue) ?? -Infinity) < (cooldown[cue] ?? 0.08)) return;
			// Reserve headroom for strategic feedback when battle voices are full.
			if (voices.size >= 8 && (cue === 'laser' || cue === 'explosion')) return;
			if (voices.size >= 12) {
				const oldest = voices.values().next().value;
				if (oldest) { oldest.source.stop(); release(oldest); }
			}
			let buffer = buffers.get(cue);
			if (!buffer) {
				const samples = synthesizeSound(cue, context.sampleRate);
				buffer = context.createBuffer(1, samples.length, context.sampleRate);
				buffer.getChannelData(0).set(samples);
				buffers.set(cue, buffer);
			}
			const source = context.createBufferSource();
			const panner = context.createStereoPanner();
			const gain = context.createGain();
			panner.pan.value = Math.max(-0.8, Math.min(0.8, pan));
			gain.gain.value = Math.max(0, Math.min(1, volume));
			source.buffer = buffer;
			source.connect(panner).connect(gain).connect(master);
			const voice: Voice = { source, pan: panner, gain };
			source.onended = function (): void { release(voice); };
			voices.add(voice);
			lastPlayed.set(cue, now);
			source.start();
		},
		stop,
		dispose: async function (): Promise<void> {
			if (disposed) return;
			disposed = true;
			stop(); buffers.clear();
			if (context && context.state !== 'closed') await context.close().catch(function () {});
		},
	};
};
