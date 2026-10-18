import type { CampaignEncounterOutcome } from './campaign-report';

const node = function <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	if (text !== undefined) element.textContent = text;
	if (className) element.className = className;
	return element;
};
const amount = function (value: number): string {
	return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
};
const owner = function (faction: string | null): string {
	return faction === 'blue' ? 'You' : faction === 'red' ? 'Rival' : 'Unclaimed';
};

/** A completed campaign encounter adds a summary without replacing tactical controls. */
export const createCampaignResultView = function (parent: HTMLElement): {
	render: (outcome: CampaignEncounterOutcome | undefined, time: number) => void;
	hide: () => void;
	dispose: () => void;
} {
	const panel = node('aside', undefined, 'command-panel');
	panel.id = 'campaign-result';
	panel.setAttribute('aria-label', 'Campaign encounter result');
	panel.hidden = true;
	parent.append(panel);
	let rendered: CampaignEncounterOutcome | undefined;
	let renderedTime: number | undefined;
	const render = function (outcome: CampaignEncounterOutcome | undefined, time: number): void {
		panel.hidden = !outcome;
		if (!outcome || (rendered === outcome && renderedTime === time)) return;
		rendered = outcome;
		renderedTime = time;
		const won = outcome.winner === 'blue';
		panel.classList.toggle('lost', !won);
		const changedOwnership = outcome.planets.filter(function (change) { return change.before.factionId !== change.after.factionId; });
		const held = outcome.planets.filter(function (change) { return change.after.factionId === 'blue'; }).length;
		panel.replaceChildren(
			node('p', won ? 'ENCOUNTER WON' : 'ENCOUNTER LOST', 'campaign-result-label'),
			node('h2', outcome.systemName),
			node('p', `${held} / ${outcome.planets.length} planets now yours · ${changedOwnership.length} changed owners`, 'campaign-result-note'),
		);
		const spending = node('section', undefined, 'campaign-result-impact');
		spending.append(
			node('strong', `Expedition · ${amount(outcome.attackerPoints)} points already spent`),
			node('small', 'Surviving and produced units do not refund galaxy points.'),
		);
		panel.append(spending);
		for (const { before, after } of outcome.planets) {
			const row = node('section', undefined, 'campaign-result-impact');
			row.append(node('strong', `${after.name} · ${amount(after.availablePoints)} / ${amount(after.maximumPoints)} points`));
			row.append(node('span', before.factionId === after.factionId ? owner(after.factionId) : `${owner(before.factionId)} → ${owner(after.factionId)}`));
			row.append(node('small', `Development +${amount(before.developmentBonusPoints)}${before.developmentBonusPoints === after.developmentBonusPoints ? '' : ` → +${amount(after.developmentBonusPoints)}`} · Depletion ${amount(after.depletion)} retained`));
			if (before.maximumPoints !== after.maximumPoints)
				row.append(node('small', `Maximum ${amount(before.maximumPoints)} → ${amount(after.maximumPoints)} after capture`));
			panel.append(row);
		}
		panel.append(
			node('p', `Galaxy time ${amount(time)}s is frozen. These balances precede remaining arrivals.`, 'campaign-result-note'),
			node('p', 'Return to galaxy applies this result and resolves queued arrivals. The galaxy returns paused.', 'campaign-result-note'),
		);
	};
	return {
		render,
		hide: function (): void { panel.hidden = true; },
		dispose: function (): void { panel.remove(); },
	};
};
