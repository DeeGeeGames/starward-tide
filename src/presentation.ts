import ECSpresso from 'ecspresso';
import { createTransformPlugin } from 'ecspresso/plugins/spatial/transform';
import { createCameraPlugin, screenToWorld, worldToScreen } from 'ecspresso/plugins/spatial/camera';
import { createTimer, createTimerPlugin } from 'ecspresso/plugins/scripting/timers';
import type { Camera, Point } from './camera';

export interface Presentation {
	camera(): Camera;
	setCamera(camera: Camera, width: number, height: number): void;
	pan(delta: Point): void;
	zoom(anchor: Point, factor: number, minimum: number, maximum: number): void;
	toWorld(point: Point): Point;
	notify(text: string): void;
	clearNotice(): void;
	notice(): string;
	update(dt: number): void;
	dispose(): Promise<void>;
}

// Presentation has a real-time clock independent of the paused/replaced simulation.
export const createPresentation = async function (): Promise<Presentation> {
	const ecs = ECSpresso.create()
		.withPlugin(createTransformPlugin())
		.withPlugin(createCameraPlugin())
		.withPlugin(createTimerPlugin<'notice'>())
		.build();
	await ecs.initialize();
	ecs.update(0);
	const state = ecs.getResource('cameraState');
	const notices = ecs.spawn({ timers: { notice: createTimer<'notice'>(0) } });
	let message = '';
	const sync = function (): void { ecs.update(0); };
	return {
		camera: function (): Camera {
			const origin = worldToScreen(0, 0, state);
			return { ...origin, scale: state.zoom };
		},
		setCamera: function (camera: Camera, width: number, height: number): void {
			state.viewportWidth = width;
			state.viewportHeight = height;
			state.setPosition((width / 2 - camera.x) / camera.scale, (height / 2 - camera.y) / camera.scale);
			state.setZoom(camera.scale);
			sync();
		},
		pan: function (delta: Point): void {
			state.setPosition(state.x - delta.x / state.zoom, state.y - delta.y / state.zoom);
			sync();
		},
		zoom: function (anchor: Point, factor: number, minimum: number, maximum: number): void {
			const before = screenToWorld(anchor.x, anchor.y, state);
			state.setZoom(Math.max(minimum, Math.min(maximum, state.zoom * factor)));
			sync();
			const after = screenToWorld(anchor.x, anchor.y, state);
			state.setPosition(state.x + before.x - after.x, state.y + before.y - after.y);
			sync();
		},
		toWorld: function (point: Point): Point { return screenToWorld(point.x, point.y, state); },
		notify: function (text: string): void {
			message = text;
			ecs.addComponent(notices.id, 'timers', { notice: createTimer<'notice'>(2.6) });
		},
		clearNotice: function (): void {
			message = '';
		},
		notice: function (): string {
			return notices.components.timers.notice?.active ? message : '';
		},
		update: function (dt: number): void { ecs.update(dt); },
		dispose: function (): Promise<void> { return ecs.dispose(); },
	};
};
