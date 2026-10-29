const requestAction = function (message: string, confirmLabel: string, initialValue?: string): Promise<string | null> {
	const dialog = document.getElementById('confirm-dialog');
	const copy = document.getElementById('confirm-message');
	const accept = document.getElementById('confirm-accept');
	const input = document.getElementById('confirm-input');
	const label = document.getElementById('confirm-input-label');
	if (!(dialog instanceof HTMLDialogElement) || !copy || !accept || !(input instanceof HTMLInputElement) || !label) return Promise.resolve(null);
	// A second operation cannot replace an action the player is already reviewing.
	if (dialog.open) return Promise.resolve(null);
	const previous = document.activeElement;
	copy.textContent = message;
	accept.textContent = confirmLabel;
	label.hidden = initialValue === undefined;
	input.value = initialValue ?? '';
	input.disabled = initialValue === undefined;
	dialog.returnValue = 'cancel';
	return new Promise(function (resolve) {
		dialog.addEventListener('close', function () {
			requestAnimationFrame(function () {
				if (previous instanceof HTMLElement && previous.isConnected && previous.getClientRects().length > 0 && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
			});
			resolve(dialog.returnValue === 'confirm' ? initialValue === undefined ? '' : input.value : null);
		}, { once: true });
		dialog.showModal();
	});
};

export const confirmAction = async function (message: string, confirmLabel = 'Continue'): Promise<boolean> {
	return await requestAction(message, confirmLabel) !== null;
};

export const promptAction = function (message: string, initialValue: string): Promise<string | null> {
	return requestAction(message, 'Rename', initialValue);
};
