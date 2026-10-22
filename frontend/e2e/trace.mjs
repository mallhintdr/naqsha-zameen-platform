import { chromium } from '@playwright/test';
const [,, role, path] = process.argv;
const mod = await import('./smoke-mocks.mjs');
const b = await chromium.launch(); const pg = await b.newPage();
await pg.route('**/*', mod.mockFor(role));
pg.on('pageerror', e => console.log('ERR', e.stack.split('\n').slice(0,4).join('\n')));
await pg.goto('http://localhost:4173'+path, {waitUntil:'networkidle'}); await pg.waitForTimeout(1500);
console.log('TEXT:', (await pg.evaluate(()=>document.body.innerText)).slice(0,300).replace(/\n/g,' | '));
await b.close();
