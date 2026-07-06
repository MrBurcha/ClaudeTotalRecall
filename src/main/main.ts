import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc'
import { SyncScheduler } from './syncScheduler'

let scheduler: SyncScheduler | null = null

// En prod el ícono lo pone el bundle empaquetado (build/icon.*). En dev usamos
// build/icon.png desde la raíz del proyecto si existe (resiliente si aún no está).
const devIcon = join(process.cwd(), 'build', 'icon.png')
const hasDevIcon = !!process.env.ELECTRON_RENDERER_URL && existsSync(devIcon)

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 740,
    show: false,
    title: 'ClaudeTR',
    ...(hasDevIcon ? { icon: devIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.on('ready-to-show', () => win.show())

  // Smoke test de arranque: cargar el renderer y salir (CI/headless).
  if (process.env.CLAUDETR_SMOKE) {
    win.webContents.on('did-finish-load', () => {
      console.log('[claudetr] renderer cargó OK')
      setTimeout(() => app.quit(), 300)
    })
    win.webContents.on('render-process-gone', (_e, d) => {
      console.error('[claudetr] render-process-gone', d)
      process.exit(1)
    })
  }

  // In dev, electron-vite serves the renderer over HTTP; in prod we load the file.
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (hasDevIcon && process.platform === 'darwin') app.dock?.setIcon(devIcon)
  createWindow()

  // El motor empuja su estado a todas las ventanas vivas. Se crea antes de
  // registrar el IPC (los handlers sync:* lo consultan) y arranca tras el boot.
  scheduler = new SyncScheduler((state) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('sync:state', state)
    }
  })
  registerIpc(scheduler)
  if (!process.env.CLAUDETR_SMOKE) void scheduler.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  scheduler?.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
