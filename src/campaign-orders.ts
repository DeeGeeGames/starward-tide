import { isActiveExpedition } from './campaign-state';
import type { CampaignExpedition, CampaignState } from './campaign-state';

export interface CampaignOrdersView {
	readonly scope: string;
	readonly scoped: boolean;
	readonly expeditions: readonly CampaignExpedition[];
}

export interface CampaignOrdersPreference {
	readonly selectionKey: string | undefined;
	readonly showAll: boolean;
}

export const emptyCampaignOrdersPreference = function (): CampaignOrdersPreference {
	return { selectionKey: undefined, showAll: false };
};

export const reconcileCampaignOrdersPreference = function (
	preference: CampaignOrdersPreference,
	selectedSystemId: string | undefined,
): CampaignOrdersPreference {
	return preference.selectionKey === selectedSystemId
		? preference
		: { selectionKey: selectedSystemId, showAll: false };
};

export const showAllCampaignOrders = function (preference: CampaignOrdersPreference): CampaignOrdersPreference {
	return { ...preference, showAll: true };
};

export const campaignOrdersView = function (
	state: CampaignState,
	selectedSystemId: string | undefined,
	showAll: boolean,
): CampaignOrdersView {
	const selectedSystem = showAll ? undefined : state.systems.find(function (system) { return system.id === selectedSystemId; });
	const active = state.expeditions.filter(isActiveExpedition);
	return {
		scope: selectedSystem?.name ?? 'All routes',
		scoped: selectedSystem !== undefined,
		expeditions: selectedSystem
			? active.filter(function (expedition) {
				return expedition.sourceSystemId === selectedSystem.id || expedition.destinationSystemId === selectedSystem.id;
			})
			: active,
	};
};
