# Umbra Control (desktop app)

Electron app for the AsiaHorse Umbra hub on Linux: the 15 built-in hub effects,
software animations, a fan curve editor on the CPU temperature, a per-LED
canvas and the hub settings. Same protocol as `../asiahorse.py`, ported to
TypeScript in `src/main/protocol.ts` (tests check both emit the same bytes).

The main process reads and writes `/dev/hidraw` directly (no native module);
the window gets a minimal API through the preload (context isolation, sandbox).
No network access.

## Run

```bash
pnpm install
node node_modules/electron/install.js   # pnpm 10 skips the Electron download script
pnpm dev                                 # or: pnpm build && pnpm start
pnpm test                                # protocol tests
```

Needs the udev rule from the repo root (`70-asiahorse.rules`). On Ubuntu
24.04+, Electron's sandbox needs the AppArmor profile in `apparmor/`.

Without the hub, run `sudo python3 ../umbra_emu.py` in another terminal.

## Safety

- Fan curve: unreadable temperature or curve stopped (including app quit) sets the fans to 100 %.
- Firmware commands (bootloader, firmware update, flash save, reset) are never sent.
- Opening a page never changes the hub: commands are only sent on an explicit action.
