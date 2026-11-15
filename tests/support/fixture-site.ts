/**
The synthetic SPA build behind every fixture artifact, by web-root path: the
shell, its service worker and manifest, one extra file per name in `extras`
and hashed assets unique to the commit. Files of different releases have
equal lengths on purpose, so only content tells them apart.
*/
export function fixtureSite(
  commit: string,
  extras: readonly string[] = ['img/app.svg'],
  assetDir = 'assets',
): Map<string, string> {
  const sha7 = commit.slice(0, 7);
  return new Map([
    [
      'index.html',
      `<!doctype html><html lang="de"><head><link rel="stylesheet" href="/${assetDir}/app.${sha7}.css"><script type="module" src="/${assetDir}/app.${sha7}.js"></script></head><body><h1>Release ${sha7}</h1></body></html>`,
    ],
    ['manifest.webmanifest', `{"name":"Performance ${sha7}"}`],
    ['sw.js', `// service worker ${sha7}\n`],
    ...extras.map((path): [string, string] => [
      path,
      `<svg xmlns="http://www.w3.org/2000/svg"><title>${sha7} ${path}</title></svg>`,
    ]),
    [`${assetDir}/app.${sha7}.css`, `body{content:"${sha7}"}`],
    [`${assetDir}/app.${sha7}.js`, `console.log("${sha7}");`],
  ]);
}
