// Turns raw flights into enriched flights + every stat, first, age figure and badge.
import {
  haversineKm, greatCirclePoints, crossesEquator, crossesDateLine, localToEpoch,
  addDays, continentOf, CONTINENTS, EARTH_CIRCUMFERENCE_KM, MOON_DISTANCE_KM,
} from './geo.js';

const DAY = 86400000;
const parseDate = s => new Date(s + 'T00:00:00Z');

// --- ages -----------------------------------------------------------------
export function ageAt(birth, date) {
  const b = parseDate(birth), d = parseDate(date);
  let y = d.getUTCFullYear() - b.getUTCFullYear();
  let m = d.getUTCMonth() - b.getUTCMonth();
  let dd = d.getUTCDate() - b.getUTCDate();
  if (dd < 0) { m -= 1; dd += new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)).getUTCDate(); }
  if (m < 0) { y -= 1; m += 12; }
  return { years: y, months: m, days: dd, totalDays: Math.round((d - b) / DAY) };
}
export function formatAge(a, short = false) {
  if (a.totalDays < 0) return 'before birth';
  const parts = [];
  if (a.years) parts.push(`${a.years}y`);
  if (a.months) parts.push(`${a.months}m`);
  if (a.days || parts.length === 0) parts.push(`${a.days}d`);
  if (short) return parts.join(' ');
  const long = [];
  if (a.years) long.push(`${a.years} year${a.years === 1 ? '' : 's'}`);
  if (a.months) long.push(`${a.months} month${a.months === 1 ? '' : 's'}`);
  if (a.days || long.length === 0) long.push(`${a.days} day${a.days === 1 ? '' : 's'}`);
  return long.join(', ');
}

// --- enrich ---------------------------------------------------------------
export function enrichFlights(data, airports) {
  const flights = data.flights.map((f, idx) => {
    const from = airports[f.from], to = airports[f.to];
    if (!from || !to) throw new Error(`Unknown airport code in flight ${f.flight || idx}: ${!from ? f.from : f.to}`);
    const km = f.distance_km ?? Math.round(haversineKm(from, to));
    let durationMin = f.duration_min ?? null;
    let depEpoch = null, arrEpoch = null;
    let arrDate = f.arr_date || null;
    if (f.dep_time && f.arr_time) {
      if (!arrDate) arrDate = f.arr_time < f.dep_time ? addDays(f.date, 1) : f.date;
      depEpoch = localToEpoch(f.date, f.dep_time, from.tz);
      arrEpoch = localToEpoch(arrDate, f.arr_time, to.tz);
      if (durationMin == null) durationMin = Math.round((arrEpoch - depEpoch) / 60000);
      if (durationMin <= 0) durationMin = Math.round((arrEpoch + DAY - depEpoch) / 60000);
    }
    const durationEstimated = durationMin == null;
    if (durationEstimated) durationMin = Math.round(35 + km / 800 * 60);
    const pts = greatCirclePoints(from, to);
    return {
      ...f, idx, fromAp: from, toAp: to, km, durationMin, durationEstimated,
      arrDate: arrDate || f.date, depEpoch, arrEpoch,
      international: from.k !== to.k,
      overnight: !!f.overnight || (arrDate != null && arrDate > f.date),
      longHaul: durationMin >= 8 * 60,
      crossesEquator: crossesEquator(pts),
      crossesDateLine: crossesDateLine(from, to),
      fromContinent: continentOf(from.k), toContinent: continentOf(to.k),
      age: data.birthdate ? ageAt(data.birthdate, f.date) : null,
      onBirthday: data.birthdate ? f.date.slice(5) === data.birthdate.slice(5) && f.date > data.birthdate : false,
      points: pts,
    };
  });
  flights.sort((a, b) => a.date.localeCompare(b.date) || (a.dep_time || '').localeCompare(b.dep_time || '') || a.idx - b.idx);
  flights.forEach((f, i) => f.seq = i + 1);
  return flights;
}

