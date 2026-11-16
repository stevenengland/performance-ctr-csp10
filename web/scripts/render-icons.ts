/*
Renders the PNG app icons from public/favicon.svg (the "P" monogram). Run after
changing the SVG: `node web/scripts/render-icons.ts`; the PNGs are committed.
PW_CHANNEL=chrome uses an installed Chrome instead of Playwright's Chromium.
*/
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const publicDir = new URL('../public/', import.meta.url);
const svg = await readFile(new URL('favicon.svg', publicDir), 'utf8');
// Maskable icons fill the whole square; the platform applies its own mask.
const square = svg.replace(' rx="96"', '');

const icons = [
  { file: 'pwa-192.png', size: 192, markup: svg },
  { file: 'pwa-512.png', size: 512, markup: svg },
  { file: 'pwa-maskable-512.png', size: 512, markup: square },
  { file: 'apple-touch-icon.png', size: 180, markup: square },
];

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL });
for (const icon of icons) {
  const page = await browser.newPage({
    viewport: { width: icon.size, height: icon.size },
  });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${icon.markup}`,
  );
  await page.screenshot({
    path: new URL(icon.file, publicDir).pathname,
    omitBackground: true,
  });
  await page.close();
}
await browser.close();
