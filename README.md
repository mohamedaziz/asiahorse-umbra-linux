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
sudo cp 99-asiahorse.rules /etc/udev/rules.d/
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
| `08 00`   | Motherboard passthrough "on" (per the capture)   |
| `08 01`   | Motherboard passthrough "off"                    |

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
