"""
umbra_emu.py - software emulator of the AsiaHorse Umbra hub (no hardware needed).

Creates a virtual HID device 1a86:fe05 "USBFAN" through the kernel's /dev/uhid,
so asiahorse.py finds it under /dev/hidraw* exactly like the real hub. The
emulator answers the native commands, reproduces the known firmware quirks
and draws the LEDs in the terminal.

It emulates the protocol as documented in README.md: if the real firmware (or
a V2 hub) behaves differently, only the real hub will tell.

Usage (needs root for /dev/uhid):
  sudo python3 umbra_emu.py [--ports 12,12,12,12,12,12,0,0,0,0]
Then, in another terminal:
  python3 asiahorse.py status | topology | color 0 120 255 | off
"""
import os
import select
import struct
import sys
import time

from asiahorse import (PID, PORTS, PAYLOAD, LEDS_PER_PACKET, VID,
                       PORT_RECORD_SIZE, PORT_RECORDS_OFFSET, checksum)

# linux/uhid.h
UHID_DESTROY, UHID_OUTPUT, UHID_CREATE2, UHID_INPUT2 = 1, 6, 11, 12
UHID_EVENT_SIZE = 4 + 4372  # u32 type + largest union member (uhid_create2_req)
BUS_USB = 0x03

# Vendor page 0xFF00 / usage 1, 64-byte input and output reports, no report ID
# (same usage page and usage as the SignalRGB plugin validates on the real hub).
REPORT_DESCRIPTOR = bytes([
    0x06, 0x00, 0xFF, 0x09, 0x01, 0xA1, 0x01,
    0x09, 0x01, 0x15, 0x00, 0x26, 0xFF, 0x00, 0x75, 0x08, 0x95, PAYLOAD, 0x81, 0x02,
    0x09, 0x01, 0x95, PAYLOAD, 0x91, 0x02,
    0xC0,
])

REENUMERATE_S = 1.0   # FD 01 / FC: the hub drops off USB and comes back
CRASH_DOWN_S = 5.0    # index 0 packet: the real hub drops off the bus; we come back
                      # after a pause (emulation choice) so a test run does not hang


def reply(body: bytes) -> bytes:
    """Native reply frame 52 42 <len> 00 <body> <checksum>, padded."""
    pkt = bytearray([0x52, 0x42, (len(body) + 5) & 0xFF, 0x00]) + body
    pkt += bytes([checksum(pkt)])
    return bytes(pkt).ljust(PAYLOAD, b"\x00")


