// Run against the local game with PLAYWRIGHT_MODULE pointing to a Playwright install.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const run = async function () {
	const output = process.env.POLISH_OUTPUT_DIR || '/tmp/galaxy-conquest-polish';
	fs.mkdirSync(output, { recursive: true });
	const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
	const results = { checks: [], viewports: [], errors: [] };
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
		page.setDefaultTimeout(6000);
		page.on('pageerror', function (error) { results.errors.push(error.message); });
		const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:3000');
		url.searchParams.set('diagnostics', '1');
		await page.goto(url.href);
		await page.waitForFunction(function () { return window.conquestDiagnostics; });
		const fixture = async function (name = 'capture') {
			await page.evaluate(async function (name) {
				await window.conquestDiagnostics.carrierPreview(name);
				window.conquestDiagnostics.enable(false);
			}, name);
		};
		const check = function (name) { results.checks.push(name); console.log(`PASS ${name}`); };
		const selected = function () { return page.locator('.planet[aria-pressed="true"]').count(); };
		const scale = function () { return page.locator('#app').evaluate(function (el) { return el.style.getPropertyValue('--map-scale'); }); };
		const transform = function () { return page.locator('#map-world').evaluate(function (el) { return el.style.transform; }); };
		const emptyPoint = function () {
			return page.evaluate(function () {
				for (let y = 180; y < innerHeight - 50; y += 30) {
					for (let x = 30; x < innerWidth - 350; x += 30) {
						const el = document.elementFromPoint(x, y);
						if (el?.closest('#board') && !el.closest('button')) return { x, y };
					}
				}
				throw new Error('No empty map point');
			});
		};
		const center = async function (name) {
			const box = await page.locator(`[data-planet="${name}"]`).boundingBox();
			assert.ok(box, `Missing planet ${name}`);
			return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		};

		await fixture();
		await page.locator('[data-planet="Sol"]').click();
		assert.equal(await page.locator('#production-options').isVisible(), false);
		await page.locator('#change-production').click();
		await page.locator('[data-production="ships"]').click();
		assert.equal(await page.locator('[data-production="ships"]').getAttribute('aria-pressed'), 'true');
		await page.locator('#change-production').click();
		check('production remains available behind compact disclosure');

		await page.locator('[data-planet="Terra"]').click({ modifiers: ['Shift'] });
		assert.equal(await selected(), 2);
		await page.locator('[data-planet="Terra"]').click({ modifiers: ['Shift'] });
		assert.equal(await selected(), 1);
		await page.locator('[data-planet="Vega"]').click();
		await page.locator('[data-planet="Sol"]').click({ modifiers: ['Shift'] });
		assert.equal(await selected(), 1);
		check('Shift-click adds/removes sources and clears stale enemy inspection');

		await page.locator('#settings').click();
		await page.keyboard.press('Escape');
		await page.evaluate(function () { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', repeat: true })); });
		assert.equal(await selected(), 1);
		assert.equal(await page.locator('#field-guide').isVisible(), false);
		check('Escape closes one layer and ignores key repeats');

		await page.locator('#send-units').click();
		const empty = await emptyPoint();
		await page.mouse.click(empty.x, empty.y, { button: 'right' });
		assert.equal(await page.locator('#destination-prompt').isVisible(), false);
		assert.equal(await selected(), 1);
		check('right-click empty map cancels destination and retains sources');

		await page.mouse.move(empty.x, empty.y);
		await page.mouse.wheel(0, -250);
		await page.waitForTimeout(100);
		const zoom = await scale();
		await page.locator('#clear').click();
		assert.equal(await scale(), zoom);
		assert.equal(await page.evaluate(function () { return document.activeElement.id; }), 'board');
		await page.locator('#settings').click();
		await page.keyboard.press('Escape');
		assert.equal(await scale(), zoom);
		check('manual zoom survives clear and menu layout changes');
		await page.locator('#board').focus();
		await page.keyboard.press('Home');
		assert.notEqual(await scale(), zoom);
		const fitted = await transform();
		await page.keyboard.press('ArrowLeft');
		assert.notEqual(await transform(), fitted);
		await page.keyboard.press('Space');
		assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'false');
		await page.keyboard.press('Space');
		assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true');
		check('Home, arrow keys and Space work from map focus');

		await fixture();
		await page.locator('[data-planet="Sol"]').click();
		const blank = await emptyPoint();
		await page.mouse.click(blank.x, blank.y);
		assert.equal(await selected(), 0);
		await page.locator('[data-planet="Blue carrier"]').click();
		await page.mouse.click(blank.x, blank.y);
		assert.equal(await selected(), 1);
		assert.match(await page.locator('#banner').textContent(), /Carrier course set/);
		check('empty-map clicks clear ordinary sources and still move carriers');

		await fixture();
		const start = await center('Sol');
		const beforeDrag = await transform();
		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		await page.mouse.move(start.x + 80, start.y + 30, { steps: 8 });
		await page.mouse.up();
		assert.equal(await selected(), 0);
		assert.notEqual(await transform(), beforeDrag);
		const beforeEdge = await transform();
		await page.mouse.move(2, 200);
		await page.mouse.down();
		await page.mouse.move(-15, 230, { steps: 3 });
		await page.mouse.up();
		assert.notEqual(await transform(), beforeEdge);
		assert.equal(await page.locator('#board.dragging').count(), 0);
		check('drags suppress clicks, track beyond the board edge and end cleanly');

		await fixture();
		await page.locator('[data-planet="Sol"]').click();
		const cdp = await page.context().newCDPSession(page);
		await page.locator('#send-units').click();
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [await center('Rhea')] });
		await page.waitForTimeout(150);
		assert.equal(await page.locator('.holding').count(), 1);
		await page.keyboard.press('Escape');
		await page.waitForTimeout(500);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		assert.equal(await page.locator('.holding').count(), 0);
		assert.equal(await selected(), 1);
		assert.equal(await page.locator('[data-planet="Sol"] .count').textContent(), '20');
		await page.locator('#send-units').click();
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [await center('Rhea')] });
		await page.waitForTimeout(600);
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		assert.equal(await page.locator('[data-planet="Sol"] .count').textContent(), '10');
		assert.equal(await selected(), 1);
		await cdp.detach();
		check('touch holds show feedback, cancel safely and launch exactly once');

		for (const [name, width, height] of [
			['desktop', 1440, 900], ['tablet', 1024, 768], ['portrait', 390, 844],
			['small-portrait', 320, 568], ['landscape', 844, 390], ['short-landscape', 568, 320],
		]) {
			await page.setViewportSize({ width, height });
			await fixture();
			await page.locator('[data-planet="Sol"]').click();
			await page.locator('#send-units').scrollIntoViewIfNeeded();
			await page.screenshot({ path: path.join(output, `${name}.png`) });
			const layout = await page.evaluate(function () {
				const panel = document.querySelector('#planet-panel').getBoundingClientRect();
				const header = document.querySelector('.game-header').getBoundingClientRect();
				return {
					viewport: [innerWidth, innerHeight], page: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
					panel: { x: panel.x, y: panel.y, width: panel.width, height: panel.height }, headerBottom: header.bottom,
				};
			});
			assert.deepEqual(layout.page, [width, height]);
			assert.ok(layout.panel.x >= 0 && layout.panel.y >= layout.headerBottom - 1);
			assert.ok(layout.panel.x + layout.panel.width <= width && layout.panel.y + layout.panel.height <= height);
			results.viewports.push({ name, ...layout });
			await page.locator('#send-units').click();
			assert.equal(await page.locator('#planet-panel').isVisible(), false);
			await page.keyboard.press('Escape');
			await page.locator('#orders-toggle').click();
			await page.locator('.order-select').first().click();
			assert.equal(await page.locator('.order-select').first().getAttribute('aria-pressed'), 'true');
			await page.locator('#close-orders').click();
			await page.locator('#sheet-toggle').click();
			assert.equal(await page.locator('#command-details').isVisible(), false);
			await page.locator('#sheet-toggle').click();
		}
		check('six viewport layouts keep destination, Orders and collapse controls usable');
		assert.deepEqual(results.errors, []);
		fs.writeFileSync(path.join(output, 'browser-checks.json'), JSON.stringify(results, null, 2) + '\n');
	} finally {
		await browser.close();
	}
};
void run().catch(function (error) { console.error(error); process.exitCode = 1; });
