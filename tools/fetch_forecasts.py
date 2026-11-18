"""Save a 14-day snowfall forecast for every resort to data/forecasts.json.

The globe fetches forecasts live from Open-Meteo when it can. Some hosts block
pages from calling other websites (the claude.ai artifact preview does), so the
page falls back to this saved snapshot and shows when it was taken.

Open-Meteo accepts many locations in one request, so this makes only a couple
of calls. It's free for non-commercial use and needs no API key.

Run from the repo root:  python3 tools/fetch_forecasts.py
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESORTS = ROOT / "data" / "ikon-resorts.json"
OUT = ROOT / "data" / "forecasts.json"

# Keep these in sync with FORECAST_PARAMS in app.js.
DAILY = "snowfall_sum,temperature_2m_max,temperature_2m_min,weather_code"
DAYS = 14
BATCH = 20  # locations per request


def get_json(url, tries=4):
    """GET JSON, retrying a few times on dropped connections or server errors."""
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ski-globe/0.1"})
            with urllib.request.urlopen(req, timeout=60) as res:
                return json.loads(res.read())
        except (urllib.error.URLError, ConnectionError, TimeoutError) as err:
            if attempt == tries - 1:
                raise
            print(f"  request failed ({err}); retrying…")
            time.sleep(3 * (attempt + 1))


def main():
    resorts = json.loads(RESORTS.read_text())["resorts"]
    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "source": "Open-Meteo (open-meteo.com)",
        "resorts": {},
    }
    for i in range(0, len(resorts), BATCH):
        batch = resorts[i:i + BATCH]
        params = urllib.parse.urlencode({
            "latitude": ",".join(str(r["lat"]) for r in batch),
            "longitude": ",".join(str(r["lng"]) for r in batch),
            "daily": DAILY,
            "timezone": "auto",
            "forecast_days": DAYS,
        })
        data = get_json(f"https://api.open-meteo.com/v1/forecast?{params}")
        if isinstance(data, dict):  # a single location comes back unwrapped
            data = [data]
        for resort, f in zip(batch, data):
            out["resorts"][resort["id"]] = {
                "elevation": f.get("elevation"),
                "timezone": f.get("timezone"),
                "daily": f["daily"],
            }
        print(f"  fetched {min(i + BATCH, len(resorts))}/{len(resorts)}")
        time.sleep(1)

    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(out['resorts'])} resorts, {OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
