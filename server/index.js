import express from 'express';
import cors from 'cors';
import multer from 'multer';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  getPool,
  testConnection,
  getConnectionStatus,
  configurePoolFromManual,
  resetPool,
  reconnectFromEnvFile,
} from './db.js';
import { processWorkbook } from './processWorkbook.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, '..', 'dist');
const indexPath = path.join(distPath, 'index.html');
const hasUi = fs.existsSync(indexPath);

const app = express();
const upload = multer({
  dest: process.env.UPLOAD_DIR || os.tmpdir(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

app.use(cors({ origin: true }));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/connection-status', (req, res) => {
  try {
    res.json({ ok: true, ...getConnectionStatus() });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

app.post('/api/connect', async (req, res) => {
  try {
    const { host, port, user, password, database } = req.body || {};
    const status = await configurePoolFromManual({
      host,
      port,
      user,
      password,
      database,
    });
    res.json({ ok: true, message: 'Connected to MySQL.', ...status });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message });
  }
});

app.post('/api/disconnect', (req, res) => {
  resetPool(true);
  const after = getConnectionStatus();
  res.json({
    ok: true,
    message: after.envFileConfigured
      ? 'Disconnected. Use “Connect from .env” or enter credentials below.'
      : 'Disconnected. Connect again with your MySQL user (VPN on).',
    ...after,
  });
});

app.post('/api/connect-env', async (req, res) => {
  try {
    const status = await reconnectFromEnvFile();
    res.json({ ok: true, message: 'Connected using .env file.', ...status });
  } catch (e) {
    res.status(400).json({ ok: false, message: e.message });
  }
});

app.post('/api/test-db', async (req, res) => {
  try {
    await testConnection();
    res.json({ ok: true, message: 'Connected to MySQL.' });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

app.post('/api/process', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, message: 'Missing file (form field name: file).' });
  }

  let pool = null;
  try {
    pool = getPool();
  } catch {
    pool = null;
  }

  try {
    const buf = fs.readFileSync(req.file.path);
    try {
      fs.unlinkSync(req.file.path);
    } catch {
      /* ignore */
    }
    const result = await processWorkbook(buf, pool);
    const status = result.ok ? 200 : 400;
    res.status(status).json(result);
  } catch (e) {
    try {
      if (req.file?.path) fs.unlinkSync(req.file.path);
    } catch {
      /* ignore */
    }
    res.status(500).json({ ok: false, message: e.message });
  }
});

if (hasUi) {
  app.use(express.static(distPath, { index: 'index.html' }));
}

app.get('/', (req, res) => {
  if (hasUi) {
    return res.sendFile(indexPath);
  }
  res
    .type('text/plain')
    .send(
      'LSO API is running. UI not built yet: run npm run build so dist/ exists before deploy.'
    );
});

if (hasUi) {
  app.get(/^\/(?!api\/).*/, (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(indexPath, (err) => {
      if (err) next(err);
    });
  });
}

const PORT = Number(process.env.PORT || 3001);
const LISTEN_HOST =
  process.env.LISTEN_HOST || (process.env.WEBSITE_SITE_NAME ? '0.0.0.0' : '127.0.0.1');
app.listen(PORT, LISTEN_HOST, () => {
  const ui = hasUi ? 'UI + API' : 'API only (no dist/index.html)';
  console.log(`LSO benefit update (${ui}): http://${LISTEN_HOST}:${PORT}`);
  if (!hasUi) {
    console.warn(`Missing ${indexPath}. Deploy must include npm run build output.`);
  }
});
