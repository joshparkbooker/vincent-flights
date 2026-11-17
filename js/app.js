import { enrichFlights, enrichDrives, mergeLegs, computeStats, groupTrips, formatAge, ageAt, computeCrew, normPerson } from './stats.js';
import { EARTH_CIRCUMFERENCE_KM, MOON_DISTANCE_KM } from './geo.js';

const $ = sel => document.querySelector(sel);
const fmtInt = n => Math.round(n).toLocaleString();
const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
const fmtDate = s => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDateLong = s => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
const fmtDur = m => { const h = Math.floor(m / 60), mm = m % 60; return h ? `${h}h ${String(mm).padStart(2, '0')}m` : `${mm}m`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

let DATA, FLIGHTS, DRIVES, LEGS, STATS, TRIPS, CREW, UPCOMING = [], WORLD, AIRPORTS, map, mapBuilt = false;
const airportsLon = code => AIRPORTS?.[code]?.lon;

async function main() {
  try {
    const [data, airports, world] = await Promise.all([
      fetch('data/flights.json', { cache: 'no-store' }).then(r => r.json()),
      fetch('data/airports.json').then(r => r.json()),
      fetch('data/world.geo.json').then(r => r.json()),
    ]);
    WORLD = world; AIRPORTS = airports;
    DATA = data;
    FLIGHTS = enrichFlights(data, airports);
    DRIVES = enrichDrives(data, airports);
    LEGS = mergeLegs(FLIGHTS, DRIVES);
    STATS = computeStats(data, FLIGHTS, DRIVES);
    TRIPS = groupTrips(FLIGHTS, data.trips || {}, DRIVES);
    CREW = computeCrew(TRIPS);
  } catch (e) {
    $('main').prepend(el(`<div class="error">Could not load flight data: ${esc(e.message)}</div>`));
    console.error(e);
    return;
  }
  document.title = `${DATA.name}'s Big Adventures`;
  $('#title').textContent = `${DATA.name}'s Big Adventures`;
  try { UPCOMING = computeUpcoming(); } catch (e) { console.error('Upcoming adventure skipped:', e); }
  renderHero();
  renderStats();
  renderCrew();
  renderLogbook();
  renderRoadbook();
  renderRoadStats();
  renderPassport();
  renderTrips();
  renderBadges();
  renderUpcoming();
  $('#datanote').textContent = `${FLIGHTS.length} flights${DRIVES.length ? ` and ${DRIVES.length} drive${DRIVES.length === 1 ? '' : 's'}` : ''} on record · last updated ${LEGS.length ? fmtDate(LEGS[LEGS.length - 1].date) : '—'}`;
  setupTabs();
}

// --- tabs -------------------------------------------------------------------
function setupTabs() {
  const show = () => {
    const id = (location.hash || '#map').slice(1);
    document.querySelectorAll('.tab').forEach(s => s.hidden = s.id !== `tab-${id}`);
    document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === id));
    if (id === 'map') { buildMap(); setTimeout(() => map.invalidateSize(), 50); }
  };
  addEventListener('hashchange', show);
  show();
}

