import { expect, test } from 'bun:test';
import { createCampaignSetupWriter } from './campaign-setup-writer';
import type { CampaignEncounterSetup } from './campaign-setup';

const setup = function (troops: number): CampaignEncounterSetup {
	return { costs: { troops: 1, ships: 6, guns: 5 }, defenders: [], beachheads: [{ planetId: 'a', troops, ships: 0 }] };
};

test('writes retain snapshots and serialize pending allocation changes before flush completes', async function () {
	let release = function (): void {};
	const blocked = new Promise<void>(function (resolve) { release = resolve; });
	const writes: CampaignEncounterSetup[] = [];
	const writer = createCampaignSetupWriter(async function (draft) {
		if (writes.length === 0) await blocked;
		writes.push(draft);
	}, function () {});
	const draft = { ...setup(1), beachheads: [{ planetId: 'a', troops: 1, ships: 0 }] };
	writer.write(draft);
	draft.beachheads[0] = { planetId: 'a', troops: 99, ships: 0 };
	writer.write(setup(2));
	const flushed = writer.flush();
	expect(writes).toEqual([]);
	release();
	await flushed;
	expect(writes.map(function (item) { return item.beachheads[0]?.troops; })).toEqual([1, 2]);
});

test('flush retries the latest rejected draft and keeps failed drafts available for another retry', async function () {
	let fail = true;
	const writes: number[] = [];
	const errors: unknown[] = [];
	const writer = createCampaignSetupWriter(async function (draft) {
		writes.push(draft.beachheads[0]?.troops ?? -1);
		if (fail) throw new Error('quota');
	}, function (error) { errors.push(error); });
	writer.write(setup(3));
	await expect(writer.flush()).rejects.toThrow('quota');
	expect(errors.some(function (error) { return error instanceof Error; })).toBe(true);
	fail = false;
	await writer.flush();
	expect(writes).toEqual([3, 3, 3]);
	expect(errors.at(-1)).toBeUndefined();
});

test('a rejected stale write does not block saving a newer draft', async function () {
	const writes: number[] = [];
	const writer = createCampaignSetupWriter(async function (draft) {
		const troops = draft.beachheads[0]?.troops ?? -1;
		writes.push(troops);
		if (troops === 1) throw new Error('first failed');
	}, function () {});
	writer.write(setup(1));
	writer.write(setup(2));
	await writer.flush();
	expect(writes).toEqual([1, 2]);
});

test('flush includes an allocation queued while it is waiting for an earlier save', async function () {
	let release = function (): void {};
	const blocked = new Promise<void>(function (resolve) { release = resolve; });
	const writes: number[] = [];
	const writer = createCampaignSetupWriter(async function (draft) {
		const troops = draft.beachheads[0]?.troops ?? -1;
		if (troops === 1) await blocked;
		writes.push(troops);
	}, function () {});
	writer.write(setup(1));
	const flushed = writer.flush();
	writer.write(setup(2));
	release();
	await flushed;
	expect(writes).toEqual([1, 2]);
});
