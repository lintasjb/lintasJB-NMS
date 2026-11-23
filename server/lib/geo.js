// Geospatial helpers for lintasJB NMS.
// The fault locator works on WGS84 polylines. For production-grade PostGIS
// deployments see docs/postgis.sql for an optional spatial schema.

const EARTH_R = 6371008.8;

export const toRad = (d) => (d * Math.PI) / 180;
export const toDeg = (r) => (r * 180) / Math.PI;

/** Haversine distance in metres between [lat,lng] points. */
export function haversine(a, b) {
  if (!a || !b) return 0;
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Total length of a polyline in metres. */
export function pathLength(path = []) {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += haversine(path[i - 1], path[i]);
  return total;
}

export function bearing(a, b) {
  const [lat1, lng1] = a.map(toRad);
  const [lat2, lng2] = b.map(toRad);
  const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Move a point by distance (m) along a bearing (deg). */
export function destination(point, distanceM, bearingDeg) {
  const [lat, lng] = point.map(toRad);
  const br = toRad(bearingDeg);
  const d = distanceM / EARTH_R;
  const lat2 = Math.asin(
    Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(br)
  );
  const lng2 =
    lng +
    Math.atan2(
      Math.sin(br) * Math.sin(d) * Math.cos(lat),
      Math.cos(d) - Math.sin(lat) * Math.sin(lat2)
    );
  return [toDeg(lat2), ((toDeg(lng2) + 540) % 360) - 180];
}

/**
 * Interpolate a point at a distance (metres) measured from the A-end
 * of the polyline. Returns { point, ratio, segment, bearing }.
 */
export function pointAtDistance(path, distanceM) {
  if (!Array.isArray(path) || path.length === 0) return null;
  if (path.length === 1) {
    return { point: [...path[0]], ratio: 0, segment: 0, bearing: 0, distanceM: 0 };
  }
  const total = pathLength(path);
  const target = Math.max(0, Math.min(total, Number(distanceM) || 0));
  let walked = 0;
  for (let i = 1; i < path.length; i += 1) {
    const seg = haversine(path[i - 1], path[i]);
    if (walked + seg >= target || i === path.length - 1) {
      const ratio = seg > 0 ? (target - walked) / seg : 0;
      const [lat1, lng1] = path[i - 1];
      const [lat2, lng2] = path[i];
      return {
        point: [lat1 + (lat2 - lat1) * ratio, lng1 + (lng2 - lng1) * ratio],
        ratio: total > 0 ? target / total : 0,
        segment: i - 1,
        bearing: bearing(path[i - 1], path[i]),
        distanceM: target,
        totalM: total,
      };
    }
    walked += seg;
  }
  return {
    point: [...path[path.length - 1]],
    ratio: 1,
    segment: path.length - 2,
    bearing: 0,
    distanceM: total,
    totalM: total,
  };
}

/** Nearest point on a polyline to a [lat,lng] point. */
export function nearestOnPath(path, point) {
  if (!Array.isArray(path) || path.length === 0) return null;
  let best = null;
  let walked = 0;
  const total = pathLength(path);
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const seg = haversine(a, b);
    // Project in a local planar approximation (adequate at FTTH scale).
    const k = Math.cos(toRad((a[0] + b[0]) / 2));
    const ax = a[1] * k;
    const ay = a[0];
    const bx = b[1] * k;
    const by = b[0];
    const px = point[1] * k;
    const py = point[0];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const proj = [ay + dy * t, (ax + dx * t) / k];
    const dist = haversine(proj, point);
    if (!best || dist < best.distanceM) {
      best = {
        point: proj,
        distanceM: dist,
        alongM: walked + seg * t,
        ratio: total > 0 ? (walked + seg * t) / total : 0,
        segment: i - 1,
      };
    }
    walked += seg;
  }
  return best;
}

export function dms(value, isLat) {
  const dir = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = ((minFloat - min) * 60).toFixed(1);
  return `${deg}° ${min}' ${sec}" ${dir}`;
}

export function formatCoord(latlng) {
  if (!latlng) return '-';
  const [lat, lng] = latlng;
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

export function formatDistance(m) {
  const n = Number(m) || 0;
  if (n >= 1000) return `${(n / 1000).toFixed(2)} km`;
  return `${n.toFixed(1)} m`;
}

export function bboxOf(points = []) {
  if (!points.length) return null;
  let minLat = 90;
  let maxLat = -90;
  let minLng = 180;
  let maxLng = -180;
  for (const [lat, lng] of points) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return { minLat, maxLat, minLng, maxLng };
}

/** Points every `step` metres along a path (used by the KML exporter / heatmap). */
export function samplePath(path, step = 50) {
  const total = pathLength(path);
  const out = [];
  for (let d = 0; d <= total; d += step) {
    const at = pointAtDistance(path, d);
    if (at) out.push(at.point);
  }
  return out;
}

export default {
  haversine,
  pathLength,
  pointAtDistance,
  nearestOnPath,
  dms,
  formatCoord,
  formatDistance,
  destination,
  bboxOf,
  samplePath,
};
