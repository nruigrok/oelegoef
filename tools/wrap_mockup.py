#!/usr/bin/env python3
"""Wraps mockup/oelegoef-mockup.html (the Artifact page: a fragment starting with <title>
and <style>, no <html>/<head>/<body>) into a complete standalone page at
mockup/index.html, which the server serves as the site until the real client exists.

The Artifact page carries an intro, a legend and a phone frame around the game. The
site version hides all of that and shows only the game, sized to fit a phone screen
the way the Toby client does: one column, at most 480 px wide, scene scaled to the
remaining height.

  python3 tools/wrap_mockup.py
"""
import os
import re

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, "mockup", "oelegoef-mockup.html")
OUT = os.path.join(REPO, "mockup", "index.html")

with open(SRC, encoding="utf-8") as f:
    body = f.read()

title = re.search(r"<title>(.*?)</title>", body)
title = title.group(1) if title else "Oelegoef"
body = re.sub(r"\s*<title>.*?</title>", "", body, count=1)

SITE_CSS = """
    /* ---- site mode: game only, fitted to the phone ----
       Every box is pinned to its parent with position:absolute/fixed instead of percentage heights,
       because iOS Safari does not resolve height:100% reliably inside flex boxes; a fixed box with
       inset:0 always matches the visible viewport there, toolbars included. */
    html, body { height: 100%; overflow: hidden; overscroll-behavior: none; }
    body { background: #eef3e6; }
    .page { position: fixed; inset: 0; height: auto; max-width: none; padding: 0; margin: 0; }
    .intro, .legend { display: none; }
    .stage { position: absolute; inset: 0; display: block; }
    .phone {
      position: absolute; top: 0; bottom: 0; left: 0; right: 0; margin: 0 auto;
      width: 100%; max-width: 480px; height: auto;
      background: none; border-radius: 0; padding: 0; box-shadow: none;
    }
    .screen { position: absolute; inset: 0; border-radius: 0; height: auto; min-height: 0; display: flex; flex-direction: column; }
    .app-header { flex: 0 0 auto; padding: max(5px, env(safe-area-inset-top)) 14px 5px; gap: 3px 10px; }
    .stat-rows { gap: 3px; }
    .stat-row { grid-template-columns: 56px 1fr 26px; gap: 8px; font-size: 11.5px; }
    .stat-row b { font-size: 11.5px; }
    .bar { height: 9px; }
    .app-header .bell { width: 30px; height: 30px; font-size: 14px; }
    .scene { position: relative; flex: 1 1 0; min-height: 0; width: 100%; display: block; }
    .scene svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    .tray { flex: 0 0 auto; padding: 5px 14px calc(5px + env(safe-area-inset-bottom)); grid-auto-rows: 40px; gap: 8px; }
    .tray-item { height: auto; padding: 2px 4px 2px; font-size: 8.5px; }
    .tray-item svg { width: 24px; height: 19px; }
    .status { display: none; }
"""

page = f"""<!doctype html>
<html lang="nl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="color-scheme" content="light" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="theme-color" content="#eef3e6" />
    <link rel="icon" type="image/png" sizes="64x64" href="/favicon.png" />
    <link rel="icon" href="/favicon.ico" sizes="32x32" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <title>{title}</title>
  </head>
  <body>
{body}
    <style>{SITE_CSS}</style>
  </body>
</html>
"""

with open(OUT, "w", encoding="utf-8") as f:
    f.write(page)
print(f"wrote {OUT} ({len(page) // 1024} KB)")