// --- next adventure -----------------------------------------------------------
// data.upcoming: [{ name, start, end?, route: [place or airport code, …], by: 'plane' | 'car', emoji?, with?, notes? }]
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
function computeUpcoming() {
  const today = localToday();
  return (DATA.upcoming || []).filter(u => u.start && (u.end || u.start) >= today).sort((a, b) => a.start.localeCompare(b.start)).map(u => {
    const route = u.route || [], car = u.by === 'car';
    const planned = route.slice(1).map((to, i) => ({ from: route[i], to, trip: u.name, date: i > 0 && i === route.length - 2 && u.end ? u.end : u.start }));
    // pretend the trip has happened and see what changes: new places, countries and stickers
    // stops: places visited along the way without a flight or drive of their own, e.g. { name, country, place? }
    const stops = (u.stops || []).map(st => typeof st === 'string' ? { name: st } : st);
    const sim = { ...DATA, flights: [...DATA.flights, ...(car ? [] : planned)], drives: [...(DATA.drives || []), ...(car ? planned : [])],
      trips: { ...(DATA.trips || {}), [u.name]: { ...(DATA.trips?.[u.name] || {}), stops } } };
    const F = enrichFlights(sim, AIRPORTS), D = enrichDrives(sim, AIRPORTS), S = computeStats(sim, F, D);
    const legs = car ? D.filter(d => d.idx >= (DATA.drives || []).length) : F.filter(f => f.idx >= DATA.flights.length);
    const had = (list, c) => list.some(x => x.name === c.name && (x.country ?? '') === (c.country ?? ''));
    const nameOf = (l, end) => car ? l[end + 'Pl'].name : l[end + 'Ap'].c;
    const stopsAt = legs.length ? [nameOf(legs[0], 'from'), ...legs.map(l => nameOf(l, 'to'))] : [];
    return {
      ...u, car, legs, today, stops,
      stopPins: stops.map(st => ({ name: st.name, ...(DATA.places?.[st.place || st.name] || {}) })).filter(p => p.lat != null),
      sleeps: daysBetween(today, u.start),
      underway: u.start <= today,
      day: daysBetween(u.start, today) + 1, days: daysBetween(u.start, u.end || u.start) + 1,
      km: legs.reduce((n, l) => n + l.km, 0),
      routeNames: stopsAt.filter((n, i) => i === 0 || n !== stopsAt[i - 1]),
      newPlaces: S.cities.filter(c => !had(STATS.cities, c)),
      newCountries: S.countries.filter(c => !STATS.countries.some(x => x.name === c.name)),
      newBadges: S.badges.filter(b => b.earned && !STATS.badges.find(x => x.id === b.id)?.earned),
    };
  });
}
function upcomingCard(u, first) {
  const dates = !u.end || u.end === u.start ? fmtDateLong(u.start) : `${fmtDate(u.start)} – ${fmtDate(u.end)}`;
  const count = u.underway
    ? `<div class="next-count now"><b>🎉</b><span>${u.days > 1 ? `day ${u.day} of ${u.days}` : 'today!'}</span></div>`
    : `<div class="next-count"><b>${u.sleeps}</b><span>sleep${u.sleeps === 1 ? '' : 's'} to go</span></div>`;
  const extras = [
    ...u.newCountries.map(c => `🌍 new country: ${esc(c.name)}`),
    ...(u.newPlaces.length ? [`📍 ${u.newPlaces.length} new place${u.newPlaces.length === 1 ? '' : 's'}: ${u.newPlaces.map(c => esc(c.name)).join(', ')}`] : []),
    ...u.newBadges.map(b => `${b.icon} new sticker: ${esc(b.name)}`),
  ];
  return `<article class="next">
    ${count}
    <div class="next-body">
      <div class="next-kicker">${u.underway ? 'Happening right now' : first ? 'Next adventure' : 'After that'}</div>
      <h3>${u.emoji ? u.emoji + ' ' : ''}${esc(u.name)}</h3>
      <div class="next-sub">${dates}${u.routeNames.length ? ` · ${u.car ? '🚗' : '✈️'} ${u.routeNames.map(esc).join(' → ')}` : ''}${u.km ? ` · about ${fmtInt(u.km)} km` : ''}</div>
      ${u.stops.length ? `<div class="next-sub">📍 Stopping at ${u.stops.map(st => esc(st.name)).join(', ')}</div>` : ''}
      ${u.notes ? `<p class="notes">${esc(u.notes)}</p>` : ''}
      ${extras.length ? `<div class="next-unlocks">${extras.map(x => `<span>${x}</span>`).join('')}</div>` : ''}
      ${crewRow(u.with)}
    </div>
  </article>`;
}
function renderUpcoming() {
  const html = UPCOMING.map((u, i) => upcomingCard(u, i === 0)).join('');
  for (const id of ['#next-map', '#next-trips']) { const box = $(id); if (box) { box.innerHTML = id === '#next-map' ? (UPCOMING[0] ? upcomingCard(UPCOMING[0], true) : '') : html; box.hidden = !html; } }
}

// --- hero -------------------------------------------------------------------
function renderHero() {
  const s = STATS, life = s.life, name = esc(DATA.name);
  const headline = s.flights
    ? `${name} has zoomed <b>${fmtInt(s.totalKm)} km</b> through the sky!`
    : `${name}'s adventures are about to begin!`;
  $('#hero').innerHTML = `
    <div class="plane">✈️</div>
    <div>
      <div class="headline">${headline}</div>
      <div class="chips">
        <span class="chip c1">✈️ ${s.flights} flight${s.flights === 1 ? '' : 's'}</span>
        <span class="chip c2">☁️ ${fmtDur(s.totalMin)} in the clouds</span>
        ${s.road.drives ? `<span class="chip c6">🚗 ${fmtInt(s.road.km)} km by road</span>` : ''}
        <span class="chip c3">🏙️ ${s.cities.length} place${s.cities.length === 1 ? '' : 's'}</span>
        <span class="chip c4">🌍 ${s.countries.length} countr${s.countries.length === 1 ? 'y' : 'ies'}</span>
        <span class="chip c5">🏅 ${s.badges.filter(b => b.earned).length} sticker${s.badges.filter(b => b.earned).length === 1 ? '' : 's'}</span>
      </div>
    </div>
    ${life ? `<div class="age">${name} is ${formatAge(life.ageNow)} old${s.firsts ? ` and first flew when he was just ${formatAge(s.firsts.flight.age)} old` : ''}.</div>` : ''}`;
}

