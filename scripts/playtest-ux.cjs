const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const out = process.env.UX_OUTPUT_DIR || '/tmp/starward-ux';
fs.mkdirSync(out, { recursive: true });
(async function () {
 const browser = await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  for (const [name, width, height, touch] of [['desktop',1440,900,false],['portrait',390,844,true],['small',320,568,true],['landscape',844,390,true]]) {
   const context = await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch});
   const page = await context.newPage();
   const errors=[]; page.on('pageerror', error => errors.push(error.message));
   await page.addInitScript(function () {
    window.pad={id:'UX simulated controller',index:0,connected:true,mapping:'standard',timestamp:0,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0}))};
    Object.defineProperty(navigator,'getGamepads',{value:()=>{window.padPolls=(window.padPolls||0)+1;return window.enablePad ? [window.pad] : [];}});
    Object.defineProperty(document,'hasFocus',{value:()=>true});
   });
   const press = async function (index) {
    await page.evaluate(i=>{window.pad.buttons[i]={pressed:true,touched:true,value:1};},index);
    const polls = await page.evaluate(()=>window.padPolls||0);
    await page.waitForFunction(before=>(window.padPolls||0)>before+2,polls);
    await page.evaluate(i=>{window.pad.buttons[i]={pressed:false,touched:false,value:0};},index);
    const releasedPolls = await page.evaluate(()=>window.padPolls||0);
    await page.waitForFunction(before=>(window.padPolls||0)>before+2,releasedPolls);
   };
   await page.goto(process.env.GAME_URL || 'http://localhost:3100');
   await page.locator('#new-game').click();
   await page.locator('#setup-next').click();
   await page.locator('#start-conquest').click();
   await page.locator('#app').waitFor({state:'visible'});
   await page.locator('#pause').click();
   const buttons = await page.locator('.planet').evaluateAll(items=>items.map(x=>({label:x.getAttribute('aria-label'),id:x.dataset.planet})));
   const blue = buttons.find(x=>/blue|your|you/i.test(x.label));
   assert(blue,JSON.stringify(buttons));
   const target = page.locator(`.planet[data-planet="${blue.id}"]`);
   if(touch) await target.tap(); else await target.click();
   assert(await page.locator('#dispatch-details').isVisible());
   // Repeated selection should retain the source, not dismiss commands.
   await target.click(); assert(await page.locator('#planet-panel').isVisible());
   await page.locator('[data-amount="0.25"]').click();
   await page.locator('#open-production').click(); assert(await page.locator('#production-options').isVisible());
   await page.locator('#open-dispatch').click();
   await page.locator('#send-units').click(); assert(await page.locator('#planet-panel').isHidden());
   await page.locator('#cancel-dispatch').click(); assert(await page.locator('#dispatch-details').isVisible());
   await page.locator('#panel-multi').click();
   await page.locator('#send-units').click(); assert(await page.locator('#destination-prompt').isVisible());
   const otherId = buttons.find(x=>x.id!==blue.id).id;
   await page.locator(`.planet[data-planet="${otherId}"]`).click();
   assert(await page.locator('#destination-prompt').isHidden());
   assert.match(await page.locator('#orders-toggle').textContent(), /[1-9]/);
   await page.locator('#zoom-in').click(); await page.locator('#zoom-out').click();
   const bounds = await page.evaluate(()=>({w:innerWidth,h:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight}));
   assert(bounds.sw<=bounds.w && bounds.sh<=bounds.h,JSON.stringify(bounds));
   await page.screenshot({path:`${out}/${name}.png`});
   await page.evaluate(()=>{window.enablePad=true;});
   await press(0); // Deliberate controller claim.
   await press(2); // Open settings from map.
   assert.equal(await page.evaluate(()=>document.activeElement.dataset.amount),'0.25');
   await press(15); // Right follows the visible row.
   assert.equal(await page.evaluate(()=>document.activeElement.dataset.amount),'0.5');
   await press(0);
   await press(2); // X goes directly to destination picking.
   assert(await page.locator('#destination-prompt').isVisible());
   await press(1);
   assert.equal(await page.evaluate(()=>document.activeElement.id),'send-units');
   await press(1);
   assert.equal(await page.evaluate(()=>document.activeElement.id),'board');
   console.log(`PASS ${name}: controller row navigation, X shortcut, cancel and B return to map`);
   assert.deepEqual(errors,[]);
   console.log(`PASS ${name}: select, build, configure, cancel, multi-send, dispatch, zoom, viewport`);
   await context.close();
  }
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