// --- road trips -------------------------------------------------------------
// A drive goes from → (via …) → to. Each name is a key in data.places ({lat, lon, country}) or an airport code.
const ROAD_FACTOR = 1.3;   // roads wiggle: straight-line km × this when no real distance is given
const ROAD_KMH = 75;
function resolvePlace(ref, data, airports) {
  const p = data.places?.[ref];
  if (p) return { name: p.name || ref, lat: p.lat, lon: p.lon, country: p.country || '' };
  const ap = airports[ref];
  if (ap) return { name: ap.c, lat: ap.lat, lon: ap.lon, country: ap.k, airport: ref };
  throw new Error(`Unknown place in road trip: "${ref}" (add it to "places" in flights.json)`);
}
export function enrichDrives(data, airports) {
  const drives = (data.drives || []).map((d, idx) => {
    const stops = [d.from, ...(d.via || []), d.to].map(r => resolvePlace(r, data, airports));
    let straight = 0;
    const points = [[stops[0].lat, stops[0].lon]];
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1], b = stops[i];
      straight += haversineKm(a, b);
      for (let k = 1; k <= 24; k++) points.push([a.lat + (b.lat - a.lat) * k / 24, a.lon + (b.lon - a.lon) * k / 24]);
    }
    const kmEstimated = d.km == null;
    const km = kmEstimated ? Math.round(straight * ROAD_FACTOR) : d.km;
    const durationEstimated = d.duration_min == null;
    const durationMin = durationEstimated ? Math.round(km / ROAD_KMH * 60) : d.duration_min;
    return {
      ...d, kind: 'drive', idx, stops, fromPl: stops[0], toPl: stops[stops.length - 1], viaPl: stops.slice(1, -1),
      km, kmEstimated, durationMin, durationEstimated, arrDate: d.arr_date || d.date,
      age: data.birthdate ? ageAt(data.birthdate, d.date) : null,
      points,
    };
  });
  drives.sort((a, b) => a.date.localeCompare(b.date) || (a.dep_time || '').localeCompare(b.dep_time || '') || a.idx - b.idx);
  drives.forEach((d, i) => d.seq = i + 1);
  return drives;
}
// flights and drives together, in the order they happened
export function mergeLegs(flights, drives) {
  return [...flights, ...drives].sort((a, b) => a.date.localeCompare(b.date) || (a.dep_time || '').localeCompare(b.dep_time || ''));
}

// --- group into trips -----------------------------------------------------
export function groupTrips(flights, tripMeta = {}, drives = []) {
  const trips = [];
  const byName = new Map();
  let lastAuto = null;
  for (const f of mergeLegs(flights, drives)) {
    let key = f.trip;
    if (!key) {
      // auto-group: consecutive untitled flights within 3 days of each other
      if (lastAuto && (parseDate(f.date) - parseDate(lastAuto.end)) / DAY <= 3) key = lastAuto.name;
      else key = `Trip of ${f.date}`;
    }
    let t = byName.get(key);
    if (!t) {
      t = { name: key, flights: [], drives: [], legs: [], start: f.date, end: f.arrDate, meta: tripMeta[key] || {} };
      byName.set(key, t); trips.push(t);
    }
    t.legs.push(f);
    (f.kind === 'drive' ? t.drives : t.flights).push(f);
    if (f.arrDate > t.end) t.end = f.arrDate;
    if (!f.trip) lastAuto = t;
  }
  for (const t of trips) {
    t.stops = (t.meta.stops || []).map(st => ({ ...st, photos: st.photos || [] }));
    if (t.stops.length) {
      const ds = t.stops.flatMap(st => [st.from, st.to]).filter(Boolean).sort();
      if (ds.length) { if (ds[0] < t.start) t.start = ds[0]; if (ds[ds.length - 1] > t.end) t.end = ds[ds.length - 1]; }
    }
    t.km = t.flights.reduce((s, f) => s + f.km, 0);
    t.minutes = t.flights.reduce((s, f) => s + f.durationMin, 0);
    t.roadKm = t.drives.reduce((s, d) => s + d.km, 0);
    t.roadMin = t.drives.reduce((s, d) => s + d.durationMin, 0);
    t.origin = t.legs[0].kind === 'drive' ? t.legs[0].fromPl.name : t.legs[0].fromAp.c;
    t.places = [...new Set(t.legs.map(l => l.kind === 'drive' ? l.toPl.name : l.toAp.c))];
    t.countries = [...new Set(t.legs.flatMap(l => l.kind === 'drive' ? [l.fromPl.country, l.toPl.country] : [l.fromAp.k, l.toAp.k]).filter(Boolean))];
  }
  return trips;
}

