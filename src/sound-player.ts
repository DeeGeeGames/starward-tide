import { synthesizeSound, type SoundCue } from './sound-design';
import { createMusicPlayer, type MusicPlayer, type MusicState } from './music-player';

const MUTE_KEY = 'starward-tide.sound-muted';
const EFFECTS_VOLUME_KEY = 'starward-tide.effects-volume';
const MUSIC_VOLUME_KEY = 'starward-tide.music-volume';
const cooldown: Partial<Record<SoundCue, number>> = { laser: 0.14, explosion: 0.22, charge: 0.5, bombard: 0.5, capture: 0.25, loss: 0.25, select: 0.045 };
const readVolume = function (key: string, fallback: number): number {
	try {
		const stored = localStorage.getItem(key);
		if (stored === null || stored.trim() === '') return fallback;
		const value = Number(stored);
		return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
	} catch { return fallback; }
};
const savePreference = function (key: string, value: string): void {
	try { localStorage.setItem(key, value); } catch { /* Keep the session setting. */ }
};
interface Voice {
	source: AudioBufferSourceNode;
	pan: StereoPannerNode;
	gain: GainNode;
}
export interface SoundPlayer {
	isMuted(): boolean;
	setMuted(muted: boolean): void;
	getEffectsVolume(): number;
	setEffectsVolume(volume: number): void;
	getMusicVolume(): number;
	setMusicVolume(volume: number): void;
	setMusicState(state: MusicState): void;
	unlock(): void;
	setActive(active: boolean): void;
	play(cue: SoundCue, pan?: number, volume?: number): void;
	stop(): void;
	dispose(): Promise<void>;
}

export const createSoundPlayer = function (): SoundPlayer {
	let muted = false;
	try { muted = localStorage.getItem(MUTE_KEY) === 'true'; } catch { /* Storage is optional. */ }
	let effectsVolume = readVolume(EFFECTS_VOLUME_KEY, 0.8);
	let musicVolume = readVolume(MUSIC_VOLUME_KEY, 0.45);
	let musicState: MusicState = 'menu';
	let active = true;
	let disposed = false;
	let context: AudioContext | undefined;
	let master: GainNode | undefined;
	let musicGain: GainNode | undefined;
	let music: MusicPlayer | undefined;
	let resuming = false;
	const buffers = new Map<SoundCue, AudioBuffer>();
	const lastPlayed = new Map<SoundCue, number>();
	const voices = new Set<Voice>();
	const release = function (voice: Voice): void {
		if (!voices.delete(voice)) return;
		voice.source.onended = null;
		voice.source.disconnect(); voice.pan.disconnect(); voice.gain.disconnect();
	};
	// Transient effects stop on tactical pause; the score has its own quiet pause state.
	const stop = function (): void {
		for (const voice of voices) { voice.source.stop(); release(voice); }
		lastPlayed.clear();
	};
	const syncMusic = function (): void {
		music?.setActive(!disposed && !muted && active && musicVolume > 0 && context?.state === 'running');
	};
	const unlock = function (): void {
		if (disposed || muted || !active || typeof AudioContext === 'undefined') return;
		try {
			if (!context) {
				context = new AudioContext({ latencyHint: 'interactive' });
				master = context.createGain();
				master.gain.value = effectsVolume * 0.55;
				master.connect(context.destination);
				musicGain = context.createGain();
				musicGain.gain.value = musicVolume;
				musicGain.connect(context.destination);
				music = createMusicPlayer(context, musicGain);
				music.setState(musicState);
				context.addEventListener('statechange', function () {
					if (context?.state !== 'running') stop();
					syncMusic();
				});
			}
			if (context.state !== 'running' && context.state !== 'closed' && (!resuming || navigator.userActivation?.isActive)) {
				resuming = true;
				void context.resume().catch(function () {}).finally(function () { resuming = false; syncMusic(); });
			}
			syncMusic();
		} catch { /* Audio availability must not prevent play. */ }
	};
	return {
		isMuted: function (): boolean { return muted; },
		setMuted: function (value): void {
			muted = value;
			if (muted) stop();
			else unlock();
			syncMusic();
			savePreference(MUTE_KEY, String(muted));
		},
		getEffectsVolume: function (): number { return effectsVolume; },
		setEffectsVolume: function (value): void {
			if (disposed || !Number.isFinite(value)) return;
			effectsVolume = Math.max(0, Math.min(1, value));
			if (context && master) master.gain.setTargetAtTime(effectsVolume * 0.55, context.currentTime, 0.02);
			if (effectsVolume === 0) stop();
			savePreference(EFFECTS_VOLUME_KEY, String(effectsVolume));
		},
		getMusicVolume: function (): number { return musicVolume; },
		setMusicVolume: function (value): void {
			if (disposed || !Number.isFinite(value)) return;
			musicVolume = Math.max(0, Math.min(1, value));
			if (context && musicGain) musicGain.gain.setTargetAtTime(musicVolume, context.currentTime, 0.08);
			syncMusic();
			savePreference(MUSIC_VOLUME_KEY, String(musicVolume));
		},
		setMusicState: function (value): void {
			if (disposed) return;
			musicState = value;
			music?.setState(value);
		},
		unlock,
		setActive: function (value): void {
			if (active === value) return;
			active = value;
			if (!active) stop();
			syncMusic();
		},
		play: function (cue, pan = 0, volume = 1): void {
			// Never queue cues behind browser autoplay restrictions or tab suspension.
			if (disposed || muted || effectsVolume === 0 || !active || !context || !master || context.state !== 'running') return;
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
			stop(); music?.dispose(); buffers.clear();
			master?.disconnect(); musicGain?.disconnect();
			if (context && context.state !== 'closed') await context.close().catch(function () {});
		},
	};
};