// --- map --------------------------------------------------------------------
function buildMap() {
  if (mapBuilt) return;
  mapBuilt = true;
  map = L.map('map-canvas', { worldCopyJump: true, minZoom: 1, maxZoom: 10, zoomSnap: 0.25, attributionControl: false });
  const css = getComputedStyle(document.documentElement);
  const landFill = css.getPropertyValue('--land').trim(), landLine = css.getPropertyValue('--land-line').trim();
  const world = L.geoJSON(WORLD, { style: { color: landLine, weight: 0.6, fillColor: landFill, fillOpacity: 1, interactive: false } }).addTo(map);
  // draw neighbouring world copies so arcs over the antimeridian still sit on land
  for (const shift of [-360, 360]) {
    L.geoJSON(WORLD, {
      style: { color: landLine, weight: 0.6, fillColor: landFill, fillOpacity: 1, interactive: false },
      coordsToLatLng: c => L.latLng(c[1], c[0] + shift),
    }).addTo(map);
  }
  L.control.attribution({ prefix: false }).addAttribution('Outlines: Natural Earth').addTo(map);

  const arcLayer = L.layerGroup().addTo(map);
  const pinLayer = L.layerGroup().addTo(map);
  const routeColor = getComputedStyle(document.documentElement).getPropertyValue('--series-1').trim();
  const activeColor = getComputedStyle(document.documentElement).getPropertyValue('--series-2').trim();
  const pinFill = getComputedStyle(document.documentElement).getPropertyValue('--pin').trim();
  const plannedColor = getComputedStyle(document.documentElement).getPropertyValue('--planned').trim();
  const roadColor = getComputedStyle(document.documentElement).getPropertyValue('--road').trim();
  const roadName = d => `${d.fromPl.name} → ${d.toPl.name}`;
  const flownCodes = () => new Set(STATS.airports.map(a => a.code));

  function drawAll() {
    arcLayer.clearLayers(); pinLayer.clearLayers();
    for (const f of FLIGHTS) arcLayer.addLayer(arcFor(f, routeColor, 0.55));
    for (const d of DRIVES) arcLayer.addLayer(roadFor(d, 0.9));
    for (const a of STATS.airports) pinLayer.addLayer(pinFor(a));
    const flown = flownCodes();
    for (const p of STATS.road.places) if (!flown.has(p.airport)) pinLayer.addLayer(placePin(p));
    // adventures still to come: faint dashed lines and hollow dots
    for (const u of UPCOMING) for (const l of [...u.legs, ...u.stopPins.map(p => ({ stop: p }))]) {
      const tip = `<b>${u.emoji || '🧳'} Coming up: ${esc(u.name)}</b>${u.underway ? 'Happening right now' : `${u.sleeps} sleep${u.sleeps === 1 ? '' : 's'} to go`}<br><span class="dim">${fmtDate(u.start)}${u.end && u.end !== u.start ? ' – ' + fmtDate(u.end) : ''}</span>`;
      if (!l.stop) {
        const copies = [0, -360, 360].map(dx => l.points.map(([la, lo]) => [la, lo + dx]));
        arcLayer.addLayer(L.polyline(copies, { color: plannedColor, weight: 2, opacity: 0.9, dashArray: '6 7' }).bindTooltip(tip, { sticky: true, className: 'ap-tip' }));
      }
      const end = l.stop || (l.kind === 'drive' ? l.toPl : l.toAp);
      pinLayer.addLayer(L.featureGroup([0, -360, 360].map(dx => L.circleMarker([end.lat, end.lon + dx], { radius: 5, color: plannedColor, weight: 2, dashArray: '2 3', fillColor: '#fff', fillOpacity: 0.6 }))).bindTooltip(tip, { direction: 'top', offset: [0, -6], className: 'ap-tip' }));
    }
  }
  // drives: dotted line in the road colour, so they read differently from flight arcs
  function roadFor(d, opacity) {
    const copies = [0, -360, 360].map(dx => d.points.map(([la, lo]) => [la, lo + dx]));
    const line = L.polyline(copies, { color: roadColor, weight: 3, opacity, dashArray: '1 7', lineCap: 'round', smoothFactor: 0.5 });
    line.bindTooltip(`<b>🚗 ${esc(roadName(d))}</b>${fmtDateLong(d.date)}${d.viaPl.length ? `<br>via ${d.viaPl.map(p => esc(p.name)).join(', ')}` : ''}<br><span class="dim">${d.kmEstimated ? 'about ' : ''}${fmtInt(d.km)} km · ${d.durationEstimated ? 'about ' : ''}${fmtDur(d.durationMin)}${d.age ? ' · aged ' + formatAge(d.age, true) : ''}</span>`, { sticky: true, className: 'ap-tip' });
    return line;
  }
  function placePin(p, visits = p.visits, dates = p.dates) {
    const m = L.featureGroup([0, -360, 360].map(dx => L.circleMarker([p.lat, p.lon + dx], {
      radius: 4 + 1.6 * Math.sqrt(visits), color: '#fff', weight: 2, fillColor: roadColor, fillOpacity: 0.95,
    })));
    const uniq = [...new Set(dates)].sort();
    m.bindTooltip(`<b>🚗 ${esc(p.name)}</b>${esc(p.country)}<br><span class="dim">${uniq.map(fmtDate).join(', ')}</span>`, { direction: 'top', offset: [0, -6], className: 'ap-tip' });
    return m;
  }
  function arcFor(f, color, opacity) {
    // draw on the centre copy and both neighbours so arcs crossing the antimeridian always read whole
    const copies = [0, -360, 360].map(dx => f.points.map(([la, lo]) => [la, lo + dx]));
    const line = L.polyline(copies, { color, weight: 2, opacity, smoothFactor: 0.5 });
    line.bindTooltip(`<b>${esc(f.flight || '')} ${esc(f.from)} → ${esc(f.to)}</b>${fmtDateLong(f.date)}<br>${esc(f.airline || '')}${f.aircraft ? ' · ' + esc(f.aircraft) : ''}<br><span class="dim">${fmtInt(f.km)} km · ${fmtDur(f.durationMin)}${f.age ? ' · aged ' + formatAge(f.age, true) : ''}</span>`, { sticky: true, className: 'ap-tip' });
    return line;
  }
  function pinFor(a, visits = a.visits, dates = a.dates) {
    const m = L.featureGroup([0, -360, 360].map(dx => L.circleMarker([a.ap.lat, a.ap.lon + dx], {
      radius: 5 + 2.2 * Math.sqrt(visits), color: '#fff', weight: 2, fillColor: pinFill, fillOpacity: 0.9,
    })));
    const uniq = [...new Set(dates)].sort();
    m.bindTooltip(`<b>${esc(a.code)} · ${esc(a.ap.c)}</b>${esc(a.ap.n)}<br><span class="dim">${esc(a.ap.k)} · ${visits} visit${visits === 1 ? '' : 's'}</span><br><span class="dim">${uniq.map(fmtDate).join(', ')}</span>`, { direction: 'top', offset: [0, -6], className: 'ap-tip' });
    return m;
  }
  function fitAll() {
    if (!LEGS.length) { map.setView([-25, 134], 3); return; }
    // centre the world on home: shift every airport into the 360° window around the home longitude
    const homeLon = airportsLon(DATA.home) ?? LEGS[0].points[0][1];
    const shift = lon => { let x = lon; while (x < homeLon - 180) x += 360; while (x >= homeLon + 180) x -= 360; return x; };
    const b = L.latLngBounds([
      ...FLIGHTS.flatMap(f => [[f.fromAp.lat, shift(f.fromAp.lon)], [f.toAp.lat, shift(f.toAp.lon)]]),
      ...DRIVES.flatMap(d => d.stops.map(p => [p.lat, shift(p.lon)])),
      ...UPCOMING.flatMap(u => u.legs.flatMap(l => [l.points[0], l.points[l.points.length - 1]].map(([la, lo]) => [la, shift(lo)]))),
    ]);
    map.fitBounds(b, { padding: [40, 40], maxZoom: 5 });
  }
  drawAll(); fitAll();

  // --- replay animation ---
  let playing = false, raf = null;
  const status = $('#replay-status');
  $('#replay').onclick = () => {
    if (playing || !LEGS.length) return;
    playing = true; $('#replay').hidden = true; $('#replay-stop').hidden = false;
    arcLayer.clearLayers(); pinLayer.clearLayers();
    const visits = new Map();
    let i = 0;
    const perArc = Math.max(350, Math.min(1400, 12000 / LEGS.length));
    const flown = flownCodes(), placeSeen = new Map();
    const addPin = (code, ap, when) => {
      const e = visits.get(code) || { code, ap, visits: 0, dates: [], marker: null };
      e.visits++; e.dates.push(when);
      if (e.marker) pinLayer.removeLayer(e.marker);
      e.marker = pinFor(e, e.visits, e.dates); pinLayer.addLayer(e.marker);
      visits.set(code, e);
    };
    const addPlace = (pl, when) => {
      if (flown.has(pl.airport)) return;
      const e = placeSeen.get(pl.name) || { ...pl, visits: 0, dates: [], marker: null };
      e.visits++; e.dates.push(when);
      if (e.marker) pinLayer.removeLayer(e.marker);
      e.marker = placePin(e, e.visits, e.dates); pinLayer.addLayer(e.marker);
      placeSeen.set(pl.name, e);
    };
    const step = () => {
      if (!playing) return;
      if (i >= LEGS.length) { finish(); return; }
      const f = LEGS[i], drive = f.kind === 'drive';
      status.textContent = drive
        ? `${fmtDateLong(f.date)} · 🚗 drive ${f.seq} of ${DRIVES.length} · ${roadName(f)}${f.age ? ' · aged ' + formatAge(f.age, true) : ''}`
        : `${fmtDateLong(f.date)} · flight ${f.seq} of ${FLIGHTS.length} · ${f.from} → ${f.to}${f.age ? ' · aged ' + formatAge(f.age, true) : ''}`;
      if (drive) addPlace(f.fromPl, f.date); else if (i === 0) addPin(f.from, f.fromAp, f.date);
      const grow = L.polyline([f.points[0]], { color: activeColor, weight: 3, opacity: 0.95 }).addTo(arcLayer);
      map.panTo(f.points[Math.floor(f.points.length / 2)], { animate: true, duration: perArc / 1000 });
      const t0 = performance.now();
      const frame = now => {
        if (!playing) return;
        const p = Math.min(1, (now - t0) / perArc);
        grow.setLatLngs(f.points.slice(0, Math.max(2, Math.ceil(p * f.points.length))));
        if (p < 1) raf = requestAnimationFrame(frame);
        else {
          arcLayer.removeLayer(grow);
          if (drive) { arcLayer.addLayer(roadFor(f, 0.9)); addPlace(f.toPl, f.arrDate); }
          else { arcLayer.addLayer(arcFor(f, routeColor, 0.55)); addPin(f.to, f.toAp, f.arrDate); }
          i++; setTimeout(step, 150);
        }
      };
      raf = requestAnimationFrame(frame);
    };
    const finish = () => {
      playing = false; $('#replay').hidden = false; $('#replay-stop').hidden = true;
      status.textContent = `${FLIGHTS.length} flights · ${fmtInt(STATS.totalKm)} km${DRIVES.length ? ` · ${DRIVES.length} drive${DRIVES.length === 1 ? '' : 's'} · ${fmtInt(STATS.road.km)} km by road` : ''}`;
      drawAll(); fitAll();
    };
    $('#replay-stop').onclick = () => { playing = false; cancelAnimationFrame(raf); finish(); };
    step();
  };
}

