import { CONFIG } from './config';
import { LAB_MAP } from './maps';
import type { GameSnapshot } from './save-state';

// Versioned, pure fixture: identical IDs/positions on every load, no random seed.
export const createCrowdedBaseline = function (): GameSnapshot {
	const planets: GameSnapshot['planets'] = LAB_MAP.planets.map(function ([name, x, y, radius, owner, troops, rate], index) {
		return { id: index + 1, planet: { name, x, y, radius, owner, troops, rate,
			guns: 0, production: 'troops', progress: 0 } };
	});
	const blue = planets.find(function (entity) { return entity.planet.owner === 'blue'; });
	const red = planets.find(function (entity) { return entity.planet.owner === 'red'; });
	if (!blue || !red) throw new Error('Baseline requires both homeworlds');
	const units: GameSnapshot['units'] = Array.from({ length: 1500 }, function (_, index) {
		const transport = index >= 1200;
		const home = index < 600 || transport ? blue : red;
		return { id: planets.length + index + 1, unit: {
			owner: home.planet.owner === 'red' ? 'red' : 'blue',
			kind: transport ? 'transport' : 'ship',
			x: transport ? 60 + (index % 20) * 3 : home.planet.x,
			y: transport ? 60 + Math.floor((index - 1200) / 20) * 3 : home.planet.y,
			target: home.id, phase: transport ? 'travel' : 'orbit',
			hp: transport ? CONFIG.transportHealth : CONFIG.shipHealth,
			cargo: transport ? 10 : 0, age: 0,
		} };
	});
	return { map: structuredClone(LAB_MAP), scenario: 'skirmish', pace: 1,
		planets, units, orderBook: { nextId: 1, active: [] },
		match: { time: 0, paused: false, winner: null, ai: false, aiClock: 0,
			orders: 0, captures: 0, transportsLost: 0, troopsLost: 0,
			firstCapture: null, notices: [] } };
};
