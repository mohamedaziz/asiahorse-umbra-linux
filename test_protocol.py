"""Protocol self-check without hardware or root: asiahorse.py talks to the
emulator's firmware logic directly (no /dev/uhid). Run: python3 test_protocol.py"""
import asiahorse
import umbra_emu


class FakeHub:
    node, fd = "fake", None

    def close(self):
        pass


def make_emulator(ports):
    emu = umbra_emu.Emulator.__new__(umbra_emu.Emulator)
    emu.ports, emu.software_mode, emu.passthrough, emu.fan = ports, False, None, None
    emu.effect = "-"
    emu.boot_mode, emu.self_check = 0xFF, 0xFF
    emu.pending, emu.frames, emu.leds, emu.log = {}, 0, [(0, 0, 0)] * sum(ports), []
    emu.replies, emu.reenumerations = [], 0
    emu.send = emu.replies.append
    emu.draw = lambda force=False: None

    def reenumerate(pause):
        emu.reenumerations += 1
        emu.pending.clear()
    emu.reenumerate = reenumerate
    return emu


def wire(emu):
    asiahorse.write = lambda h, p: emu.on_output(bytes([0]) + p) or len(p) + 1
    asiahorse.read_reply = lambda h, t=500: emu.replies.pop(0) if emu.replies else b""


def main():
    ports = [12, 12, 12, 0, 0, 0, 24, 0, 0, 0]
    emu = make_emulator(ports)
    wire(emu)
    h = FakeHub()

    assert asiahorse.checksum(b"\xff\x02") == 0x01
    assert asiahorse.topology(h) == ports

    asiahorse.write(h, asiahorse.native(bytes([0xFD, 0x01])))
    assert emu.software_mode and emu.reenumerations == 1

    asiahorse.stream_color(h, ports, 10, 20, 30, frames=2)
    assert emu.frames == 2 and emu.leds == [(10, 20, 30)] * sum(ports)

    # packets are 1-based: index 0 must crash the emulated firmware
    asiahorse.write(h, asiahorse.rgb_packet(1, 0, [(1, 2, 3)] * 20))
    assert not emu.software_mode and emu.reenumerations == 2

    # corrupted checksum is refused
    bad = bytearray(asiahorse.rgb_packet(1, 1, [(9, 9, 9)] * 20))
    bad[3 + 60] ^= 0xFF  # checksum byte
    asiahorse.write(h, bytes(bad))
    assert emu.leds[0] == (10, 20, 30)

    asiahorse.write(h, asiahorse.native(bytes([0xFB, 0x32])))
    assert emu.fan == 0x32

    asiahorse.write(h, asiahorse.native(asiahorse.SETTINGS["fan-control"]["software"]))
    assert emu.passthrough == 0x01
    asiahorse.write(h, asiahorse.native(asiahorse.SETTINGS["self-check"]["off"]))
    assert emu.self_check == 0x01
    asiahorse.write(h, asiahorse.native(bytes([0xFD, 0x01])))
    asiahorse.write(h, asiahorse.native(asiahorse.SETTINGS["lights"]["hardware"]))
    assert not emu.software_mode

    # settings commands carry the same wire format as the vendor app:
    # [report 0] 52 42 len 00 cmd val sum, len counting the report byte (app: agreement.py)
    pkt = bytes([0]) + asiahorse.native(bytes([0x0C, 0x01]))[:7]
    assert pkt[3] == 7 and pkt[7] == sum(pkt[:7]) % 256

    asiahorse.write(h, asiahorse.native(bytes([0x00])))
    st = emu.replies.pop()
    assert st[:2] == b"\x52\x42" and st[23] == 0xFF and st[24] == 0x01  # self-check off above
    assert st[25] == asiahorse.checksum(st[:25])
    # built-in effect: block layout as the vendor app builds it
    opts = asiahorse.parse_effect_args(["speed=1", "bright=40", "00ffff"])
    pkt = asiahorse.effect_packet(asiahorse.EFFECTS.index("static"), **opts)
    assert pkt[2] == 60 and pkt[4:7] == b"\x03\xff\xff"
    assert list(pkt[7:11]) == [0, 1, 1, 102]           # id, speed, dir default, 40 % x 2.55
    assert pkt[11:17] == b"\x00\xff\xff\x00\xff\xff"   # static mirrors color 1 into color 2
    assert pkt[59] == asiahorse.checksum(pkt[:59])
    asiahorse.write(h, pkt)
    assert emu.effect.startswith("static speed=1") and emu.leds[0] == (0, 102, 102)
    # fan curve interpolation and software animation frame shape
    c = asiahorse.DEFAULT_CURVE
    assert asiahorse.curve_percent(c, 30) == 20 and asiahorse.curve_percent(c, 99) == 100
    assert asiahorse.curve_percent(c, 47.5) == 32 and asiahorse.curve_percent(c, 64) == 85
    for name in asiahorse.ANIMATIONS:
        f = asiahorse.animation_frame(name, ports, 1.3, [(0, 160, 255)])
        assert len(f) == sum(ports) and all(0 <= v <= 255 for rgb in f for v in rgb)
    asiahorse.stream_frame(h, asiahorse.animation_frame("rainbow", ports, 0, []))
    assert emu.leds == asiahorse.animation_frame("rainbow", ports, 0, [])
    print("OK protocol self-check")


if __name__ == "__main__":
    main()