// --- stats ------------------------------------------------------------------
function tile(label, value, unit = '', note = '', em = '') {
  return `<div class="tile"><div class="label">${em ? `<span class="em">${em}</span>` : ''}${label}</div><div class="value">${value}${unit ? `<small>${unit}</small>` : ''}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`;
}
function renderStats() {
  const s = STATS, c = s.comparisons;
  $('#totals').innerHTML = [
    tile('Times up in the sky', s.flights, '', '', '✈️'),
    tile('Kilometres zoomed', fmtInt(s.totalKm), 'km', '', '📏'),
    tile('Time in the clouds', fmtDur(s.totalMin), '', '', '☁️'),
    tile('Countries explored', s.countries.length, '', '', '🌍'),
    tile('Places visited', s.cities.length, '', s.cities.some(c => c.stop || c.road) ? 'cities and stops along the way' : '', '🏙️'),
    tile('Airports', s.airports.length, '', '', '🛫'),
    tile('Airlines', s.airlines.length, '', '', '🎫'),
    tile('Kinds of plane', s.aircraft.length, '', '', '🛩️'),
    tile('Continents', s.continentsVisited.length, '', s.continentsVisited.join(', '), '🗺️'),
  ].join('');
  const melSyd = Math.round(s.totalKm / 705);
  $('#comparisons').innerHTML = [
    tile('Laps around the whole Earth', fmt1(c.aroundEarth), '×', `the Earth is ${fmtInt(EARTH_CIRCUMFERENCE_KM)} km around its middle`, '🌏'),
    tile('Of the way to the Moon', fmt1(c.toMoon * 100), '%', `the Moon is ${fmtInt(MOON_DISTANCE_KM)} km away`, '🌙'),
    tile('Hops from Melbourne to Sydney', fmtInt(melSyd), '×', 'each hop is 705 km', '🦘'),
    tile('Whole days up in the sky', fmt1(c.daysInSky), '', `${fmt1(c.hoursInSky)} hours all together`, '🌞'),
    tile('A normal flight for Vincent', fmtInt(s.flights ? s.totalKm / s.flights : 0), 'km', s.flights ? 'about ' + fmtDur(Math.round(s.totalMin / s.flights)) + ' long' : '', '🧸'),
  ].join('');
  if (s.life) {
    const l = s.life;
    $('#agestats').innerHTML = [
      tile('How old on his first flight', l.ageAtFirstFlight ? formatAge(l.ageAtFirstFlight) : '—', '', l.ageAtFirstFlight ? `only ${l.daysOldAtFirstFlight} days old!` : 'No flights yet', '🍼'),
      tile('Of his whole life spent flying', l.pctAirborne < 0.1 ? l.pctAirborne.toFixed(3) : fmt1(l.pctAirborne), '%', '', '⏳'),
      tile('Kilometres for every month alive', fmtInt(l.kmPerMonth), 'km', '', '📈'),
      tile('Flights for every month alive', fmt1(l.flightsPerMonth), '', '', '🎈'),
      tile('How old he is today', formatAge(l.ageNow), '', `that's ${fmtInt(l.ageNow.totalDays)} days`, '🎂'),
    ].join('');
  } else {
    $('#agestats').innerHTML = `<p class="empty">Set <code>birthdate</code> in flights.json for age stats.</p>`;
  }
  const f = s.firsts;
  const firstCard = (icon, what, fl, detailFn) => fl
    ? `<div class="first"><div class="icon">${icon}</div><div class="what">${what}</div><div class="detail">${detailFn(fl)}</div><div class="when">${fmtDateLong(fl.date)}${fl.age ? ` · aged ${formatAge(fl.age)}` : ''}</div></div>`
    : `<div class="first pending"><div class="icon">${icon}</div><div class="what">${what}</div><div class="detail">Not yet!</div><div class="when">One day…</div></div>`;
  const route = fl => `${esc(fl.fromAp.c)} → ${esc(fl.toAp.c)} <span class="dim">(${esc(fl.flight || fl.from + '–' + fl.to)})</span>`;
  const listCard = (icon, what, items) => `<div class="first"><div class="icon">${icon}</div><div class="what">${what}</div><div class="detail"><ul>${items.map(x => `<li>${esc(x.name)} <span class="when">· ${fmtDate(x.date)}</span></li>`).join('') || '<li>Not yet</li>'}</ul></div><div></div></div>`;
  $('#firsts').innerHTML = !f ? '<p class="empty">No flights yet. The sky is waiting!</p>' : [
    firstCard('🛫', 'Very first flight', f.flight, route),
    firstCard('🛂', 'First trip to another country', f.international, route),
    firstCard('🌙', 'First flight through the night', f.overnight, route),
    firstCard('🛩️', 'First really long flight (8h+)', f.longHaul, route),
    firstCard('📏', 'Longest flight ever', f.longest, fl => `${route(fl)} · ${fmtInt(fl.km)} km, ${fmtDur(fl.durationMin)}`),
    firstCard('🐜', 'Shortest flight ever', f.shortest, fl => `${route(fl)} · ${fmtInt(fl.km)} km, ${fmtDur(fl.durationMin)}`),
    firstCard('🌞', 'First time over the equator', f.equator, route),
    firstCard('🕰️', 'First time across the date line', f.dateLine, route),
    firstCard('🎂', 'First flight on his birthday', f.birthday, route),
    listCard('🛬', 'First go on each kind of plane', f.aircraft.map(a => ({ name: a.name, date: a.flight.date }))),
    listCard('🎫', 'First go with each airline', f.airlines.map(a => ({ name: a.name, date: a.flight.date }))),
    listCard('🌐', 'First time on each continent', f.continents),
  ].join('');
  $('#airlines').innerHTML = s.airlines.map(a => `<li><span>${esc(a.key)}</span><span>${a.count}</span></li>`).join('') || '<li>—</li>';
  $('#aircraft').innerHTML = s.aircraft.map(a => `<li><span>${esc(a.key)}</span><span>${a.count}</span></li>`).join('') || '<li>—</li>';
  $('#busiest').innerHTML = s.airports.slice(0, 8).map(a => `<li><span>${esc(a.code)} ${esc(a.ap.c)}</span><span>${a.visits}</span></li>`).join('') || '<li>—</li>';
  $('#peryear').innerHTML = `<tr><th>Year</th><th>Flights</th><th>km</th><th>Hours</th></tr>` +
    s.perYear.map(y => `<tr><td>${y.year}</td><td>${y.flights}</td><td>${fmtInt(y.km)}</td><td>${fmt1(y.minutes / 60)}</td></tr>`).join('');
}

