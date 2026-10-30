import { contextBridge, ipcRenderer } from 'electron'

// The only surface the window gets: no Node, no fs, no raw ipcRenderer.
const api = {
  refresh: () => ipcRenderer.invoke('refresh'),
  effect: (name: string, opts: object) => ipcRenderer.invoke('effect', name, opts),
  animate: (name: string, colors: number[][], speed: number) => ipcRenderer.invoke('animate', name, colors, speed),
  stopAnimation: () => ipcRenderer.invoke('stopAnimation'),
  frame: (leds: number[][], kind: 'canvas' | 'color') => ipcRenderer.invoke('frame', leds, kind),
  fan: (pct: number) => ipcRenderer.invoke('fan', pct),
  curve: (curve: [number, number][] | null) => ipcRenderer.invoke('curve', curve),
  setting: (key: string) => ipcRenderer.invoke('setting', key),
  onState: (cb: (s: unknown) => void) => {
    const h = (_e: unknown, s: unknown) => cb(s)
    ipcRenderer.on('state', h)
    return () => { ipcRenderer.removeListener('state', h) }
  },
}

contextBridge.exposeInMainWorld('umbra', api)
export type UmbraApi = typeof api
