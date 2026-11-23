/* lintasJB NMS — daftar tipe animasi kabel.
 * Satu sumber kebenaran untuk UI (public/js/ui.js) dan validasi server
 * (server/routes/network.js), supaya opsi baru tidak ditolak saat disimpan. */
export const CABLE_ANIMATIONS = {
  flow: 'Flow (aliran data)',
  glowflow: 'Glow Flow (aliran bercahaya)',
  comet: 'Comet (komet data)',
  packet: 'Packet (paket berjalan)',
  wave: 'Wave (gelombang)',
  laser: 'Laser (sinar cepat)',
  rainbow: 'Rainbow (warna bergerak)',
  pulse: 'Pulse (denyut)',
  dash: 'Dash (putus-putus)',
  glow: 'Glow (cahaya statis)',
  breath: 'Breath (napas cahaya)',
  static: 'Statis',
  none: 'Tanpa animasi',
};

export const CABLE_ANIMATION_TYPES = Object.keys(CABLE_ANIMATIONS);
