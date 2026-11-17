# Vincent's Flight Log

A static site that tracks every flight Vincent has taken: a world map with great-circle arcs and an animated replay, lifetime stats, firsts, age-based figures, a pilot's logbook, passport stamps per country, trips, and badges.

No build step. Everything is computed in the browser from `data/flights.json`.

## Adding a flight

1. Open `add.html` on the live site (or locally), fill in the form, copy the JSON.
2. Paste it into the `flights` array in `data/flights.json` and commit.

Or just edit the JSON by hand. Each flight looks like:

```json
{
  "date": "2026-02-14",          // departure date, local
  "flight": "QF430",             // optional
  "from": "MEL",                 // IATA code (must exist in data/airports.json)
  "to": "SYD",
  "airline": "Qantas",           // optional
  "aircraft": "Boeing 737-800",  // optional, used for aircraft stats + widebody badge
  "dep_time": "09:00",           // optional, local time at origin
  "arr_time": "10:25",           // optional, local time at destination
  "arr_date": "2026-02-15",      // optional, only if arrival is on a later date
  "duration_min": 85,            // optional, overrides times; otherwise estimated from distance
  "seat": "14A",                 // optional
  "trip": "Sydney to meet the cousins",  // optional, groups flights into a trip
  "overnight": true              // optional, force the red-eye flag
}
```

Top-level fields: `name`, `birthdate` (YYYY-MM-DD, drives all the age stats), `home` and an optional `trips` object keyed by trip name with `emoji`, `notes` and `photos` (array of image URLs or paths).

Durations: if both times are given, the real duration is computed using each airport's time zone. If only distance is known, it's estimated at roughly 800 km/h plus taxi time and marked "est" in the logbook.

## Adding photos to a trip

Drop the photos (JPEG, PNG or iPhone HEIC) into `inbox/`, then:

```
python3 scripts/add_photos.py "First trip to Noosa" inbox/
```

Or name files directly, optionally with a caption that applies to all of them:

```
python3 scripts/add_photos.py "First trip to Noosa" --caption "Beach day" ~/Pictures/IMG_1234.HEIC
```

The script resizes each photo to 1600px (plus a 480px thumbnail) into `photos/<trip-slug>/`, reads the capture date from the file, and links it to the trip in `data/flights.json`. Commit `photos/` and `data/flights.json` and they appear on the Adventures tab with a lightbox. `inbox/` is ignored by git so originals never get committed. The trip name must match the `trip` field on the flights.

### Trips with several stops

A trip can list stops, each with its own dates, notes and photos. Flights still carry the trip name; stops are purely descriptive, so a town reached by car or train works too, and each stop counts as a place visited.

```json
"trips": {
  "Japan": {
    "emoji": "🗾",
    "notes": "Three weeks, two cities, one very tired toddler.",
    "stops": [
      { "name": "Tokyo", "from": "2026-09-01", "to": "2026-09-06", "emoji": "🗼", "notes": "...", "photos": [] },
      { "name": "Kyoto", "from": "2026-09-06", "to": "2026-09-10", "emoji": "⛩️", "photos": [] }
    ],
    "photos": []
  }
}
```

Add `"with": ["Mum", "Dad"]` to a trip or a stop to show who came along. A person can be an object, e.g. `{"name": "Ollie", "buddy": true, "note": "Vincent's best mate"}`, to mark a travel buddy.

Attach photos to a stop with `--stop`:

```
python3 scripts/add_photos.py "Japan" --stop "Kyoto" inbox/
```

Photos can also be hand-edited in the JSON as `{"src": "...", "thumb": "...", "caption": "...", "date": "YYYY-MM-DD"}` or a plain URL string.

## Road trips

Drives live in a `drives` array next to `flights`, and the towns they touch live in `places` (an airport code works as a place too, for a drive that starts at the airport):

```json
"places": {
  "Melbourne": { "lat": -37.8136, "lon": 144.9631, "country": "Australia" },
  "Lorne":     { "lat": -38.541,  "lon": 143.975,  "country": "Australia" }
},
"drives": [
  {
    "date": "2026-10-17",
    "from": "Melbourne",
    "to": "Lorne",
    "via": ["Torquay"],            // optional waypoints, only shape the line on the map
    "km": 142,                     // optional road distance; otherwise straight-line x 1.3, marked "est"
    "duration_min": 125,           // optional; otherwise estimated at 75 km/h, marked "est"
    "trip": "Great Ocean Road",    // optional, same trip names as flights, so a trip can mix both
    "vehicle": "Family car",       // optional
    "notes": "First beach nap"     // optional
  }
]
```

Drives show as dotted lines on the map (and in the replay), get their own logbook table, an "On the road" block on the Numbers tab and a few stickers. Where a drive ends counts as a place visited. Flight totals stay flight-only.

## Local preview

```
python3 -m http.server 8000
```

Then open http://localhost:8000. Modules and `fetch` need a server; opening `index.html` directly won't work.

## Airports data

`data/airports.json` is derived from [OpenFlights](https://openflights.org/data.html) (airports.dat, ODbL). Rebuild with:

```
python3 -I scripts/build_airports.py /path/to/airports.dat data/airports.json
```
