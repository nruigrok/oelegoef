#!/usr/bin/env python3
"""Generates animation-overview.html: every cat state and transition, rendered at the
exact in-game scale (80x80 box, background-size:contain, image-rendering:pixelated,
matching style.css), one row per transition with all frames including the start/end
statics. Self-contained (embeds everything as data URIs) — just open the output file,
no server needed. Requires ffmpeg and Pillow.

Run from anywhere; paths are resolved relative to this script's location:
  python3 tools/gen_animation_overview.py
"""
import base64
import os
import subprocess
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(SCRIPT_DIR)
CAT_DIR = f"{REPO}/client/src/assets/cat"
OBJ_DIR = f"{REPO}/client/src/assets/objects"
OUT = f"{REPO}/animation-overview.html"


def b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def data_uri(path, mime="image/png"):
    return f"data:{mime};base64,{b64(path)}"


STATE_IMG = {
    "asleep": data_uri(f"{CAT_DIR}/asleep-southeast.png"),
    "lyingdown": data_uri(f"{CAT_DIR}/lyingdown-southeast.png"),
    "sitting": data_uri(f"{CAT_DIR}/sitting-southeast.png"),
    "dragged": data_uri(f"{CAT_DIR}/dragged-southeast.png"),
}

STATE_LABEL = {
    "asleep": "ASLEEP",
    "lyingdown": "LYINGDOWN",
    "sitting": "SITTING",
    "dragged": "DRAGGED",
}

_frame_cache = {}


def frame_uris(gif_name):
    """Extracts every frame of client/src/assets/cat/<gif_name>.gif via ffmpeg (Pillow's
    own GIF frame iterator has a stale-frame bug on some files — ffmpeg is reliable)."""
    if gif_name in _frame_cache:
        return _frame_cache[gif_name]
    with tempfile.TemporaryDirectory() as tmp_dir:
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", f"{CAT_DIR}/{gif_name}.gif", f"{tmp_dir}/frame_%03d.png"],
            check=True,
        )
        uris = [data_uri(os.path.join(tmp_dir, f)) for f in sorted(os.listdir(tmp_dir))]
    _frame_cache[gif_name] = uris
    return uris


def cat_cell(uri, label="", sitting_offset=False):
    cls = " sitting" if sitting_offset else ""
    caption = f'<div class="cap">{label}</div>' if label else ""
    return f'<div class="cell"><div class="cat{cls}" style="background-image:url({uri})"></div>{caption}</div>'


def state_cell(state_key, label=None):
    sitting = state_key == "sitting"
    return cat_cell(STATE_IMG[state_key], label or STATE_LABEL[state_key], sitting_offset=sitting)


def transition_row(title, subtitle, from_state, gif_name, to_state, duration_ms, note=None):
    cells = [state_cell(from_state)]
    for i, uri in enumerate(frame_uris(gif_name)):
        cells.append(cat_cell(uri, f"frame {i}"))
    cells.append(state_cell(to_state))
    note_html = f'<p class="note">{note}</p>' if note else ""
    return f"""
    <section class="row">
      <h2>{title}</h2>
      <p class="subtitle">{subtitle} &middot; {duration_ms}ms total</p>
      {note_html}
      <div class="strip">{''.join(cells)}</div>
    </section>
    """


def states_section():
    cells = [state_cell(k) for k in ["asleep", "lyingdown", "sitting", "dragged"]]
    return f"""
    <section class="row">
      <h2>States (static)</h2>
      <p class="subtitle">The four resting poses — no motion, no transform except SITTING's own offset.</p>
      <div class="strip">{''.join(cells)}</div>
    </section>
    """


def bowl_section():
    full = data_uri(f"{OBJ_DIR}/bowl_full.png")
    empty = data_uri(f"{OBJ_DIR}/bowl_empty.png")
    cells = "".join(
        f'<div class="cell"><div class="bowl" style="background-image:url({u})"></div><div class="cap">{l}</div></div>'
        for u, l in [(full, "FULL"), (empty, "EMPTY")]
    )
    return f"""
    <section class="row">
      <h2>Food bowl (static)</h2>
      <p class="subtitle">30x30px box, same contain/pixelated treatment.</p>
      <div class="strip">{cells}</div>
    </section>
    """


