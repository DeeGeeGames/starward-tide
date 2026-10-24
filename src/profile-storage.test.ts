import { expect, test } from 'bun:test';
import type { Scenario } from './config';
import { ProfileLimitError } from './profile-storage';
import {
	MAX_PROFILES,
	ProfileNotFoundError,
	ProfileRepository,
	ProfileStorageError,
} from './profile-storage';
import type { ProfileDatabase, StoredProfile } from './profile-storage';
import { SAVE_SCHEMA_VERSION } from './save-state';
import type { ConquestSave } from './save-state';

class MemoryProfileDatabase implements ProfileDatabase {
	private readonly profiles = new Map<string, StoredProfile>();
	private selected: string | null = null;
	private nextUpdateFailure: Error | undefined;
	private nextUpdateWait: (() => Promise<void>) | undefined;

	async listProfiles(): Promise<unknown[]> {
		return structuredClone([...this.profiles.values()]);
	}

	async getProfile(id: string): Promise<unknown> {
		const profile = this.profiles.get(id);
		return profile === undefined ? undefined : structuredClone(profile);
	}

	async createProfile(profile: StoredProfile, maximum: number): Promise<void> {
		if (this.profiles.size >= maximum) throw new ProfileLimitError();
		if (this.profiles.has(profile.id)) throw new ProfileStorageError('Duplicate profile ID.');
		this.profiles.set(profile.id, structuredClone(profile));
	}

	async updateProfile(
		id: string,
		update: (profile: StoredProfile) => StoredProfile,
	): Promise<void> {
		const wait = this.nextUpdateWait;
		this.nextUpdateWait = undefined;
		if (wait) await wait();
		const failure = this.nextUpdateFailure;
		this.nextUpdateFailure = undefined;
		if (failure) throw failure;
		const profile = this.profiles.get(id);
		if (profile === undefined) throw new ProfileNotFoundError();
		const next = update(structuredClone(profile));
		this.profiles.set(id, structuredClone(next));
	}

	async deleteProfile(id: string): Promise<void> {
		if (!this.profiles.delete(id)) throw new ProfileNotFoundError();
		if (this.selected === id) this.selected = null;
	}

	async getSelectedProfileId(): Promise<unknown> {
		return this.selected;
	}

	async setSelectedProfileId(id: string | null): Promise<void> {
		if (id !== null && !this.profiles.has(id)) throw new ProfileNotFoundError();
		this.selected = id;
	}

	close(): void {}

	failNextUpdate(error: Error): void {
		this.nextUpdateFailure = error;
	}

	waitForNextUpdate(wait: () => Promise<void>): void {
		this.nextUpdateWait = wait;
	}
}

const makeSave = function (
	profileId: string,
	savedAt: number,
	scenario: Scenario = 'skirmish',
): ConquestSave {
	return {
		schemaVersion: SAVE_SCHEMA_VERSION,
		profileId,
		savedAt,
		game: {
			map: {
				width: 120,
				height: 90,
				planets: [
					['Terra', 20, 30, 10, 'blue', 30, 2],
					['Vega', 95, 60, 12, 'red', 30, 2],
				],
			},
			scenario,
			pace: 1,
			match: {
				time: 0,
				paused: true,
				winner: null,
				ai: true,
				aiClock: 0,
				orders: 0,
				captures: 0,
				transportsLost: 0,
				troopsLost: 0,
				firstCapture: null,
				notices: [],
			},
			planets: [
				{
					id: 1,
					planet: {
						name: 'Terra',
						x: 20,
						y: 30,
						radius: 10,
						owner: 'blue',
						troops: 30,
						guns: 0,
						rate: 2,
						production: 'troops',
						progress: 0,
					},
				},
				{
					id: 2,
					planet: {
						name: 'Vega',
						x: 95,
						y: 60,
						radius: 12,
						owner: 'red',
						troops: 30,
						guns: 0,
						rate: 2,
						production: 'troops',
						progress: 0,
					},
				},
			],
			units: [],
			orderBook: { nextId: 1, active: [] },
		},
	};
};

