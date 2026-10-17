#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Settings = require('./public/settings.js');

const VERSION = '1.1.0';
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '127.0.0.1';
const MAX_BODY_BYTES = 256 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

const sseClients = new Set();
let lastFrame = null;
let lastFrameAt = 0;
let configStore = null;
let effectiveHost = DEFAULT_HOST;
let effectivePort = DEFAULT_PORT;

function printHelp() {
  console.log(`桌面音频频谱 · 本地服务 v${VERSION}

用法:
  node server.js [选项]

选项:
  -p, --port <端口>    监听端口（覆盖 config.json 和 PORT 环境变量）
      --host <地址>    监听地址，默认 127.0.0.1
  -h, --help           显示帮助
  -v, --version        显示版本

示例:
  node server.js --port 9000
  set PORT=9000 && node server.js
  node server.js --host 0.0.0.0 --port 8787

配置也可以直接修改同目录下的 config.json。`);
}

function parsePort(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`端口必须是 1-65535 之间的整数，收到: ${value}`);
  }
  return parsed;
}

function parseCli(argv) {
  const result = { help: false, version: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      result.version = true;
      continue;
    }
    if (arg === '--port' || arg === '-p') {
      if (!argv[i + 1]) throw new Error('--port 需要一个端口号。');
      result.port = parsePort(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--port=')) {
      result.port = parsePort(arg.slice('--port='.length));
      continue;
    }
    if (arg === '--host') {
      if (!argv[i + 1]) throw new Error('--host 需要一个监听地址。');
      result.host = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--host=')) {
      result.host = arg.slice('--host='.length);
      continue;
    }
    throw new Error(`未知参数: ${arg}（使用 --help 查看用法）`);
  }
  return result;
}

function initialConfig() {
  return {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    settings: Settings.sanitize(Settings.DEFAULTS)
  };
}

function readConfigFile() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      const fresh = initialConfig();
      writeConfigFile(fresh);
      return fresh;
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn(`[配置] config.json 不是合法 JSON，将使用默认设置。(${error.message})`);
    return initialConfig();
  }

  let port = DEFAULT_PORT;
  try {
    port = parsePort(parsed.port);
  } catch {
    port = DEFAULT_PORT;
  }

  return {
    host:
      typeof parsed.host === 'string' && parsed.host.trim()
        ? parsed.host.trim()
        : DEFAULT_HOST,
    port,
    settings: Settings.sanitize(parsed.settings)
  };
}

function writeConfigFile(store) {
  // Preserve a host/port that was edited by hand while the server was running.
  let host = store.host;
  let port = store.port;
  try {
    const onDisk = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (typeof onDisk.host === 'string' && onDisk.host.trim()) {
      host = onDisk.host.trim();
    }
    try {
      port = parsePort(onDisk.port);
    } catch {
      /* keep the startup port */
    }
  } catch {
    /* missing or invalid file: use the values we already have */
  }

  const payload = {
    host,
    port,
    settings: Settings.sanitize(store.settings)
  };
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function getPortFromEnv() {
  if (process.env.PORT === undefined || process.env.PORT === '') return undefined;
  try {
    return parsePort(process.env.PORT);
  } catch (error) {
    console.warn(`[配置] PORT 环境变量无效，已忽略: ${error.message}`);
    return undefined;
  }
}

function sendJson(res, statusCode, payload) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('请求体过大。'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('请求体不是合法 JSON。'));
      }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('请求已中断。')));
  });
}

function removeSseClient(client, notify = true) {
  if (!sseClients.delete(client)) return;
  client.closed = true;
  if (notify) broadcastStatus();
}

function sendSse(client, event, data) {
  if (client.closed || client.res.writableEnded) return false;
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    removeSseClient(client);
    return false;
  }
}

