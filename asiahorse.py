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
  asiahorse.py fan 10-100          # fan PWM speed, percent (FB)
  asiahorse.py effect breath bright=40 00FFFF  # built-in hub effect (03)
  asiahorse.py animate wave 00A0FF A000FF      # software animation, Ctrl-C stops
  asiahorse.py fan-curve 40:20,55:45,62:70,66:100  # fan speed on CPU temp
  asiahorse.py fan-control board|software    # who drives fan speed (08)
  asiahorse.py lights hardware|software      # who drives the LEDs (FD)
  asiahorse.py boot-effect memory|fixed      # power-on lighting (0B)
  asiahorse.py self-check on|off             # power-on LED self-check (0C)

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


def led_total(ports: list) -> int:
    return sum(ports) or PORTS * 12  # topology unreadable: assume fans, still paint


def stream_frame(h, leds: list) -> int:
    """One frame: every LED of every port, in port order 0-9."""
    count = -(-len(leds) // LEDS_PER_PACKET)
    sent = 0
    for idx in range(count):
        chunk = leds[idx * LEDS_PER_PACKET:(idx + 1) * LEDS_PER_PACKET]
        chunk += [(0, 0, 0)] * (LEDS_PER_PACKET - len(chunk))
        # Packet index is 1-BASED (plugin: sendDirectRgbPacket(packetCount,
        # packetIndex + 1, ...)) - index 0 makes the firmware drop off
        # the bus entirely. Found the hard way, 2026-08-25.
        sent += write(h, rgb_packet(count, idx + 1, chunk))
    return sent


def stream_color(h, ports: list, r: int, g: int, b: int, frames: int = 5) -> int:
    sent = 0
    for _ in range(frames):
        sent += stream_frame(h, [(r, g, b)] * led_total(ports))
        time.sleep(0.05)
    return sent


ANIMATIONS = ["rainbow", "wave", "breathe"]


def animation_frame(name: str, ports: list, t: float, colors: list, speed: float = 1.0) -> list:
    """Software animations (computed here, streamed like the vendor "Screen" mode).
    Per-port position so each fan ring animates the same way."""
    import colorsys
    import math
    c1 = colors[0] if colors else (0, 160, 255)
    c2 = colors[1] if len(colors) > 1 else (160, 0, 255)
    leds = []
    for p, n in enumerate(ports if sum(ports) else [12] * PORTS):
        for i in range(n):
            x = i / n
            if name == "rainbow":
                rgb = colorsys.hsv_to_rgb((x + p / PORTS + t * 0.2 * speed) % 1.0, 1.0, 1.0)
                leds.append(tuple(round(v * 200) for v in rgb))  # no gamma: keep it below 255
            elif name == "wave":
                k = (math.sin(2 * math.pi * (x - t * 0.5 * speed)) + 1) / 2
                leds.append(tuple(round(a * k + b * (1 - k)) for a, b in zip(c1, c2)))
            else:  # breathe
                k = 0.05 + 0.95 * (math.sin(2 * math.pi * t * 0.25 * speed) + 1) / 2
                leds.append(tuple(round(a * k) for a in c1))
    return leds


def enter_software_mode(h):
    write(h, native(bytes([0xFD, 0x01])))  # software mode - hub re-enumerates!
    h.close()
    time.sleep(0.5)
    return stabilize()


def animate(h, ports: list, name: str, colors: list, speed: float = 1.0, fps: int = 30):
    """Streams until Ctrl-C. 4 packets x 30 fps for 72 LEDs stays well under the
    ~378 writes/s the vendor app was measured sustaining (SignalRGB plugin notes)."""
    t0 = time.time()
    try:
        while True:
            stream_frame(h, animation_frame(name, ports, time.time() - t0, colors, speed))
            time.sleep(1 / fps)
    except KeyboardInterrupt:
        pass


# Fan curve on the CPU temperature, like the vendor "Auto Speed" (CPU/GPU temp).
# Points are (deg C, percent); linear in between. Default tuned for a 1950X
# (AMD max 68 C): calm at idle, full speed before the limit.
DEFAULT_CURVE = [(40, 20), (55, 45), (62, 70), (66, 100)]


def curve_percent(curve: list, temp: float) -> int:
    if temp <= curve[0][0]:
        return curve[0][1]
    for (t1, p1), (t2, p2) in zip(curve, curve[1:]):
        if temp <= t2:
            return round(p1 + (p2 - p1) * (temp - t1) / (t2 - t1))
    return curve[-1][1]


def cpu_temp() -> float:
    """k10temp: Tdie when exposed (Threadripper 1st gen Tctl has a +27 C offset), else Tctl."""
    for d in glob.glob("/sys/class/hwmon/hwmon*"):
        try:
            if open(d + "/name").read().strip() != "k10temp":
                continue
            labels = {open(f).read().strip(): f.replace("_label", "_input")
                      for f in glob.glob(d + "/temp*_label")}
            path = labels.get("Tdie") or labels.get("Tctl")
            return int(open(path).read()) / 1000
        except (OSError, TypeError, ValueError):
            continue
    raise OSError("no k10temp sensor")


def fan_curve(h, curve: list, period: float = 2.0):
    """Fail-safe: an unreadable temperature sends 100 %."""
    last = None
    try:
        while True:
            try:
                temp = cpu_temp()
                pct = max(FAN_MIN, curve_percent(curve, temp))
            except OSError as e:
                temp, pct = None, FAN_MAX
                print("temperature unreadable, full speed:", e)
            if last is None or abs(pct - last) >= 3 or pct == FAN_MAX != last:
                try:
                    write(h, native(bytes([0xFB, pct])))
                except OSError:  # hub re-enumerated (e.g. lights switched to software mode)
                    h.close()
                    h = stabilize()
                    write(h, native(bytes([0xFB, pct])))
                print(f"{temp} C -> fan {pct} %")
                last = pct
            time.sleep(period)
    except KeyboardInterrupt:
        pass
    finally:
        # the hub keeps the last speed: never leave the fans slow when the curve stops
        write(h, native(bytes([0xFB, FAN_MAX])))
        print("curve stopped: fan 100 %")


# Settings commands, named after the vendor app (AsiaHorse UMBRA 3.5.5, see
# README "Vendor app command table"). Value meanings marked (?) are inferred
# from the app's UI code, not yet confirmed on hardware.
SETTINGS = {
    # 08 = fan speed control authority (app: argb_cp_mcu_fan_speed). Formerly
    # labelled "passthrough"; the vendor app names it fan speed control.
    "fan-control": {"board": bytes([0x08, 0x00]), "software": bytes([0x08, 0x01])},  # (?)
    # FD = lighting control authority (app: ARGB_MCU_C_changer); 01 = software
    # streaming (verified upstream), 00 = back to the hub's own effects (?)
    "lights": {"hardware": bytes([0xFD, 0x00]), "software": bytes([0xFD, 0x01])},
    "boot-effect": {"memory": bytes([0x0B, 0xFF]), "fixed": bytes([0x0B, 0x01])},
    "self-check": {"on": bytes([0x0C, 0xFF]), "off": bytes([0x0C, 0x01])},
}
FAN_MIN, FAN_MAX = 10, 100  # FB takes a percentage; the vendor slider floors at 10

# Built-in hub effects ("Sync Effect" page of the vendor app), id = list index.
EFFECTS = ["static", "rainbow", "gradient-rainbow", "breath", "breath-rainbow",
           "runway", "tile", "fade-out", "trail", "scan", "brick", "disco",
           "pulse", "flash", "address"]
DEFAULT_COLORS = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 255)]  # vendor defaults
EFFECT_BLOCK = 52


