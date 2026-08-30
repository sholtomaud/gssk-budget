#!/usr/bin/env python3
"""Render a GSSK model JSON to a standalone SVG using Odum ESL symbols.

    python3 tools/render-diagram.py docs/diagrams/household-overview.json

Reads node `visual.x` / `visual.y` / `visual.label` — the same layout block
gssk-dia writes — so a diagram edited in gssk-dia round-trips through here.

Carrier is encoded twice, by colour AND by stroke dash, because REQ-UI-8
forbids colour as the sole carrier of meaning.
"""

import json
import math
import sys
from pathlib import Path

R = 40  # symbol half-size; gssk-dia draws at translate(x-40, y-40) on a 80x80 box

CARRIER = {
    "money": {"colour": "#1a7f4b", "dash": "none", "label": "money"},
    "material": {"colour": "#b25e00", "dash": "7 4", "label": "material"},
    "energy": {"colour": "#b3261e", "dash": "2 4", "label": "energy"},
    "information": {"colour": "#1f5fa8", "dash": "12 3 2 3", "label": "information"},
}
DEFAULT = {"colour": "#555555", "dash": "none", "label": "unspecified"}


def carrier(name):
    return CARRIER.get(name or "", DEFAULT)


def symbol(node):
    """Odum ESL glyph, drawn in a 100x100 space translated to the node centre."""
    t = node["type"]
    if t == "source":
        return ('<path d="M25,60 Q15,60 15,50 Q15,35 30,35 Q35,20 50,20 '
                'Q65,20 70,35 Q85,35 85,50 Q85,60 75,60 L25,60 Z"/>')
    if t == "storage":
        return ('<path d="M30,20 L70,20 Q80,20 80,30 L80,70 Q80,80 70,80 '
                'L30,80 Q20,80 20,70 L20,30 Q20,20 30,20 Z"/>')
    if t == "sink":
        return ('<line x1="50" y1="18" x2="50" y2="58"/>'
                '<path d="M40,48 L50,58 L60,48"/>'
                '<line x1="30" y1="64" x2="70" y2="64"/>'
                '<line x1="35" y1="71" x2="65" y2="71"/>'
                '<line x1="40" y1="78" x2="60" y2="78"/>')
    if t == "constant":
        return '<rect x="30" y="30" width="40" height="40" transform="rotate(45 50 50)"/>'
    if t in ("exchange", "gain", "interaction", "switch", "loop_limited"):
        # Odum's work gate / transaction diamond
        return ('<circle cx="50" cy="50" r="22"/>'
                '<line x1="35" y1="35" x2="65" y2="65"/>'
                '<line x1="65" y1="35" x2="35" y2="65"/>')
    return '<rect x="25" y="25" width="50" height="50"/>'


