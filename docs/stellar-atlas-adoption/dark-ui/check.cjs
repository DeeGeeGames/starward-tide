const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
(async function () {
 const browser = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  const page = await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:2});
  const result = {errors:[],viewports:[]};
  page.on('pageerror',function(error){result.errors.push(error.message);});
  await page.goto('http://127.0.0.1:3127/?diagnostics=1');
  await page.waitForTimeout(1200);
  for (const [name,width,height] of [['desktop',1440,900],['portrait',390,844],['landscape',667,320]]) {
   await page.setViewportSize({width,height});
   await page.evaluate(async function(){await window.conquestDiagnostics.carrierPreview('capture');window.conquestDiagnostics.enable(false);});
   await page.locator('[data-planet="Sol"]').click();
   await page.waitForTimeout(300);
   await page.screenshot({path:`docs/stellar-atlas-adoption/dark-ui/${name}.png`});
   result.viewports.push(await page.evaluate(function(){return {viewport:[innerWidth,innerHeight],document:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],board:getComputedStyle(document.querySelector('#board')).background,header:getComputedStyle(document.querySelector('.status-cluster')).backgroundColor,label:getComputedStyle(document.querySelector('.planet .name')).color,carrierImages:document.querySelectorAll('.planet.carrier img').length};}));
   if(name==='desktop') {
    const box=await page.locator('[data-planet="Sol"]').boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-600);await page.waitForTimeout(300);
    await page.screenshot({path:'docs/stellar-atlas-adoption/dark-ui/desktop-close.png'});
   }
  }
  fs.writeFileSync('docs/stellar-atlas-adoption/dark-ui/checks.json',JSON.stringify(result,null,2));
 } finally {await browser.close();}
})();
