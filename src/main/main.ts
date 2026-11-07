import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, Menu, powerMonitor } from 'electron'
import { createPlatformAdapter } from '../platform'
import { InstanceGuard } from './instanceGuard'
import { machineFacts } from '../core/releaseCheck'
import { registerIpc } from './ipc'
import { SyncScheduler } from './syncScheduler'
import { UpdateScheduler } from './updateScheduler'

let scheduler: SyncScheduler | null = null
let updateScheduler: UpdateScheduler | null = null
let guard: InstanceGuard | null = null
let mainWindow: BrowserWindow | null = null

const SMOKE = !!process.env.CLAUDE_TOTAL_RECALL_SMOKE

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

function createWindow(): BrowserWindow {
  const icon = resolveIcon()
  const win = new BrowserWindow({
    width: 1100,
    height: 740,
    show: false,
    title: 'Claude Total Recall',
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
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // La barra de título custom refleja maximizado/restaurado: le empujamos cada
  // cambio (mismo patrón de fan-out que el motor de sync).
  win.on('maximize', () => win.webContents.send('window:state', true))
  win.on('unmaximize', () => win.webContents.send('window:state', false))

  // Smoke test de arranque: cargar el renderer y salir (CI/headless).
  if (SMOKE) {
    win.webContents.on('did-finish-load', () => {
      console.log('[claude-total-recall] renderer loaded OK')
      setTimeout(() => app.quit(), 300)
    })
    win.webContents.on('render-process-gone', (_e, d) => {
      console.error('[claude-total-recall] render-process-gone', d)
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
  mainWindow = win
  return win
}

/**
 * A second launch (#140) lands here instead of starting another full app: bring the
 * existing window to the front. It may still be hidden (waiting for ready-to-show,
 * which is exactly when an impatient second click happens) — then it shows itself.
 */
function revealMainWindow(): void {
  const win = mainWindow ?? BrowserWindow.getAllWindows()[0] ?? null
  if (!win) {
    if (app.isReady()) createWindow() // macOS: app alive with no windows
    return
  }
  if (win.isMinimized()) win.restore()
  if (win.webContents.isLoading() && !win.isVisible()) return
  win.show()
  win.focus()
}

function boot(): void {
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
  // Checks GitHub for a newer stable release on open + every 24h (#66); never
  // during the smoke test, same guard as the sync scheduler below. The machine
  // facts pick this machine's installer (#134): process.arch reports x64 under
  // Rosetta, so the real chip comes from runningUnderARM64Translation (#133).
  const facts = machineFacts({
    platform: process.platform,
    arch: process.arch,
    translated: app.runningUnderARM64Translation,
    env: process.env,
  })
  updateScheduler = new UpdateScheduler(app.getVersion(), facts, (state) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('update:state', state)
    }
  })
  // Cross-process lock (#141): only the process holding it syncs this machine. The
  // engine starts once it's ours; while another app copy or a CLI command holds it,
  // the engine stays off and the sync bar says why (the guard retries on its own).
  const engine = scheduler
  guard = new InstanceGuard(createPlatformAdapter(), {
    onAcquired: () => {
      engine.setBlocked(null)
      void engine.start()
    },
    onBlocked: (by) => engine.setBlocked(by),
  })
  const owner = guard
  registerIpc(scheduler, updateScheduler, () => owner.held)
  if (!SMOKE) {
    void guard.start()
    updateScheduler.start()
    // After sleep the heartbeat is minutes old: re-assert it before anyone takes over.
    powerMonitor.on('resume', () => void owner.check())
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

// Single instance (#140): every launch used to start a complete app with its own
// sync engine on the same working copy. Now a second launch hands over to the first
// one (second-instance → revealMainWindow) and quits before touching any state. The
// smoke test skips the lock so it can't be swallowed by a dev copy that's open.
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => revealMainWindow())
  void app.whenReady().then(boot)

  app.on('before-quit', () => {
    scheduler?.stop()
    updateScheduler?.stop()
    guard?.stop()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
