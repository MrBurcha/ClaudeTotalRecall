import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, Menu } from 'electron'
import { registerIpc } from './ipc'
import { SyncScheduler } from './syncScheduler'

let scheduler: SyncScheduler | null = null

/**
 * Ícono de la ventana (barra de tareas, alt-tab, overview) en Linux/Windows: lo
 * setea BrowserWindow.icon. En macOS lo da el .icns del bundle y la opción se
 * ignora → undefined. En dev el PNG vive en la raíz del repo; en prod se copia a
 * resources/ vía electron-builder (extraResources) y se resuelve desde
 * process.resourcesPath (build/ NO viaja dentro del bundle).
 */
function resolveIcon(): string | undefined {
  if (process.platform === 'darwin') return undefined
  const p = process.env.ELECTRON_RENDERER_URL
    ? join(process.cwd(), 'build', 'icon.png')
    : join(process.resourcesPath, 'icon.png')
  return existsSync(p) ? p : undefined
}

function createWindow(): void {
  const icon = resolveIcon()
  const win = new BrowserWindow({
    width: 1100,
    height: 740,
    show: false,
    title: 'ClaudeTR',
    // Chrome propio: en Linux/Windows sacamos el marco nativo (la barra de título
    // la dibuja el renderer); en macOS ocultamos la barra pero conservamos los
    // semáforos nativos (titleBarStyle 'hidden').
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' as const } : { frame: false }),
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.on('ready-to-show', () => win.show())

  // La barra de título custom refleja maximizado/restaurado: le empujamos cada
  // cambio (mismo patrón de fan-out que el motor de sync).
  win.on('maximize', () => win.webContents.send('window:state', true))
  win.on('unmaximize', () => win.webContents.send('window:state', false))

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
  // Linux/Windows muestran un menú nativo por defecto (File/Edit/View…) que no
  // aporta nada con chrome propio; lo removemos. En macOS el menú vive en la barra
  // global del sistema (Cmd+Q / Cmd+C/V), así que lo dejamos.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

  // macOS en dev: el dock muestra el ícono genérico de Electron; lo seteamos si el
  // arte está. En prod lo cubre el .icns del bundle.
  if (process.platform === 'darwin' && process.env.ELECTRON_RENDERER_URL) {
    const devIcon = join(process.cwd(), 'build', 'icon.png')
    if (existsSync(devIcon)) app.dock?.setIcon(devIcon)
  }

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
