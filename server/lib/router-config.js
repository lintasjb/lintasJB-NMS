import { unseal } from './secret.js';

/**
 * Ambil password router dari sumber yang tersedia, berurutan:
 *   1. override eksplisit (mis. input form test koneksi)
 *   2. environment variable (passwordEnv) bila terisi
 *   3. password tersegel di database
 * Password plaintext tidak pernah disimpan di record router.
 */
export function routerPassword(router, override) {
  if (override !== undefined && override !== null && override !== '') return String(override);
  const envName = String(router.passwordEnv || '').trim();
  if (envName && process.env[envName]) return String(process.env[envName]);
  if (router.password) return String(router.password);
  if (router.passwordEnc) return unseal(router.passwordEnc);
  return '';
}

/** Salinan config router dengan password siap pakai untuk adapter. */
export function routerConfig(router, override = {}) {
  const merged = { ...router, ...override };
  return { ...merged, password: routerPassword(merged, override.password) };
}
