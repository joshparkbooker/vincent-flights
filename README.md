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

Top-level fields: `name`, `birthdate` (YYYY-MM-DD, drives all the age stats), `home`, an optional `passport` (`{"country": "Australia", "issued": "2026-03-27"}`, which makes that country's stamp show the issue date) and an optional `trips` object keyed by trip name with `emoji`, `notes` and `photos` (array of image URLs or paths).

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

## Next adventure countdown

Add trips that haven't happened yet to an `upcoming` array:

```json
"upcoming": [
  {
    "name": "Fiji holiday",
    "emoji": "🏝️",                 // optional
    "start": "2026-12-05",
    "end": "2026-12-14",            // optional
    "route": ["MEL", "NAN", "MEL"], // airport codes, or names from "places" for a drive
    "by": "plane",                  // or "car"
    "stops": [{ "name": "Nikoi Island", "country": "Indonesia" }],  // optional side trips; pinned on the map if the name is in "places"
    "with": ["Mum", "Dad"],         // optional
    "notes": "Pool, sand, repeat."  // optional
  }
]
```

The next one shows as a "sleeps to go" card above the map, all of them sit at the top of Adventures, and the route is drawn as a dashed line on the map. The card also lists any new places, countries and stickers the trip would add. A trip drops off by itself the day after it ends; log the real flights or drives then.

## Family password

The site asks for one shared password before it loads anything, and remembers a device once it has got in. Only a SHA-256 fingerprint of the password is in `index.html` (`window.VBA_GATE`). To change it:

```
printf 'vincent-flights:NEWPASSWORD' | shasum -a 256
```

and paste the result into `index.html` (lower case, since the check ignores case). Everyone will be asked again.

This keeps casual visitors and search engines out. It is not encryption: the repo is public, so the data file and photos can still be reached by anyone who goes looking for their direct addresses.

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

## Travel buddies

Trips and stops can list who came along with `"with": ["Mum", "Dad", "Mimi"]`. Each name gets a card on the Buddies tab, with a page of the adventures and photos they shared.

The top-level `people` object says who everyone is, which decides the section they appear in and their label:

```json
"people": {
  "Mimi": { "group": "grandparents" },
  "Uncle Marc": { "group": "family", "relation": "Uncle" },
  "Ollie": { "group": "friends", "buddy": true, "note": "Vincent's best mate, born the same year" }
}
```

`group` is one of `parents`, `grandparents`, `great-grandparents`, `family` or `friends`; a name that isn't listed counts as a friend. `parents` are the home team and sit out the buddy awards. Someone listed on the trip itself, or on every one of its stops, was there the whole way and gets the trip's kilometres; someone on only some stops gets those stops' days, places and photos.
