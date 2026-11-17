// Geography helpers: distances, great-circle arcs, time zones, continents.
export const EARTH_RADIUS_KM = 6371.0088;
export const EARTH_CIRCUMFERENCE_KM = 40075;
export const MOON_DISTANCE_KM = 384400;

const toRad = d => d * Math.PI / 180;
const toDeg = r => r * 180 / Math.PI;

export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s));
}

// Points along the great circle from a to b. Longitudes are "unwrapped" so the
// line stays continuous across the antimeridian (Leaflet renders lon > 180 fine).
export function greatCirclePoints(a, b, n = 64) {
  const lat1 = toRad(a.lat), lon1 = toRad(a.lon);
  const lat2 = toRad(b.lat), lon2 = toRad(b.lon);
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2));
  if (d === 0) return [[a.lat, a.lon], [b.lat, b.lon]];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    pts.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]);
  }
  // unwrap longitudes
  for (let i = 1; i < pts.length; i++) {
    let diff = pts[i][1] - pts[i - 1][1];
    if (diff > 180) pts[i][1] -= 360;
    else if (diff < -180) pts[i][1] += 360;
  }
  return pts;
}

export function crossesEquator(pts) {
  return pts.some((p, i) => i > 0 && Math.sign(p[0]) !== Math.sign(pts[i - 1][0]) && p[0] !== 0);
}

export function crossesDateLine(a, b) {
  // The shorter path crosses the antimeridian when the raw lon difference exceeds 180.
  return Math.abs(b.lon - a.lon) > 180;
}

// --- time zones -----------------------------------------------------------
function tzOffsetMinutes(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(date).map(x => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return (asUTC - date.getTime()) / 60000;
}

// Local wall-clock time in tz -> epoch ms.
export function localToEpoch(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  if (!tz) return guess;
  try {
    let off = tzOffsetMinutes(new Date(guess), tz);
    let t = guess - off * 60000;
    const off2 = tzOffsetMinutes(new Date(t), tz);
    if (off2 !== off) t = guess - off2 * 60000;
    return t;
  } catch { return guess; }
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

// --- continents -----------------------------------------------------------
const C = {
  'North America': ['United States', 'Canada', 'Mexico', 'Greenland', 'Bermuda', 'Guatemala', 'Belize', 'Honduras', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama', 'Cuba', 'Jamaica', 'Haiti', 'Dominican Republic', 'Puerto Rico', 'Bahamas', 'Barbados', 'Trinidad and Tobago', 'Saint Lucia', 'Antigua and Barbuda', 'Grenada', 'Saint Kitts and Nevis', 'Saint Vincent and the Grenadines', 'Dominica', 'Cayman Islands', 'Aruba', 'Curacao', 'Netherlands Antilles', 'Virgin Islands', 'British Virgin Islands', 'Turks and Caicos Islands', 'Martinique', 'Guadeloupe', 'Saint Pierre and Miquelon', 'Anguilla', 'Montserrat', 'Sint Maarten', 'Saint Barthelemy', 'Saint Martin'],
  'South America': ['Brazil', 'Argentina', 'Chile', 'Peru', 'Colombia', 'Venezuela', 'Ecuador', 'Bolivia', 'Paraguay', 'Uruguay', 'Guyana', 'Suriname', 'French Guiana', 'Falkland Islands'],
  'Europe': ['United Kingdom', 'Ireland', 'France', 'Germany', 'Spain', 'Portugal', 'Italy', 'Netherlands', 'Belgium', 'Luxembourg', 'Switzerland', 'Austria', 'Denmark', 'Sweden', 'Norway', 'Finland', 'Iceland', 'Poland', 'Czech Republic', 'Slovakia', 'Hungary', 'Romania', 'Bulgaria', 'Greece', 'Croatia', 'Slovenia', 'Serbia', 'Bosnia and Herzegovina', 'Montenegro', 'North Macedonia', 'Macedonia', 'Albania', 'Kosovo', 'Estonia', 'Latvia', 'Lithuania', 'Belarus', 'Ukraine', 'Moldova', 'Russia', 'Malta', 'Cyprus', 'Monaco', 'Andorra', 'Liechtenstein', 'San Marino', 'Gibraltar', 'Faroe Islands', 'Isle of Man', 'Jersey', 'Guernsey', 'Svalbard', 'Turkey'],
  'Africa': ['South Africa', 'Egypt', 'Morocco', 'Kenya', 'Tanzania', 'Ethiopia', 'Nigeria', 'Ghana', 'Senegal', 'Tunisia', 'Algeria', 'Libya', 'Sudan', 'South Sudan', 'Uganda', 'Rwanda', 'Burundi', 'Zambia', 'Zimbabwe', 'Botswana', 'Namibia', 'Mozambique', 'Malawi', 'Angola', 'Madagascar', 'Mauritius', 'Seychelles', 'Reunion', 'Mayotte', 'Comoros', 'Cameroon', 'Ivory Coast', "Cote d'Ivoire", 'Mali', 'Niger', 'Chad', 'Burkina Faso', 'Benin', 'Togo', 'Liberia', 'Sierra Leone', 'Guinea', 'Guinea-Bissau', 'Gambia', 'Mauritania', 'Cape Verde', 'Gabon', 'Congo (Brazzaville)', 'Congo (Kinshasa)', 'Republic of the Congo', 'Democratic Republic of the Congo', 'Central African Republic', 'Equatorial Guinea', 'Sao Tome and Principe', 'Djibouti', 'Eritrea', 'Somalia', 'Lesotho', 'Swaziland', 'Eswatini', 'Western Sahara', 'Saint Helena'],
  'Asia': ['China', 'Japan', 'South Korea', 'North Korea', 'India', 'Pakistan', 'Bangladesh', 'Sri Lanka', 'Nepal', 'Bhutan', 'Maldives', 'Thailand', 'Vietnam', 'Cambodia', 'Laos', 'Myanmar', 'Burma', 'Malaysia', 'Singapore', 'Indonesia', 'Philippines', 'Brunei', 'East Timor', 'Timor-Leste', 'Taiwan', 'Hong Kong', 'Macau', 'Mongolia', 'Kazakhstan', 'Uzbekistan', 'Turkmenistan', 'Kyrgyzstan', 'Tajikistan', 'Afghanistan', 'Iran', 'Iraq', 'Syria', 'Lebanon', 'Israel', 'Palestine', 'Jordan', 'Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Bahrain', 'Kuwait', 'Oman', 'Yemen', 'Georgia', 'Armenia', 'Azerbaijan', 'Christmas Island', 'Cocos (Keeling) Islands'],
  'Oceania': ['Australia', 'New Zealand', 'Papua New Guinea', 'Fiji', 'Samoa', 'American Samoa', 'Tonga', 'Vanuatu', 'Solomon Islands', 'New Caledonia', 'French Polynesia', 'Cook Islands', 'Guam', 'Northern Mariana Islands', 'Palau', 'Micronesia', 'Marshall Islands', 'Kiribati', 'Nauru', 'Tuvalu', 'Niue', 'Wallis and Futuna', 'Norfolk Island', 'Hawaii'],
  'Antarctica': ['Antarctica'],
};
const COUNTRY_TO_CONTINENT = {};
for (const [cont, list] of Object.entries(C)) for (const k of list) COUNTRY_TO_CONTINENT[k] = cont;
export const CONTINENTS = Object.keys(C);
export function continentOf(country) { return COUNTRY_TO_CONTINENT[country] || 'Unknown'; }