function broadcastRaw(raw, roleFilter) {
  for (const client of Array.from(sseClients)) {
    if (roleFilter && client.role !== roleFilter) continue;
    if (client.closed || client.res.writableEnded) {
      removeSseClient(client, false);
      continue;
    }
    try {
      client.res.write(raw);
    } catch {
      removeSseClient(client, false);
    }
  }
}

function broadcast(event, data, roleFilter) {
  broadcastRaw(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`, roleFilter);
}

function overlayCount() {
  let count = 0;
  for (const client of sseClients) {
    if (client.role === 'overlay') count += 1;
  }
  return count;
}

function statusPayload() {
  return {
    overlayClients: overlayCount(),
    captureActive: lastFrame !== null && Date.now() - lastFrameAt < 2000,
    serverTime: Date.now(),
    version: VERSION
  };
}

function broadcastStatus() {
  broadcast('status', statusPayload(), null);
}

function handleSse(req, res, url) {
  const role = url.searchParams.get('role') === 'overlay' ? 'overlay' : 'control';
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff'
  });
  if (res.socket) res.socket.setNoDelay(true);
  res.write('retry: 1800\n\n');

  const client = { res, role, closed: false };
  sseClients.add(client);

  sendSse(client, 'hello', {
    settings: configStore.settings,
    ...statusPayload()
  });

  if (role === 'overlay' && lastFrame && Date.now() - lastFrameAt < 5000) {
    sendSse(client, 'frame', lastFrame);
  }

  const cleanup = () => removeSseClient(client);
  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);

  broadcastStatus();
}

async function handleConfigUpdate(req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const candidate =
    body && typeof body === 'object' && body.settings && typeof body.settings === 'object'
      ? body.settings
      : body;
  const nextSettings = Settings.sanitize(candidate);

  const previous = configStore.settings;
  configStore.settings = nextSettings;
  try {
    writeConfigFile(configStore);
  } catch (error) {
    configStore.settings = previous;
    console.error(`[配置] 保存失败: ${error.message}`);
    sendJson(res, 500, { error: '配置保存失败，请检查目录写入权限。' });
    return;
  }

  broadcast('config', { settings: nextSettings }, null);
  sendJson(res, 200, { ok: true, settings: nextSettings });
}

async function handleFrame(req, res) {
  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  const frame = Settings.sanitizeFrame(body);
  if (!frame) {
    sendJson(res, 400, { error: '频谱帧无效。' });
    return;
  }

  lastFrame = frame;
  lastFrameAt = Date.now();
  broadcast('frame', frame, 'overlay');
  res.writeHead(204, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end();
}

function apiConfigPayload() {
  const address = httpServer.address();
  const actualPort = address && typeof address === 'object' ? address.port : effectivePort;
  const localHost = actualPort
    ? `127.0.0.1:${actualPort}`
    : `127.0.0.1:${effectivePort}`;
  return {
    version: VERSION,
    port: actualPort,
    host: effectiveHost,
    settings: configStore.settings,
    urls: {
      control: `http://${localHost}/`,
      overlay: `http://${localHost}/overlay.html`
    }
  };
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/events' && req.method === 'GET') {
    handleSse(req, res, url);
    return;
  }

  if (url.pathname === '/api/config' && req.method === 'GET') {
    sendJson(res, 200, apiConfigPayload());
    return;
  }

  if (url.pathname === '/api/config' && req.method === 'POST') {
    await handleConfigUpdate(req, res);
    return;
  }

  if (url.pathname === '/api/frame' && req.method === 'POST') {
    await handleFrame(req, res);
    return;
  }

  if (url.pathname === '/api/status' && req.method === 'GET') {
    sendJson(res, 200, { ...statusPayload(), port: apiConfigPayload().port });
    return;
  }

  sendJson(res, 404, { error: '接口不存在。' });
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  if (pathname === '/' || pathname === '') pathname = '/index.html';
  if (pathname === '/overlay' || pathname === '/overlay/') pathname = '/overlay.html';

  const normalized = path.posix.normalize(pathname);
  const filePath = path.resolve(PUBLIC_DIR, `.${normalized}`);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end('Not Found');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Length': stats.size
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.writableEnded) res.end();
    });
    stream.pipe(res);
  });
}

