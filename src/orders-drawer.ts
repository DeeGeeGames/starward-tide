import { activeOrders, cancelOrder, orderUnits, matchEnded } from './game';
import type { Game, Order } from './game';

interface OrderRow {
	root: HTMLLIElement;
	select: HTMLButtonElement;
	route: HTMLElement;
	counts: HTMLElement;
	status: HTMLElement;
	action: HTMLButtonElement;
}
interface DrawerElements {
	toggle: HTMLButtonElement;
	panel: HTMLElement;
	close: HTMLButtonElement;
	title: HTMLElement;
	showAll: HTMLButtonElement;
	list: HTMLElement;
	empty: HTMLElement;
}
export const createOrdersDrawer = function (
	elements: DrawerElements,
	onOpen: () => void,
	onAction: (message: string) => void,
): {
	update: (world: Game, planetIds: readonly number[]) => void;
	close: () => void;
	reset: () => void;
	highlighted: () => Order | undefined;
} {
	let currentWorld: Game | undefined;
	let selectionKey = '';
	let selection: readonly number[] = [];
	let showAll = false;
	let highlightedId: number | undefined;
	const rows = new Map<number, OrderRow>();
	const close = function (): void {
		elements.panel.hidden = true;
		elements.toggle.setAttribute('aria-expanded', 'false');
		elements.toggle.focus();
	};
	const refresh = function (): void {
		if (currentWorld) update(currentWorld, selection);
	};
	elements.toggle.addEventListener('click', function () {
		if (!elements.panel.hidden) {
			close();
			return;
		}
		onOpen();
		elements.panel.hidden = false;
		elements.toggle.setAttribute('aria-expanded', 'true');
		refresh();
		elements.close.focus();
	});
	elements.close.addEventListener('click', close);
	elements.showAll.addEventListener('click', function () {
		showAll = true;
		refresh();
		elements.close.focus();
	});
	const update = function (world: Game, planetIds: readonly number[]): void {
		currentWorld = world;
		selection = planetIds;
		const key = [...planetIds]
			.sort(function (a, b) {
				return a - b;
			})
			.join(',');
		if (key !== selectionKey) {
			selectionKey = key;
			showAll = false;
		}
		const filter = showAll ? [] : planetIds;
		const orders = activeOrders(world, filter);
		const planetName = function (id: number): string {
			return world.getComponent(id, 'planet')?.name ?? 'Unknown world';
		};
		const scope =
			filter.length === 0 ? 'All routes' : filter.map(planetName).join(', ');
		elements.title.textContent = `Orders · ${scope}`;
		elements.toggle.textContent = `Orders · ${orders.length}`;
		elements.toggle.setAttribute(
			'aria-label',
			`Orders · ${scope} · ${orders.length}`,
		);
		elements.showAll.hidden = filter.length === 0;
		elements.empty.hidden = orders.length > 0;
		elements.empty.textContent =
			filter.length === 0
				? 'No active orders.'
				: 'No active orders for this selection.';
		if (
			!orders.some(function (order) {
				return order.id === highlightedId;
			})
		)
			highlightedId = undefined;
		const visibleIds = new Set(
			orders.map(function (order) {
				return order.id;
			}),
		);
		for (const [id, row] of rows) {
			if (visibleIds.has(id)) continue;
			const focused = row.root.contains(document.activeElement);
			row.root.remove();
			rows.delete(id);
			if (focused && !elements.panel.hidden) elements.close.focus();
		}
		for (const order of orders) {
			let row = rows.get(order.id);
			if (!row) {
				const root = document.createElement('li');
				root.className = 'order-row';
				const select = document.createElement('button');
				select.className = 'order-select';
				const route = document.createElement('strong');
				const counts = document.createElement('span');
				const status = document.createElement('span');
				status.className = 'order-status';
				select.append(route, counts, status);
				const action = document.createElement('button');
				action.className = 'order-action';
				select.addEventListener('click', function () {
					highlightedId = highlightedId === order.id ? undefined : order.id;
					refresh();
				});
				action.addEventListener('click', function () {
					if (!currentWorld) return;
					const pending = order.state === 'pending';
					if (cancelOrder(currentWorld, order.id))
						onAction(
							pending
								? 'Launch cancelled · units stay at their sources.'
								: 'Recall ordered · returning to departure worlds.',
						);
					refresh();
				});
				root.append(select, action);
				elements.list.append(root);
				row = { root, select, route, counts, status, action };
				rows.set(order.id, row);
			}
			const members = orderUnits(world, order);
			const sourceIds = [
				...new Set(
					order.departures.map(function (entry) {
						return entry.source;
					}),
				),
			];
			const sources = sourceIds.map(planetName).join(' + ');
			const target = planetName(order.target);
			row.route.textContent =
				order.state === 'returning'
					? `${target} ↶ ${sources}`
					: `${sources} → ${target}`;
			const ships = members.filter(function (entity) {
				return entity.components.unit.kind === 'ship';
			}).length;
			const troops = members.reduce(function (sum, entity) {
				return sum + entity.components.unit.cargo;
			}, 0);
			row.counts.textContent = `${ships} ships · ${troops} troops`;
			row.status.textContent =
				order.state === 'pending'
					? 'Awaiting resume'
					: order.state === 'returning'
						? 'Returning'
						: members.some(function (entity) {
									return entity.components.unit.phase === 'travel';
							  })
							? 'En route'
							: 'Awaiting landing';
			row.select.setAttribute(
				'aria-pressed',
				String(highlightedId === order.id),
			);
			row.select.setAttribute(
				'aria-label',
				`Highlight route: ${row.route.textContent}, ${row.counts.textContent}, ${row.status.textContent}`,
			);
			row.action.textContent =
				order.state === 'pending'
					? 'Cancel launch'
					: order.state === 'returning'
						? 'Returning'
						: '↶ Recall';
			row.action.setAttribute(
				'aria-label',
				`${row.action.textContent}: ${row.route.textContent}`,
			);
			row.action.disabled =
				order.state === 'returning' ||
				matchEnded(world.getResource('match'));
		}
	};
	return {
		update,
		close,
		reset: function (): void {
			highlightedId = undefined;
			selectionKey = '';
			showAll = false;
			for (const row of rows.values()) row.root.remove();
			rows.clear();
			elements.panel.hidden = true;
			elements.toggle.setAttribute('aria-expanded', 'false');
		},
		highlighted: function (): Order | undefined {
			if (elements.panel.hidden || !currentWorld) return;
			return activeOrders(currentWorld).find(function (order) {
				return order.id === highlightedId;
			});
		},
	};
};
