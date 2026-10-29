import type { Engagement } from './game';

interface WeaponPulse extends Engagement { started: number }

// Renderer-local feedback follows simulation time, including pause and game speed.
export const createWeaponEffects = function (): {
	update: (time: number, volley: readonly Engagement[], visible?: (shot: Engagement) => boolean) => readonly WeaponPulse[];
	reset: () => void;
} {
	let pulses: WeaponPulse[] = [];
	let lastVolley: readonly Engagement[] | undefined;
	let nextVolley = 0;
	const reset = function (): void {
		pulses = []; lastVolley = undefined; nextVolley = 0;
	};
	const update = function (time: number, volley: readonly Engagement[], visible: (shot: Engagement) => boolean = function () { return true; }): readonly WeaponPulse[] {
		pulses = pulses.filter(function (pulse) { return time >= pulse.started && time - pulse.started < 0.24; });
		if (volley !== lastVolley && time >= nextVolley && volley.length > 0) {
			pulses = [...pulses, ...volley.filter(visible).slice(0, 64).map(function (shot) { return { ...shot, started: time }; })].slice(-64);
			lastVolley = volley;
			nextVolley = time + 0.08;
		}
		return pulses;
	};
	return { update, reset };
};
