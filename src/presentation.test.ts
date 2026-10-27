import { expect, test } from 'bun:test';
import { createPresentation } from './presentation';
import { fitCamera, revealPoint } from './camera';

test('plugin camera keeps cursor anchor fixed through zoom, pan, and viewport changes', async function () {
	const ui = await createPresentation();
	try {
		ui.setCamera({ x: 50, y: 100, scale: 0.5 }, 1000, 800);
		expect(ui.camera()).toEqual({ x: 50, y: 100, scale: 0.5 });
		const anchor = { x: 235, y: 420 };
		const worldPoint = ui.toWorld(anchor);
		ui.zoom(anchor, 2, 0.25, 4);
		expect(ui.toWorld(anchor).x).toBeCloseTo(worldPoint.x);
		expect(ui.toWorld(anchor).y).toBeCloseTo(worldPoint.y);
		ui.pan({ x: 20, y: -10 });
		expect(ui.toWorld({ x: 255, y: 410 })).toEqual(worldPoint);
		const camera = ui.camera();
		ui.setCamera(camera, 390, 844);
		expect(ui.camera()).toEqual(camera);
	} finally { await ui.dispose(); }
});

test('notices expire on presentation time while simulation is paused and repeated notices reset their lifetime', async function () {
	const ui = await createPresentation();
	try {
		ui.notify('First');
		for (let tick = 0; tick < 20; tick++) ui.update(0.1);
		expect(ui.notice()).toBe('First');
		ui.notify('Second');
		for (let tick = 0; tick < 10; tick++) ui.update(0.1);
		expect(ui.notice()).toBe('Second');
		for (let tick = 0; tick < 20; tick++) ui.update(0.1);
		expect(ui.notice()).toBe('');
		ui.notify('Reset');
		ui.clearNotice();
		expect(ui.notice()).toBe('');
	} finally { await ui.dispose(); }
});

test('a mobile selection is revealed above the command sheet without changing zoom', function () {
	const camera = fitCamera({ width: 1200, height: 1320 }, { x: 20, y: 140, width: 350, height: 680 });
	const selection = { x: 532, y: 1229 };
	const area = { x: 20, y: 140, width: 350, height: 220 };
	const revealed = revealPoint(camera, selection, area);
	expect(revealed.scale).toBe(camera.scale);
	expect(revealed.y + selection.y * revealed.scale).toBeLessThan(area.y + area.height - 60);
	expect(revealed.x + selection.x * revealed.scale).toBeGreaterThan(area.x + 60);
	expect(revealPoint(revealed, selection, area)).toEqual(revealed);
});
