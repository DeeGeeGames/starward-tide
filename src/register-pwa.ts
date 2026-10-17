if ('serviceWorker' in navigator && window.isSecureContext) {
	window.addEventListener('load', function (): void {
		void navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
			.catch(function (error: unknown): void {
				console.warn('Offline support could not be enabled.', error);
			});
	});
}
