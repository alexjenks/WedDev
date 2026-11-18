"""Download each resort's logo from Wikipedia into img/logos/<id>.png.

For every resort in data/ikon-resorts.json this script:
  1. opens its English Wikipedia article (the "wiki" field),
  2. reads the "logo =" field of the article's info box, falling back to the
     logo recorded on Wikidata (property P154) for that article,
  3. downloads a 256px PNG rendering of that logo file, and
  4. pads it to a transparent square so it sits neatly in a round badge.

Resorts whose article has no logo are listed at the end; for those, save a
logo yourself as img/logos/<id>.png (the globe falls back to the website icon,
then initials).

Wikipedia asks API users to go slowly, so requests are batched, spaced out,
and the script waits whenever Wikipedia says "too many requests".

Run from the repo root:
    python3 tools/fetch_logos.py            # skip logos you already have
    python3 tools/fetch_logos.py --force    # re-download everything
Needs: Pillow.
"""

import argparse
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "ikon-resorts.json"
OUT = ROOT / "img" / "logos"
API = "https://en.wikipedia.org/w/api.php"
WIKIDATA = "https://www.wikidata.org/w/api.php"
USER_AGENT = "ski-globe-logo-fetcher/0.1 (hobby project; python-urllib)"
SIZE = 256
PAUSE = 1.0  # seconds between requests


def http_get(url, tries=12):
    """GET a URL, waiting and retrying when the server says to slow down."""
    for attempt in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                body = res.read()
            time.sleep(PAUSE)
            return body
        except urllib.error.HTTPError as err:
            if err.code in (429, 503) and attempt < tries - 1:
                wait = int(err.headers.get("Retry-After") or 0) or min(5 * 2 ** attempt, 120)
                print(f"  Wikipedia says slow down; waiting {wait}s…", flush=True)
                time.sleep(wait)
                continue
            raise


def api(base=API, **params):
    params = {"format": "json", "formatversion": "2", **params}
    return json.loads(http_get(f"{base}?{urllib.parse.urlencode(params)}"))


def chunks(items, n):
    for i in range(0, len(items), n):
        yield items[i:i + n]


def logo_field(wikitext):
    """Pull the file name out of an info box's `| logo = ...` line."""
    m = re.search(r"^\s*\|\s*logo\s*=\s*(.+?)\s*$", wikitext, re.MULTILINE | re.IGNORECASE)
    if not m:  # some info boxes put the logo in the image field
        m = re.search(r"^\s*\|\s*image\s*=\s*(.*logo.*?)\s*$", wikitext, re.MULTILINE | re.IGNORECASE)
    if not m:
        return None
    value = m.group(1)
    value = re.sub(r"^\[\[\s*(File|Image)\s*:", "", value, flags=re.IGNORECASE)  # [[File:X.svg|...]]
    value = re.sub(r"^(File|Image)\s*:", "", value, flags=re.IGNORECASE)
    value = value.split("|")[0].split("]]")[0].split("<!--")[0].strip()
    return value if re.search(r"\.(svg|png|jpe?g|gif)$", value, re.IGNORECASE) else None


def find_articles(resorts):
    """Map resort id -> resolved article title (following redirects)."""
    found = {}
    for batch in chunks(resorts, 40):
        data = api(action="query", redirects=1, titles="|".join(r["wiki"] for r in batch))
        q = data["query"]
        rename = {n["from"]: n["to"] for n in q.get("normalized", []) + q.get("redirects", [])}
        existing = {p["title"] for p in q["pages"] if not p.get("missing")}
        for r in batch:
            title = r["wiki"]
            while title in rename:
                title = rename[title]
            if title in existing:
                found[r["id"]] = title

    for r in resorts:
        if r["id"] not in found:
            print(f'  {r["name"]}: no Wikipedia article called "{r["wiki"]}"; fix its "wiki" field')
    return found


def find_logo_files(titles):
    """Map article title -> logo file name from its info box."""
    logos = {}
    for batch in chunks(sorted(set(titles)), 20):
        data = api(action="query", prop="revisions", rvprop="content", rvslots="main", titles="|".join(batch))
        for page in data["query"]["pages"]:
            revs = page.get("revisions")
            if revs:
                name = logo_field(revs[0]["slots"]["main"]["content"])
                if name:
                    logos[page["title"]] = name
    return logos


def find_wikidata_logos(titles):
    """Map article title -> logo file name from Wikidata's "logo image" (P154)."""
    logos = {}
    for batch in chunks(sorted(set(titles)), 40):
        data = api(base=WIKIDATA, action="wbgetentities", sites="enwiki", props="claims|sitelinks",
                   sitefilter="enwiki", titles="|".join(batch))
        for entity in data.get("entities", {}).values():
            title = entity.get("sitelinks", {}).get("enwiki", {}).get("title")
            claims = entity.get("claims", {}).get("P154", [])
            if title and claims:
                value = claims[0]["mainsnak"].get("datavalue", {}).get("value")
                if value:
                    logos[title] = value
    return logos


def find_image_urls(files):
    """Map file name -> URL of a PNG/JPEG rendering about SIZE px wide."""
    urls = {}
    for batch in chunks(sorted(set(files)), 40):
        data = api(action="query", prop="imageinfo", iiprop="url", iiurlwidth=SIZE,
                   titles="|".join(f"File:{f}" for f in batch))
        for page in data["query"]["pages"]:
            info = (page.get("imageinfo") or [None])[0]
            if info:
                urls[page["title"].split(":", 1)[1]] = info.get("thumburl") or info["url"]
    return urls


def save_square_png(raw, path):
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    bbox = im.getbbox()  # trim empty transparent edges
    if bbox:
        im = im.crop(bbox)
    im.thumbnail((SIZE, SIZE), Image.LANCZOS)
    side = max(im.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    square.save(path, optimize=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="re-download logos that already exist")
    args = parser.parse_args()

    resorts = json.loads(DATA.read_text())["resorts"]
    OUT.mkdir(parents=True, exist_ok=True)
    todo = [r for r in resorts if args.force or not (OUT / f'{r["id"]}.png').exists()]
    print(f"{len(resorts)} resorts, {len(todo)} to fetch")
    if not todo:
        return

    print("Finding articles…", flush=True)
    articles = find_articles(todo)
    print("Reading info boxes…", flush=True)
    logo_files = find_logo_files(articles.values())
    without = [t for t in articles.values() if t not in logo_files]
    if without:
        print("Checking Wikidata for the rest…", flush=True)
        logo_files.update(find_wikidata_logos(without))
    print("Looking up logo images…", flush=True)
    image_urls = find_image_urls(logo_files.values())

    saved, missing = [], []
    for r in todo:
        title = articles.get(r["id"])
        file = logo_files.get(title)
        url = image_urls.get(file)
        if not url:
            missing.append(f'{r["name"]} ({"no logo in " + title if title else "article not found"})')
            continue
        try:
            save_square_png(http_get(url), OUT / f'{r["id"]}.png')
            saved.append(r["name"])
            print(f'  ✓ {r["name"]}  ←  {file}', flush=True)
        except Exception as err:  # keep going if one image is odd
            missing.append(f'{r["name"]} (download failed: {err})')

    print(f"\nSaved {len(saved)} logos to {OUT.relative_to(ROOT)}/")
    if missing:
        print(f"No logo found for {len(missing)}:")
        for m in missing:
            print(f"  - {m}")


if __name__ == "__main__":
    sys.exit(main())
