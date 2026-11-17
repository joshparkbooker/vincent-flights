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

// --- group into trips -----------------------------------------------------
export function groupTrips(flights, tripMeta = {}) {
  const trips = [];
  const byName = new Map();
  let lastAuto = null;
  for (const f of flights) {
    let key = f.trip;
    if (!key) {
      // auto-group: consecutive untitled flights within 3 days of each other
      if (lastAuto && (parseDate(f.date) - parseDate(lastAuto.end)) / DAY <= 3) key = lastAuto.name;
      else key = `Trip of ${f.date}`;
    }
    let t = byName.get(key);
    if (!t) {
      t = { name: key, flights: [], start: f.date, end: f.arrDate, meta: tripMeta[key] || {} };
      byName.set(key, t); trips.push(t);
    }
    t.flights.push(f);
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
    t.places = [...new Set(t.flights.map(f => f.toAp.c))];
    t.countries = [...new Set(t.flights.flatMap(f => [f.fromAp.k, f.toAp.k]))];
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

export function computeStats(data, flights) {
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
  flights.forEach((f, i) => { if (i === 0) noteCity(f.fromAp, f.date); noteCity(f.toAp, f.arrDate); });
  // stops inside trips count as places too (a town reached by car or train)
  for (const [name, meta] of Object.entries(data.trips || {})) {
    const tripFlights = flights.filter(f => f.trip === name);
    const tripStart = tripFlights[0]?.date || '9999';
    for (const st of meta.stops || []) {
      if (!st.name) continue;
      const country = st.country || tripFlights.find(f => f.toAp.c === st.name)?.toAp.k || tripFlights[tripFlights.length - 1]?.toAp.k || '';
      const k = `${st.name}, ${country}`;
      if ([...cityFirst.keys()].some(key => key.toLowerCase() === k.toLowerCase())) continue;
      cityFirst.set(k, { name: st.name, country, first: st.from || tripStart, visits: 1, stop: true });
    }
  }
  const cities = [...cityFirst.values()].sort((a, b) => a.first.localeCompare(b.first));

  const countryFirst = new Map();
  for (const f of flights) {
    for (const [ap, when] of [[f.fromAp, f.date], [f.toAp, f.arrDate]]) {
      const e = countryFirst.get(ap.k) || { name: ap.k, continent: continentOf(ap.k), first: when, visits: 0, cities: new Set() };
      if (when < e.first) e.first = when;
      e.cities.add(ap.c);
      countryFirst.set(ap.k, e);
    }
    // a visit = an arrival into the country
    const e = countryFirst.get(f.toAp.k); e.visits++;
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

  const stats = {
    flights: flights.length, totalKm, totalMin,
    airports, cities, countries, continentsVisited, airlines, aircraft, routes,
    firsts, life, perYear,
    comparisons: {
      aroundEarth: totalKm / EARTH_CIRCUMFERENCE_KM,
      toMoon: totalKm / MOON_DISTANCE_KM,
      daysInSky: totalMin / 1440,
      hoursInSky: totalMin / 60,
    },
  };
  stats.badges = computeBadges(stats, flights);
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

export function computeBadges(s, flights) {
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
  return b;
}
