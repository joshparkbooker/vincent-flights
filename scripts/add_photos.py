#!/usr/bin/env python3
"""Add photos to a trip.

Usage:
  python3 scripts/add_photos.py "First trip to Noosa" photo1.jpg photo2.heic ...
  python3 scripts/add_photos.py "First trip to Noosa" --caption "Beach day" photo1.jpg
  python3 scripts/add_photos.py "First trip to Noosa" inbox/        # every image in a folder
  python3 scripts/add_photos.py "Japan" --stop "Kyoto" inbox/       # attach to a stop inside the trip
  python3 scripts/add_photos.py "Japan" --transit plane1.heic       # taken on the way (plane, airport, car)

Each photo is resized (max 1600px, JPEG) into photos/<trip-slug>/ with a 480px
thumbnail, and appended to trips["<name>"].photos in data/flights.json.
Photos added with --transit show under "In transit"; the rest show under
"At the destination". Re-running with --transit on a photo that is already
there moves it to "In transit".
Uses macOS `sips`, so it also handles HEIC from an iPhone. No other dependencies.
"""
import json, os, re, subprocess, sys, hashlib, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'flights.json')
IMG_EXT = {'.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.tif', '.tiff'}

def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-') or 'trip'

def sips(src, dst, max_px):
    subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82',
                    '-Z', str(max_px), src, '--out', dst],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def taken_date(src):
    """Best-effort capture date from EXIF via sips, else None."""
    try:
        out = subprocess.run(['sips', '-g', 'creation', src], capture_output=True, text=True).stdout
        m = re.search(r'creation:\s*(\d{4}):(\d{2}):(\d{2})', out)
        return f'{m.group(1)}-{m.group(2)}-{m.group(3)}' if m else None
    except Exception:
        return None

def main(argv):
    if len(argv) < 2:
        print(__doc__); sys.exit(1)
    trip = argv[0]
    caption = None
    stop = None
    transit = False
    files = []
    args = argv[1:]
    while args:
        a = args.pop(0)
        if a == '--caption':
            caption = args.pop(0)
        elif a == '--transit':
            transit = True
        elif a == '--stop':
            stop = args.pop(0)
        elif os.path.isdir(a):
            files += sorted(os.path.join(a, f) for f in os.listdir(a)
                            if os.path.splitext(f)[1].lower() in IMG_EXT)
        else:
            files.append(a)
    if not files:
        print('No image files given.'); sys.exit(1)

    data = json.load(open(DATA, encoding='utf-8'))
    known = {f.get('trip') for f in data['flights'] + data.get('drives', [])}
    if trip not in known:
        print(f'Warning: no flights or drives have trip "{trip}". Known trips: {sorted(k for k in known if k)}')
    trips = data.setdefault('trips', {})
    entry = trips.setdefault(trip, {})
    if stop:
        stops = entry.setdefault('stops', [])
        st = next((x for x in stops if x.get('name', '').lower() == stop.lower()), None)
        if st is None:
            st = {'name': stop}; stops.append(st)
            print(f'Created stop "{stop}" in "{trip}" (add from/to dates, emoji, notes in flights.json).')
        photos = st.setdefault('photos', [])
        folder = os.path.join(ROOT, 'photos', slug(trip), slug(stop))
    else:
        photos = entry.setdefault('photos', [])
        folder = os.path.join(ROOT, 'photos', slug(trip))
    existing = {p['src']: p for p in photos if isinstance(p, dict)}
    existing.update({p: None for p in photos if not isinstance(p, dict)})

    os.makedirs(folder, exist_ok=True)
    added = 0
    for src in files:
        if not os.path.isfile(src):
            print(f'skip (not a file): {src}'); continue
        h = hashlib.sha1(open(src, 'rb').read()).hexdigest()[:8]
        base = f'{slug(os.path.splitext(os.path.basename(src))[0])}-{h}'
        full = os.path.join(folder, base + '.jpg')
        thumb = os.path.join(folder, base + '-thumb.jpg')
        rel_full = os.path.relpath(full, ROOT)
        if rel_full in existing:
            old = existing[rel_full]
            if transit and old is not None and not old.get('transit'):
                old['transit'] = True; print(f'moved to In transit: {src}')
            else:
                print(f'already added: {src}')
            continue
        sips(src, full, 1600)
        sips(src, thumb, 480)
        p = {'src': rel_full, 'thumb': os.path.relpath(thumb, ROOT)}
        d = taken_date(src)
        if d: p['date'] = d
        if caption: p['caption'] = caption
        if transit: p['transit'] = True
        photos.append(p); added += 1
        print(f'added {rel_full} ({os.path.getsize(full)//1024} KB)')
    photos.sort(key=lambda p: (p.get('date') or '9999', p['src']) if isinstance(p, dict) else ('9999', p))

    with open(DATA, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False); f.write('\n')
    print(f'{added} photo(s) added to "{trip}"{" · " + stop if stop else ""}. Now commit photos/ and data/flights.json.')

if __name__ == '__main__':
    main(sys.argv[1:])
