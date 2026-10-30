export type FocusDirection = 'up' | 'down' | 'left' | 'right';

interface FocusRect {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

// Geometry is read at navigation time so responsive layouts and scrolled drawers
// use the same controls and ordering that the player can see.
export const nextFocusIndex = function (
	rects: readonly FocusRect[], current: number, direction: FocusDirection,
): number | undefined {
	if (rects.length === 0) return undefined;
	const origin = rects[current];
	if (!origin) return 0;
	const horizontal = direction === 'left' || direction === 'right';
	const sign = direction === 'up' || direction === 'left' ? -1 : 1;
	const along = function (rect: FocusRect): number {
		return horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
	};
	const across = function (rect: FocusRect): number {
		return horizontal ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
	};
	const extent = function (rect: FocusRect): number { return horizontal ? rect.height : rect.width; };
	const candidates = rects.flatMap(function (rect, index) {
		if (index === current) return [];
		const forward = (along(rect) - along(origin)) * sign;
		const offset = Math.abs(across(rect) - across(origin));
		const aligned = offset < (extent(rect) + extent(origin)) / 2;
		return [{ index, forward, offset, aligned }];
	});
	const forward = candidates.filter(function (candidate) { return candidate.forward > 1; });
	forward.sort(function (a, b) {
		return Number(b.aligned) - Number(a.aligned) ||
			(a.forward + a.offset * 2) - (b.forward + b.offset * 2) || a.index - b.index;
	});
	if (forward[0]) return forward[0].index;
	// Wrap within the same row/column before falling back to document order for
	// a single row navigated vertically or a single column navigated horizontally.
	const wrap = candidates.filter(function (candidate) { return candidate.aligned && candidate.forward < -1; });
	wrap.sort(function (a, b) { return a.forward - b.forward || a.offset - b.offset || a.index - b.index; });
	return wrap[0]?.index ?? (current + sign + rects.length) % rects.length;
};

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
	const nextIndex = nextFocusIndex(controls.map(function (control) { return control.getBoundingClientRect(); }), current, direction);
	const next = nextIndex === undefined ? undefined : controls[nextIndex];
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
