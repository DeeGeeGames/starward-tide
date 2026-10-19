export const campaignPresetPercentages = [25, 50, 100] as const;
export type CampaignPresetPercentage = typeof campaignPresetPercentages[number];

export interface PresetPlanetBalance {
	readonly planetId: string;
	readonly factionId: string | null;
	readonly availablePoints: number;
}

export const pointsForCampaignPreset = function (availablePoints: number, percentage: CampaignPresetPercentage): number {
	return Math.floor(availablePoints * percentage / 100);
};

export const allocationsForCampaignPreset = function (
	balances: readonly PresetPlanetBalance[],
	percentage: CampaignPresetPercentage,
): Map<string, number> {
	return new Map(balances.filter(function (balance) { return balance.factionId === 'blue'; })
		.map(function (balance) { return [balance.planetId, pointsForCampaignPreset(balance.availablePoints, percentage)] as const; }));
};
