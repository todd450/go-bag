#!/usr/bin/env node
// Writes the site's icon files into web/, which tools/build-web.js copies to the site's root. The page
// draws its own tab icon from its script, but only once it is running in a browser that takes an SVG
// from a data: address; these files are what the landing, the sign-in card, Safari, a bookmark and a
// phone's home screen get. All three are the page's own icon at 75, the form it shows before a
// household has loaded, so run this again whenever the case or its tile changes
// (tests/brand-mark.test.js fails until you do).
//   web/favicon.svg            the icon as the page draws it
//   web/favicon.ico            the same at 32 and 48px, for browsers that ask for /favicon.ico
//   web/apple-touch-icon.png   180px with square corners: iOS rounds them itself
// Needs Google Chrome or Chromium, as tools/screenshots.js does.
//   node tools/icons.js
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("../tests/load");
const { findChrome, openChrome } = require("./screenshots");

const WEB = path.join(ROOT, "web");

// The page's tab icon at a score, as SVG.
function svg(score = 75) {
  const href = load().run(`tabIconHref(caseScore(${score}))`);
  return decodeURIComponent(href.slice(href.indexOf(",") + 1));
}

// An .ico file holding these PNGs, each [size, bytes]. Every browser since IE 11 reads PNG entries.
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let at = head.length;
  pngs.forEach(([size, png], i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size, e); head.writeUInt8(size, e + 1);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(at, e + 12);
    at += png.length;
  });
  return Buffer.concat([head, ...pngs.map(p => p[1])]);
}

async function png(page, image, size) {
  await page.send("Emulation.setDeviceMetricsOverride", { width: 500, height: 500, deviceScaleFactor: 1, mobile: false });
  await page.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  const loaded = page.once("Page.loadEventFired");
  const html = `<body style="margin:0"><img src="data:image/svg+xml,${encodeURIComponent(image)}" width="${size}" height="${size}" style="display:block">`;
  await page.send("Page.navigate", { url: "data:text/html," + encodeURIComponent(html) });
  await loaded;
  const { data } = await page.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
  return Buffer.from(data, "base64");
}

async function main() {
  const image = svg();
  const square = image.replace(' rx="18"', "");
  if (square === image) throw new Error("icons: the tile's rounded corners weren't found; update tools/icons.js");
  const page = await openChrome(findChrome());
  try {
    fs.writeFileSync(path.join(WEB, "favicon.svg"), image + "\n");
    fs.writeFileSync(path.join(WEB, "favicon.ico"), ico([[32, await png(page, image, 32)], [48, await png(page, image, 48)]]));
    fs.writeFileSync(path.join(WEB, "apple-touch-icon.png"), await png(page, square, 180));
  } finally { await page.close(); }
  console.log("icons: wrote web/favicon.svg, web/favicon.ico and web/apple-touch-icon.png");
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { svg };