test('profiles stop at ten and keep the selected profile device-owned', async function () {
	const database = new MemoryProfileDatabase();
	const repository = new ProfileRepository(database);
	const profiles = [];
	for (let index = 0; index < MAX_PROFILES; index++)
		profiles.push(await repository.createProfile(`Player ${index + 1}`));
	await repository.setSelectedProfileId(profiles[0]?.id ?? null);
	await expect(repository.createProfile('One too many')).rejects.toBeInstanceOf(
		ProfileLimitError,
	);
	expect(await repository.listProfiles()).toHaveLength(MAX_PROFILES);
	expect(await repository.getSelectedProfileId()).toBe(profiles[0]?.id ?? null);
	repository.close();
});

test('a failed atomic save leaves the prior valid conquest available', async function () {
	const database = new MemoryProfileDatabase();
	const repository = new ProfileRepository(database);
	const profile = await repository.createProfile('Player');
	const prior = makeSave(profile.id, 100);
	await repository.saveProfile(prior);
	database.failNextUpdate(new Error('quota exceeded'));
	await expect(repository.saveProfile(makeSave(profile.id, 200, 'blockade'))).rejects.toThrow(
		'quota exceeded',
	);
	expect(await repository.loadSave(profile.id)).toEqual(prior);
	repository.close();
});

test('queued saves commit in call order so a stale write cannot replace a newer snapshot', async function () {
	const database = new MemoryProfileDatabase();
	const repository = new ProfileRepository(database);
	const profile = await repository.createProfile('Player');
	let release: (() => void) | undefined;
	let entered: (() => void) | undefined;
	const blocked = new Promise<void>(function (resolve) {
		release = resolve;
	});
	const updateStarted = new Promise<void>(function (resolve) {
		entered = resolve;
	});
	database.waitForNextUpdate(function () {
		entered?.();
		return blocked;
	});
	const earlier = repository.saveProfile(makeSave(profile.id, 100));
	await updateStarted;
	const later = repository.saveProfile(makeSave(profile.id, 200, 'invasion'));
	release?.();
	await Promise.all([earlier, later]);
	expect((await repository.loadSave(profile.id))?.savedAt).toBe(200);
	expect((await repository.loadSave(profile.id))?.game.scenario).toBe('invasion');
	repository.close();
});

test('deleting the selected profile clears only that profile selection and save', async function () {
	const database = new MemoryProfileDatabase();
	const repository = new ProfileRepository(database);
	const first = await repository.createProfile('First');
	const second = await repository.createProfile('Second');
	await repository.saveProfile(makeSave(first.id, 100));
	await repository.saveProfile(makeSave(second.id, 200));
	await repository.setSelectedProfileId(first.id);
	await repository.deleteProfile(first.id);
	expect(await repository.getSelectedProfileId()).toBeNull();
	await expect(repository.loadSave(first.id)).rejects.toBeInstanceOf(ProfileNotFoundError);
	expect((await repository.loadSave(second.id))?.savedAt).toBe(200);
	repository.close();
});

test('saving and loading retains structured-clone extensions and sparse notices', async function () {
	const database = new MemoryProfileDatabase();
	const repository = new ProfileRepository(database);
	try {
		const profile = await repository.createProfile('Compatibility');
		const save = makeSave(profile.id, 100);
		const seed = save.game.map.planets[0];
		if (!seed) throw new Error('Missing seed');
		for (const value of [save.game.units, seed, save.game.match]) {
			Object.defineProperty(value, 'extension', { value: 'retained', enumerable: true });
			Object.defineProperty(value, '__proto__', { value: { retained: true }, enumerable: true });
		}
		save.game.match.notices.length = 1;
		const before = structuredClone(save);
		await repository.saveProfile(save);
		const loaded = await repository.loadSave(profile.id);
		expect(loaded).toEqual(before);
		expect(loaded?.game.match.notices).toHaveLength(1);
		expect(loaded && 0 in loaded.game.match.notices).toBe(false);
		expect(Object.getOwnPropertyDescriptor(loaded?.game.units, 'extension')?.value).toBe('retained');
		expect(Object.getOwnPropertyDescriptor(loaded?.game.map.planets[0], '__proto__')?.value)
			.toEqual({ retained: true });
	} finally {
		repository.close();
	}
});

test('legacy skirmish profiles load without a campaign slot or metadata migration', async function () {
	const database = new MemoryProfileDatabase();
	const repository = new ProfileRepository(database);
	const save = makeSave('legacy', 100);
	const legacy = { id: 'legacy', name: 'Legacy', save };
	await database.createProfile(legacy, MAX_PROFILES);
	expect(await repository.loadSave('legacy')).toEqual(save);
	expect(await repository.listProfiles()).toEqual([{
		id: 'legacy', name: 'Legacy', hasSave: true, savedAt: 100,
	}]);
	expect(await database.getProfile('legacy')).toEqual(legacy);
	repository.close();
});