def wrap(text, width=18):
    words, lines, cur = text.split(), [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return lines


def edge_path(a, b):
    """Trim the segment so it starts and ends on the glyph boundary, not the centre."""
    x1, y1 = a["visual"]["x"], a["visual"]["y"]
    x2, y2 = b["visual"]["x"], b["visual"]["y"]
    dx, dy = x2 - x1, y2 - y1
    d = math.hypot(dx, dy) or 1.0
    pad = R * 0.72
    return (x1 + dx / d * pad, y1 + dy / d * pad,
            x2 - dx / d * (pad + 8), y2 - dy / d * (pad + 8))


def render(model):
    nodes = {n["id"]: n for n in model["nodes"]}
    for n in model["nodes"]:
        n.setdefault("visual", {}).setdefault("x", 0)
        n["visual"].setdefault("y", 0)

    xs = [n["visual"]["x"] for n in model["nodes"]]
    ys = [n["visual"]["y"] for n in model["nodes"]]
    pad = 90
    minx, miny = min(xs) - pad, min(ys) - pad
    w = max(xs) - minx + pad
    h = max(ys) - miny + pad + 160  # room for the legend strip

    used = []
    for c in ("money", "material", "energy", "information"):
        if any(e.get("carrier") == c for e in model.get("edges", [])):
            used.append(c)

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{minx} {miny} {w} {h}" '
        f'width="{w}" height="{h}" font-family="ui-sans-serif, system-ui, sans-serif">',
        '<rect x="%g" y="%g" width="%g" height="%g" fill="#ffffff"/>' % (minx, miny, w, h),
        "<defs>",
    ]
    for c in list(CARRIER) + ["default"]:
        col = CARRIER.get(c, DEFAULT)["colour"]
        out.append(
            f'<marker id="ah-{c}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
            f'markerHeight="7" orient="auto-start-reverse">'
            f'<path d="M0,0 L10,5 L0,10 z" fill="{col}"/></marker>'
        )
    out.append("</defs>")

    md = model.get("metadata", {})
    out.append(
        f'<text x="{minx + 24}" y="{miny + 46}" font-size="30" font-weight="700" '
        f'fill="#111">{md.get("name", "GSSK model")}</text>'
    )

    for e in model.get("edges", []):
        a, b = nodes[e["origin"]], nodes[e["target"]]
        cinfo = carrier(e.get("carrier"))
        key = e.get("carrier") if e.get("carrier") in CARRIER else "default"
        x1, y1, x2, y2 = edge_path(a, b)
        dash = "" if cinfo["dash"] == "none" else f' stroke-dasharray="{cinfo["dash"]}"'
        out.append(
            f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="{cinfo["colour"]}" stroke-width="2.2"{dash} '
            f'marker-end="url(#ah-{key})" opacity="0.85"/>'
        )
        # control_node edges are read, never consumed — draw them as a thin dotted tap
        cn = (e.get("params") or {}).get("control_node")
        if cn and cn in nodes:
            c = nodes[cn]
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            out.append(
                f'<line x1="{c["visual"]["x"]}" y1="{c["visual"]["y"]}" x2="{mx:.1f}" '
                f'y2="{my:.1f}" stroke="#777" stroke-width="1.2" stroke-dasharray="1 5" '
                f'opacity="0.75"/>'
            )

    for n in model["nodes"]:
        v = n["visual"]
        col = carrier(n.get("carrier"))["colour"]
        fill = "#ffffff" if n["type"] != "constant" else "#f2f2f2"
        out.append(f'<g transform="translate({v["x"] - R},{v["y"] - R}) scale({2 * R / 100})">')
        out.append(f'<g fill="{fill}" stroke="{col}" stroke-width="2.6" '
                   f'stroke-linejoin="round" stroke-linecap="round">{symbol(n)}</g>')
        out.append("</g>")
        lines = wrap(v.get("label") or n["id"])
        for i, ln in enumerate(lines):
            out.append(
                f'<text x="{v["x"]}" y="{v["y"] + R + 18 + i * 14}" font-size="12.5" '
                f'text-anchor="middle" fill="#222">{escape(ln)}</text>'
            )
        out.append(
            f'<text x="{v["x"]}" y="{v["y"] - R - 7}" font-size="10.5" text-anchor="middle" '
            f'fill="#666" font-style="italic">{n["type"]}</text>'
        )

    ly = miny + h - 74
    out.append(f'<text x="{minx + 24}" y="{ly - 14}" font-size="13" font-weight="600" '
               f'fill="#333">Carrier (colour and dash both encode it — REQ-UI-8)</text>')
    lx = minx + 24
    for c in used:
        info = CARRIER[c]
        dash = "" if info["dash"] == "none" else f' stroke-dasharray="{info["dash"]}"'
        out.append(f'<line x1="{lx}" y1="{ly + 10}" x2="{lx + 46}" y2="{ly + 10}" '
                   f'stroke="{info["colour"]}" stroke-width="2.6"{dash}/>')
        out.append(f'<text x="{lx + 54}" y="{ly + 14}" font-size="12.5" fill="#333">'
                   f'{info["label"]}</text>')
        lx += 150
    out.append(f'<line x1="{lx}" y1="{ly + 10}" x2="{lx + 46}" y2="{ly + 10}" stroke="#777" '
               f'stroke-width="1.2" stroke-dasharray="1 5"/>')
    out.append(f'<text x="{lx + 54}" y="{ly + 14}" font-size="12.5" fill="#333">'
               f'control tap (read, not consumed)</text>')
    for i, ln in enumerate(wrap(md.get("description", ""), width=150)):
        out.append(f'<text x="{minx + 24}" y="{ly + 42 + i * 16}" font-size="12" fill="#555">'
                   f'{escape(ln)}</text>')
    out.append("</svg>")
    return "\n".join(out)


def escape(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    for arg in sys.argv[1:]:
        src = Path(arg)
        model = json.loads(src.read_text())
        dst = src.with_suffix(".svg")
        dst.write_text(render(model))
        print(f"{src} -> {dst}  ({len(model['nodes'])} nodes, {len(model.get('edges', []))} edges)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