// --- aggregate stats ------------------------------------------------------
function countBy(items, keyFn) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (k == null) continue;
    const e = m.get(k) || { key: k, count: 0, first: it, items: [] };
    e.count++; e.items.push(it);
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.first.date.localeCompare(b.first.date));
}

export function computeStats(data, flights, drives = []) {
  const totalKm = flights.reduce((s, f) => s + f.km, 0);
  const totalMin = flights.reduce((s, f) => s + f.durationMin, 0);

  // airports with visit counts (an airport counts once per flight touching it)
  const airportVisits = new Map();
  for (const f of flights) {
    for (const [code, ap, when] of [[f.from, f.fromAp, f.date], [f.to, f.toAp, f.arrDate]]) {
      const e = airportVisits.get(code) || { code, ap, visits: 0, dates: [], firstDate: when };
      e.visits++; e.dates.push(when);
      if (when < e.firstDate) e.firstDate = when;
      airportVisits.set(code, e);
    }
  }
  const airports = [...airportVisits.values()].sort((a, b) => b.visits - a.visits);

  // cities visited = arrival cities (plus the first departure city — he was there)
  const cityFirst = new Map();
  const noteCity = (ap, when) => {
    const k = `${ap.c}, ${ap.k}`;
    const e = cityFirst.get(k) || { name: ap.c, country: ap.k, first: when, visits: 0 };
    e.visits++; if (when < e.first) e.first = when;
    cityFirst.set(k, e);
  };
  // airports only ever passed through (transit: true on the arriving flight) don't count as places or countries
  const transit = new Set(flights.filter(f => f.transit).map(f => f.to));
  flights.forEach((f, i) => { if (i === 0 && !transit.has(f.from)) noteCity(f.fromAp, f.date); if (!transit.has(f.to)) noteCity(f.toAp, f.arrDate); });
  // stops inside trips count as places too (a town reached by car or train)
  for (const [name, meta] of Object.entries(data.trips || {})) {
    const tripFlights = flights.filter(f => f.trip === name);
    const tripDrives = drives.filter(d => d.trip === name);
    const tripStart = tripFlights[0]?.date || tripDrives[0]?.date || '9999';
    for (const st of meta.stops || []) {
      if (!st.name) continue;
      const before = tripFlights.filter(f => !f.transit && (!st.from || f.arrDate <= st.from));
      const country = st.country || tripFlights.find(f => f.toAp.c === st.name)?.toAp.k || before[before.length - 1]?.toAp.k || tripFlights[0]?.toAp.k || tripDrives[0]?.toPl.country || '';
      const k = `${st.name}, ${country}`;
      if ([...cityFirst.keys()].some(key => key.toLowerCase() === k.toLowerCase())) continue;
      cityFirst.set(k, { name: st.name, country, first: st.from || tripStart, visits: 1, stop: true });
    }
  }
  // places reached by road count too (the end of each drive; via points are just waypoints)
  const hasCity = k => [...cityFirst.keys()].find(key => key.toLowerCase() === k.toLowerCase());
  for (const d of drives) {
    const pl = d.toPl, k = hasCity(`${pl.name}, ${pl.country}`);
    if (k) { const e = cityFirst.get(k); if (d.arrDate < e.first) e.first = d.arrDate; }
    else cityFirst.set(`${pl.name}, ${pl.country}`, { name: pl.name, country: pl.country, first: d.arrDate, visits: 1, road: true });
  }
  const cities = [...cityFirst.values()].sort((a, b) => a.first.localeCompare(b.first));

  const countryFirst = new Map();
  for (const f of flights) {
    for (const [ap, when] of [[f.fromAp, f.date], [f.toAp, f.arrDate]]) {
      if (transit.has(ap === f.fromAp ? f.from : f.to)) continue;
      const e = countryFirst.get(ap.k) || { name: ap.k, continent: continentOf(ap.k), first: when, visits: 0, cities: new Set() };
      if (when < e.first) e.first = when;
      e.cities.add(ap.c);
      countryFirst.set(ap.k, e);
    }
    // a visit = an arrival into the country
    if (!transit.has(f.to)) countryFirst.get(f.toAp.k).visits++;
  }
  // driving somewhere new adds the town to its country's stamp (and a new stamp if he drove over a border)
  for (const d of drives) {
    for (const [pl, when, arriving] of [[d.fromPl, d.date, false], [d.toPl, d.arrDate, true]]) {
      if (!pl.country) continue;
      let e = countryFirst.get(pl.country);
      if (!e) { e = { name: pl.country, continent: continentOf(pl.country), first: when, visits: arriving ? 1 : 0, cities: new Set() }; countryFirst.set(pl.country, e); }
      else if (arriving && d.fromPl.country && d.fromPl.country !== pl.country) e.visits++;
      if (when < e.first) e.first = when;
      if (arriving || !flights.length) e.cities.add(pl.name);
    }
  }
  const countries = [...countryFirst.values()].map(c => ({ ...c, cities: [...c.cities] }))
    .sort((a, b) => a.first.localeCompare(b.first));
  if (countries.length && countries[0].visits === 0) countries[0].visits = 1; // home country counts

  const continentsVisited = [...new Set(countries.map(c => c.continent))].filter(c => c !== 'Unknown');
  const airlines = countBy(flights, f => f.airline);
  const aircraft = countBy(flights, f => f.aircraft);
  const routes = countBy(flights, f => [f.from, f.to].sort().join('–'));

  const byKm = [...flights].sort((a, b) => b.km - a.km);
  const firsts = flights.length ? {
    flight: flights[0],
    international: flights.find(f => f.international) || null,
    overnight: flights.find(f => f.overnight) || null,
    longHaul: flights.find(f => f.longHaul) || null,
    equator: flights.find(f => f.crossesEquator) || null,
    dateLine: flights.find(f => f.crossesDateLine) || null,
    birthday: flights.find(f => f.onBirthday) || null,
    longest: byKm[0], shortest: byKm[byKm.length - 1],
    aircraft: aircraft.map(a => ({ name: a.key, flight: a.first })).sort((a, b) => a.flight.date.localeCompare(b.flight.date)),
    airlines: airlines.map(a => ({ name: a.key, flight: a.first })).sort((a, b) => a.flight.date.localeCompare(b.flight.date)),
    continents: continentsVisited.map(c => ({ name: c, date: countries.filter(k => k.continent === c).map(k => k.first).sort()[0] })).sort((a, b) => a.date.localeCompare(b.date)),
  } : null;

  // age-based
  let life = null;
  if (data.birthdate) {
    const today = new Date().toISOString().slice(0, 10);
    const age = ageAt(data.birthdate, today);
    const lifeMinutes = Math.max(1, age.totalDays * 1440);
    const lifeMonths = Math.max(1, age.totalDays / 30.4375);
    life = {
      ageNow: age,
      pctAirborne: totalMin / lifeMinutes * 100,
      kmPerMonth: totalKm / lifeMonths,
      flightsPerMonth: flights.length / lifeMonths,
      ageAtFirstFlight: flights.length ? flights[0].age : null,
      daysOldAtFirstFlight: flights.length ? flights[0].age.totalDays : null,
    };
  }

  const perYear = countBy(flights, f => f.date.slice(0, 4)).map(y => ({
    year: y.key, flights: y.count,
    km: y.items.reduce((s, f) => s + f.km, 0),
    minutes: y.items.reduce((s, f) => s + f.durationMin, 0),
  })).sort((a, b) => a.year.localeCompare(b.year));

  // places on the road map: every drive end, sized by visits (airports already get their own pin)
  const placeVisits = new Map();
  drives.forEach((d, i) => {
    for (const [pl, when] of [...(i === 0 || drives[i - 1].toPl.name !== d.fromPl.name ? [[d.fromPl, d.date]] : []), [d.toPl, d.arrDate]]) {
      const e = placeVisits.get(pl.name) || { ...pl, visits: 0, dates: [] };
      e.visits++; e.dates.push(when);
      placeVisits.set(pl.name, e);
    }
  });
  const byRoadKm = [...drives].sort((a, b) => b.km - a.km);
  const road = {
    drives: drives.length,
    km: drives.reduce((s, d) => s + d.km, 0),
    minutes: drives.reduce((s, d) => s + d.durationMin, 0),
    first: drives[0] || null,
    longest: byRoadKm[0] || null,
    places: [...placeVisits.values()],
    newPlaces: cities.filter(c => c.road).length,
  };

  const stats = {
    flights: flights.length, totalKm, totalMin, road,
    airports, cities, countries, continentsVisited, airlines, aircraft, routes,
    firsts, life, perYear,
    comparisons: {
      aroundEarth: totalKm / EARTH_CIRCUMFERENCE_KM,
      toMoon: totalKm / MOON_DISTANCE_KM,
      daysInSky: totalMin / 1440,
      hoursInSky: totalMin / 60,
    },
  };
  stats.badges = computeBadges(stats, flights, drives, data);
  return stats;
}

