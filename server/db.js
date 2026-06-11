import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/** @type {import('mysql2/promise').Pool | null} */
let poolSingleton = null;

/** @type {'env' | 'manual' | null} */
let poolSource = null;

/** @type {{ host: string; port: number; user: string; database: string | null } | null} */
let poolMeta = null;

/** After explicit disconnect, do not silently recreate pool from .env until user reconnects. */
let skipEnvUntilExplicitReconnect = false;

function buildPoolConfig(host, port, user, password, database) {
  return {
    host,
    port,
    user,
    password: password ?? '',
    ...(database ? { database } : {}),
    waitForConnections: true,
    connectionLimit: 5,
  };
}

export function tryLoadPoolFromEnv() {
  if (poolSingleton || skipEnvUntilExplicitReconnect) return;

  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = Number(process.env.MYSQL_PORT || 3306);
  const user = process.env.MYSQL_USER;
  const password = process.env.MYSQL_PASSWORD ?? '';
  const database = process.env.MYSQL_DATABASE || undefined;

  if (!user) return;

  poolSingleton = mysql.createPool(buildPoolConfig(host, port, user, password, database));
  poolSource = 'env';
  poolMeta = { host, port, user, database: database ?? null };
}

/**
 * @param {boolean} userDisconnected - if true, .env auto-load stays off until reconnect-env or manual connect
 */
export function resetPool(userDisconnected = false) {
  if (poolSingleton) {
    poolSingleton.end().catch(() => {});
    poolSingleton = null;
  }
  poolSource = null;
  poolMeta = null;
  if (userDisconnected) {
    skipEnvUntilExplicitReconnect = true;
  }
}

/**
 * @returns {{ connected: boolean, source: 'env'|'manual'|null, host?: string, port?: number, user?: string, database?: string|null, envFileConfigured: boolean }}
 */
export function getConnectionStatus() {
  tryLoadPoolFromEnv();
  const envFileConfigured = Boolean(process.env.MYSQL_USER);

  if (!poolSingleton) {
    return {
      connected: false,
      source: null,
      envFileConfigured,
    };
  }

  return {
    connected: true,
    source: poolSource,
    host: poolMeta?.host,
    port: poolMeta?.port,
    user: poolMeta?.user,
    database: poolMeta?.database ?? null,
    envFileConfigured,
  };
}

export function getPool() {
  tryLoadPoolFromEnv();
  if (!poolSingleton) {
    throw new Error(
      'Database not connected. Use “Connect from .env” or “Connect with my credentials” in the web app, or create a .env file (VPN on).'
    );
  }
  return poolSingleton;
}

export async function configurePoolFromManual({
  host,
  port = 3306,
  user,
  password = '',
  database = '',
}) {
  if (!host || !String(host).trim()) {
    throw new Error('Host is required.');
  }
  if (!user || !String(user).trim()) {
    throw new Error('MySQL user is required.');
  }

  const h = String(host).trim();
  const p = Number(port) || 3306;
  const u = String(user).trim();
  const pw = password === undefined || password === null ? '' : String(password);
  const db = database && String(database).trim() ? String(database).trim() : undefined;

  const newPool = mysql.createPool(buildPoolConfig(h, p, u, pw, db));
  const conn = await newPool.getConnection();
  try {
    await conn.query('SELECT 1 AS ok');
  } finally {
    conn.release();
  }

  if (poolSingleton) {
    poolSingleton.end().catch(() => {});
  }

  poolSingleton = newPool;
  poolSource = 'manual';
  poolMeta = { host: h, port: p, user: u, database: db ?? null };
  skipEnvUntilExplicitReconnect = false;

  return getConnectionStatus();
}

/** Reconnect using .env after a disconnect. */
export async function reconnectFromEnvFile() {
  skipEnvUntilExplicitReconnect = false;
  if (poolSingleton) {
    poolSingleton.end().catch(() => {});
    poolSingleton = null;
    poolSource = null;
    poolMeta = null;
  }

  tryLoadPoolFromEnv();
  if (!poolSingleton) {
    throw new Error('No MYSQL_USER in .env. Copy .env.example to .env or use manual connect.');
  }

  const conn = await poolSingleton.getConnection();
  try {
    await conn.query('SELECT 1 AS ok');
  } finally {
    conn.release();
  }

  return getConnectionStatus();
}

export async function testConnection() {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.query('SELECT 1 AS ok');
  } finally {
    conn.release();
  }
}
