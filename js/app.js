import { enrichFlights, computeStats, groupTrips, formatAge, ageAt } from './stats.js';
import { EARTH_CIRCUMFERENCE_KM, MOON_DISTANCE_KM } from './geo.js';

const $ = sel => document.querySelector(sel);
const fmtInt = n => Math.round(n).toLocaleString();
const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
const fmtDate = s => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDateLong = s => new Date(s + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
const fmtDur = m => { const h = Math.floor(m / 60), mm = m % 60; return h ? `${h}h ${String(mm).padStart(2, '0')}m` : `${mm}m`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

let DATA, FLIGHTS, STATS, TRIPS, WORLD, AIRPORTS, map, mapBuilt = false;
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
    STATS = computeStats(data, FLIGHTS);
    TRIPS = groupTrips(FLIGHTS, data.trips || {});
  } catch (e) {
    $('main').prepend(el(`<div class="error">Could not load flight data: ${esc(e.message)}</div>`));
    console.error(e);
    return;
  }
  document.title = `${DATA.name}'s Big Adventures`;
  $('#title').textContent = `${DATA.name}'s Big Adventures`;
  renderHero();
  renderStats();
  renderLogbook();
  renderPassport();
  renderTrips();
  renderBadges();
  $('#datanote').textContent = `${FLIGHTS.length} flights on record · last updated ${FLIGHTS.length ? fmtDate(FLIGHTS[FLIGHTS.length - 1].date) : '—'}`;
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

  function drawAll() {
    arcLayer.clearLayers(); pinLayer.clearLayers();
    for (const f of FLIGHTS) arcLayer.addLayer(arcFor(f, routeColor, 0.55));
    for (const a of STATS.airports) pinLayer.addLayer(pinFor(a));
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
    if (!FLIGHTS.length) { map.setView([-25, 134], 3); return; }
    // centre the world on home: shift every airport into the 360° window around the home longitude
    const homeLon = airportsLon(DATA.home) ?? FLIGHTS[0].fromAp.lon;
    const shift = lon => { let x = lon; while (x < homeLon - 180) x += 360; while (x >= homeLon + 180) x -= 360; return x; };
    const b = L.latLngBounds(FLIGHTS.flatMap(f => [[f.fromAp.lat, shift(f.fromAp.lon)], [f.toAp.lat, shift(f.toAp.lon)]]));
    map.fitBounds(b, { padding: [40, 40], maxZoom: 5 });
  }
  drawAll(); fitAll();

  // --- replay animation ---
  let playing = false, raf = null;
  const status = $('#replay-status');
  $('#replay').onclick = () => {
    if (playing || !FLIGHTS.length) return;
    playing = true; $('#replay').hidden = true; $('#replay-stop').hidden = false;
    arcLayer.clearLayers(); pinLayer.clearLayers();
    const visits = new Map();
    let i = 0;
    const perArc = Math.max(350, Math.min(1400, 12000 / FLIGHTS.length));
    const addPin = (code, ap, when) => {
      const e = visits.get(code) || { code, ap, visits: 0, dates: [], marker: null };
      e.visits++; e.dates.push(when);
      if (e.marker) pinLayer.removeLayer(e.marker);
      e.marker = pinFor(e, e.visits, e.dates); pinLayer.addLayer(e.marker);
      visits.set(code, e);
    };
    const step = () => {
      if (!playing) return;
      if (i >= FLIGHTS.length) { finish(); return; }
      const f = FLIGHTS[i];
      status.textContent = `${fmtDateLong(f.date)} · flight ${f.seq} of ${FLIGHTS.length} · ${esc(f.from)} → ${esc(f.to)}${f.age ? ' · aged ' + formatAge(f.age, true) : ''}`;
      if (i === 0) addPin(f.from, f.fromAp, f.date);
      const grow = L.polyline([f.points[0]], { color: activeColor, weight: 3, opacity: 0.95 }).addTo(arcLayer);
      map.panTo(f.points[Math.floor(f.points.length / 2)], { animate: true, duration: perArc / 1000 });
      const t0 = performance.now();
      const frame = now => {
        if (!playing) return;
        const p = Math.min(1, (now - t0) / perArc);
        grow.setLatLngs(f.points.slice(0, Math.max(2, Math.ceil(p * f.points.length))));
        if (p < 1) raf = requestAnimationFrame(frame);
        else {
          arcLayer.removeLayer(grow); arcLayer.addLayer(arcFor(f, routeColor, 0.55));
          addPin(f.to, f.toAp, f.arrDate);
          i++; setTimeout(step, 150);
        }
      };
      raf = requestAnimationFrame(frame);
    };
    const finish = () => {
      playing = false; $('#replay').hidden = false; $('#replay-stop').hidden = true;
      status.textContent = `${FLIGHTS.length} flights · ${fmtInt(STATS.totalKm)} km`;
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
    tile('Places visited', s.cities.length, '', s.cities.some(c => c.stop) ? 'cities and stops along the way' : '', '🏙️'),
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

// --- logbook ----------------------------------------------------------------
function renderLogbook() {
  const rows = FLIGHTS.map(f => `<tr>
    <td class="seq">${f.seq}</td>
    <td>${fmtDate(f.date)}</td>
    <td class="route"><b>${esc(f.from)} → ${esc(f.to)}</b><span class="dim">${esc(f.fromAp.c)} to ${esc(f.toAp.c)}</span></td>
    <td>${esc(f.flight || '')}</td>
    <td>${esc(f.airline || '')}<span class="small">${esc(f.aircraft || '')}</span></td>
    <td class="num">${f.dep_time ? esc(f.dep_time) + '–' + esc(f.arr_time) : '<span class="est">—</span>'}${f.overnight ? '<span class="tag">overnight</span>' : ''}${f.transit ? '<span class="tag" title="Stayed in the airport">transit</span>' : ''}</td>
    <td class="num">${fmtInt(f.km)}</td>
    <td class="num">${fmtDur(f.durationMin)}${f.durationEstimated ? '<span class="tag" title="Estimated from distance">est</span>' : ''}</td>
    <td>${f.age ? formatAge(f.age, true) : ''}</td>
    <td>${esc(f.seat || '')}</td>
  </tr>`).join('');
  $('#logbook-table').innerHTML = `<thead><tr><th>#</th><th>When</th><th>Where</th><th>Flight</th><th>Airline &amp; plane</th><th class="num">Times</th><th class="num">km</th><th class="num">How long</th><th>How old</th><th>Seat</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="10" class="empty">Nothing in the logbook yet!</td></tr>'}</tbody>
    <tfoot><tr class="total"><td></td><td colspan="5">All together · ${FLIGHTS.length} flight${FLIGHTS.length === 1 ? '' : 's'}</td><td class="num">${fmtInt(STATS.totalKm)}</td><td class="num">${fmtDur(STATS.totalMin)}</td><td colspan="2"></td></tr></tfoot>`;
}

// --- passport ---------------------------------------------------------------
function renderPassport() {
  const hash = s => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
  $('#passport-stamps').innerHTML = STATS.countries.map((c, i) => {
    const rot = (hash(c.name) % 13) - 6;
    return `<div class="stamp" style="--rot:${rot}deg">
      <div class="visits">${c.visits}× </div>
      <div class="country">${esc(c.name)}</div>
      <div><div class="entered">First entered</div><div class="date">${fmtDate(c.first)}</div></div>
      <div class="cities">${c.cities.map(esc).join(' · ')}</div>
    </div>`;
  }).join('') || '<p class="empty">No stamps yet. Pack the passport!</p>';
}

// --- trips ------------------------------------------------------------------
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
    const placeList = t.stops.length ? t.stops.map(st => st.name) : t.places.filter(p => p !== t.flights[0].fromAp.c);
    const nPhotos = normPhotos(t.meta.photos).length + t.stops.reduce((n, st) => n + normPhotos(st.photos).length, 0);
    const stops = t.stops.map((st, si) => {
      const sd = st.from && st.to ? (st.from === st.to ? fmtDateLong(st.from) : `${fmtDate(st.from)} – ${fmtDate(st.to)}`) : (st.from ? fmtDateLong(st.from) : '');
      const nights = st.from && st.to ? Math.round((new Date(st.to) - new Date(st.from)) / 86400000) : null;
      return `<section class="stop">
        <div class="stop-head"><span class="stop-em">${st.emoji || '📍'}</span><div><h4>${esc(st.name)}</h4><div class="stop-dates">${sd}${nights ? ` · ${nights} night${nights === 1 ? '' : 's'}` : ''}</div></div></div>
        ${st.notes ? `<p class="notes">${esc(st.notes)}</p>` : ''}
        ${photoStrip(st.photos, t.name, si)}
      </section>`;
    }).join('');
    return `<article class="trip">
      <div class="em">${em}</div>
      <h3>${esc(t.name)}</h3>
      <div class="dates">${dates} · ${esc(placeList.join(' → ') || t.places.join(', '))}</div>
      ${age ? `<div class="age">${DATA.name} was ${formatAge(age)} old</div>` : ''}
      <div class="summary"><b>${fmtInt(t.km)} km</b>${t.flights.length} flight${t.flights.length === 1 ? '' : 's'} · ${fmtDur(t.minutes)}${nPhotos ? ` · ${nPhotos} photos` : ''}</div>
      ${t.meta.notes ? `<p class="notes">${esc(t.meta.notes)}</p>` : ''}
      <div class="legs">${t.flights.map(f => `<span class="leg"><b>${esc(f.from)}→${esc(f.to)}</b> ${fmtDate(f.date)}${f.flight ? ' · ' + esc(f.flight) : ''}</span>`).join('')}</div>
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