// --- travel crew ------------------------------------------------------------
function renderCrew() {
  const el_ = $('#crew-grid'); if (!el_) return;
  el_.innerHTML = CREW.map(p => {
    const n = p.adventures.length;
    return `<div class="crew-card${p.buddy ? ' buddy' : ''}">
      <i class="avatar" style="background:${avatarColor(p.name)}">${p.buddy ? '✨' : esc(initials(p.name))}</i>
      <div class="crew-name">${esc(p.name)}</div>
      ${p.buddy ? `<div class="crew-buddy">Travel buddy</div>` : ''}
      <div class="crew-count">${n} adventure${n === 1 ? '' : 's'} together</div>
      <div class="crew-first">since ${fmtDate(p.first)}</div>
      ${p.note ? `<div class="crew-note">${esc(p.note)}</div>` : ''}
      <div class="crew-list">${[...new Set(p.adventures.map(a => a.trip))].map(trip => {
        const stops = p.adventures.filter(a => a.trip === trip && a.stop).map(a => a.stop);
        return esc(trip) + (stops.length ? ` (${stops.map(esc).join(', ')})` : '');
      }).join(' · ')}</div>
    </div>`;
  }).join('') || '<p class="empty">Nobody yet.</p>';
}

// --- logbook ----------------------------------------------------------------
function renderLogbook() {
  const rows = FLIGHTS.map(f => `<tr>
    <td class="seq">${f.seq}</td>
    <td class="date">${fmtDate(f.date)}</td>
    <td class="route"><b>${esc(f.from)} → ${esc(f.to)}</b><span class="dim">${esc(f.fromAp.c)} to ${esc(f.toAp.c)}</span></td>
    <td data-label="Flight">${esc(f.flight || '')}</td>
    <td data-label="Airline &amp; plane">${esc(f.airline || '')}<span class="small">${esc(f.aircraft || '')}</span></td>
    <td class="num" data-label="Times">${f.dep_time ? esc(f.dep_time) + '–' + esc(f.arr_time) : '<span class="est">—</span>'}${f.overnight ? '<span class="tag">overnight</span>' : ''}${f.transit ? '<span class="tag" title="Stayed in the airport">transit</span>' : ''}</td>
    <td class="num" data-label="km">${fmtInt(f.km)}</td>
    <td class="num" data-label="How long">${fmtDur(f.durationMin)}${f.durationEstimated ? '<span class="tag" title="Estimated from distance">est</span>' : ''}</td>
    <td data-label="How old">${f.age ? formatAge(f.age, true) : ''}</td>
    <td data-label="Seat" class="${f.seat ? '' : 'none'}">${esc(f.seat || '')}</td>
  </tr>`).join('');
  $('#logbook-table').innerHTML = `<thead><tr><th>#</th><th>When</th><th>Where</th><th>Flight</th><th>Airline &amp; plane</th><th class="num">Times</th><th class="num">km</th><th class="num">How long</th><th>How old</th><th>Seat</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="10" class="empty">Nothing in the logbook yet!</td></tr>'}</tbody>
    <tfoot><tr class="total"><td></td><td colspan="5">All together · ${FLIGHTS.length} flight${FLIGHTS.length === 1 ? '' : 's'}</td><td class="num">${fmtInt(STATS.totalKm)}</td><td class="num">${fmtDur(STATS.totalMin)}</td><td colspan="2"></td></tr></tfoot>`;
}

