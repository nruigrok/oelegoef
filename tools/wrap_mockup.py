#!/usr/bin/env python3
"""Wraps mockup/oelegoef-mockup.html (the Artifact page: a fragment starting with <title>
and <style>, no <html>/<head>/<body>) into a complete standalone page at
mockup/index.html, which the server serves as the site until the real client exists.

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

page = f"""<!doctype html>
<html lang="nl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <title>{title}</title>
  </head>
  <body>
{body}
  </body>
</html>
"""

with open(OUT, "w", encoding="utf-8") as f:
    f.write(page)
print(f"wrote {OUT} ({len(page) // 1024} KB)")
