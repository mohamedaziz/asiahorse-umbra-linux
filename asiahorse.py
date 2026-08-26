"""
asiahorse.py - AsiaHorse Umbra ARGB hub control for Linux.

Native Linux control (per-LED capable, 10 ports) for the AsiaHorse Umbra
ARGB hub - USB VID 0x1A86 PID 0xFE05, enumerates as "USBFAN" (QinHeng
CH55x). No official Linux support exists; this speaks the hub's own HID
protocol directly via /dev/hidraw. Python 3 stdlib only, no dependencies.

See README.md for full protocol documentation and the required udev rule.

Provenance: passthrough packets captured by u/idk_a_name_wtf
(r/ASIAHORSEGlobal, Wireshark); full protocol from maihcx's SignalRGB
plugin (github.com/maihcx/AsiaHorse-Umbra-ARGB-Hub-SignalRGB-Plugin);
Linux port, hidraw backend, and firmware quirks (1-based packet index,
mode-switch re-enumeration, frame latching, no-gamma diodes) found and
verified live by ToeTagger, August 2026 - a guy in Arkansas who wouldn't
stop digging - with Claude.

Usage:
  asiahorse.py status              # hub status (read-only)
  asiahorse.py topology            # per-port LED counts (read-only)
  asiahorse.py color R G B         # all LEDs one color (0-255 each)
  asiahorse.py off                 # all LEDs dark
  asiahorse.py passthrough on|off  # motherboard passthrough toggle
                                   # (labels per the original capture;
                                   # verify by eye, may be inverted)

Colors LATCH: the hub holds the last streamed frame with no refresh until
power loss (which restores the hub's built-in effects). The diodes have no
gamma - run saturated colors dark (amber is 200,110,10; 245,189,99 washes
to near-white).
"""
import glob
import os
import select
import sys
import time

VID, PID = 0x1A86, 0xFE05
REPORT_ID = 0x00
PAYLOAD = 64
LEDS_PER_PACKET = 20
PORTS = 10
PORT_RECORDS_OFFSET = 6
PORT_RECORD_SIZE = 5


def checksum(data: bytes) -> int:
    s = 0
    for b in data:
        s = (s + (b & 0xFF)) & 0xFF
    return s


def native(body: bytes) -> bytes:
    pkt = bytes([0x52, 0x42, (len(body) + 5) & 0xFF, 0x00]) + body
    pkt += bytes([checksum(pkt)])
    return pkt.ljust(PAYLOAD, b"\x00")


def rgb_packet(count: int, index: int, colors: list) -> bytes:
    pkt = bytes([0x88, count & 0xFF, index & 0xFF])
    for (r, g, b) in colors:
        pkt += bytes([r & 0xFF, g & 0xFF, b & 0xFF])
    pkt += bytes([checksum(pkt)])
    return pkt.ljust(PAYLOAD, b"\x00")


# Direct /dev/hidraw I/O (2026-08-25): the pip hidapi wheel on lostbits
# uses the libusb backend, which ignores the hidraw node the udev rule
# unlocked and demands raw-USB permissions we did not grant ("open
# failed"). The kernel hidraw interface is just file I/O - no library,
# no backend moods. First write byte is the report ID (0x00).
class Hub:
    def __init__(self):
        self.node = self._find_node()
        self.fd = os.open(self.node, os.O_RDWR)

    @staticmethod
    def _find_node() -> str:
        want = f"{VID:08X}:{PID:08X}"
        for p in glob.glob("/sys/class/hidraw/hidraw*/device/uevent"):
            try:
                txt = open(p).read().upper()
            except OSError:
                continue
            if "HID_ID" in txt and want in txt:
                return "/dev/" + p.split("/")[4]
        raise SystemExit(f"no hidraw node for {want} - hub unplugged, or udev rule missing?")

    def close(self):
        if self.fd is not None:
            try:
                os.close(self.fd)
            except OSError:
                pass
            self.fd = None


def open_hub() -> Hub:
    return Hub()


