import { unseal } from './secret.js';

/**
 * Siapkan konfigurasi OLT untuk adapter: password dan private key diambil dari
 * override (form/draft), lalu record tersegel. Nilai plaintext tidak pernah
 * dikirim kembali ke klien.
 */
export function oltConfig(olt, override = {}) {
  const merged = { ...olt, ...override };
  const password = override.password !== undefined && override.password !== null && override.password !== ''
    ? String(override.password)
    : merged.password
      ? String(merged.password)
      : unseal(merged.passwordEnc);

  let sshPrivateKey = override.sshPrivateKey || merged.sshPrivateKey || '';
  if (!sshPrivateKey && merged.sshKeyEnc) sshPrivateKey = unseal(merged.sshKeyEnc);

  return {
    ...merged,
    password: password || '',
    sshPrivateKey: sshPrivateKey || '',
    sshKeyPassphrase: override.sshKeyPassphrase || (merged.sshPassEnc ? unseal(merged.sshPassEnc) : ''),
    port: Number(merged.port) || (merged.protocol === 'ssh' ? 22 : merged.protocol === 'snmp' ? 161 : 80),
    protocol: String(merged.protocol || 'http').toLowerCase(),
  };
}

export default oltConfig;
