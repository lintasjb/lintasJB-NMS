/* lintasJB NMS — page lifecycle helpers */
let cleanups = [];

export function registerCleanup(fn) {
  if (typeof fn === 'function') cleanups.push(fn);
  return fn;
}

export function runCleanup() {
  const list = cleanups;
  cleanups = [];
  for (const fn of list) {
    try { fn(); } catch (err) { console.warn('[cleanup]', err); }
  }
}

export default { registerCleanup, runCleanup };
