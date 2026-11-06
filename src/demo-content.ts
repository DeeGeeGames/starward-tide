import type { StarMap } from './maps';

// A compact, mirrored opening uses the ordinary rules and save format.
export const FIRST_COMMAND_MAP: StarMap = {
	width: 900,
	height: 900,
	mode: 'conquest',
	planets: [
		['Terra', 140, 140, 30, 'blue', 44, 2.6],
		['Haven', 400, 130, 26, 'neutral', 8, 1.7],
		['Kepler', 140, 400, 27, 'neutral', 8, 1.7],
		['Meridian', 680, 150, 32, 'neutral', 16, 3.4],
		['Pyre', 760, 760, 30, 'red', 44, 2.6],
		['Vesper', 500, 770, 26, 'neutral', 8, 1.7],
		['Helix', 760, 500, 27, 'neutral', 8, 1.7],
		['Cinder', 220, 750, 32, 'neutral', 16, 3.4],
	],
};

export const isFirstCommandMap = function (map: StarMap): boolean {
	return map.width === FIRST_COMMAND_MAP.width && map.height === FIRST_COMMAND_MAP.height &&
		map.planets.length === FIRST_COMMAND_MAP.planets.length &&
		map.planets.every(function (seed, index) {
			const original = FIRST_COMMAND_MAP.planets[index];
			return original !== undefined && seed.every(function (value, field) { return value === original[field]; });
		}) && !map.carriers && (!map.mode || map.mode === 'conquest');
};
