import { expect, test } from 'bun:test';
import { campaignOrdersView, emptyCampaignOrdersPreference, reconcileCampaignOrdersPreference, showAllCampaignOrders } from './campaign-orders';
import type { CampaignExpedition } from './campaign-state';
import { createCampaign } from './campaign-scenario';

const expedition = function (
	id: string,
	sourceSystemId: string,
	destinationSystemId: string,
	status: CampaignExpedition['status'] = 'traveling',
): CampaignExpedition {
	return { id, factionId: 'blue', sourceSystemId, destinationSystemId, contributions: [], points: 40,
		departureTime: 0, arrivalTime: 10, status };
};

test('campaign orders scope includes incoming and outgoing active expeditions but excludes unrelated systems', function () {
	const state = { ...createCampaign(), expeditions: [
		expedition('incoming', 'sirius', 'sol'), expedition('outgoing', 'sol', 'deneb'),
		expedition('unrelated', 'sirius', 'arcturus'), expedition('returning', 'sol', 'arcturus', 'returning'),
		expedition('encounter', 'sirius', 'sol', 'encounter'), expedition('cancelled', 'sol', 'deneb', 'cancelled'),
		expedition('resolved', 'sol', 'arcturus', 'resolved'),
	] };

	const view = campaignOrdersView(state, 'sol', false);
	expect(view.scope).toBe('Sol');
	expect(view.scoped).toBe(true);
	expect(view.expeditions.map(function (order) { return order.id; })).toEqual(['incoming', 'outgoing', 'returning', 'encounter']);
});

test('Show all and an empty selection display every active expedition without changing the selected scope', function () {
	const state = { ...createCampaign(), expeditions: [
		expedition('in-scope', 'sol', 'deneb'), expedition('unrelated', 'sirius', 'arcturus'),
	] };

	const showAll = campaignOrdersView(state, 'sol', true);
	expect(showAll.scope).toBe('All routes');
	expect(showAll.scoped).toBe(false);
	expect(showAll.expeditions.map(function (order) { return order.id; })).toEqual(['in-scope', 'unrelated']);
	expect(campaignOrdersView(state, undefined, false)).toEqual(showAll);
	expect(campaignOrdersView(state, 'sol', false).scope).toBe('Sol');
});

test('orders scope follows expedition status changes and keeps its count tied to visible routes', function () {
	const state = { ...createCampaign(), expeditions: [
		expedition('arrival', 'sirius', 'sol'), expedition('unrelated', 'sirius', 'arcturus'),
	] };
	const advanced = { ...state, time: 10, expeditions: state.expeditions.map(function (order) {
		return order.id === 'arrival' ? { ...order, status: 'encounter' as const } : order;
	}) };
	const resolved = { ...advanced, expeditions: advanced.expeditions.map(function (order) {
		return order.id === 'arrival' ? { ...order, status: 'resolved' as const } : order;
	}) };

	expect(campaignOrdersView(advanced, 'sol', false).expeditions.map(function (order) { return order.status; })).toEqual(['encounter']);
	expect(campaignOrdersView(resolved, 'sol', false).expeditions).toEqual([]);
	expect(campaignOrdersView(resolved, undefined, false).expeditions.map(function (order) { return order.id; })).toEqual(['unrelated']);
});

test('resetting orders preferences clears Show all even when the next campaign selects the same system', function () {
	const state = { ...createCampaign(), expeditions: [
		expedition('in-scope', 'sol', 'deneb'), expedition('unrelated', 'sirius', 'arcturus'),
	] };
	const selected = reconcileCampaignOrdersPreference(emptyCampaignOrdersPreference(), 'sol');
	const showingAll = showAllCampaignOrders(selected);
	expect(campaignOrdersView(state, 'sol', showingAll.showAll).scope).toBe('All routes');

	const restarted = reconcileCampaignOrdersPreference(emptyCampaignOrdersPreference(), 'sol');
	expect(campaignOrdersView(state, 'sol', restarted.showAll).scope).toBe('Sol');
	expect(campaignOrdersView(state, 'sol', restarted.showAll).expeditions.map(function (order) { return order.id; })).toEqual(['in-scope']);
});
