import { MAX_PROFILES } from './profile-storage';
import type { ProfileRepository, ProfileSummary } from './profile-storage';

interface ProfilePickerElements {
	list: HTMLDivElement;
	count: HTMLSpanElement;
	createForm: HTMLFormElement;
	nameInput: HTMLInputElement;
	createButton: HTMLButtonElement;
	continueButton: HTMLButtonElement;
	saveTime: HTMLSpanElement;
	status: HTMLParagraphElement;
}

export interface ProfilePickerState {
	available: boolean;
	busy: boolean;
	selectedProfile: ProfileSummary | undefined;
}

export interface ProfilePickerController {
	getState(): ProfilePickerState;
	render(): ProfilePickerState;
	reload(): Promise<void>;
	refresh(): Promise<void>;
	dispose(): void;
}

interface ProfilePickerOptions {
	elements: ProfilePickerElements;
	profiles: ProfileRepository | undefined;
	initialProfiles: readonly ProfileSummary[];
	initialSelectedProfileId: string | null;
	storageMessage: string | null;
	beforeProfileChange: () => Promise<void>;
	onProfileChange: (profileId: string | null) => void;
	continueProfile: (profileId: string) => Promise<void>;
	isStarting: () => boolean;
	setStarting: (starting: boolean) => void;
	onStateChange: (state: ProfilePickerState) => void;
}

