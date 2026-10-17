import ECSpresso from 'ecspresso';
import { COLORS } from './config';
import { generateMap, isMapSize, MAP_SIZES } from './maps';
import type { MapSize, StarMap } from './maps';
import { MAX_PROFILES } from './profile-storage';
import type { ProfileRepository, ProfileSummary } from './profile-storage';

const element = function <T extends HTMLElement>(
	id: string,
	constructor: { new (...args: never[]): T },
): T {
	const found = document.getElementById(id);
	if (!(found instanceof constructor)) throw new Error(`Missing ${id}`);
	return found;
};
const svgElement = function (
	tag: string,
	attributes: Readonly<Record<string, string | number>>,
): SVGElement {
	const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
	for (const [name, value] of Object.entries(attributes))
		node.setAttribute(name, String(value));
	return node;
};
const freshMap = function (size: MapSize): StarMap {
	const seed = crypto.getRandomValues(new Uint32Array(1))[0];
	if (seed === undefined) throw new Error('Could not generate a map seed');
	return generateMap(size, seed);
};

const initialState = function (): Record<string, never> {
	return {};
};
const flowBuilder = ECSpresso.create().withScreens(function (screens) {
	return screens
		.add('title', { initialState })
		.add('setup', { initialState })
		.add('playing', { initialState });
});
type FrontMenu = ReturnType<typeof flowBuilder.build>;