class Emulator:
    def __init__(self, ports: list):
        self.ports = ports
        self.fd = os.open("/dev/uhid", os.O_RDWR)
        self.software_mode = False
        self.passthrough = None
        self.fan = None          # last FB value
        self.boot_mode = 0xFF    # 0xFF memory, 0x01 fixed
        self.self_check = 0xFF   # 0xFF enabled, 0x01 disabled
        self.pending = {}
        self.frames = 0
        self.leds = [(0, 0, 0)] * sum(ports)
        self.log = []
        self.last_draw = 0.0
        self.create()

    # --- uhid plumbing ---
    def create(self):
        ev = struct.pack("<I128s64s64sHHIIII", UHID_CREATE2, b"USBFAN (umbra_emu)",
                         b"umbra_emu/input0", b"", len(REPORT_DESCRIPTOR), BUS_USB,
                         VID, PID, 0x0100, 0) + REPORT_DESCRIPTOR
        os.write(self.fd, ev)

    def destroy(self):
        os.write(self.fd, struct.pack("<I", UHID_DESTROY))

    def send(self, data: bytes):
        os.write(self.fd, struct.pack("<IH", UHID_INPUT2, len(data)) + data)

    def reenumerate(self, pause: float):
        self.destroy()
        time.sleep(pause)
        self.pending.clear()
        self.create()

    # --- firmware ---
    def say(self, msg: str):
        self.log = (self.log + [time.strftime("%H:%M:%S ") + msg])[-8:]
        self.draw(force=True)

    def on_output(self, data: bytes):
        if len(data) == PAYLOAD + 1 and data[0] == 0x00:
            data = data[1:]  # report ID byte written by hidraw users
        if data[:2] == b"\x52\x42":
            self.native(data)
        elif data[:1] == b"\x88":
            self.rgb(data)
        else:
            self.say(f"unknown packet {data[:8].hex(' ')}")

    def native(self, data: bytes):
        n = data[2]
        if n < 5 or n > len(data) or checksum(data[:n - 1]) != data[n - 1]:
            return self.say(f"native: bad length/checksum {data[:n].hex(' ')}")
        body = data[4:n - 1]
        cmd = body[0]
        if cmd == 0x00:
            # boot mode at frame offset 23, self-check at 24, checksum at 25 (SignalRGB plugin)
            self.send(reply(bytes([0x00]) + bytes(18) + bytes([self.boot_mode, self.self_check])))
        elif body == b"\x01\xff":
            recs = b"".join(bytes([c, 0, 0, i, 0]) for i, c in enumerate(self.ports))
            assert PORT_RECORDS_OFFSET == 6 and len(recs) == PORTS * PORT_RECORD_SIZE
            self.send(reply(b"\x01\xff" + recs))
        elif body == b"\xfd\x01":
            self.say("FD 01 software mode: re-enumerating")
            self.reenumerate(REENUMERATE_S)
            self.software_mode = True
        elif body == b"\xfd\x00":
            self.software_mode = False
            self.say("FD 00 lights back to hardware effects (re-enumeration unknown)")
        elif cmd == 0xFB and len(body) == 2:
            self.fan = body[1]
            self.say(f"FB fan PWM speed = {body[1]} (0x{body[1]:02x})")
        elif cmd == 0xFC:
            self.say("FC save to flash + REBOOT")
            self.reenumerate(REENUMERATE_S)
            self.software_mode = False
        elif cmd == 0x07:
            self.say("07 auto-detect LED count")
        elif cmd == 0x08 and len(body) == 2:
            self.passthrough = body[1]
            self.say(f"08 fan speed control = {'software' if body[1] else 'board'} (?)")
        elif cmd in (0x0B, 0x0C) and len(body) == 2:
            if cmd == 0x0B:
                self.boot_mode = body[1]
            else:
                self.self_check = body[1]
            self.say(f"{cmd:02X} boot setting = {body[1]:02x}")
        else:
            self.say(f"native: unknown body {body.hex(' ')}")

    def rgb(self, data: bytes):
        count, index = data[1], data[2]
        end = 3 + LEDS_PER_PACKET * 3
        if checksum(data[:end]) != data[end]:
            return self.say(f"88 #{index}: bad checksum")
        if index == 0:
            self.say("88 index 0: FIRMWARE DROPS OFF THE BUS (real hub needs a replug)")
            self.reenumerate(CRASH_DOWN_S)
            self.software_mode = False
            return
        if not self.software_mode:
            self.say("88 frame while not in software mode (FD 01 missing?)")
        self.pending[index] = [tuple(data[3 + i * 3:6 + i * 3]) for i in range(LEDS_PER_PACKET)]
        if all(i in self.pending for i in range(1, count + 1)):
            stream = sum((self.pending[i] for i in range(1, count + 1)), [])
            self.leds = stream[:len(self.leds)]
            self.pending.clear()
            self.frames += 1
            self.draw()

    # --- display ---
    def draw(self, force: bool = False):
        now = time.time()
        if not force and now - self.last_draw < 1 / 20:
            return
        self.last_draw = now
        out = ["\x1b[H\x1b[2J umbra_emu  1a86:fe05  "
               f"mode={'software' if self.software_mode else 'hardware'}  "
               f"fan={self.fan if self.fan is not None else '-'}  frames={self.frames}\n"]
        pos = 0
        for p, n in enumerate(self.ports):
            if n:
                dots = "".join(f"\x1b[38;2;{r};{g};{b}m●" for r, g, b in self.leds[pos:pos + n])
                out.append(f" port {p}  {dots}\x1b[0m\n")
            pos += n
        out.append("\n" + "\n".join(" " + l for l in self.log) + "\n")
        sys.stdout.write("".join(out))
        sys.stdout.flush()

    def run(self):
        self.say(f"virtual hub up, ports {self.ports}")
        try:
            while True:
                select.select([self.fd], [], [])
                ev = os.read(self.fd, UHID_EVENT_SIZE)
                if struct.unpack_from("<I", ev)[0] == UHID_OUTPUT:
                    size = struct.unpack_from("<H", ev, 4 + 4096)[0]
                    self.on_output(ev[4:4 + size])
        except KeyboardInterrupt:
            pass
        finally:
            self.destroy()
            os.close(self.fd)


def main() -> int:
    ports = [12] * 6 + [0] * 4
    if len(sys.argv) == 3 and sys.argv[1] == "--ports":
        ports = [int(v) for v in sys.argv[2].split(",")]
    if len(ports) != PORTS:
        print(f"--ports needs {PORTS} comma-separated LED counts")
        return 1
    Emulator(ports).run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
