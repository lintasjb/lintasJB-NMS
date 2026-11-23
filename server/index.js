import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDb, DATA_DIR } from './lib/store.js';
import { bus } from './lib/events.js';
import { requireAuth } from './lib/auth.js';
import { getLicenseSecret } from './lib/secret.js';
import { scheduleMonitor, monitorStatus } from './monitors.js';
import authRoutes from './routes/auth.js';
import networkRoutes from './routes/network.js';
import settingsRoutes from './routes/settings.js';
import integrationRoutes from './routes/integrations.js';
import ioRoutes from './routes/io.js';
import billingRoutes from './routes/billing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PORT = Number(process.env.PORT) || 8787;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ---------------------------------------------------------------------------
// Realtime Server-Sent Events
// ---------------------------------------------------------------------------
const sseClients = new Set();
bus.on('event', (event) => {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
});

app.get('/api/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  sseClients.add(res);
  res.write(
    `event: hello\ndata: ${JSON.stringify({
      at: new Date().toISOString(),
      user: req.user.name,
      monitor: monitorStatus(),
    })}\n\n`
  );
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);
  heartbeat.unref?.();
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  const db = getDb();
  res.json({
    ok: true,
    app: 'lintasJB NMS',
    version: '1.0.0',
    instanceId: db.meta.instanceId,
    uptimeSec: Math.round(process.uptime()),
    nodeVersion: process.version,
    projects: db.projects.length,
    nodes: db.nodes.length,
    monitor: monitorStatus(),
    serverTime: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api', networkRoutes);
app.use('/api', settingsRoutes);
app.use('/api', integrationRoutes);
app.use('/api', ioRoutes);
app.use('/api', billingRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ error: `Endpoint API tidak ditemukan: ${req.method} ${req.originalUrl}` });
});

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '7d',
    immutable: false,
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  })
);
app.use(
  express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
      else if (/\.(js|css|mjs)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
      else res.setHeader('Cache-Control', 'public, max-age=3600');
    },
  })
);

app.get('/favicon.ico', (req, res) => res.redirect(302, '/assets/logo.svg'));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return;
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Terjadi kesalahan pada server.';
  if (err.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    message = 'Ukuran file terlalu besar (maksimal 25 MB).';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Body JSON tidak valid.';
  } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    status = 400;
    message = 'Field upload tidak sesuai.';
  }
  if (status >= 500) console.error('[error]', err.stack || err.message);
  res.status(status).json({ error: message });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const db = getDb();
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ██╗   ██╗ ███╗   ██╗████████╗ █████╗ ███████╗     ██╗██████╗ ');
  console.log('  ██║   ██║ ████╗  ██║╚══██╔══╝██╔══██╗██╔════╝     ██║██╔══██╗');
  console.log('  ██║   ██║ ██╔██╗ ██║   ██║   ███████║███████╗     ██║██████╔╝');
  console.log('  ██║   ██║ ██║╚██╗██║   ██║   ██╔══██║╚════██║██   ██║██╔══██╗');
  console.log('  ╚██████╔╝ ██║ ╚████║   ██║   ██║  ██║███████║╚█████╔╝██████╔╝');
  console.log('   ╚═════╝  ╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚══════╝ ╚════╝ ╚═════╝  NMS');
  console.log('');
  console.log(`  lintasJB NMS v1.0.0  •  http://localhost:${PORT}`);
  console.log(`  Data: ${DATA_DIR}`);
  console.log(`  License secret: ${getLicenseSecret() ? 'loaded' : 'missing'}`);
  console.log('  Login demo: admin@lintasjb.id / Admin123!');
  console.log('  Tekan Ctrl+C untuk berhenti.');
  console.log('');
  scheduleMonitor();
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

export default app;