// --- on the road ------------------------------------------------------------
function renderRoadbook() {
  const sec = $('#roadbook'); if (!sec) return;
  sec.hidden = !DRIVES.length;
  if (!DRIVES.length) return;
  const rows = DRIVES.map(d => `<tr>
    <td class="seq">${d.seq}</td>
    <td class="date">${fmtDate(d.date)}</td>
    <td class="route"><b>${esc(d.fromPl.name)} → ${esc(d.toPl.name)}</b><span class="dim">${d.viaPl.length ? 'via ' + d.viaPl.map(p => esc(p.name)).join(', ') : esc(d.toPl.country)}</span></td>
    <td data-label="Adventure" class="${d.trip ? '' : 'none'}">${esc(d.trip || '')}</td>
    <td data-label="Wheels" class="${d.vehicle ? '' : 'none'}">${esc(d.vehicle || '')}</td>
    <td class="num" data-label="km">${fmtInt(d.km)}${d.kmEstimated ? '<span class="tag" title="Estimated from the map">est</span>' : ''}</td>
    <td class="num" data-label="How long">${fmtDur(d.durationMin)}${d.durationEstimated ? '<span class="tag" title="Estimated from distance">est</span>' : ''}</td>
    <td data-label="How old">${d.age ? formatAge(d.age, true) : ''}</td>
    <td data-label="Notes" class="${d.notes ? '' : 'none'}">${esc(d.notes || '')}</td>
  </tr>`).join('');
  $('#roadbook-table').innerHTML = `<thead><tr><th>#</th><th>When</th><th>Where</th><th>Adventure</th><th>Wheels</th><th class="num">km</th><th class="num">How long</th><th>How old</th><th>Notes</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="total"><td></td><td colspan="4">All together · ${DRIVES.length} drive${DRIVES.length === 1 ? '' : 's'}</td><td class="num">${fmtInt(STATS.road.km)}</td><td class="num">${fmtDur(STATS.road.minutes)}</td><td colspan="2"></td></tr></tfoot>`;
}
function renderRoadStats() {
  const sec = $('#roadstats-wrap'); if (!sec) return;
  const r = STATS.road;
  sec.hidden = !r.drives;
  if (!r.drives) return;
  $('#roadstats').innerHTML = [
    tile('Drives', r.drives, '', '', '🚗'),
    tile('Kilometres by road', fmtInt(r.km), 'km', `${fmt1(r.km / (r.km + STATS.totalKm || 1) * 100)}% of all his travels`, '🛣️'),
    tile('Time in the car seat', fmtDur(r.minutes), '', '', '🧃'),
    tile('Longest drive', fmtInt(r.longest.km), 'km', `${esc(r.longest.fromPl.name)} → ${esc(r.longest.toPl.name)}, ${fmtDur(r.longest.durationMin)}`, '🥱'),
    tile('First road trip', fmtDate(r.first.date), '', `${esc(r.first.fromPl.name)} → ${esc(r.first.toPl.name)}${r.first.age ? ', aged ' + formatAge(r.first.age, true) : ''}`, '🎉'),
  ].join('');
}

