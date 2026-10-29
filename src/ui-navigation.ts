export type FocusDirection = 'up' | 'down' | 'left' | 'right';

export const visibleControls = function (root: ParentNode): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>('button, select, input, summary, [tabindex="0"]')].filter(function (control) {
		return control.getClientRects().length > 0 && !control.closest('[hidden], [inert]') &&
			!control.matches(':disabled') && getComputedStyle(control).visibility !== 'hidden';
	});
};

export const adjustControl = function (control: HTMLElement, delta: number): boolean {
	const setting = control.dataset.setting;
	const target = setting ? document.getElementById(setting) : control;
	if (target instanceof HTMLSelectElement && !target.disabled) {
		const options = [...target.options].filter(function (option) { return !option.disabled; });
		const current = options.findIndex(function (option) { return option.selected; });
		const next = options[(current + delta + options.length) % options.length];
		if (!next) return false;
		target.value = next.value;
		target.dispatchEvent(new Event('change', { bubbles: true }));
		return true;
	}
	if (target instanceof HTMLInputElement && target.type === 'checkbox' && !target.disabled) {
		target.click();
		return true;
	}
	return false;
};

export const moveFocus = function (root: ParentNode, direction: FocusDirection): void {
	const controls = visibleControls(root);
	if (controls.length === 0) return;
	const active = document.activeElement;
	if ((direction === 'left' || direction === 'right') && active instanceof HTMLElement && controls.includes(active) && adjustControl(active, direction === 'left' ? -1 : 1)) return;
	const current = controls.findIndex(function (control) { return control === active; });
	const delta = direction === 'up' || direction === 'left' ? -1 : 1;
	const next = controls[current < 0 ? 0 : (current + delta + controls.length) % controls.length];
	if (!next) return;
	if (next instanceof HTMLInputElement && next.type === 'text') next.select();
	next.focus({ preventScroll: true });
	next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
};

export const activateControl = function (root: ParentNode): void {
	const active = document.activeElement;
	const controls = visibleControls(root);
	if (!(active instanceof HTMLElement) || !controls.includes(active)) {
		controls[0]?.focus({ preventScroll: true });
		return;
	}
	if (active instanceof HTMLInputElement && active.type === 'text') {
		const form = active.closest('form');
		if (form) form.requestSubmit();
		return;
	}
	if (!adjustControl(active, 1)) active.click();
};
