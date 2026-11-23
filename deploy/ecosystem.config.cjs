/* =============================================================================
 * lintasJB NMS — PM2 ecosystem
 * Jalankan dari root project:
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save
 * ========================================================================== */
const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'lintasjb-nms',
      // Working directory HARUS root project agar folder `data/` ditemukan.
      cwd: path.join(__dirname, '..'),
      script: path.join(__dirname, '..', 'server', 'index.js'),
      // Aplikasi memakai store JSON in-process + SSE, jadi harus 1 instance.
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      time: true,
      env: {
        NODE_ENV: 'production',
        // PORT dan DATA_DIR dibaca dari .env di root project.
      },
    },
  ],
};