// --- badges -----------------------------------------------------------------
const nth = (arr, n) => arr.length >= n ? arr[n - 1] : null;
function thresholdBadge(id, name, desc, icon, list, n, dateOf) {
  const hit = nth(list, n);
  return { id, name, desc, icon, earned: !!hit, progress: Math.min(list.length, n), target: n, date: hit ? dateOf(hit) : null };
}
function cumulativeBadge(id, name, desc, icon, flights, valueOf, target, unit) {
  let run = 0, date = null;
  for (const f of flights) { run += valueOf(f); if (run >= target && !date) date = f.date; }
  return { id, name, desc, icon, earned: !!date, progress: Math.min(run, target), target, unit, date };
}

export function computeBadges(s, flights, drives = [], data = {}) {
  const fDate = f => f.date;
  const inhabited = CONTINENTS.filter(c => c !== 'Antarctica');
  const firstAtContinentCount = n => {
    const seen = new Set();
    for (const f of flights) {
      seen.add(f.fromContinent); seen.add(f.toContinent); seen.delete('Unknown');
      if (seen.size >= n) return f.date;
    }
    return null;
  };
  const b = [];
  b.push({ id: 'first', name: 'Wings', desc: 'Took his first flight', icon: '🛫', earned: !!s.firsts, progress: Math.min(1, flights.length), target: 1, date: s.firsts?.flight.date });
  b.push(thresholdBadge('f10', 'Frequent flyer', 'Ten flights', '✈️', flights, 10, fDate));
  b.push(thresholdBadge('f25', 'Seasoned traveller', 'Twenty-five flights', '🧳', flights, 25, fDate));
  b.push(thresholdBadge('f50', 'Half century', 'Fifty flights', '🎖️', flights, 50, fDate));
  b.push(thresholdBadge('f100', 'Centurion', 'One hundred flights', '💯', flights, 100, fDate));
  b.push({ ...thresholdBadge('ap10', 'Airport collector', 'Ten different airports', '🏷️', [...s.airports].sort((a, b2) => a.firstDate.localeCompare(b2.firstDate)), 10, a => a.firstDate) });
  b.push({ ...thresholdBadge('al5', 'Loyal to no one', 'Five different airlines', '🎫', s.firsts?.airlines || [], 5, a => a.flight.date) });
  b.push({ ...thresholdBadge('ac5', 'Plane spotter', 'Five different aircraft types', '🔭', s.firsts?.aircraft || [], 5, a => a.flight.date) });
  b.push({ ...thresholdBadge('c5', 'Passport pages', 'Five countries', '🛂', s.countries, 5, c => c.first) });
  b.push({ ...thresholdBadge('c10', 'Globetrotter', 'Ten countries', '🌍', s.countries, 10, c => c.first) });
  b.push({ id: 'intl', name: 'Border crosser', desc: 'First international flight', icon: '🛃', earned: !!s.firsts?.international, progress: s.firsts?.international ? 1 : 0, target: 1, date: s.firsts?.international?.date });
  b.push({ id: 'cont3', name: 'Three continents', desc: 'Set foot on three continents', icon: '🗺️', earned: !!firstAtContinentCount(3), progress: Math.min(3, s.continentsVisited.length), target: 3, date: firstAtContinentCount(3) });
  b.push({ id: 'cont6', name: 'Every continent', desc: 'All six inhabited continents', icon: '🌐', earned: inhabited.every(c => s.continentsVisited.includes(c)), progress: inhabited.filter(c => s.continentsVisited.includes(c)).length, target: 6, date: firstAtContinentCount(6) });
  b.push({ id: 'antarctica', name: 'Penguin club', 'desc': 'Antarctica. Seriously.', icon: '🐧', earned: s.continentsVisited.includes('Antarctica'), progress: s.continentsVisited.includes('Antarctica') ? 1 : 0, target: 1, date: s.firsts?.continents.find(c => c.name === 'Antarctica')?.date });
  b.push({ id: 'equator', name: 'Line crosser', desc: 'Crossed the equator', icon: '🌞', earned: !!s.firsts?.equator, progress: s.firsts?.equator ? 1 : 0, target: 1, date: s.firsts?.equator?.date });
  b.push({ id: 'dateline', name: 'Time traveller', desc: 'Crossed the international date line', icon: '🕰️', earned: !!s.firsts?.dateLine, progress: s.firsts?.dateLine ? 1 : 0, target: 1, date: s.firsts?.dateLine?.date });
  b.push({ id: 'redeye', name: 'Red-eye', desc: 'Flew through the night', icon: '🌙', earned: !!s.firsts?.overnight, progress: s.firsts?.overnight ? 1 : 0, target: 1, date: s.firsts?.overnight?.date });
  b.push({ id: 'longhaul', name: 'Long hauler', desc: 'A flight of eight hours or more', icon: '🛩️', earned: !!s.firsts?.longHaul, progress: s.firsts?.longHaul ? 1 : 0, target: 1, date: s.firsts?.longHaul?.date });
  b.push({ id: 'birthday', name: 'Birthday in the sky', desc: 'Flew on his birthday', icon: '🎂', earned: !!s.firsts?.birthday, progress: s.firsts?.birthday ? 1 : 0, target: 1, date: s.firsts?.birthday?.date });
  b.push(cumulativeBadge('km10k', '10,000 km', 'Ten thousand kilometres flown', '📏', flights, f => f.km, 10000, 'km'));
  b.push(cumulativeBadge('earth', 'Around the world', `Flew the circumference of the Earth (${EARTH_CIRCUMFERENCE_KM.toLocaleString()} km)`, '🌏', flights, f => f.km, EARTH_CIRCUMFERENCE_KM, 'km'));
  b.push(cumulativeBadge('km100k', '100,000 km', 'One hundred thousand kilometres', '🚀', flights, f => f.km, 100000, 'km'));
  b.push(cumulativeBadge('h24', 'A day in the sky', 'Twenty-four hours airborne', '⏱️', flights, f => f.durationMin, 1440, 'min'));
  b.push(cumulativeBadge('h100', 'A hundred hours', 'One hundred hours airborne', '⌛', flights, f => f.durationMin, 6000, 'min'));
  b.push({ id: 'widebody', name: 'Widebody', desc: 'Flew on a widebody jet (A330/A350/A380/747/767/777/787)', icon: '🛬', ...(() => {
    const f = flights.find(x => /A3[358]0|A380|7[4678]7|777/i.test(x.aircraft || ''));
    return { earned: !!f, progress: f ? 1 : 0, target: 1, date: f?.date };
  })() });
  b.push({ id: 'repeat', name: 'Regular', desc: 'Flew the same route five times', icon: '🔁', ...(() => {
    const r = s.routes.find(x => x.count >= 5);
    return { earned: !!r, progress: Math.min(5, s.routes[0]?.count || 0), target: 5, date: r ? r.items[4].date : null };
  })() });
  // on the road
  b.push({ id: 'road1', name: 'Road tripper', desc: 'Went on his first road trip', icon: '🚗', earned: drives.length > 0, progress: Math.min(1, drives.length), target: 1, date: drives[0]?.date });
  b.push({ id: 'longdrive', name: 'Are we there yet?', desc: 'A drive of three hours or more', icon: '🥱', ...(() => {
    const d = drives.find(x => x.durationMin >= 180);
    return { earned: !!d, progress: d ? 1 : 0, target: 1, date: d?.date };
  })() });
  b.push(cumulativeBadge('road1k', 'Wheels on the bus', 'One thousand kilometres by road', '🛣️', drives, d => d.km, 1000, 'km'));
  b.push(cumulativeBadge('road5k', 'Big lap', 'Five thousand kilometres by road', '🚐', drives, d => d.km, 5000, 'km'));
  b.push(...crewBadges(data, flights, drives));
  return b;
}