const httpServer = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((error) => {
      console.error(`[请求错误] ${error.message}`);
      if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误。' });
      else if (!res.writableEnded) res.end();
    });
    return;
  }

  serveStatic(req, res, url);
});

const heartbeat = setInterval(() => {
  broadcastRaw(': keep-alive\n\n', null);
}, 15000);
heartbeat.unref();

function shutdown(signal) {
  console.log(`\n[服务] 收到 ${signal}，正在关闭...`);
  clearInterval(heartbeat);
  for (const client of Array.from(sseClients)) {
    try {
      client.res.end();
    } catch {
      /* ignore */
    }
    sseClients.delete(client);
  }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function networkUrls(port) {
  const urls = [];
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        urls.push(`http://${entry.address}:${port}/`);
      }
    }
  }
  return urls;
}

function start() {
  let cli;
  try {
    cli = parseCli(process.argv.slice(2));
  } catch (error) {
    console.error(`\n参数错误: ${error.message}\n`);
    process.exit(1);
  }

  if (cli.help) {
    printHelp();
    return;
  }
  if (cli.version) {
    console.log(VERSION);
    return;
  }

  try {
    configStore = readConfigFile();
  } catch (error) {
    console.error(`[配置] 无法读取 config.json: ${error.message}`);
    process.exit(1);
  }

  effectiveHost = cli.host || process.env.HOST || configStore.host || DEFAULT_HOST;
  const envPort = getPortFromEnv();
  effectivePort =
    cli.port !== undefined ? cli.port : envPort !== undefined ? envPort : configStore.port;

  httpServer.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n[错误] 端口 ${effectivePort} 已被占用。`);
      console.error(`请换一个端口，例如: node server.js --port ${effectivePort + 1}\n`);
    } else if (error.code === 'EACCES') {
      console.error(`\n[错误] 没有权限监听 ${effectiveHost}:${effectivePort}。请换一个大于 1024 的端口。\n`);
    } else {
      console.error(`\n[错误] 服务启动失败: ${error.message}\n`);
    }
    process.exitCode = 1;
  });

  httpServer.listen(effectivePort, effectiveHost, () => {
    const address = httpServer.address();
    const actualPort = address && typeof address === 'object' ? address.port : effectivePort;
    const localHost =
      effectiveHost === '0.0.0.0' || effectiveHost === '::'
        ? '127.0.0.1'
        : effectiveHost.includes(':')
          ? `[${effectiveHost}]`
          : effectiveHost;

    console.log('');
    console.log('  ┌────────────────────────────────────────────────┐');
    console.log('  │   桌面音频频谱 · Desktop Audio Visualizer      │');
    console.log('  └────────────────────────────────────────────────┘');
    console.log('');
    console.log(`  控制台 / 采集端   http://${localHost}:${actualPort}/`);
    console.log(`  透明叠加层        http://${localHost}:${actualPort}/overlay.html`);
    console.log('');
    console.log('  使用步骤: 打开控制台 → 共享桌面音频 → 把叠加层地址填入直播姬浏览器源');
    console.log(`  配置文件         ${CONFIG_PATH}`);
    console.log('  修改端口         node server.js --port 9000（或修改 config.json）');
    console.log('');

    if (effectiveHost === '0.0.0.0' || effectiveHost === '::') {
      const urls = networkUrls(actualPort);
      if (urls.length) {
        console.log('  局域网地址（注意：桌面音频采集只在 localhost / HTTPS 下可用）:');
        for (const url of urls) console.log(`    ${url}`);
        console.log('');
      }
    }

    console.log('  按 Ctrl+C 停止服务。');
    console.log('');
  });
}

start();
