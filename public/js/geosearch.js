/* lintasJB NMS — pencarian objek & parser koordinat (decimal, DMS, URL peta) */

const NUM = '-?\\d+(?:\\.\\d+)?';

function normalize(raw) {
  return String(raw || '')
    .trim()
    .replace(/[−–]/g, '-')
    .replace(/[′`]/g, "'")
    .replace(/[″]/g, '"')
    .replace(/\blatitude\b/gi, 'lat')
    .replace(/\blongitude\b/gi, 'lng')
    .replace(/\blong\b/gi, 'lng');
}

function valid(lat, lng, source) {
  let a = Number(lat);
  let b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // Format terbalik (lng, lat) sangat umum saat forkopasta dari GPS.
  if (Math.abs(a) > 90 && Math.abs(b) <= 90) [a, b] = [b, a];
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: Number(a.toFixed(7)), lng: Number(b.toFixed(7)), source };
}

function parseDms(text) {
  const re = /(\d+(?:\.\d+)?)\s*°?\s*(\d+(?:\.\d+)?)?\s*['’]?\s*(\d+(?:\.\d+)?)?\s*["”]?\s*([NSEW])?/gi;
  const found = [];
  let match;
  while ((match = re.exec(text)) && found.length < 2) {
    const [, deg, min, sec, hemi] = match;
    if (!hemi) continue;
    let value = Number(deg) + (Number(min) || 0) / 60 + (Number(sec) || 0) / 3600;
    if (/S|W/i.test(hemi)) value = -value;
    found.push(value);
  }
  return found.length === 2 ? valid(found[0], found[1], 'dms') : null;
}

/**
 * Parse koordinat dari berbagai bentuk:
 *   - "-8.1694, 113.7012" / "-8.1694 113.7012" / "-8.1694;113.7012"
 *   - "lat: -8.1694 lng: 113.7012"
 *   - "8°10'9.8\"S 113°42'4.3\"E"
 *   - URL Google Maps ("@...,-8.1694,113.7012...", "?q=-8.1694,113.7012")
 * @returns {{lat:number,lng:number,source:string}|null}
 */
export function parseCoordinate(raw) {
  const s = normalize(raw);
  if (!s) return null;

  // Label eksplisit lebih dipercaya dari pasangan angka bebas.
  const latLabel = s.match(new RegExp(`lat\\s*[:=]?\\s*(${NUM})`, 'i'));
  const lngLabel = s.match(new RegExp(`lng\\s*[:=]?\\s*(${NUM})`, 'i'));
  if (latLabel && lngLabel) return valid(latLabel[1], lngLabel[1], 'label');

  // URL / tautan peta.
  let m = s.match(new RegExp(`@\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)`, 'i'))
    || s.match(new RegExp(`[?&]q=\\s*(-?\\d+(?:\\.\\d+)?)\\s*(?:,|%2C)?\\s*(-?\\d+(?:\\.\\d+)?)`, 'i'))
    || s.match(/!3d(-?\d+(?:\.\d+)?)[^!]*!4d(-?\d+(?:\.\d+)?)/i);
  if (m) return valid(m[1], m[2], 'url');

  const dms = parseDms(s);
  if (dms) return dms;

  // Pasangan desimal: koma, titik koma, atau spasi sebagai pemisah.
  m = s.match(new RegExp(`^\\s*(${NUM})\\s*[,;\\s]+\\s*(${NUM})\\s*$`));
  if (m) return valid(m[1], m[2], 'decimal');

  // Fallback: tepat dua bilangan di dalam teks (mis. "koordinat -8.1694, 113.7012").
  const numbers = s.match(new RegExp(NUM, 'g')) || [];
  if (numbers.length === 2 && /\d\.\d|[NSEW]/.test(s)) return valid(numbers[0], numbers[1], 'decimal');
  return null;
}

function norm(text) {
  return String(text || '').toLocaleLowerCase('id');
}

/**
 * Cari node, kabel, dan gangguan berdasarkan nama/kode/serial/alamat.
 * @returns {Array<{kind:string,id:string,label:string,sub:string,point:number[]|null,score:number}>}
 */
export function searchObjects(query, { nodes = [], cables = [], faults = [], meta = {}, limit = 12 } = {}) {
  const q = norm(query).trim();
  if (!q) return [];
  const out = [];

  const push = (item) => {
    const label = norm(item.label);
    item.score = label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
    out.push(item);
  };

  for (const n of nodes) {
    const nodeMeta = meta.node?.(n.type) || {};
    const hay = norm([n.name, n.code, n.serial, n.address, n.type, nodeMeta.label].filter(Boolean).join(' '));
    if (!hay.includes(q)) continue;
    push({
      kind: 'node',
      id: n.id,
      label: n.name || n.code || n.id,
      sub: `${nodeMeta.short || n.type || 'NODE'}${n.code ? ` · ${n.code}` : ''} · ${n.status || ''}`,
      point: [n.lat, n.lng],
      icon: nodeMeta.icon || 'pin',
      color: nodeMeta.color || '#8ba0bd',
    });
  }

  for (const c of cables) {
    const cableMeta = meta.cable?.(c.type) || {};
    const hay = norm([c.name, c.code, c.type, cableMeta.label, c.status].filter(Boolean).join(' '));
    if (!hay.includes(q)) continue;
    push({
      kind: 'cable',
      id: c.id,
      label: c.name || c.code || c.id,
      sub: `${cableMeta.label || c.type || 'Kabel'} · ${c.code || ''}`,
      point: Array.isArray(c.path) && c.path.length ? c.path[Math.floor(c.path.length / 2)] : null,
      icon: cableMeta.icon || 'cable',
      color: cableMeta.color || '#22d3ee',
    });
  }

  for (const f of faults) {
    const hay = norm([f.title, f.description, f.source, f.type].filter(Boolean).join(' '));
    if (!hay.includes(q)) continue;
    push({
      kind: 'fault',
      id: f.id,
      label: f.title || 'Gangguan',
      sub: `${f.source || 'manual'} · ${f.status || ''}`,
      point: Array.isArray(f.point) ? f.point : null,
      icon: 'alert-triangle',
      color: '#ff4d6d',
    });
  }

  return out.sort((a, b) => a.score - b.score || a.label.localeCompare(b.label)).slice(0, limit);
}

export default { parseCoordinate, searchObjects };
