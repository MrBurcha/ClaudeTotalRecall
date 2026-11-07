// Renders the brand art with Electron's own Chromium — no ImageMagick or system
// Chrome needed, so it works the same on macOS, Linux and Windows:
//   build/icon.svg        → build/icon-source.png + build/icon.png (1024) +
//                           build/icons/<N>x<N>.png (Linux hicolor set)
//   scripts/background.html → build/background@2x.png (1280x1208) +
//                             build/background.png (640x604) for the macOS DMG
//
// Usage: npm run brand   (runs `electron scripts/render-brand.cjs`)
const { app, BrowserWindow, nativeImage } = require('electron')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const BUILD = join(ROOT, 'build')
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

app.disableHardwareAcceleration()

async function capture(source, width, height, zoom = 1) {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: true, zoomFactor: zoom },
  })
  if (source.file) await win.loadFile(source.file)
  else await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(source.html)}`)
  await new Promise((r) => setTimeout(r, 400))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width, height })
  // Not destroyed here: on Windows a BrowserWindow created right after destroying
  // another can fail to load (ERR_FAILED). They all go away when the app quits.
  return img
}

function page(body, w, h, extraCss = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;width:${w}px;height:${h}px;overflow:hidden}
    ${extraCss}</style></head><body>${body}</body></html>`
}

async function renderIcon() {
  const svg = readFileSync(join(BUILD, 'icon.svg'), 'utf8')
  const img = await capture({ html: page(svg, 1024, 1024, 'svg{display:block}') }, 1024, 1024)
  const png = img.resize({ width: 1024, height: 1024, quality: 'best' }).toPNG()
  writeFileSync(join(BUILD, 'icon-source.png'), png)
  writeFileSync(join(BUILD, 'icon.png'), png)
  mkdirSync(join(BUILD, 'icons'), { recursive: true })
  const master = nativeImage.createFromBuffer(png)
  for (const s of ICON_SIZES) {
    const out = master.resize({ width: s, height: s, quality: 'best' }).toPNG()
    writeFileSync(join(BUILD, 'icons', `${s}x${s}.png`), out)
  }
  console.log(`✓ icon.png (1024) + icons/ ${ICON_SIZES.join(', ')}`)
}

async function renderBackground() {
  // Layout at 640x604 CSS px, rendered at 2x for retina, like make-background.sh.
  const img = await capture({ file: join(ROOT, 'scripts', 'background.html') }, 1280, 1208, 2)
  const at2x = img.resize({ width: 1280, height: 1208, quality: 'best' })
  writeFileSync(join(BUILD, 'background@2x.png'), at2x.toPNG())
  writeFileSync(
    join(BUILD, 'background.png'),
    at2x.resize({ width: 640, height: 604, quality: 'best' }).toPNG(),
  )
  console.log('✓ background@2x.png (1280x1208) + background.png (640x604)')
}

app
  .whenReady()
  .then(async () => {
    await renderIcon()
    await renderBackground()
  })
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => app.quit())
