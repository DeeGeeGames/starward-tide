const offerUpdate = function (registration: ServiceWorkerRegistration): void {
	const host = document.createElement('div');
	const root = host.attachShadow({ mode: 'open' });
	root.innerHTML = `
		<style>
			:host { position: fixed; bottom: max(16px, env(safe-area-inset-bottom));
				left: 50%; transform: translateX(-50%); z-index: 10000;
				width: max-content; max-width: calc(100vw - 32px); }
			aside { box-sizing: border-box; padding: 12px 16px; border: 1px solid #708ba8;
				border-radius: 10px; background: #101d2e; color: #f1f6ff;
				font: 14px/1.4 system-ui, sans-serif; box-shadow: 0 4px 20px #0008; }
			p { margin: 0 0 8px; }
			button { min-height: 44px; padding: 8px 12px; border-radius: 6px;
				border: 1px solid #9fc9ef; background: #213d59; color: #fff;
				font: inherit; cursor: pointer; }
			button:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
		</style>
		<aside aria-label="Game update">
			<p role="status">Update available. Reloading will leave the current game.</p>
		</aside>`;
	const button = document.createElement('button');
	button.type = 'button';
	button.textContent = 'Update available — reload';
	let requestedWorker: ServiceWorker | null = null;
	navigator.serviceWorker.addEventListener('controllerchange', function (): void {
		// Activation in another tab must not reload an ongoing game here.
		if (requestedWorker && navigator.serviceWorker.controller === requestedWorker)
			window.location.reload();
	});
	button.addEventListener('click', function (): void {
		const waiting = registration.waiting;
		if (!waiting) {
			// Another tab may already have activated the offered release.
			window.location.reload();
			return;
		}
		requestedWorker = waiting;
		button.disabled = true;
		button.textContent = 'Updating…';
		waiting.postMessage({ type: 'SKIP_WAITING' });
	});
	root.querySelector('aside')?.append(button);
	document.body.append(host);
};

if ('serviceWorker' in navigator && window.isSecureContext) {
	window.addEventListener('load', function (): void {
		void navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
			.then(function (registration): void {
				let offered = false;
				const checkForUpdate = function (): void {
					if (offered || !registration.waiting || !navigator.serviceWorker.controller) return;
					offered = true;
					offerUpdate(registration);
				};
				registration.addEventListener('updatefound', function (): void {
					registration.installing?.addEventListener('statechange', checkForUpdate);
				});
				registration.installing?.addEventListener('statechange', checkForUpdate);
				checkForUpdate();
			})
			.catch(function (error: unknown): void {
				console.warn('Offline support could not be enabled.', error);
			});
	});
}
