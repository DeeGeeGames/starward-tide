import type { CampaignEncounterSetup } from './campaign-setup';

/** Serialize allocation snapshots and retry the latest unsaved draft before leaving setup. */
export const createCampaignSetupWriter = function (
	persist: (setup: CampaignEncounterSetup) => Promise<void>,
	status: (error: unknown | undefined) => void,
): { write: (setup: CampaignEncounterSetup) => void; flush: () => Promise<void> } {
	let tail: Promise<void> = Promise.resolve();
	let latest: CampaignEncounterSetup | undefined;
	let version = 0;
	let savedVersion = 0;
	const enqueue = function (snapshot: CampaignEncounterSetup, revision: number): void {
		tail = tail.catch(function () {}).then(async function () {
			await persist(snapshot);
			savedVersion = revision;
		});
		void tail.then(function () { if (revision === version) status(undefined); }, function (error: unknown) {
			if (revision === version) status(error);
		});
	};
	return {
		write: function (setup): void {
			latest = structuredClone(setup);
			version++;
			enqueue(latest, version);
		},
		flush: async function (): Promise<void> {
			// More edits may have queued while an earlier snapshot was being saved.
			for (;;) {
				const pending = tail;
				await pending.catch(function () {});
				if (pending !== tail) continue;
				if (!latest || savedVersion === version) return;
				enqueue(structuredClone(latest), version);
				await tail;
			}
		},
	};
};