rows = []
rows.append(states_section())
rows.append(transition_row(
    "Startled awake", "ASLEEP &rarr; LYINGDOWN &middot; tap while asleep",
    "asleep", "startled-southeast", "lyingdown", 340,
))
rows.append(transition_row(
    "Drift off to sleep", "LYINGDOWN &rarr; ASLEEP &middot; auto after ~2.5s resting",
    "lyingdown", "driftoff-southeast", "asleep", 1700,
))
rows.append(transition_row(
    "Sit up", "LYINGDOWN &rarr; SITTING &middot; tap while resting, or noticing food",
    "lyingdown", "situp-southeast", "sitting", 340,
    note="Also used for the food-noticing sit-up (same asset, same timing).",
))
rows.append(transition_row(
    "Lie down", "SITTING &rarr; LYINGDOWN &middot; auto after ~3s sitting",
    "sitting", "liedown-southeast", "lyingdown", 3400,
    note="Reprocessed from assets_raw/cat_v2/liedown.gif with an interpolated scale (1.205x "
         "&rarr; 1.0x) and vertical shift (10.5px &rarr; 0px canvas-space) &mdash; it starts "
         "undersized and cropped like sitting-southeast.png's own too-low crop, but already "
         "ends up correctly sized and positioned like lyingdown &mdash; see assets_raw/reprocess_gif.py.",
))
rows.append(transition_row(
    "Picked up", "LYINGDOWN &rarr; DRAGGED &middot; grabbed by the player",
    "lyingdown", "picked-up-southeast", "dragged", 340,
    note="Can also start from ASLEEP or SITTING (design.md &sect;4) &mdash; this gif's first frame "
         "only matches LYINGDOWN, so grabbing from those two other states currently pops "
         "straight into this shape instead of easing from the actual starting pose.",
))
rows.append(transition_row(
    "Released", "DRAGGED &rarr; LYINGDOWN &middot; set down without feeding",
    "dragged", "released-southeast", "lyingdown", 1700,
))
rows.append(transition_row(
    "Eating", "SITTING &rarr; SITTING &middot; decided to eat the food",
    "sitting", "eat-southeast", "sitting", 1800,
    note="Loops 3x in-game (5400ms total) &mdash; one 9-frame cycle shown here. Ends back at "
         "SITTING (not LYINGDOWN), then follows the normal SITTING hold timer down. "
         "Reprocessed from assets_raw/cat_v2/eat.gif (scale 1.205x) to match SITTING's apparent size "
         "&mdash; see assets_raw/reprocess_gif.py.",
))
rows.append(transition_row(
    "Declining", "SITTING &rarr; SITTING &middot; decided not to eat",
    "sitting", "nope-southeast", "sitting", 3400,
    note="Ends back at SITTING (not LYINGDOWN), then follows the normal SITTING hold timer down. "
         "Reprocessed from assets_raw/cat_v2/nope.gif (scale 1.205x, and re-canvased from its "
         "original 132x132 onto the standard 140x128) &mdash; see assets_raw/reprocess_gif.py.",
))
rows.append(bowl_section())

html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Toby animation overview</title>
<style>
  body {{
    font-family: system-ui, sans-serif;
    background: #f2ede4;
    color: #333;
    padding: 1.5rem;
  }}
  h1 {{ margin-top: 0; }}
  h2 {{ margin-bottom: 0.1rem; font-size: 1.1rem; }}
  .subtitle {{ margin-top: 0; color: #666; font-size: 0.85rem; }}
  .note {{ margin: 0.3rem 0 0.6rem; color: #a15c00; font-size: 0.8rem; max-width: 70ch; }}
  section.row {{
    background: white;
    border-radius: 10px;
    padding: 0.75rem 1rem 1rem;
    margin-bottom: 1.25rem;
    box-shadow: 0 1px 2px rgba(0,0,0,0.08);
  }}
  .strip {{
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: flex-end;
    overflow-x: auto;
    padding-bottom: 4px;
  }}
  .cell {{
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
  }}
  .cat {{
    width: 80px;
    height: 80px;
    background-repeat: no-repeat;
    background-position: center;
    background-size: contain;
    image-rendering: pixelated;
    background-color: #e8e0d0;
    border-radius: 6px;
    border: 1px solid #ddd0b8;
  }}
  /* Matches #cat.sitting in style.css exactly. */
  .cat.sitting {{
    transform: translateY(-6px);
  }}
  .bowl {{
    width: 30px;
    height: 30px;
    background-repeat: no-repeat;
    background-position: center;
    background-size: contain;
    image-rendering: pixelated;
    background-color: #e8e0d0;
    border-radius: 6px;
    border: 1px solid #ddd0b8;
  }}
  .cap {{
    font-size: 0.6rem;
    color: #888;
    text-align: center;
    white-space: pre-line;
    margin-top: 2px;
    line-height: 1.1;
  }}
</style>
</head>
<body>
<h1>Toby &mdash; animation overview</h1>
<p class="subtitle">
  Generated reference of every cat state and transition, rendered in an 80&times;80px box with
  <code>background-size:contain</code> and <code>image-rendering:pixelated</code> &mdash; exactly how
  <code>#cat</code> renders in-game (style.css). The SITTING state's -6px offset is applied wherever
  the game actually applies it (the two static SITTING bookends), not to transition frames, since the
  game strips that class before any transition gif plays.
</p>
{''.join(rows)}
</body>
</html>
"""

with open(OUT, "w") as f:
    f.write(html)

print(f"wrote {OUT}, {os.path.getsize(OUT)} bytes")