def stabilize(timeout: float = 10.0) -> Hub:
    """The FD 01 mode switch makes the hub drop off USB and re-enumerate
    (observed live: hidraw6 -> hidraw5). Worse, the old node can linger
    briefly, so a quick reopen grabs a corpse and the first write dies on
    it. Trust no clock: reopen and PING (status query) until the hub
    actually answers - proof of life before paint."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        h = None
        try:
            h = Hub()
            write(h, native(bytes([0x00])))
            if read_reply(h, 400):
                return h
            last = "no status reply"
        except (SystemExit, OSError) as e:
            last = e
        if h is not None:
            h.close()
        time.sleep(0.4)
    raise SystemExit(f"hub did not stabilize after mode switch ({last})")


def write(h: Hub, payload: bytes) -> int:
    return os.write(h.fd, bytes([REPORT_ID]) + payload)


def read_reply(h: Hub, timeout_ms: int = 500) -> bytes:
    r, _, _ = select.select([h.fd], [], [], timeout_ms / 1000.0)
    if not r:
        return b""
    return os.read(h.fd, PAYLOAD + 1)


def topology(h) -> list:
    """[(port_index, led_count)] for populated ports, port order."""
    write(h, native(bytes([0x01, 0xFF])))
    reply = read_reply(h)
    ports = [0] * PORTS
    if len(reply) >= PORT_RECORDS_OFFSET + PORTS * PORT_RECORD_SIZE:
        for i in range(PORTS):
            off = PORT_RECORDS_OFFSET + i * PORT_RECORD_SIZE
            led_count, idx = reply[off], reply[off + 3]
            if idx < PORTS:
                ports[idx] = led_count
    return ports


def stream_color(h, ports: list, r: int, g: int, b: int, frames: int = 5) -> int:
    total = sum(ports)
    if total == 0:
        total = PORTS * 12  # topology unreadable: assume fans, still paint
    import math
    count = math.ceil(total / LEDS_PER_PACKET)
    sent = 0
    for _ in range(frames):
        led_stream = [(r, g, b)] * total
        for idx in range(count):
            chunk = led_stream[idx * LEDS_PER_PACKET:(idx + 1) * LEDS_PER_PACKET]
            chunk += [(0, 0, 0)] * (LEDS_PER_PACKET - len(chunk))
            # Packet index is 1-BASED (plugin: sendDirectRgbPacket(packetCount,
            # packetIndex + 1, ...)) - index 0 makes the firmware drop off
            # the bus entirely. Found the hard way, 2026-08-25.
            sent += write(h, rgb_packet(count, idx + 1, chunk))
        time.sleep(0.05)
    return sent


PASSTHROUGH = {"on": bytes([0x08, 0x00]), "off": bytes([0x08, 0x01])}


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__.splitlines()[-2].strip())
        return 1
    h = open_hub()
    try:
        print("Opened:", h.node)
        cmd = args[0]
        if cmd == "status":
            write(h, native(bytes([0x00])))
            reply = read_reply(h)
            print("status reply:", reply.hex(" ") if reply else "(none)")
        elif cmd == "topology":
            ports = topology(h)
            for i, n in enumerate(ports):
                print(f"port {i}: {n} LEDs")
            print("total:", sum(ports))
        elif cmd == "color" and len(args) == 4:
            r, g, b = (max(0, min(255, int(v))) for v in args[1:4])
            ports = topology(h)
            print("topology:", ports, "total", sum(ports))
            write(h, native(bytes([0xFD, 0x01])))  # software mode - hub re-enumerates!
            h.close()
            time.sleep(0.5)
            h = stabilize()
            print("hub alive again as", h.node)
            n = stream_color(h, ports, r, g, b)
            print(f"streamed rgb({r},{g},{b}) — {n} bytes written")
        elif cmd == "off":
            ports = topology(h)
            write(h, native(bytes([0xFD, 0x01])))  # software mode - hub re-enumerates!
            h.close()
            time.sleep(0.5)
            h = stabilize()
            n = stream_color(h, ports, 0, 0, 0)
            print(f"all dark - {n} bytes written")
        elif cmd == "passthrough" and len(args) == 2 and args[1] in PASSTHROUGH:
            write(h, native(PASSTHROUGH[args[1]]))
            print(f"passthrough {args[1].upper()} sent (labels per the Reddit OP — verify by eye)")
        else:
            print("usage: asiahorse.py status | topology | color R G B | off | passthrough on|off")
            return 1
        return 0
    finally:
        h.close()


if __name__ == "__main__":
    sys.exit(main())
