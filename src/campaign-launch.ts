import { commitEncounterDefenses } from './campaign-setup';
import type { CampaignEncounterSetup, CampaignEncounterSetupValidationOptions } from './campaign-setup';
import type { CampaignSave } from './campaign-save';
import type { CampaignState } from './campaign-state';

/** Older battles keep the ledger that was authoritative when they launched. */
export const campaignBattleLaunchState = function (
	save: CampaignSave,
	setup: CampaignEncounterSetup,
	options: Readonly<CampaignEncounterSetupValidationOptions> = {},
): CampaignState {
	if (save.encounterState?.phase === 'battle' && !save.campaign.encounter?.defenseCommitments) return save.campaign;
	return commitEncounterDefenses(save.campaign, setup, options);
};

/** Keep saves outside the interval where a battle exists but is not installed yet. */
export const createCampaignLaunch = function (): {
	run: (operation: () => Promise<void>) => Promise<void>;
	settled: () => Promise<void>;
} {
	let pending: Promise<void> | undefined;
	return {
		run: function (operation): Promise<void> {
			if (pending) return pending;
			const launched = Promise.resolve().then(operation);
			pending = launched;
			const clear = function (): void { if (pending === launched) pending = undefined; };
			void launched.then(clear, clear);
			return launched;
		},
		settled: async function (): Promise<void> {
			// Failure leaves allocation authoritative and safe to save again.
			await pending?.catch(function () {});
		},
	};
};