// --- passport ---------------------------------------------------------------
function renderPassport() {
  const hash = s => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  $('#passport-stamps').innerHTML = STATS.countries.map((c, i) => {
    const rot = (hash(c.name) % 13) - 6;
    // the home-country stamp shows the day his passport was issued rather than a first arrival
    const issued = DATA.passport?.country === c.name ? DATA.passport.issued : null;
    return `<div class="stamp" style="--rot:${rot}deg">
      <div class="visits">${c.visits}× </div>
      <div class="country">${esc(c.name)}</div>
      <div><div class="entered">${issued ? 'Passport issued' : 'First entered'}</div><div class="date">${fmtDate(issued || c.first)}</div></div>
      <div class="cities">${c.cities.map(esc).join(' · ')}</div>
    </div>`;
  }).join('') || '<p class="empty">No stamps yet. Pack the passport!</p>';
}

// --- trips ------------------------------------------------------------------
const AVATAR_COLORS = ['#ffd23f', '#7ed9b2', '#5fb6ff', '#c9a7ff', '#ffb98a', '#ff9eb5', '#9ad7f5', '#c5e384'];
const avatarColor = name => AVATAR_COLORS[[...name].reduce((h, ch) => h + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];
const initials = name => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
function crewRow(list, label = 'With') {
  const people = (list || []).map(normPerson);
  if (!people.length) return '';
  return `<div class="crew"><span class="crew-label">${label}</span>${people.map(p => `<span class="person${p.buddy ? ' buddy' : ''}" title="${esc(p.note || '')}"><i style="background:${avatarColor(p.name)}">${p.buddy ? '✨' : esc(initials(p.name))}</i>${esc(p.name)}${p.buddy ? '<em>travel buddy</em>' : ''}</span>`).join('')}</div>`;
}
const normPhotos = list => (list || []).map(p => typeof p === 'string' ? { src: p, thumb: p } : p);
function photoStrip(list, tripName, stopIdx) {
  const plist = normPhotos(list);
  if (!plist.length) return '';
  return `<div class="photos">${plist.map((p, i) => `<button class="photo" data-trip="${esc(tripName)}" data-stop="${stopIdx}" data-i="${i}" title="${esc(p.caption || '')}"><img src="${esc(p.thumb || p.src)}" alt="${esc(p.caption || '')}" loading="lazy"></button>`).join('')}<span class="photo-count">📸 ${plist.length} photo${plist.length === 1 ? '' : 's'}</span></div>`;
}
function renderTrips() {
  const ems = ['🏖️', '🎢', '🏔️', '🦘', '🐠', '🎈', '🚂', '🍦'];
  $('#trips-list').innerHTML = [...TRIPS].reverse().map(t => {
    const age = DATA.birthdate ? ageAt(DATA.birthdate, t.start) : null;
    const dates = t.start === t.end ? fmtDateLong(t.start) : `${fmtDate(t.start)} – ${fmtDate(t.end)}`;
    const em = t.meta.emoji || ems[[...t.name].reduce((h, ch) => h + ch.charCodeAt(0), 0) % ems.length];
    const placeList = t.stops.length ? t.stops.map(st => st.name) : t.places.filter(p => p !== t.origin);
    const nPhotos = normPhotos(t.meta.photos).length + t.stops.reduce((n, st) => n + normPhotos(st.photos).length, 0);
    const stops = t.stops.map((st, si) => {
      const sd = st.from && st.to ? (st.from === st.to ? fmtDateLong(st.from) : `${fmtDate(st.from)} – ${fmtDate(st.to)}`) : (st.from ? fmtDateLong(st.from) : '');
      const nights = st.from && st.to ? Math.round((new Date(st.to) - new Date(st.from)) / 86400000) : null;
      return `<section class="stop">
        <div class="stop-head"><span class="stop-em">${st.emoji || '📍'}</span><div><h4>${esc(st.name)}</h4><div class="stop-dates">${sd}${nights ? ` · ${nights} night${nights === 1 ? '' : 's'}` : ''}</div></div></div>
        ${st.notes ? `<p class="notes">${esc(st.notes)}</p>` : ''}
        ${crewRow(st.with)}
        ${photoStrip(st.photos, t.name, si)}
      </section>`;
    }).join('');
    return `<article class="trip">
      <div class="em">${em}</div>
      <h3>${esc(t.name)}</h3>
      <div class="dates">${dates} · ${esc(placeList.join(' → ') || t.places.join(', '))}</div>
      ${age ? `<div class="age">${DATA.name} was ${formatAge(age)} old</div>` : ''}
      <div class="summary"><b>${fmtInt(t.km + t.roadKm)} km</b>${[
        t.flights.length ? `${t.flights.length} flight${t.flights.length === 1 ? '' : 's'} · ${fmtDur(t.minutes)}` : '',
        t.drives.length ? `${t.drives.length} drive${t.drives.length === 1 ? '' : 's'} · ${t.flights.length ? fmtInt(t.roadKm) + ' km · ' : ''}${fmtDur(t.roadMin)}` : '',
        nPhotos ? `${nPhotos} photos` : '',
      ].filter(Boolean).join(' · ')}</div>
      ${t.meta.notes ? `<p class="notes">${esc(t.meta.notes)}</p>` : ''}
      ${crewRow(t.meta.with)}
      <div class="legs">${t.legs.map(f => f.kind === 'drive'
        ? `<span class="leg road"><b>🚗 ${esc(f.fromPl.name)}→${esc(f.toPl.name)}</b> ${fmtDate(f.date)} · ${fmtInt(f.km)} km</span>`
        : `<span class="leg"><b>${esc(f.from)}→${esc(f.to)}</b> ${fmtDate(f.date)}${f.flight ? ' · ' + esc(f.flight) : ''}</span>`).join('')}</div>
      ${photoStrip(t.meta.photos, t.name, -1)}
      ${stops ? `<div class="stops">${stops}</div>` : ''}
    </article>`;
  }).join('') || '<p class="empty">No adventures yet. Where to first?</p>';
  $('#trips-list').onclick = e => {
    const b = e.target.closest('.photo'); if (!b) return;
    const t = TRIPS.find(x => x.name === b.dataset.trip);
    const si = +b.dataset.stop;
    const list = si >= 0 ? t.stops[si].photos : t.meta.photos;
    const title = si >= 0 ? `${t.name} · ${t.stops[si].name}` : t.name;
    openLightbox(normPhotos(list), title, +b.dataset.i);
  };
}

// --- lightbox ---------------------------------------------------------------
function openLightbox(plist, title, index) {
  let i = index;
  let box = $('#lightbox');
  if (!box) {
    box = el(`<div id="lightbox" class="lightbox" hidden>
      <button class="lb-close" aria-label="Close">✕</button>
      <button class="lb-prev" aria-label="Previous">‹</button>
      <figure><img alt=""><figcaption></figcaption></figure>
      <button class="lb-next" aria-label="Next">›</button>
    </div>`);
    document.body.appendChild(box);
    box.addEventListener('click', e => { if (e.target === box || e.target.closest('.lb-close')) close(); });
    let tx = null, ty = null;
    box.addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
    box.addEventListener('touchend', e => {
      if (tx == null) return;
      const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty; tx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) show(dx < 0 ? i + 1 : i - 1);
      else if (dy > 80 && Math.abs(dy) > Math.abs(dx)) close();
    }, { passive: true });
    box.querySelector('.lb-prev').onclick = () => show(i - 1);
    box.querySelector('.lb-next').onclick = () => show(i + 1);
    addEventListener('keydown', e => {
      if (box.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(i - 1);
      if (e.key === 'ArrowRight') show(i + 1);
    });
  }
  const img = box.querySelector('img'), cap = box.querySelector('figcaption');
  function show(n) {
    i = (n + plist.length) % plist.length;
    const p = plist[i];
    img.src = p.src;
    cap.innerHTML = `<b>${esc(title)}</b>${p.caption ? ` · ${esc(p.caption)}` : ''}${p.date ? ` <span class="dim">${fmtDate(p.date)}</span>` : ''} <span class="dim">${i + 1} / ${plist.length}</span>`;
    box.querySelector('.lb-prev').hidden = box.querySelector('.lb-next').hidden = plist.length < 2;
  }
  function close() { box.hidden = true; document.body.style.overflow = ''; }
  show(i); box.hidden = false; document.body.style.overflow = 'hidden';
}

// --- badges -----------------------------------------------------------------
function renderBadges() {
  const sorted = [...STATS.badges].sort((a, b) => (b.earned - a.earned) || (a.date || '').localeCompare(b.date || ''));
  const prog = b => b.unit === 'km' ? `${fmtInt(b.progress)} / ${fmtInt(b.target)} km` : b.unit === 'min' ? `${fmtDur(b.progress)} / ${fmtDur(b.target)}` : `${b.progress} / ${b.target}`;
  $('#badges-grid').innerHTML = sorted.map(b => `<div class="badge${b.earned ? '' : ' locked'}">
    <div class="icon">${b.icon}</div>
    <div class="name">${esc(b.name)}</div>
    <div class="desc">${esc(b.desc)}</div>
    ${b.earned ? `<div class="date">Got it ${fmtDate(b.date)}!</div>` : `<div class="meter"><i style="width:${Math.round(b.progress / b.target * 100)}%"></i></div><div class="progress">${prog(b)}</div>`}
  </div>`).join('');
}

main();