test('campaign metadata is independent of the existing skirmish slot', async function () {
	const database = new MemoryProfileDatabase();
	const repository = new ProfileRepository(database);
	const campaignSave = { savedAt: 250, futureCampaignFormat: { turn: 3 } };
	await database.createProfile({ id: 'campaign', name: 'Campaign', campaignSave }, MAX_PROFILES);
	expect(await repository.loadSave('campaign')).toBeUndefined();
	expect(await repository.listProfiles()).toEqual([{
		id: 'campaign', name: 'Campaign', hasSave: false, savedAt: null,
	}]);
	await repository.saveProfile(makeSave('campaign', 300));
	await repository.renameProfile('campaign', 'Renamed');
	await repository.setSelectedProfileId('campaign');
	expect(await repository.getSelectedProfileId()).toBe('campaign');
	expect(await database.getProfile('campaign')).toEqual({
		id: 'campaign', name: 'Renamed', campaignSave, save: makeSave('campaign', 300),
	});
	repository.close();
});

test('malformed campaign metadata survives listing, rename and failed or successful skirmish saves', async function () {
	const database = new MemoryProfileDatabase();
	const repository = new ProfileRepository(database);
	for (const campaignSave of [null, 'unknown format', { savedAt: NaN }, { savedAt: Infinity }, { savedAt: 'yesterday' }]) {
		const profile = await repository.createProfile('Malformed campaign');
		await database.updateProfile(profile.id, function (stored) { return { ...stored, campaignSave }; });
		const before = await database.getProfile(profile.id);
		const summary = (await repository.listProfiles()).find(function (entry) { return entry.id === profile.id; });
		expect(summary?.hasSave).toBe(false);
		expect(summary?.savedAt).toBeNull();
		expect(await database.getProfile(profile.id)).toEqual(before);
		await repository.renameProfile(profile.id, 'Kept');
		database.failNextUpdate(new Error('quota exceeded'));
		await expect(repository.saveProfile(makeSave(profile.id, 100))).rejects.toThrow();
		expect(await database.getProfile(profile.id)).toEqual({ id: profile.id, name: 'Kept', campaignSave });
		await repository.saveProfile(makeSave(profile.id, 200));
		expect(await database.getProfile(profile.id)).toEqual({
			id: profile.id, name: 'Kept', campaignSave, save: makeSave(profile.id, 200),
		});
	}
	repository.close();
});

test('deleting a profile removes both its slots while preserving the other profile', async function () {
	const database = new MemoryProfileDatabase();
	const repository = new ProfileRepository(database);
	const first = await repository.createProfile('First');
	const second = await repository.createProfile('Second');
	for (const profile of [first, second]) {
		await repository.saveProfile(makeSave(profile.id, 100));
		await database.updateProfile(profile.id, function (stored) {
			return { ...stored, campaignSave: { savedAt: 200, opaqueData: profile.id } };
		});
	}
	const secondBefore = await database.getProfile(second.id);
	await repository.setSelectedProfileId(first.id);
	await repository.deleteProfile(first.id);
	expect(await database.getProfile(first.id)).toBeUndefined();
	expect(await repository.getSelectedProfileId()).toBeNull();
	expect(await database.getProfile(second.id)).toEqual(secondBefore);
	expect(await repository.listProfiles()).toHaveLength(1);
	repository.close();
});

test('profiles can be created when HTTP browsers omit crypto.randomUUID', async function () {
	const previous = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
	const database = new MemoryProfileDatabase();
	const repository = new ProfileRepository(database);
	Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
	try {
		const first = await repository.createProfile('LAN player');
		const second = await repository.createProfile('Another LAN player');
		expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(second.id).not.toBe(first.id);
		await repository.setSelectedProfileId(first.id);
		expect(await repository.getSelectedProfileId()).toBe(first.id);
		await repository.saveProfile(makeSave(first.id, 100));
		expect((await repository.loadSave(first.id))?.profileId).toBe(first.id);
	} finally {
		if (previous) Object.defineProperty(crypto, 'randomUUID', previous);
		else Reflect.deleteProperty(crypto, 'randomUUID');
		repository.close();
	}
});
