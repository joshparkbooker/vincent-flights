"""Convert OpenFlights airports.dat into a compact JSON keyed by IATA code.
Usage: python3 -I scripts/build_airports.py /path/to/airports.dat data/airports.json
"""
import csv, json, sys

src, dst = sys.argv[1], sys.argv[2]
out = {}
with open(src, newline='', encoding='utf-8') as f:
    for row in csv.reader(f):
        if len(row) < 12: continue
        _id, name, city, country, iata, icao, lat, lon, _alt, _tz, _dst, tzname = row[:12]
        if iata in ('', '\\N') or len(iata) != 3: continue
        try:
            lat, lon = float(lat), float(lon)
        except ValueError:
            continue
        out[iata] = {
            "n": name, "c": city, "k": country,
            "lat": round(lat, 4), "lon": round(lon, 4),
            "tz": tzname if tzname != '\\N' else None,
        }
with open(dst, 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
print(f"wrote {len(out)} airports to {dst}")
