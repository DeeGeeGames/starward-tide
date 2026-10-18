import type { CampaignState } from './campaign-state';

export interface CampaignSelection {
	selectedSystemId: string | undefined;
	sourceSystemId: string | undefined;
	initialized: boolean;
}

export const emptyCampaignSelection = function (): CampaignSelection {
	return { selectedSystemId: undefined, sourceSystemId: undefined, initialized: false };
};

const systemExists = function (state: CampaignState, systemId: string): boolean {
	return state.systems.some(function (system) { return system.id === systemId; });
};

const hasOwnedPlanets = function (state: CampaignState, systemId: string): boolean {
	return state.planets.some(function (planet) { return planet.systemId === systemId && planet.factionId === 'blue'; });
};

export const reconcileCampaignSelection = function (selection: CampaignSelection, state: CampaignState): CampaignSelection {
	if (!selection.initialized) {
		const source = state.systems.find(function (system) { return hasOwnedPlanets(state, system.id); });
		return {
			selectedSystemId: source?.id ?? state.systems[0]?.id,
			sourceSystemId: source?.id,
			initialized: true,
		};
	}
	const selectedSystemId = selection.selectedSystemId !== undefined && systemExists(state, selection.selectedSystemId)
		? selection.selectedSystemId
		: undefined;
	const sourceSystemId = selectedSystemId !== undefined && hasOwnedPlanets(state, selectedSystemId)
		? selectedSystemId
		: undefined;
	return { selectedSystemId, sourceSystemId, initialized: true };
};

export const selectCampaignSystem = function (selection: CampaignSelection, state: CampaignState, systemId: string): CampaignSelection {
	if (!systemExists(state, systemId)) return selection;
	if (selection.selectedSystemId === systemId) return { selectedSystemId: undefined, sourceSystemId: undefined, initialized: true };
	return focusCampaignSystem(selection, state, systemId);
};

export const focusCampaignSystem = function (selection: CampaignSelection, state: CampaignState, systemId: string): CampaignSelection {
	if (!systemExists(state, systemId)) return selection;
	return {
		selectedSystemId: systemId,
		sourceSystemId: hasOwnedPlanets(state, systemId) ? systemId : undefined,
		initialized: true,
	};
};

export const clearCampaignSelection = function (): CampaignSelection {
	return { selectedSystemId: undefined, sourceSystemId: undefined, initialized: true };
};
