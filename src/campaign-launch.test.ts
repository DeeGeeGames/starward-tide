import { expect, test } from 'bun:test';
import { createCampaignLaunch } from './campaign-launch';

const deferred = function (): { promise: Promise<void>; resolve: () => void } {
	let release: () => void = function () {};
	const promise = new Promise<void>(function (resolve) { release = resolve; });
	return { promise, resolve: release };
};

test('save during delayed battle launch waits for installed battle and duplicate launch shares transaction', async function () {
	const launch = createCampaignLaunch();
	const writingBattle = deferred();
	const started = deferred();
	const writes: string[] = [];
	let authoritative = 'allocation';
	let worldsCreated = 0;
	const operation = async function (): Promise<void> {
		worldsCreated += 1;
		writes.push('battle');
		started.resolve();
		await writingBattle.promise;
		authoritative = 'battle';
	};
	const first = launch.run(operation);
	await started.promise;
	const duplicate = launch.run(operation);
	expect(duplicate).toBe(first);
	const save = async function (): Promise<void> {
		await launch.settled();
		writes.push(authoritative);
	};
	const autosave = save();
	await Promise.resolve();
	expect(writes).toEqual(['battle']);
	writingBattle.resolve();
	await Promise.all([first, duplicate, autosave]);
	expect(worldsCreated).toBe(1);
	expect(writes).toEqual(['battle', 'battle']);
});

test('failed launch releases waiting saves and permits retry after cleanup', async function () {
	const launch = createCampaignLaunch();
	const writingBattle = deferred();
	const started = deferred();
	let disposed = false;
	const failing = launch.run(async function () {
		started.resolve();
		try {
			await writingBattle.promise;
			throw new Error('quota exceeded');
		} finally { disposed = true; }
	});
	await started.promise;
	let saved = false;
	const saving = launch.settled().then(function () { saved = true; });
	expect(saved).toBe(false);
	writingBattle.resolve();
	await expect(failing).rejects.toThrow('quota exceeded');
	await saving;
	expect(disposed).toBe(true);
	expect(saved).toBe(true);
	let installed = false;
	await launch.run(async function () { installed = true; });
	expect(installed).toBe(true);
});