def effect_packet(effect: int, speed: int = 3, direction: int = 1, brightness: int = 60,
                  colors: list = None) -> bytes:
    """03 FF FF = same effect on every port (vendor ARGB_ten_effect(255, 255)).
    Block: effect id, speed 0-5 (0 fastest, vendor default 3), direction 0/1,
    brightness byte (percent x 2.55, vendor floor 10 %), 4 RGB colors, 0, zero padded."""
    cols = (list(colors or []) + DEFAULT_COLORS[len(colors or []):])[:4]
    if effect == 0:
        cols[1] = cols[0]  # the vendor app mirrors color 1 into color 2 for Static
    block = [effect, max(0, min(5, speed)), 1 if direction else 0,
             round(max(10, min(100, brightness)) * 2.55)]
    block += [c for rgb in cols for c in rgb] + [0]
    return native(bytes([0x03, 0xFF, 0xFF]) + bytes(block).ljust(EFFECT_BLOCK, b"\x00"))


def parse_effect_args(args: list) -> dict:
    """effect NAME [speed=0-5] [dir=0|1] [bright=10-100] [RRGGBB ...]"""
    opts = {"colors": []}
    keys = {"speed": "speed", "dir": "direction", "bright": "brightness"}
    for a in args:
        k, _, v = a.partition("=")
        if v and k in keys:
            opts[keys[k]] = int(v)
        else:
            opts["colors"].append(tuple(bytes.fromhex(a.lstrip("#"))))
    return opts


