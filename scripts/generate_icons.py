"""
Generates crisp, anti-aliased RGBA PNG icons (16x16, 48x48, 128x128)
using Python standard library only (no Pillow required).
"""

import math
import os
import struct
import zlib


def write_png(filepath: str, width: int, height: int, rgba_rows: list[bytes]) -> None:
    def chunk(chunk_type: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
        return struct.pack("!I", len(data)) + chunk_type + data + struct.pack("!I", crc)

    raw = b"".join(b"\x00" + row for row in rgba_rows)
    ihdr = struct.pack("!IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png_bytes = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(filepath, "wb") as f:
        f.write(png_bytes)


def sd_rounded_box(px: float, py: float, bx: float, by: float, r: float) -> float:
    qx = abs(px) - bx + r
    qy = abs(py) - by + r
    return (
        math.hypot(max(qx, 0.0), max(qy, 0.0))
        + min(max(qx, qy), 0.0)
        - r
    )


def sd_segment(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    pax, pay = px - ax, py - ay
    bax, bay = bx - ax, by - ay
    denom = bax * bax + bay * bay
    h = max(0.0, min(1.0, (pax * bax + pay * bay) / denom)) if denom > 0 else 0.0
    return math.hypot(pax - bax * h, pay - bay * h)


def blend(dst: tuple[float, float, float, float], src: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    sa = src[3]
    da = dst[3]
    out_a = sa + da * (1.0 - sa)
    if out_a <= 1e-6:
        return (0.0, 0.0, 0.0, 0.0)
    out_r = (src[0] * sa + dst[0] * da * (1.0 - sa)) / out_a
    out_g = (src[1] * sa + dst[1] * da * (1.0 - sa)) / out_a
    out_b = (src[2] * sa + dst[2] * da * (1.0 - sa)) / out_a
    return (out_r, out_g, out_b, out_a)


def render_sample(nx: float, ny: float) -> tuple[float, float, float, float]:
    """Renders normalized icon coordinates in [-1, 1] x [-1, 1]."""
    color = (0.0, 0.0, 0.0, 0.0)

    # Rounded square badge with vibrant indigo-blue gradient
    d_box = sd_rounded_box(nx, ny, 0.88, 0.88, 0.34)
    if d_box < 0.02:
        t = max(0.0, min(1.0, (nx + ny + 1.6) / 3.2))
        r = 37 + (99 - 37) * t      # #2563EB -> #6366F1 -> #0EA5E9 sheen
        g = 99 + (179 - 99) * t
        b = 235 + (237 - 235) * t
        box_a = max(0.0, min(1.0, (0.01 - d_box) / 0.03))
        color = blend(color, (r, g, b, box_a))

        # Subtle inner highlight ring
        if abs(d_box + 0.05) < 0.035:
            ring_a = max(0.0, 1.0 - abs(d_box + 0.05) / 0.035) * 0.22 * box_a
            color = blend(color, (255.0, 255.0, 255.0, ring_a))

    # Crisp white checkmark centered slightly lower-left
    d_c1 = sd_segment(nx, ny, -0.44, 0.04, -0.10, 0.38)
    d_c2 = sd_segment(nx, ny, -0.10, 0.38, 0.46, -0.28)
    d_check = min(d_c1, d_c2) - 0.135
    if d_check < 0.03:
        check_a = max(0.0, min(1.0, (0.015 - d_check) / 0.035))
        color = blend(color, (255.0, 255.0, 255.0, check_a))

    # Small emerald AI sparkle dot at top-left
    d_spark = math.hypot(nx + 0.42, ny + 0.44) - 0.12
    if d_spark < 0.03:
        spark_a = max(0.0, min(1.0, (0.015 - d_spark) / 0.035))
        color = blend(color, (134.0, 239.0, 172.0, spark_a))

    return color


def generate_icon(filepath: str, size: int) -> None:
    samples = 4 if size <= 48 else 2
    rows: list[bytes] = []

    for y in range(size):
        row = bytearray(size * 4)
        for x in range(size):
            acc_r = acc_g = acc_b = acc_a = 0.0
            for sy in range(samples):
                for sx in range(samples):
                    px = (x + (sx + 0.5) / samples) / size * 2.0 - 1.0
                    py = (y + (sy + 0.5) / samples) / size * 2.0 - 1.0
                    r, g, b, a = render_sample(px, py)
                    acc_r += r * a
                    acc_g += g * a
                    acc_b += b * a
                    acc_a += a

            total = samples * samples
            out_a = acc_a / total
            if out_a > 1e-6:
                out_r = min(255, max(0, int(round(acc_r / acc_a))))
                out_g = min(255, max(0, int(round(acc_g / acc_a))))
                out_b = min(255, max(0, int(round(acc_b / acc_a))))
                out_a_byte = min(255, max(0, int(round(out_a * 255))))
            else:
                out_r = out_g = out_b = out_a_byte = 0

            idx = x * 4
            row[idx] = out_r
            row[idx + 1] = out_g
            row[idx + 2] = out_b
            row[idx + 3] = out_a_byte
        rows.append(bytes(row))

    write_png(filepath, size, size, rows)


def main() -> None:
    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
    os.makedirs(out_dir, exist_ok=True)
    for size in (16, 48, 128):
        path = os.path.join(out_dir, f"icon-{size}.png")
        generate_icon(path, size)
        print(f"Generated {path} ({size}x{size})")


if __name__ == "__main__":
    main()
