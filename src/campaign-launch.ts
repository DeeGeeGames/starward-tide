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