export const createFrontMenu = async function (options: {
	start: (map: StarMap) => Promise<void>;
	continue: (profileId: string) => Promise<void>;
	profiles: ProfileRepository | undefined;
	initialProfiles: ProfileSummary[];
	initialSelectedProfileId: string | null;
	storageMessage: string | null;
	beforeProfileChange: () => Promise<void>;
	onProfileChange: (profileId: string | null) => void;
	onPlaying: () => void;
	onMenu: () => void;
}): Promise<FrontMenu> {
	const root = element('front-menu', HTMLDivElement);
	const title = element('title-screen', HTMLElement);
	const setup = element('setup', HTMLElement);
	const app = element('app', HTMLDivElement);
	const newGame = element('new-game', HTMLButtonElement);
	const start = element('start-conquest', HTMLButtonElement);
	const profileList = element('profile-list', HTMLDivElement);
	const profileCount = element('profile-count', HTMLSpanElement);
	const profileCreateForm = element('profile-create-form', HTMLFormElement);
	const profileName = element('profile-name', HTMLInputElement);
	const createProfileButton = element('create-profile', HTMLButtonElement);
	const continueButton = element('continue-conquest', HTMLButtonElement);
	const profileSaveTime = element('profile-save-time', HTMLSpanElement);
	const profileStatus = element('profile-status', HTMLParagraphElement);
	const status = element('setup-status', HTMLDivElement);
	const summary = element('summary', HTMLDivElement);
	const detail = element('size-detail', HTMLParagraphElement);
	const preview = document.getElementById('map-preview');
	const stars = document.getElementById('stars');
	if (!(preview instanceof SVGElement) || !(stars instanceof SVGElement))
		throw new Error('Missing menu artwork');
	const sizeButtons = [
		...root.querySelectorAll<HTMLButtonElement>('[data-size]'),
	];
	let size: MapSize = 'medium';
	let map = freshMap(size);
	let starting = false;
	let profileBusy = false;
	let profiles = options.initialProfiles;
	let selectedProfileId = options.initialSelectedProfileId;
	let profileMessage = options.storageMessage ?? '';
	const flow = flowBuilder.build();
	const selectedProfile = function (): ProfileSummary | undefined {
		return profiles.find(function (profile) {
			return profile.id === selectedProfileId;
		});
	};
	const profileErrorText = function (error: unknown): string {
		const message = error instanceof Error ? error.message : 'Browser storage could not complete the request.';
		return window.top !== window.self
			? `${message} Embedded browsers may block saves; open the standalone game to use profiles.`
			: message;
	};
	const reloadProfiles = async function (): Promise<void> {
		if (!options.profiles) return;
		profiles = await options.profiles.listProfiles();
	};
	const refreshProfiles = async function (): Promise<void> {
		try {
			await reloadProfiles();
			profileMessage = '';
		} catch (error) {
			profileMessage = profileErrorText(error);
		} finally {
			renderProfiles();
		}
	};
	const selectProfile = async function (profileId: string): Promise<void> {
		if (!options.profiles || profileBusy || starting) return;
		profileBusy = true;
		profileStatus.textContent = 'Switching profile…';
		try {
			await options.beforeProfileChange();
			await options.profiles.setSelectedProfileId(profileId);
			selectedProfileId = profileId;
			options.onProfileChange(profileId);
			profileMessage = '';
		} catch (error) {
			profileMessage = profileErrorText(error);
		} finally {
			profileBusy = false;
			renderProfiles();
		}
	};
	const renderProfiles = function (): void {
		profileCount.textContent = options.profiles
			? `${profiles.length} / ${MAX_PROFILES}`
			: 'Storage unavailable';
		const rows = profiles.map(function (profile) {
			const row = document.createElement('div');
			row.className = `profile-row${profile.id === selectedProfileId ? ' current' : ''}`;
			const info = document.createElement('div');
			info.className = 'profile-row-name';
			const name = document.createElement('strong');
			name.textContent = profile.name;
			const detail = document.createElement('small');
			detail.textContent = profile.hasSave
				? profile.savedAt === null
					? 'Saved conquest · validation needed'
					: `Saved ${new Date(profile.savedAt).toLocaleString()}`
				: 'No saved conquest';
			info.append(name, detail);
			const use = document.createElement('button');
			use.type = 'button';
			use.textContent = profile.id === selectedProfileId ? 'Selected' : 'Use';
			use.disabled = starting || profileBusy || profile.id === selectedProfileId;
			use.setAttribute('aria-pressed', String(profile.id === selectedProfileId));
			use.addEventListener('click', function () {
				void selectProfile(profile.id);
			});
			const rename = document.createElement('button');
			rename.type = 'button';
			rename.textContent = 'Rename';
			rename.disabled = starting || profileBusy;
			rename.addEventListener('click', async function () {
				if (!options.profiles || starting || profileBusy) return;
				const name = window.prompt('Rename local profile', profile.name);
				if (name === null) return;
				profileBusy = true;
				profileStatus.textContent = 'Renaming profile…';
				try {
					await options.profiles.renameProfile(profile.id, name);
					await reloadProfiles();
					profileMessage = '';
				} catch (error) {
					profileMessage = profileErrorText(error);
				} finally {
					profileBusy = false;
					renderProfiles();
				}
			});
			const remove = document.createElement('button');
			remove.type = 'button';
			remove.textContent = 'Delete';
			remove.disabled = starting || profileBusy;
			remove.addEventListener('click', async function () {
				if (!options.profiles || starting || profileBusy) return;
				if (
					!window.confirm(
						`Delete ${profile.name} and its saved conquest? This cannot be undone.`,
					)
				)
					return;
				profileBusy = true;
				profileStatus.textContent = 'Deleting profile…';
				try {
					const deletingSelectedProfile = selectedProfileId === profile.id;
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
				} catch (error) {
					profileMessage = profileErrorText(error);
				} finally {
					profileBusy = false;
					renderProfiles();
				}
			});
			row.append(info, use, rename, remove);
			return row;
		});
		profileList.replaceChildren(...rows);
		const selected = selectedProfile();
		continueButton.disabled =
			!options.profiles || starting || profileBusy || !selected?.hasSave;
		createProfileButton.disabled =
			!options.profiles || starting || profileBusy || profiles.length >= MAX_PROFILES;
		profileName.disabled = createProfileButton.disabled;
		profileCreateForm.hidden = !options.profiles || profiles.length >= MAX_PROFILES;
		newGame.disabled = !options.profiles || profileBusy || starting || !selected;
		profileSaveTime.textContent = selected?.savedAt
			? `Last save ${new Date(selected.savedAt).toLocaleString()}`
			: selected?.hasSave
				? 'Saved conquest needs validation'
				: 'No saved conquest yet';
		profileStatus.textContent = profileMessage;
		start.disabled = !options.profiles || !selected || starting;
		for (const button of sizeButtons) button.disabled = starting;
		element('reroll', HTMLButtonElement).disabled = starting;
		element('back', HTMLButtonElement).disabled = starting;
	};
	const renderPreview = function (): void {
		preview.setAttribute('viewBox', `0 0 ${map.width} ${map.height}`);
		preview.setAttribute(
			'aria-label',
			`Generated ${size} map with ${map.planets.length} worlds, one starting world per side`,
		);
		preview.replaceChildren();
		for (let i = 0; i < 100; i++)
			preview.append(
				svgElement('circle', {
					cx: (i * 137.57) % map.width,
					cy: (i * 83.37) % map.height,
					r: 1.8,
					fill: '#55758e',
					opacity: 0.6,
				}),
			);
		for (const [name, x, y, radius, owner] of map.planets) {
			const node = svgElement('g', {});
			const label = svgElement('title', {});
			label.textContent = `${name} · ${owner === 'blue' ? 'You' : owner === 'red' ? 'Rival' : 'Neutral'}`;
			node.append(label);
			if (owner !== 'neutral')
				node.append(
					svgElement('circle', {
						cx: x,
						cy: y,
						r: radius + 27,
						fill: COLORS[owner],
						'fill-opacity': 0.07,
						stroke: COLORS[owner],
						'stroke-width': 3,
						'stroke-opacity': 0.6,
					}),
				);
			node.append(
				svgElement('circle', {
					cx: x,
					cy: y,
					r: radius,
					fill: COLORS[owner],
					'fill-opacity': owner === 'neutral' ? 0.6 : 1,
				}),
			);
			preview.append(node);
		}
		const count = document.createElement('strong');
		count.textContent = `${map.planets.length} worlds`;
		summary.replaceChildren(
			count,
			' · 1 rival',
			document.createElement('br'),
			'One starting world per side',
		);
		detail.textContent = MAP_SIZES[size].detail;
		for (const button of sizeButtons)
			button.setAttribute('aria-pressed', String(button.dataset.size === size));
	};
	for (let i = 0; i < 110; i++)
		stars.append(
			svgElement('circle', {
				cx: (i * 137.57) % 720,
				cy: (i * 83.37) % 420,
				r: i % 9 === 0 ? 1.3 : 0.65,
				fill: '#9eb6cc',
				opacity: 0.15 + (i % 4) * 0.1,
			}),
		);
	const showMenu = function (screen: 'title' | 'setup'): void {
		options.onMenu();
		app.hidden = true;
		root.hidden = false;
		title.hidden = screen !== 'title';
		setup.hidden = screen !== 'setup';
		root.scrollTop = 0;
		if (screen === 'title') newGame.focus();
		else
			sizeButtons
				.find(function (button) {
					return button.dataset.size === size;
				})
				?.focus();
	};
	profileCreateForm.addEventListener('submit', async function (event) {
		event.preventDefault();
		if (!options.profiles || starting || profileBusy || profiles.length >= MAX_PROFILES) return;
		profileBusy = true;
		profileStatus.textContent = 'Creating profile…';
		renderProfiles();
		let createdProfileId: string | undefined;
		try {
			await options.beforeProfileChange();
			const created = await options.profiles.createProfile(profileName.value);
			createdProfileId = created.id;
			await options.profiles.setSelectedProfileId(created.id);
			await reloadProfiles();
			selectedProfileId = created.id;
			options.onProfileChange(created.id);
			profileName.value = 'Player';
			profileMessage = '';
		} catch (error) {
			profileMessage = profileErrorText(error);
			if (createdProfileId) {
				try {
					await reloadProfiles();
				} catch (refreshError) {
					profileMessage = `${profileMessage} ${profileErrorText(refreshError)}`;
				}
			}
		} finally {
			profileBusy = false;
			renderProfiles();
		}
	});
	continueButton.addEventListener('click', async function () {
		const selected = selectedProfile();
		if (!selected?.hasSave || !options.profiles || starting || profileBusy) return;
		starting = true;
		profileStatus.textContent = 'Validating saved conquest…';
		renderProfiles();
		try {
			await options.continue(selected.id);
			await flow.setScreen('playing', {});
			profileMessage = '';
		} catch (error) {
			profileMessage = profileErrorText(error);
		} finally {
			starting = false;
			renderProfiles();
		}
	});
	flow.onScreenEnter('title', function () {
		showMenu('title');
		void refreshProfiles();
	});
	flow.onScreenEnter('setup', function () {
		showMenu('setup');
	});
	flow.onScreenEnter('playing', function () {
		root.hidden = true;
		app.hidden = false;
		options.onPlaying();
	});
	newGame.addEventListener('click', function () {
		if (!newGame.disabled) void flow.setScreen('setup', {});
	});
	element('back', HTMLButtonElement).addEventListener('click', function () {
		if (!starting) void flow.setScreen('title', {});
	});
	for (const button of sizeButtons)
		button.addEventListener('click', function () {
			if (
				starting ||
				!isMapSize(button.dataset.size) ||
				button.dataset.size === size
			)
				return;
			size = button.dataset.size;
			map = freshMap(size);
			renderPreview();
			status.textContent = `${MAP_SIZES[size].label} map generated: ${map.planets.length} worlds.`;
		});
	element('reroll', HTMLButtonElement).addEventListener('click', function () {
		if (starting) return;
		map = freshMap(size);
		renderPreview();
		status.textContent = 'New layout generated.';
	});
	start.addEventListener('click', async function () {
		const selected = selectedProfile();
		if (starting || !selected || !options.profiles) return;
		starting = true;
		renderProfiles();
		status.textContent = 'Preparing your galaxy…';
		try {
			await reloadProfiles();
			const currentProfile = selectedProfile();
			if (!currentProfile)
				throw new Error('The selected profile is no longer available.');
			if (
				currentProfile.hasSave &&
				!window.confirm(
					`Starting a new conquest will replace ${currentProfile.name}'s saved conquest. Continue?`,
				)
			) {
				status.textContent = '';
				return;
			}
			await options.start(map);
			await flow.setScreen('playing', {});
			status.textContent = '';
		} catch (error) {
			console.error('Could not start conquest', error);
			status.textContent =
				error instanceof Error
					? error.message
					: 'Could not start conquest. Please try again.';
		} finally {
			starting = false;
			renderProfiles();
		}
	});
	renderProfiles();
	renderPreview();
	await flow.initialize();
	await flow.setScreen('title', {});
	return flow;
};