// --- travel crew -------------------------------------------------------------
// data.people: { "Mimi": { group: 'parents' | 'grandparents' | 'great-grandparents' | 'family' | 'friends', relation?, buddy?, note? } }
// A person can still be written inline on a trip or stop as { name, … }; inline details win over the registry.
export const normPerson = (x, people = {}) => { const p = typeof x === 'string' ? { name: x } : x; return { ...(people[p.name] || {}), ...p }; };
export const CREW_GROUPS = ['parents', 'grandparents', 'great-grandparents', 'family', 'friends'];
const eachDay = (from, to) => { const out = []; for (let t = +parseDate(from); t <= +parseDate(to); t += DAY) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
function stopCountry(t, st) {
  const before = t.flights.filter(f => !f.transit && (!st.from || f.arrDate <= st.from));
  return st.country || t.flights.find(f => f.toAp.c === st.name)?.toAp.k || before[before.length - 1]?.toAp.k || t.countries[0] || '';
}
export function computeCrew(trips, people = {}) {
  const crew = new Map();
  const get = x => {
    const p = normPerson(x, people);
    let e = crew.get(p.name);
    if (!e) { e = { ...p, group: CREW_GROUPS.includes(p.group) ? p.group : 'friends', adventures: [], daySet: new Set(), placeSet: new Set(), countrySet: new Set(), km: 0 }; crew.set(p.name, e); }
    return e;
  };
  for (const t of trips) {
    const nameOf = x => normPerson(x).name;
    // on the trip's own list, or on every single stop: they were there the whole way
    const whole = new Map((t.meta.with || []).map(x => [nameOf(x), x]));
    const stopLists = t.stops.map(st => st.with || []);
    if (stopLists.length) for (const x of stopLists[0]) if (stopLists.every(l => l.some(y => nameOf(y) === nameOf(x))) && !whole.has(nameOf(x))) whole.set(nameOf(x), x);
    for (const x of whole.values()) {
      const e = get(x);
      e.adventures.push({ trip: t, whole: true, stops: t.stops, from: t.start, to: t.end });
      eachDay(t.start, t.end).forEach(d => e.daySet.add(d));
      e.km += t.km + t.roadKm;
      if (t.stops.length) for (const st of t.stops) { e.placeSet.add(st.name); e.countrySet.add(stopCountry(t, st)); }
      else { t.places.filter(p => p !== t.origin).forEach(p => e.placeSet.add(p)); t.countries.forEach(c => e.countrySet.add(c)); }
    }
    // joined for some of the stops only: the days, places and countries of those stops count, but not the travel in between
    const partial = new Map();
    for (const st of t.stops) for (const x of st.with || []) {
      if (whole.has(nameOf(x))) continue;
      const e = get(x);
      if (!partial.has(e.name)) { const a = { trip: t, whole: false, stops: [], from: st.from || t.start, to: st.to || st.from || t.start }; partial.set(e.name, a); e.adventures.push(a); }
      const a = partial.get(e.name);
      a.stops.push(st);
      if (st.from && st.from < a.from) a.from = st.from;
      if ((st.to || st.from || '') > a.to) a.to = st.to || st.from;
      if (st.from) eachDay(st.from, st.to || st.from).forEach(d => e.daySet.add(d));
      e.placeSet.add(st.name); e.countrySet.add(stopCountry(t, st));
    }
  }
  return [...crew.values()].map(e => {
    const adv = e.adventures.sort((a, b) => a.from.localeCompare(b.from));
    return { ...e, adventures: adv, trips: adv.length, days: e.daySet.size, places: [...e.placeSet], countries: [...e.countrySet].filter(Boolean),
      first: adv[0].from, firstTrip: adv[0].trip.name, last: adv[adv.length - 1].to };
  }).sort((a, b) => CREW_GROUPS.indexOf(a.group) - CREW_GROUPS.indexOf(b.group) || b.trips - a.trips || b.days - a.days || a.first.localeCompare(b.first));
}

// stickers earned by who came along. Works from the raw data so the "next adventure" preview can use it too.
function crewBadges(data, flights, drives) {
  const people = data.people || {}, events = [];
  for (const [name, meta] of Object.entries(data.trips || {})) {
    const start = [...flights, ...drives].filter(l => l.trip === name).map(l => l.date).sort()[0];
    if (!start) continue;
    const add = (list, date) => { if (list?.length) events.push({ date, people: list.map(x => normPerson(x, people)) }); };
    add(meta.with, start);
    for (const st of meta.stops || []) add(st.with, st.from || start);
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  const once = (id, name, desc, icon, test) => { const hit = events.find(test); return { id, name, desc, icon, crew: true, earned: !!hit, progress: hit ? 1 : 0, target: 1, date: hit?.date || null }; };
  const has = (e, group) => e.people.some(p => p.group === group);
  // buddies in the order they first joined in (Mum and Dad are the home team, not buddies)
  const joined = [], seen = new Set();
  for (const e of events) for (const p of e.people) if (p.group !== 'parents' && !seen.has(p.name)) { seen.add(p.name); joined.push({ name: p.name, date: e.date }); }
  const biggest = events.reduce((n, e) => Math.max(n, e.people.length), 0), full = events.find(e => e.people.length >= 6);
  return [
    once('grandparent', 'Grandparent getaway', 'An adventure with a grandparent', '👵', e => has(e, 'grandparents')),
    once('fourgen', 'Four generations', 'A grandparent and a great-grandparent on the same adventure', '🌳', e => has(e, 'grandparents') && has(e, 'great-grandparents')),
    once('bestmate', 'Best mates', 'An adventure with his best mate', '👬', e => e.people.some(p => p.buddy)),
    { id: 'fullhouse', name: 'Full house', desc: 'Six or more people along on one adventure', icon: '🏡', crew: true, earned: !!full, progress: Math.min(biggest, 6), target: 6, date: full?.date || null },
    { ...thresholdBadge('crew10', 'Popular kid', 'Ten different travel buddies', '🎉', joined, 10, j => j.date), crew: true },
    { ...thresholdBadge('crew25', 'It takes a village', 'Twenty-five different travel buddies', '🏘️', joined, 25, j => j.date), crew: true },
  ];
}