export const createProfilePicker = function (
	options: ProfilePickerOptions,
): ProfilePickerController {
	const { elements } = options;
	let profiles = [...options.initialProfiles];
	let selectedProfileId = options.initialSelectedProfileId;
	let profileBusy = false;
	let profileMessage = options.storageMessage ?? '';
	let disposed = false;
	const permanentListeners = new AbortController();
	let rowListeners = new AbortController();

	const selectedProfile = function (): ProfileSummary | undefined {
		return profiles.find(function (profile) {
			return profile.id === selectedProfileId;
		});
	};
	const getState = function (): ProfilePickerState {
		return {
			available: options.profiles !== undefined,
			busy: profileBusy,
			selectedProfile: selectedProfile(),
		};
	};
	const profileErrorText = function (error: unknown): string {
		const message = error instanceof Error
			? error.message
			: 'Browser storage could not complete the request.';
		return window.top !== window.self
			? message + ' Embedded browsers may block saves; open the standalone game to use profiles.'
			: message;
	};
	const reloadProfiles = async function (): Promise<void> {
		if (!options.profiles) return;
		profiles = await options.profiles.listProfiles();
	};
	const render = function (): ProfilePickerState {
		const state = getState();
		if (disposed) return state;

		rowListeners.abort();
		rowListeners = new AbortController();
		elements.count.textContent = options.profiles
			? profiles.length + ' / ' + MAX_PROFILES
			: 'Storage unavailable';
		const rows = profiles.map(function (profile) {
			const row = document.createElement('div');
			row.className =
				'profile-row' + (profile.id === selectedProfileId ? ' current' : '');
			const info = document.createElement('div');
			info.className = 'profile-row-name';
			const name = document.createElement('strong');
			name.textContent = profile.name;
			const detail = document.createElement('small');
			detail.textContent = profile.hasSave
				? profile.savedAt === null
					? 'Saved conquest · validation needed'
					: 'Saved ' + new Date(profile.savedAt).toLocaleString()
				: 'No saved conquest';
			info.append(name, detail);

			const use = document.createElement('button');
			use.type = 'button';
			use.textContent = profile.id === selectedProfileId ? 'Selected' : 'Use';
			use.disabled =
				options.isStarting() ||
				profileBusy ||
				profile.id === selectedProfileId;
			use.setAttribute('aria-pressed', String(profile.id === selectedProfileId));
			use.addEventListener(
				'click',
				function () {
					void selectProfile(profile.id);
				},
				{ signal: rowListeners.signal },
			);

			const rename = document.createElement('button');
			rename.type = 'button';
			rename.textContent = 'Rename';
			rename.disabled = options.isStarting() || profileBusy;
			rename.addEventListener(
				'click',
				async function () {
					if (!options.profiles || options.isStarting() || profileBusy) return;
					const name = window.prompt('Rename local profile', profile.name);
					if (name === null) return;
					await runProfileOperation('Renaming profile…', async function () {
						if (!options.profiles) return;
						await options.profiles.renameProfile(profile.id, name);
						await reloadProfiles();
						profileMessage = '';
					});
				},
				{ signal: rowListeners.signal },
			);

			const remove = document.createElement('button');
			remove.type = 'button';
			remove.textContent = 'Delete';
			remove.disabled = options.isStarting() || profileBusy;
			remove.addEventListener(
				'click',
				async function () {
					if (!options.profiles || options.isStarting() || profileBusy) return;
					if (
						!window.confirm(
							'Delete ' +
								profile.name +
								' and its saved conquest? This cannot be undone.',
						)
					)
						return;
					await runProfileOperation('Deleting profile…', async function () {
						if (!options.profiles) return;
						const deletingSelectedProfile =
							selectedProfileId === profile.id;
						await options.profiles.deleteProfile(profile.id);
						if (deletingSelectedProfile) {
							selectedProfileId = null;
							options.onProfileChange(null);
						}
						await reloadProfiles();
						profileMessage = '';
						if (deletingSelectedProfile) {
							const nextProfileId = profiles[0]?.id ?? null;
							try {
								await options.profiles.setSelectedProfileId(nextProfileId);
								selectedProfileId = nextProfileId;
								options.onProfileChange(nextProfileId);
							} catch (error) {
								profileMessage = profileErrorText(error);
							}
						}
					});
				},
				{ signal: rowListeners.signal },
			);

			row.append(info, use, rename, remove);
			return row;
		});
		elements.list.replaceChildren(...rows);
		const selected = state.selectedProfile;
		elements.continueButton.disabled =
			!options.profiles ||
			options.isStarting() ||
			profileBusy ||
			!selected?.hasSave;
		elements.createButton.disabled =
			!options.profiles ||
			options.isStarting() ||
			profileBusy ||
			profiles.length >= MAX_PROFILES;
		elements.nameInput.disabled = elements.createButton.disabled;
		elements.createForm.hidden =
			!options.profiles || profiles.length >= MAX_PROFILES;
		elements.saveTime.textContent = selected?.savedAt
			? 'Last save ' + new Date(selected.savedAt).toLocaleString()
			: selected?.hasSave
				? 'Saved conquest needs validation'
				: 'No saved conquest yet';
		elements.status.textContent = profileMessage;
		return state;
	};
	const notifyStateChange = function (): void {
		const state = render();
		options.onStateChange(state);
	};
	const runProfileOperation = async function (
		status: string,
		operation: () => Promise<void>,
		renderWhileBusy = false,
	): Promise<void> {
		if (
			disposed ||
			!options.profiles ||
			profileBusy ||
			options.isStarting()
		)
			return;
		profileBusy = true;
		elements.status.textContent = status;
		if (renderWhileBusy) notifyStateChange();
		try {
			await operation();
		} catch (error) {
			profileMessage = profileErrorText(error);
		} finally {
			profileBusy = false;
			if (!disposed) notifyStateChange();
		}
	};
	const selectProfile = async function (profileId: string): Promise<void> {
		await runProfileOperation('Switching profile…', async function () {
			if (!options.profiles) return;
			await options.beforeProfileChange();
			await options.profiles.setSelectedProfileId(profileId);
			selectedProfileId = profileId;
			options.onProfileChange(profileId);
			profileMessage = '';
		});
	};
	const refresh = async function (): Promise<void> {
		if (disposed) return;
		try {
			await reloadProfiles();
			profileMessage = '';
		} catch (error) {
			profileMessage = profileErrorText(error);
		} finally {
			if (!disposed) notifyStateChange();
		}
	};
	const createProfile = async function (): Promise<void> {
		await runProfileOperation(
			'Creating profile…',
			async function () {
				let createdProfileId: string | undefined;
				try {
					if (!options.profiles) return;
					await options.beforeProfileChange();
					const created = await options.profiles.createProfile(
						elements.nameInput.value,
					);
					createdProfileId = created.id;
					await options.profiles.setSelectedProfileId(created.id);
					await reloadProfiles();
					selectedProfileId = created.id;
					options.onProfileChange(created.id);
					elements.nameInput.value = 'Player';
					profileMessage = '';
				} catch (error) {
					profileMessage = profileErrorText(error);
					if (createdProfileId) {
						try {
							await reloadProfiles();
						} catch (refreshError) {
							profileMessage += ' ' + profileErrorText(refreshError);
						}
					}
				}
			},
			true,
		);
	};
	const continueSelectedProfile = async function (): Promise<void> {
		const selected = selectedProfile();
		if (
			disposed ||
			!selected?.hasSave ||
			!options.profiles ||
			profileBusy ||
			options.isStarting()
		)
			return;
		options.setStarting(true);
		elements.status.textContent = 'Validating saved conquest…';
		notifyStateChange();
		try {
			await options.continueProfile(selected.id);
			profileMessage = '';
		} catch (error) {
			profileMessage = profileErrorText(error);
		} finally {
			options.setStarting(false);
			if (!disposed) notifyStateChange();
		}
	};

	elements.createForm.addEventListener(
		'submit',
		function (event) {
			event.preventDefault();
			void createProfile();
		},
		{ signal: permanentListeners.signal },
	);
	elements.continueButton.addEventListener(
		'click',
		function () {
			void continueSelectedProfile();
		},
		{ signal: permanentListeners.signal },
	);

	return {
		getState,
		render,
		reload: async function (): Promise<void> {
			if (!disposed) await reloadProfiles();
		},
		refresh,
		dispose: function (): void {
			if (disposed) return;
			disposed = true;
			permanentListeners.abort();
			rowListeners.abort();
		},
	};
};
