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
    /* ---- site mode: game only, fitted to the phone ---- */
    html, body { height: 100%; }
    body { background: #eef3e6; overflow: hidden; }
    .page { max-width: none; padding: 0; height: 100%; height: 100dvh; }
    .intro, .legend { display: none; }
    .stage { display: block; height: 100%; }
    .phone {
      background: none; border-radius: 0; padding: 0; box-shadow: none;
      width: 100%; max-width: 480px; height: 100%; margin: 0 auto;
    }
    .screen { border-radius: 0; height: 100%; min-height: 0; }
    .app-header { padding: max(8px, env(safe-area-inset-top)) 16px 6px; }
    .scene { flex: 1; min-height: 0; display: flex; justify-content: center; }
    .scene svg { width: 100%; height: 100%; }
    .tray { padding: 8px 16px; }
    .tray-item { height: 58px; }
    .status { padding: 6px 16px calc(8px + env(safe-area-inset-bottom)); min-height: 0; }
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
