import { COLORS, factionLabel, isHostile } from './config';
import { travelingGroups } from './fleet-interception';
import type { Game } from './game';

export const createFleetTargets = function (layer: HTMLElement): {
	update: (world: Game, enabled: boolean) => void;
	reset: () => void;
} {
	const buttons = new Map<number, HTMLButtonElement>();
	return {
		update: function (world, enabled): void {
			layer.hidden = !enabled;
			const groups = travelingGroups(world).filter(function (group) { return isHostile(group.order.owner, 'blue'); });
			const live = new Set(groups.map(function (group) { return group.order.id; }));
			for (const [id, button] of buttons) {
				if (live.has(id)) continue;
				if (button === document.activeElement) layer.closest<HTMLElement>('#board')?.focus();
				button.remove();
				buttons.delete(id);
			}
			for (const { order, members } of groups) {
				const anchor = members[0]?.components.unit;
				if (!anchor) continue;
				let button = buttons.get(order.id);
				if (!button) {
					button = document.createElement('button');
					button.className = 'fleet-target';
					button.dataset.fleet = String(order.id);
					layer.append(button);
					buttons.set(order.id, button);
				}
				const ships = members.filter(function (entity) { return entity.components.unit.kind === 'ship'; }).length;
				const transports = members.length - ships;
				button.textContent = `⌖ ${ships}◆${transports > 0 ? ` ${transports}▰` : ''}`;
				const label = `Intercept ${factionLabel(order.owner)} group ${order.id}, ${ships} ships, ${transports} transports`;
				button.setAttribute('aria-label', label);
				button.title = label;
				button.style.left = `${anchor.x}px`;
				button.style.top = `${anchor.y}px`;
				button.style.setProperty('--fleet-color', COLORS[order.owner]);
				button.disabled = !enabled;
				button.classList.toggle('intercepted', world.getResource('orderBook').active.some(function (candidate) {
					return candidate.owner === 'blue' && candidate.interceptOrder === order.id;
				}));
			}
		},
		reset: function (): void {
			layer.replaceChildren();
			buttons.clear();
		},
	};
};
