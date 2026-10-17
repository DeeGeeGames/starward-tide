import { expect, test } from 'bun:test';
import type { ProfileDatabase, StoredProfile } from './profile-storage';
import { ProfileRepository } from './profile-storage';
import type { ProfilePickerController, ProfilePickerState } from './profile-picker';
import { createProfilePicker } from './profile-picker';

class MemoryProfileDatabase implements ProfileDatabase {
	private readonly profiles = new Map<string, StoredProfile>();
	private selectedProfileId: string | null = null;
	createdCount = 0;

	async listProfiles(): Promise<unknown[]> {
		return structuredClone([...this.profiles.values()]);
	}

	async getProfile(id: string): Promise<unknown> {
		const profile = this.profiles.get(id);
		return profile === undefined ? undefined : structuredClone(profile);
	}

	async createProfile(profile: StoredProfile): Promise<void> {
		this.profiles.set(profile.id, structuredClone(profile));
		this.createdCount++;
	}

	async updateProfile(
		id: string,
		update: (profile: StoredProfile) => StoredProfile,
	): Promise<void> {
		const profile = this.profiles.get(id);
		if (!profile) throw new Error('Profile not found');
		this.profiles.set(id, update(structuredClone(profile)));
	}

	async deleteProfile(id: string): Promise<void> {
		this.profiles.delete(id);
		if (this.selectedProfileId === id) this.selectedProfileId = null;
	}

	async getSelectedProfileId(): Promise<unknown> {
		return this.selectedProfileId;
	}

	async setSelectedProfileId(id: string | null): Promise<void> {
		this.selectedProfileId = id;
	}

	close(): void {}
}

class TestElement extends EventTarget {
	disabled = false;
	hidden = false;
	value = 'Player';
	textContent = '';
}

class TestProfileList extends EventTarget {
	replaceChildren(): void {}
}

const createElements = function (): {
	list: TestProfileList;
	count: TestElement;
	createForm: TestElement;
	nameInput: TestElement;
	createButton: TestElement;
	continueButton: TestElement;
	saveTime: TestElement;
	status: TestElement;
} {
	return {
		list: new TestProfileList(),
		count: new TestElement(),
		createForm: new TestElement(),
		nameInput: new TestElement(),
		createButton: new TestElement(),
		continueButton: new TestElement(),
		saveTime: new TestElement(),
		status: new TestElement(),
	};
};

const createController = function (
	database: ProfileDatabase,
	elements: ReturnType<typeof createElements>,
	beforeProfileChange: () => Promise<void>,
	onProfileChange: (profileId: string | null) => void,
	onStateChange: (state: ProfilePickerState) => void,
): ProfilePickerController {
	return createProfilePicker({
		elements,
		profiles: new ProfileRepository(database),
		initialProfiles: [],
		initialSelectedProfileId: null,
		storageMessage: null,
		beforeProfileChange,
		onProfileChange,
		continueProfile: async function () {},
		isStarting: function () {
			return false;
		},
		setStarting: function () {},
		onStateChange,
	});
};

const waitForPendingEffects = function (): Promise<void> {
	return new Promise(function (resolve) {
		setTimeout(resolve, 0);
	});
};

test('a create waiting to save the current profile stops after disposal', async function () {
	const database = new MemoryProfileDatabase();
	const elements = createElements();
	let releaseSave: (() => void) | undefined;
	let signalSaveStarted: (() => void) | undefined;
	const saveStarted = new Promise<void>(function (resolve) {
		signalSaveStarted = resolve;
	});
	const saveCurrentProfile = new Promise<void>(function (resolve) {
		releaseSave = resolve;
	});
	const profileChanges: Array<string | null> = [];
	let stateChangeCount = 0;
	const controller = createController(
		database,
		elements,
		function () {
			signalSaveStarted?.();
			return saveCurrentProfile;
		},
		function (profileId) {
			profileChanges.push(profileId);
		},
		function () {
			stateChangeCount++;
		},
	);

	elements.createForm.dispatchEvent(new Event('submit', { cancelable: true }));
	await saveStarted;
	const changesBeforeDispose = stateChangeCount;
	controller.dispose();
	releaseSave?.();
	await waitForPendingEffects();

	expect(database.createdCount).toBe(0);
	expect(await new ProfileRepository(database).listProfiles()).toEqual([]);
	expect(profileChanges).toEqual([]);
	expect(stateChangeCount).toBe(changesBeforeDispose);
});

test('profile refresh succeeds and a save-before-change failure remains visible', async function () {
	const database = new MemoryProfileDatabase();
	const refreshElements = createElements();
	const refreshedStates: ProfilePickerState[] = [];
	const refreshController = createController(
		database,
		refreshElements,
		async function () {},
		function () {},
		function (state) {
			refreshedStates.push(state);
		},
	);

	await refreshController.refresh();

	expect(refreshElements.status.textContent).toBe('');
	expect(refreshedStates.at(-1)?.busy).toBe(false);
	refreshController.dispose();

	const failureElements = createElements();
	const failedStates: ProfilePickerState[] = [];
	const failureController = createController(
		database,
		failureElements,
		async function () {
			throw new Error('The active conquest could not be saved.');
		},
		function () {},
		function (state) {
			failedStates.push(state);
		},
	);

	failureElements.createForm.dispatchEvent(
		new Event('submit', { cancelable: true }),
	);
	await waitForPendingEffects();

	expect(failureElements.status.textContent).toBe(
		'The active conquest could not be saved.',
	);
	expect(failedStates.at(-1)?.busy).toBe(false);
	expect(database.createdCount).toBe(0);
	failureController.dispose();
});