def main() -> int:
    args = sys.argv[1:]
    if not args or args[0] in ("help", "-h", "--help"):
        print(__doc__)
        print("hub effects:", " ".join(EFFECTS))
        print("software animations:", " ".join(ANIMATIONS))
        return 0 if args else 1
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
        elif cmd == "fan" and len(args) == 2:
            pct = max(FAN_MIN, min(FAN_MAX, int(args[1])))
            write(h, native(bytes([0xFB, pct])))
            print(f"fan speed {pct} % sent (needs fan-control software)")
        elif cmd == "animate" and len(args) >= 2 and args[1] in ANIMATIONS:
            opts = parse_effect_args(args[2:])
            ports = topology(h)
            h = enter_software_mode(h)
            print(f"animating {args[1]} on {led_total(ports)} LEDs, Ctrl-C to stop")
            animate(h, ports, args[1], opts["colors"], opts.get("speed", 1))
        elif cmd == "fan-curve":
            curve = DEFAULT_CURVE
            if len(args) == 2:
                curve = [tuple(int(v) for v in pt.split(":")) for pt in args[1].split(",")]
            import signal
            signal.signal(signal.SIGTERM, signal.default_int_handler)  # systemd stop = Ctrl-C
            write(h, native(SETTINGS["fan-control"]["software"]))
            print("fan curve", curve, "Ctrl-C to stop (fans go to 100 %)")
            fan_curve(h, curve)
        elif cmd == "effect" and len(args) >= 2 and args[1] in EFFECTS:
            opts = parse_effect_args(args[2:])
            write(h, native(SETTINGS["lights"]["hardware"]))  # hub drives the LEDs again
            time.sleep(0.2)
            write(h, effect_packet(EFFECTS.index(args[1]), **opts))
            print(f"effect {args[1]} sent {opts}")
        elif cmd in SETTINGS and len(args) == 2 and args[1] in SETTINGS[cmd]:
            write(h, native(SETTINGS[cmd][args[1]]))
            print(f"{cmd} {args[1]} sent")
        else:
            print("effects (hub): " + " ".join(EFFECTS))
            print("animations (software): " + " ".join(ANIMATIONS))
            print("animate NAME [speed=N] [RRGGBB ...] | fan-curve [40:20,55:45,62:70,66:100]")
            print("usage: asiahorse.py status | topology | color R G B | off | fan 10-100 |"
                  " effect NAME [speed=0-5] [dir=0|1] [bright=10-100] [RRGGBB ...] |"
                  " fan-control board|software | lights hardware|software |"
                  " boot-effect memory|fixed | self-check on|off")
            return 1
        return 0
    finally:
        h.close()


if __name__ == "__main__":
    sys.exit(main())
