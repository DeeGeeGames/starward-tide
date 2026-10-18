import type { Owner } from './config';
import type { StarMap } from './maps';
import { CAMPAIGN_RULES } from './campaign-state';
import type { CampaignPlanet, CampaignState, CampaignSystem } from './campaign-state';

const systemMap = function (factionId: Owner, names: readonly [string, string, string]): StarMap {
	return { width: 1000, height: 700, planets: [
		[names[0], 200, 230, 32, factionId, 0, 1.8],
		[names[1], 750, 230, 35, factionId, 0, 2.2],
		[names[2], 500, 530, 30, factionId, 0, 1.5],
	] };
};

/** Deterministic campaign opening; tactical starting units come from point allocation. */
export const createCampaign = function (): CampaignState {
	const systems: CampaignSystem[] = [
		{ id: 'sol', name: 'Sol', x: 100, y: 100, map: systemMap('blue', ['Terra', 'Vega', 'Luna']) },
		{ id: 'sirius', name: 'Sirius', x: 200, y: 100, map: systemMap('red', ['Sirius', 'Rigel', 'Altair']) },
		{ id: 'deneb', name: 'Deneb', x: 100, y: 200, map: systemMap('neutral', ['Deneb', 'Sadr', 'Gienah']) },
		{ id: 'arcturus', name: 'Arcturus', x: 200, y: 200, map: systemMap('neutral', ['Arcturus', 'Izar', 'Muphrid']) },
	];
	return campaignFromSystems(systems);
};

/** Build a campaign from the exact generated arrangement shown in setup. */
export const createGeneratedCampaign = function (layout: StarMap): CampaignState {
	return campaignFromSystems(layout.planets.map(function ([name, x, y, , owner]): CampaignSystem {
		return { id: name.toLowerCase(), name, x, y,
			map: systemMap(owner, [`${name} I`, `${name} II`, `${name} III`]) };
	}));
};

const campaignFromSystems = function (systems: readonly CampaignSystem[]): CampaignState {
	const planets: CampaignPlanet[] = systems.flatMap(function (system) {
		return system.map.planets.map(function (seed, index) {
			return { id: `${system.id}:${index + 1}`, systemId: system.id, name: seed[0],
				factionId: seed[4] === 'neutral' ? null : seed[4],
				baselinePoints: 100, developmentBonusPoints: 0, depletion: 0, capturedTime: null, lastAppliedTime: 0 };
		});
	});
	return { time: 0, paused: true, pace: 1, nextRivalTime: CAMPAIGN_RULES.rivalInterval, phase: 'galaxy', rules: structuredClone(CAMPAIGN_RULES), systems, planets,
		expeditions: [], encounter: null, resolvedEncounters: [] };
};

export { commitCampaignRival, campaignWinner } from './campaign-state';
