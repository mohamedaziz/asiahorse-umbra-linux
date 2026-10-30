import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { cpuTemp, Hub } from './hub'
import {
  animationFrame, type AnimationName, CMD, type Curve, curvePercent, effectPacket, type EffectName,
  EFFECTS, type EffectOptions, FAN_MAX, FAN_MIN, fanPacket, ledTotal, native, type RGB,
} from './protocol'

const hub = new Hub()
let win: BrowserWindow | null = null

// What the hub is doing, pushed to the window every second.
const state = {
  connected: false, node: null as string | null, ports: [] as number[],
  lights: 'unknown' as 'unknown' | 'effect' | 'animation' | 'canvas' | 'color',
  effect: null as null | { name: EffectName } & EffectOptions,
  animation: null as null | { name: AnimationName, colors: RGB[], speed: number },
  fan: null as number | null, curve: null as Curve | null,
  cpu: null as number | null, error: null as string | null,
  preview: [] as RGB[],
}

let animTimer: NodeJS.Timeout | null = null
let curveTimer: NodeJS.Timeout | null = null

function push() { win?.webContents.send('state', state) }

async function guard<T>(fn: () => Promise<T> | T): Promise<T | null> {
  try {
    if (!hub.fd && !connect()) throw new Error('hub not found (unplugged, or udev rule missing?)')
    state.error = null
    return await fn()
  } catch (e) {
    state.error = (e as Error).message
    state.connected = false
    hub.close()
    return null
  } finally { push() }
}

function connect(): boolean {
  state.connected = hub.open()
  state.node = hub.node
  return state.connected
}

function stopAnimation() {
  if (animTimer) clearInterval(animTimer)
  animTimer = null
  state.animation = null
}

/** Fan curve: fail-safe 100 % when the temperature cannot be read. */
function startCurve(curve: Curve) {
  stopCurve(false)
  state.curve = curve
  hub.write(native([...CMD.fanControlSoftware]))
  const tick = () => guard(() => {
    const t = cpuTemp()
    state.cpu = t
    const pct = t === null ? FAN_MAX : Math.max(FAN_MIN, curvePercent(curve, t))
    if (state.fan === null || Math.abs(pct - state.fan) >= 3 || (pct === FAN_MAX && state.fan !== FAN_MAX)) {
      hub.write(fanPacket(pct))
      state.fan = pct
    }
  })
  tick()
  curveTimer = setInterval(tick, 2000)
}

function stopCurve(fullSpeed = true) {
  if (curveTimer) clearInterval(curveTimer)
  curveTimer = null
  // the hub keeps the last speed: never leave the fans slow when the curve stops
  if (state.curve && fullSpeed && hub.fd !== null) { hub.write(fanPacket(FAN_MAX)); state.fan = FAN_MAX }
  state.curve = null
}

ipcMain.handle('refresh', () => guard(async () => {
  state.ports = await hub.topology()
  state.preview = state.preview.length ? state.preview : new Array(ledTotal(state.ports)).fill([0, 0, 0])
  return hub.status()
}))

ipcMain.handle('effect', (_e, name: EffectName, opts: EffectOptions) => guard(async () => {
  stopAnimation()
  await hub.hardwareMode()
  hub.write(effectPacket(EFFECTS.indexOf(name), opts))
  state.lights = 'effect'
  state.effect = { name, ...opts }
  // the animation runs in the hub firmware: show the chosen colors only
  const k = (opts.brightness ?? 60) / 100
  if (name.includes('rainbow')) {
    state.preview = animationFrame('rainbow', hub.ports, 0, []).map(c => c.map(v => Math.round(v * k)) as RGB)
  } else {
    const cols = opts.colors?.length ? opts.colors : [[255, 255, 255] as RGB]
    state.preview = Array.from({ length: ledTotal(hub.ports) }, (_, i) =>
      cols[name === 'static' ? 0 : i % cols.length].map(v => Math.round(v * k)) as RGB)
  }
}))

ipcMain.handle('animate', (_e, name: AnimationName, colors: RGB[], speed: number) => guard(async () => {
  stopAnimation()
  await hub.enterSoftwareMode()
  const t0 = Date.now()
  state.lights = 'animation'
  state.animation = { name, colors, speed }
  // 30 fps: 4 packets per frame for 72 LEDs, far under the ~378 writes/s the vendor app sustains
  animTimer = setInterval(() => {
    const leds = animationFrame(name, hub.ports, (Date.now() - t0) / 1000, colors, speed)
    try { hub.sendFrame(leds); state.preview = leds } catch (e) { stopAnimation(); state.error = (e as Error).message }
  }, 33)
}))

ipcMain.handle('stopAnimation', () => { stopAnimation(); push() })

/** Canvas and solid color: one frame, the hub latches it. */
ipcMain.handle('frame', (_e, leds: RGB[], kind: 'canvas' | 'color') => guard(async () => {
  stopAnimation()
  await hub.enterSoftwareMode()
  for (let i = 0; i < 3; i++) hub.sendFrame(leds) // repeat: first frame after the switch can be lost
  state.lights = kind
  state.preview = leds
}))

ipcMain.handle('fan', (_e, pct: number) => guard(() => {
  stopCurve(false)
  hub.write(native([...CMD.fanControlSoftware]))
  hub.write(fanPacket(pct))
  state.fan = Math.max(FAN_MIN, Math.min(FAN_MAX, Math.round(pct)))
}))

ipcMain.handle('curve', (_e, curve: Curve | null) => guard(() => (curve ? startCurve(curve) : stopCurve())))

type SettingKey = 'fanControlBoard' | 'fanControlSoftware' | 'bootEffectMemory' | 'bootEffectFixed' | 'selfCheckOn' | 'selfCheckOff'
ipcMain.handle('setting', (_e, key: SettingKey) => guard(async () => {
  if (!(key in CMD)) throw new Error(`unknown setting ${key}`)
  if (key === 'fanControlBoard') stopCurve(false)
  hub.write(native([...CMD[key]]))
}))

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 760, minWidth: 900, minHeight: 600,
    backgroundColor: '#0B1120', title: 'Umbra Control', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
  win.on('closed', () => { win = null })
}

app.whenReady().then(() => {
  createWindow()
  setInterval(() => { state.cpu = cpuTemp(); push() }, 1000)
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  stopAnimation()
  try { stopCurve() } catch { /* hub gone */ }
  hub.close()
})
