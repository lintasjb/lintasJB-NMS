/* lintasJB NMS — client side geodesic helpers (mirror of server/lib/geo.js) */
const R = 6371008.8;

export function haversine(a, b) {
  if (!a || !b) return 0;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLength(path = []) {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += haversine(path[i - 1], path[i]);
  return total;
}

export function pointAtDistance(path = [], targetM = 0) {
  if (!Array.isArray(path) || path.length < 2) return null;
  const total = pathLength(path);
  if (!total) return null;
  let remaining = Math.max(0, Math.min(total, Number(targetM) || 0));
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const seg = haversine(a, b);
    if (remaining <= seg || i === path.length - 1) {
      const t = seg ? remaining / seg : 0;
      return {
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        distanceM: total - seg + Math.min(remaining, seg),
        totalM: total,
        ratio: (total - seg + Math.min(remaining, seg)) / total,
      };
    }
    remaining -= seg;
  }
  return { point: path[path.length - 1], distanceM: total, totalM: total, ratio: 1 };
}

export function midpoint(path = []) {
  return pointAtDistance(path, pathLength(path) / 2)?.point || null;
}

export function nearestNode(nodes, point, types = null) {
  let best = null;
  for (const node of nodes || []) {
    if (types && !types.includes(node.type)) continue;
    const d = haversine([node.lat, node.lng], point);
    if (!best || d < best.distance) best = { node, distance: d };
  }
  return best?.node || null;
}

export function bearing(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x = Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) - Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export default { haversine, pathLength, pointAtDistance, midpoint, nearestNode, bearing };
