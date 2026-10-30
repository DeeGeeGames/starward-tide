const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const out = process.env.SOUND_OUTPUT_DIR || '/tmp/galaxy-conquest-sound';
fs.mkdirSync(out, { recursive: true });
const checks = [];
const check = function (name) { checks.push(name); console.log('PASS ' + name); };
const instrument = function () {
	const Original = window.AudioContext;
	window.soundQA = { contexts: [], starts: [], active: new Set(), stopped: 0, analysers: [] };
	const nativeConnect = AudioNode.prototype.connect;
	AudioNode.prototype.connect = function (...args) {
		const result = nativeConnect.apply(this, args);
		if (args[0] instanceof AudioDestinationNode) {
			const analyser = this.context.createAnalyser(); analyser.fftSize = 2048;
			nativeConnect.call(this, analyser);
			window.soundQA.analysers.push(analyser);
		}
		return result;
	};
	window.AudioContext = class extends Original {
		constructor(...args) { super(...args); window.soundQA.contexts.push(this); }
		createBufferSource() {
			const source = super.createBufferSource(), start = source.start.bind(source), stop = source.stop.bind(source);
			source.start = function (...args) {
				window.soundQA.starts.push({ duration: source.buffer?.duration, time: performance.now() });
				window.soundQA.active.add(source); return start(...args);
			};
			source.stop = function (...args) { window.soundQA.active.delete(source); window.soundQA.stopped++; return stop(...args); };
			source.addEventListener('ended', function () { window.soundQA.active.delete(source); });
			return source;
		}
	};
};
(async function () {
	const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=user-gesture-required'] });
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
	const page = await context.newPage(); page.setDefaultTimeout(10000);
	const errors = []; page.on('pageerror', function (error) { errors.push(error.message); });
	await page.addInitScript(instrument);
	try {
		const url = new URL(process.env.GAME_URL || 'http://localhost:3000');
		url.searchParams.set('diagnostics', '1');
		await page.goto(url.href);
		await page.locator('#new-game').waitFor({ state: 'visible' }); await page.waitForFunction(function () { return window.conquestDiagnostics; }); await page.evaluate(function () { window.conquestDiagnostics.enable(false); });
		assert.equal(await page.evaluate(function () { return window.soundQA.contexts.length; }), 0);
		await page.screenshot({ path: out + '/title-desktop.png' });
		await page.locator('#title-sound').click();
		assert.equal(await page.locator('#title-sound').getAttribute('aria-pressed'), 'false');
		await page.reload(); await page.locator('#new-game').waitFor({ state: 'visible' }); await page.waitForFunction(function () { return window.conquestDiagnostics; }); await page.evaluate(function () { window.conquestDiagnostics.enable(false); });
		assert.equal(await page.locator('#title-sound').textContent(), 'Sound: Off');
		assert.equal(await page.evaluate(function () { return window.soundQA.contexts.length; }), 0);
		check('no autoplay context before interaction; mute persists across reload');
		await page.locator('#title-sound').click();
		await page.waitForFunction(function () { return window.soundQA.contexts[0]?.state === 'running'; });
		await page.locator('#new-game').click();
		await page.waitForFunction(function () {
			return window.soundQA.analysers.some(function (analyser) { const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data); return data.some(function (sample) { return Math.abs(sample) > 0.001; }); });
		});
		check('trusted pointer unlocks native audio with nonzero output');
		await page.locator('#setup-next').click(); await page.locator('#start-conquest').click();
		await page.waitForFunction(function () { return !document.querySelector('#app').hidden; });
		await page.locator('#pause').click();
		await page.locator('.planet[aria-label*=", You "]').first().click();
		await page.keyboard.press('d');
		await page.locator('.planet[aria-label*=", Neutral "]').first().click();
		await page.waitForFunction(function () { return window.soundQA.starts.some(function (entry) { return Math.abs(entry.duration - 0.26) < 0.001; }); });
		check('normal paused dispatch plays command cue and keeps controls playable');
		await page.locator('#settings').click();
		await page.locator('#game-sound').click();
		assert.equal(await page.locator('#title-sound').getAttribute('aria-pressed'), 'false');
		assert.equal(await page.evaluate(function () { return window.soundQA.active.size; }), 0);
		await page.locator('#game-sound').click();
		await page.locator('#close-guide').click();
		await page.evaluate(function () { return window.conquestDiagnostics.carrierPreview('blockade'); });
		await page.locator('.carrier[aria-label*=", You "]').click();
		await page.locator('#launch-carrier').click();
		await page.locator('#pause').click();
		await page.waitForFunction(function () { return window.soundQA.starts.some(function (entry) { return Math.abs(entry.duration - 0.13) < 0.001; }); });
		check('real orbital combat emits native laser playback');
		await page.locator('#pause').click();
		await page.waitForFunction(function () { return window.soundQA.active.size === 0; });
		const pausedShots = await page.evaluate(function () { return window.soundQA.starts.filter(function (entry) { return Math.abs(entry.duration - 0.13) < 0.001; }).length; });
		await page.waitForTimeout(400);
		assert.equal(await page.evaluate(function () { return window.soundQA.starts.filter(function (entry) { return Math.abs(entry.duration - 0.13) < 0.001; }).length; }), pausedShots);
		check('pause stops battle voices and never replays frozen volleys');
		await page.locator('#settings').click(); await page.locator('#game-sound').click();
		const off = await page.evaluate(function () { return window.soundQA.starts.length; });
		await page.locator('#close-guide').click(); await page.locator('#pause').click();
		await page.waitForTimeout(400);
		assert.equal(await page.evaluate(function () { return window.soundQA.starts.length; }), off);
		assert.equal(await page.evaluate(function () { return window.soundQA.active.size; }), 0);
		check('mute silences UI and combat immediately; both controls synchronize');
		await page.locator('#settings').click(); await page.locator('#game-sound').click(); await page.locator('#close-guide').click();
		await page.waitForTimeout(200);
		await page.evaluate(function () { window.testFocus = false; Object.defineProperty(document, 'hasFocus', { configurable: true, value: function () { return window.testFocus; } }); window.dispatchEvent(new Event('blur')); });
		await page.waitForTimeout(150);
		assert.equal(await page.evaluate(function () { return window.soundQA.active.size; }), 0);
		const blurred = await page.evaluate(function () { return window.soundQA.starts.length; });
		await page.waitForTimeout(250);
		assert.equal(await page.evaluate(function () { return window.soundQA.starts.length; }), blurred);
		await page.evaluate(function () { window.testFocus = true; window.dispatchEvent(new Event('focus')); });
		check('simulated focus loss stops active voices and suppresses background events');
		await page.locator('#pause').click();
		await page.locator('#settings').click(); await page.locator('#profiles-game').click();
		await page.setViewportSize({ width: 390, height: 844 });
		await page.locator('#title-sound').scrollIntoViewIfNeeded();
		assert(await page.locator('#title-sound').isVisible());
		const box = await page.locator('#title-sound').boundingBox();
		assert(box.y >= 0 && box.y + box.height <= 844);
		await page.screenshot({ path: out + '/title-mobile.png' });
		check('mobile title mute control stays reachable');
		assert.deepEqual(errors, []);
		check('game journey reports no browser runtime errors');
		fs.writeFileSync(out + '/browser-checks.json', JSON.stringify({ checks, errors, nativeSourcesStarted: await page.evaluate(function () { return window.soundQA.starts.length; }) }, null, 2));
	} finally { await context.close(); await browser.close(); }
})().catch(function (error) { console.error(error); process.exitCode = 1; });
