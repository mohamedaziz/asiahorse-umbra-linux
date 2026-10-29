# AsiaHorse Umbra ARGB Hub — Linux Control

Native Linux control for the **AsiaHorse Umbra ARGB hub** (USB `1a86:fe05`,
enumerates as "USBFAN", QinHeng CH55x chip). AsiaHorse ships no Linux
software and OpenRGB does not support this hub — this tool speaks its HID
protocol directly through `/dev/hidraw`. Python 3 standard library only.

Verified working August 2026: full-color control of 124 LEDs across 10
ports on real hardware.

## Quick start

```bash
# one-time: let your user talk to the hub (then replug or: sudo udevadm trigger)
sudo cp 70-asiahorse.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules && sudo udevadm trigger

python3 asiahorse.py status          # read-only sanity check
python3 asiahorse.py topology        # per-port LED counts
python3 asiahorse.py color 113 230 207
python3 asiahorse.py off
```

## Protocol documentation

Everything below was cross-validated from two independent sources (a
Wireshark capture and a published SignalRGB plugin) plus live testing;
the checksum math reproduces both sources byte-for-byte.

**Transport:** USB HID, 65-byte output reports = report ID `0x00` + 64-byte
payload, zero-padded.

**Checksum:** 8-bit additive over all preceding packet bytes:
`sum = (sum + byte) & 0xFF`, appended as the final meaningful byte.

**Native command packet:**

```
52 42 <len> 00 <body...> <checksum>      len = body length + 5
```

| Body      | Meaning                                          |
|-----------|--------------------------------------------------|
| `00`      | Status query (hub replies with a `52 42` frame)  |
| `01 FF`   | Topology query (reply below)                     |
| `FD 01`   | Enter software-controlled RGB mode (see quirks!) |
| `08 00/01`| Fan speed control authority (see vendor table below; formerly labelled "passthrough") |

### Vendor app command table

Read from the official Windows app (AsiaHorse UMBRA 3.5.5, a PyInstaller
Python 3.8 build; its protocol module is named `agreement`), October 2026, for
interoperability. Only command bytes and their meaning are recorded here, no
vendor code. Names are the app's own function names; meanings are translated
from the app's Chinese log strings. Nothing below is verified on hardware
unless stated.

| Body | App name | Meaning | Values seen in the app |
|---|---|---|---|
| `FB n` | `ARGB_pwm_speed` | fan PWM speed | percent: slider floors at 10, presets 10/45/48/100 and 20/60/80/100 |
| `08 n` | `argb_cp_mcu_fan_speed` | fan speed control authority | `00` / `01` (motherboard sync toggle in the UI) |
| `FD n` | `ARGB_MCU_C_changer` | lighting control authority | `00` / `01` (`01` = software streaming, verified) |
| `0B n` | `argb_jiyi_on_effect` | power-on lighting | `FF` remembered effect (default), `01` fixed |
| `0C n` | `argb_on_off_kaijizijian` | power-on LED self-check | `FF` on, `01` off |
| `07` | `argb_auto_rgb_num` | auto-detect LED count | |
| `95 n` | `ARGB_SYNC_effect_NO` | built-in effect number | |
| `96 n` | `ARGB_SYNC_dengxiao_speed` | effect speed | |
| `97 n` | `ARGB_SYNC_fangxiang` | effect direction | |
| `99 n` | `ARGB_SYNC_liangdu` | brightness | |
| `9A rgb…` | `ARGB_SYNC_yanse` | effect colors (flattened RGB list) | |
| `9B` / `9C v rgb…` | `ARGB_SYNC_shiyin_*` | sound-reactive mode / level | |
| `9D n` | `ARGB_SYNC_speed` | (logged as a fan speed command) | |
| `9E rgb…` | `ARGB_SYNC_same_screen` | screen sync colors | |
| `03 order n + 52 bytes` | `ARGB_ten_effect` | per-device effect | |
| `02 id fn param` | `ARGB_dan_config` | per-device setting | |
| `04 sn rgb… sound` | `ARGB_SYNC_shiyin_vaule_argb` | sound-reactive frame | |
| `05 id 01` | `argb_fan_set` | select a device | |
| `06` | `argb_fan_light_off` | lights off | |
| `09` / `0A` | `argb_433peidui` / `argb_433qingchupeidui` | 433 MHz remote pair / unpair | |

**Never send blindly** (firmware and flash operations): `FF` `ARGB_BOOT`
(reboot into the bootloader), `FE` `ARGB_IAP` (firmware update), `FC`
`argb_fan_save` (save to flash and reboot), `FA` `argb_fan_reset`, `F9`
`argb_fan_save_effect`. This tool does not expose them.

The app also talks to `robobloq.cn` (firmware and app updates, serial number
registration): this Linux tool makes no network access.

**Topology reply:** ten 5-byte records starting at offset 6:
`[led_count, ?, ?, port_index, ?]` for ports 0–9.

**Direct RGB streaming packet:**

```
88 <packet_count> <packet_index> <20 x R,G,B> <checksum>
```

Frame = all ports' LEDs concatenated in port order 0–9, padded with black
to `packet_count * 20` slots. `packet_count = ceil(total_leds / 20)`.

## Hard-won quirks (read before coding against this)

1. **The packet index is 1-BASED.** Sending index 0 makes the firmware
   drop off the USB bus entirely. This cost us an evening.
2. **`FD 01` (software mode) makes the hub re-enumerate.** It disappears
   from USB and returns, possibly under a different hidraw node — and the
   *old* node can linger briefly, so a quick reopen can grab a corpse.
   Reopen and **ping with a status query until it answers** before
   streaming ("proof of life before paint").
3. **Colors latch.** The hub holds the last streamed frame indefinitely
   with zero refresh — event-driven control works fine. Power loss resets
   to the hub's built-in effects (a warm reboot does not: the hub is
   SATA-powered).
4. **The diodes have no gamma.** High-brightness mixed colors wash toward
   white; run saturated colors dark (true amber ≈ `200,110,10`, not
   `245,189,99`).
5. **Return-to-hardware-effects command: unknown.** `FD 00` is untried.
   A full power cycle restores the hub's own effects.
6. **The pip `hidapi` wheel may use the libusb backend**, which ignores
   hidraw permissions and fails to open the device. This tool avoids the
   problem by using `/dev/hidraw` directly — no dependencies.

## Credits

- **u/idk_a_name_wtf** (r/ASIAHORSEGlobal) — original Wireshark capture
  of the passthrough packets, proving the hub could be spoken to at all.
- **maihcx** — [SignalRGB plugin](https://github.com/maihcx/AsiaHorse-Umbra-ARGB-Hub-SignalRGB-Plugin)
  documenting the full protocol.
- **ToeTagger** — found the sources, supplied the hardware, eyeballed
  every color; a guy in Arkansas who wouldn't stop digging. Linux port
  and quirk hunting with **Claude**.

MIT licensed. If you port this into OpenRGB proper, the protocol notes
above are yours — that's the point.
