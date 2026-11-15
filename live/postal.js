(() => {
'use strict';
const normalize = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const words = value => normalize(value).split(' ').filter(Boolean);
const streetTypes = {
  strada: ['strada', 'str'], sosea: ['sosea', 'soseaua', 'sos'], bulevard: ['bulevard', 'bulevardul', 'bd', 'bld'],
  calea: ['calea', 'cale', 'cal'], alee: ['alee', 'aleea', 'al'], intrare: ['intrare', 'intrarea', 'intr']
};
const canonicalType = value => Object.keys(streetTypes).find(type => streetTypes[type].includes(value)) || value;
const locationLabel = row => row.sector ? `Sector ${row.sector}, București` : `${row.city}, județul ${row.county}`;
const datasets = new Map();
function load(name) {
  if (!datasets.has(name)) {
    datasets.set(name, fetch(new URL(`postal-data/${name}.tsv.gz`, document.baseURI))
      .then(response => {
        if (!response.ok) throw new Error('Date indisponibile');
        return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text();
      })
      .then(data => data.trimEnd().split('\n').map(line => {
        if (name === 'places') {
          const [county, city, code] = line.split('\t');
          return {county, city, code};
        }
        const [county, city, sector, kind, street, range, code] = line.split('\t');
        return {county, city, sector, kind, street, range, code, tokens: words(street)};
      }))
      .catch(error => { datasets.delete(name); throw error; }));
  }
  return datasets.get(name);
}
function locationMatches(row, city, county) {
  const sector = /^sector ([1-6])$/.exec(county);
  return (!city || normalize(row.city) === city) &&
    (!county || (sector ? row.sector === sector[1] : normalize(row.county) === county));
}
function near(a, b) {
  if (a.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length > b.length) [a, b] = [b, a];
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length < b.length) return a.slice(i) === b.slice(i + 1);
  return a.slice(i + 1) === b.slice(i + 1) ||
    (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
}
function addressParts(address) {
  const match = /(?:[, ]+nr\.?\s*|,\s*)(\d+[a-z]?)(?=\s*[,;]|\s|$)/i.exec(address);
  const detail = match || /[, ]+(?:bl\.?|bloc|sc\.?|ap\.?)\s*[a-z0-9]/i.exec(address);
  const tokens = words(detail ? address.slice(0, detail.index) : address);
  const kind = canonicalType(tokens[0]);
  const hasKind = Object.prototype.hasOwnProperty.call(streetTypes, kind);
  return {tokens: hasKind ? tokens.slice(1) : tokens, kind: hasKind ? kind : '',
    number: match?.[1]?.toLowerCase() || '', suffix: detail ? address.slice(detail.index) : ''};
}
function includesNumber(range, number) {
  if (!/^nr\./i.test(range)) return false;
  return range.slice(3).split(/[,;]/).some(part => {
    const match = /^(\d+)(?:\s*-\s*(\d+|t))?$/i.exec(part.trim());
    if (!match) return part.trim().toLowerCase() === number;
    if (!match[2]) return match[1] === number;
    if (!/^\d+$/.test(number)) return false;
    const start = Number(match[1]), end = /^t$/i.test(match[2]) ? Infinity : Number(match[2]);
    const n = Number(number);
    return n >= start && n <= end && n % 2 === start % 2;
  });
}
function streetMatches(rows, parts, city, county) {
  const ranked = [];
  for (const row of rows) {
    if (!locationMatches(row, city, county) || (parts.kind && canonicalType(normalize(row.kind)) !== parts.kind)) continue;
    let score = 0;
    for (const term of parts.tokens) {
      const weight = row.tokens.includes(term) ? 3 : row.tokens.some(word => word.startsWith(term)) ? 2 :
        row.tokens.some(word => near(term, word)) ? 1 : 0;
      if (!weight) { score = 0; break; }
      score += weight;
    }
    if (score) ranked.push({row, score, exact: score === parts.tokens.length * 3 && parts.tokens.length === row.tokens.length});
  }
  return ranked.sort((a, b) => b.score - a.score || Number(b.exact) - Number(a.exact));
}
function mount(fields) {
  const input = name => fields.querySelector(`[name="${name}"]`);
  const cityField = input('city'), countyField = input('county'), address = input('address'), postal = input('postal');
  if (!cityField || !countyField || !address || !postal) return;
  postal.inputMode = 'numeric';
  const box = document.createElement('div');
  box.className = 'postal-lookup';
  box.innerHTML = '<p class="hint" aria-live="polite"></p><div class="postal-results"></div>';
  postal.closest('label').after(box);
  const message = box.firstElementChild, list = box.lastElementChild;
  let timer, generation = 0, filled = '', manual = false;
  function fill(row) {
    postal.value = row.code;
    filled = row.code;
    manual = false;
    message.textContent = `Cod poștal: ${row.code}. Sursă: Poșta Română, Infocod 2016.`;
    list.replaceChildren();
  }
  function suggest(rows, parts, updateStreet) {
    for (const row of rows.slice(0, 15)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = [row.kind && `${row.kind} ${row.street}`, locationLabel(row), row.range, row.code].filter(Boolean).join(' · ');
      button.onclick = () => {
        cityField.value = row.city;
        countyField.value = row.sector ? `Sector ${row.sector}` : row.county;
        if (updateStreet) address.value = `${row.kind} ${row.street}${parts.suffix}`;
        fill(row);
      };
      list.append(button);
    }
  }
  async function lookup(version) {
    const city = normalize(cityField.value), county = normalize(countyField.value);
    const parts = addressParts(address.value.trim());
    try {
      const places = city ? (await load('places')).filter(row => locationMatches(row, city, county)) : [];
      if (version !== generation || !box.isConnected) return;
      if (places.length && county && new Set(places.map(row => row.code)).size === 1) {
        if (!postal.value && !manual) fill(places[0]);
        return;
      }
      if (parts.tokens.join('').length < 3) {
        if (places.length) {
          message.textContent = 'Alege localitatea din județul corect.';
          suggest(places, parts, false);
        }
        return;
      }
      const matches = streetMatches(await load('streets'), parts, city, county);
      if (version !== generation || !box.isConnected) return;
      const exact = matches.filter(match => match.exact).map(match => match.row);
      const numbered = rows => parts.number ? rows.filter(row => includesNumber(row.range, parts.number)) : [];
      const exactNumber = numbered(exact);
      if (city && county && exact.length && !postal.value && !manual) {
        const allCodes = new Set(exact.map(row => row.code));
        const numberCodes = new Set(exactNumber.map(row => row.code));
        const streets = new Set(exact.map(row => [row.city, row.county, row.sector, row.kind, row.street].join('|')));
        const simpleRanges = exact.every(row => /^nr\.\s*\d+(?:\s*-\s*(?:\d+|t))?(?:\s*[,;]\s*\d+(?:\s*-\s*(?:\d+|t))?)*$/i.test(row.range));
        if (streets.size === 1 && (allCodes.size === 1 || (simpleRanges && numberCodes.size === 1))) {
          fill(allCodes.size === 1 ? exact[0] : exactNumber[0]);
          return;
        }
      }
      const rows = matches.map(match => match.row);
      const preferred = numbered(rows);
      const ranked = preferred.length ? [...new Set([...preferred, ...rows])] : rows;
      message.textContent = ranked.length ? 'Alege adresa și verifică numărul. Pentru restrângere, adaugă județul, localitatea sau „nr. 12”.' :
        'Adresa nu apare în catalog. Poți introduce codul manual.';
      suggest(ranked, parts, true);
    } catch {
      if (version === generation && box.isConnected) message.textContent = 'Căutarea este indisponibilă. Poți introduce codul manual.';
    }
  }
  const schedule = () => {
    if (filled && postal.value === filled) postal.value = '';
    filled = '';
    clearTimeout(timer);
    const version = ++generation;
    list.replaceChildren();
    message.textContent = postal.value ? 'Verifică dacă vechiul cod poștal corespunde adresei noi.' : '';
    timer = setTimeout(() => lookup(version), 350);
  };
  for (const field of [cityField, countyField, address]) field.addEventListener('input', schedule);
  postal.addEventListener('input', () => {
    filled = '';
    manual = Boolean(postal.value);
  });
}
window.amsPostal = {mount};
})();
