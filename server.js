const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env file if present
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  envFile.split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
} catch (e) { /* no .env file */ }

const PORT = 20000;
const STATIC_DIR = __dirname;
let NASA_API_KEY = process.env.NASA_API_KEY || 'DEMO_KEY';

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

// === Generic cache ===
const cache = new Map();
const CACHE_TTL_SHORT = 60 * 1000;     // 1 min (DSN — changes fast)
const CACHE_TTL_MED = 3 * 60 * 1000;   // 3 min (Horizons)
const CACHE_TTL_LONG = 30 * 60 * 1000; // 30 min (DONKI, Images)

function getCached(key, ttl) {
  const c = cache.get(key);
  if (c && Date.now() - c.time < ttl) return c.body;
  return null;
}

function setCache(key, body) {
  cache.set(key, { body, time: Date.now() });
}

// === Request queue for rate-limited APIs ===
let apiQueue = Promise.resolve();

function queuedFetch(url, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    apiQueue = apiQueue.then(() => new Promise((done) => {
      https.get(url, (apiRes) => {
        let body = '';
        apiRes.on('data', (chunk) => body += chunk);
        apiRes.on('end', () => {
          resolve({ statusCode: apiRes.statusCode, body, contentType });
          setTimeout(done, 400);
        });
      }).on('error', (err) => { reject(err); done(); });
    }));
  });
}

function proxyResponse(res, result, cacheKey, ttl) {
  if (result.statusCode === 200 && cacheKey) setCache(cacheKey, result.body);
  res.writeHead(result.statusCode, {
    'Content-Type': result.contentType || 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(result.body);
}

const server = http.createServer(async (req, res) => {
  const url = req.url;

  // ===== API Key configuration endpoint =====
  if (url === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { apiKey } = JSON.parse(body);
        if (apiKey && apiKey.length > 10) {
          NASA_API_KEY = apiKey;
          // Persist to .env
          try {
            fs.writeFileSync(path.join(__dirname, '.env'), `NASA_API_KEY=${apiKey}\n`);
          } catch (e) { /* ok if can't write */ }
          // Clear cache so new key is used
          cache.clear();
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true, message: 'API key configured' }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Invalid key' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'Bad request' }));
      }
    });
    return;
  }

  if (url === '/api/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      configured: NASA_API_KEY !== 'DEMO_KEY',
      keyPreview: NASA_API_KEY === 'DEMO_KEY' ? 'DEMO_KEY' : NASA_API_KEY.slice(0, 6) + '...',
    }));
    return;
  }

  // ===== 1. JPL Horizons Proxy =====
  if (url.startsWith('/api/horizons?')) {
    const query = url.slice('/api/horizons?'.length);
    const cached = getCached('hz:' + query, CACHE_TTL_MED);
    if (cached) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(cached); return; }

    try {
      const result = await queuedFetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${query}`);
      proxyResponse(res, result, 'hz:' + query, CACHE_TTL_MED);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ===== 2. DSN Now Proxy =====
  if (url === '/api/dsn') {
    const cached = getCached('dsn', CACHE_TTL_SHORT);
    if (cached) { res.writeHead(200, { 'Content-Type': 'text/xml', 'Access-Control-Allow-Origin': '*' }); res.end(cached); return; }

    try {
      const result = await queuedFetch('https://eyes.nasa.gov/dsn/data/dsn.xml', 'text/xml');
      proxyResponse(res, result, 'dsn', CACHE_TTL_SHORT);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ===== 3. DONKI Space Weather Proxy =====
  if (url.startsWith('/api/donki/')) {
    const donkiPath = url.slice('/api/donki/'.length);
    const cached = getCached('donki:' + donkiPath, CACHE_TTL_LONG);
    if (cached) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(cached); return; }

    try {
      const target = `https://api.nasa.gov/DONKI/${donkiPath}${donkiPath.includes('?') ? '&' : '?'}api_key=${NASA_API_KEY}`;
      const result = await queuedFetch(target);
      proxyResponse(res, result, 'donki:' + donkiPath, CACHE_TTL_LONG);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ===== 4. EPIC (Earth from deep space) =====
  if (url.startsWith('/api/epic')) {
    const epicPath = url.slice('/api/epic'.length) || '/api/natural';
    const cached = getCached('epic:' + epicPath, CACHE_TTL_LONG);
    if (cached) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(cached); return; }
    try {
      const result = await queuedFetch(`https://epic.gsfc.nasa.gov${epicPath}`);
      proxyResponse(res, result, 'epic:' + epicPath, CACHE_TTL_LONG);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ===== 5. APOD =====
  if (url === '/api/apod') {
    const cached = getCached('apod', CACHE_TTL_LONG);
    if (cached) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(cached); return; }
    try {
      const result = await queuedFetch(`https://api.nasa.gov/planetary/apod?api_key=${NASA_API_KEY}`);
      proxyResponse(res, result, 'apod', CACHE_TTL_LONG);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ===== 6. NeoWs (Near Earth Objects) =====
  if (url.startsWith('/api/neo')) {
    const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    const cached = getCached('neo:' + query, CACHE_TTL_LONG);
    if (cached) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(cached); return; }
    try {
      const result = await queuedFetch(`https://api.nasa.gov/neo/rest/v1/feed?${query}&api_key=${NASA_API_KEY}`);
      proxyResponse(res, result, 'neo:' + query, CACHE_TTL_LONG);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ===== 7. NASA Images API Proxy =====
  if (url.startsWith('/api/images?')) {
    const query = url.slice('/api/images?'.length);
    const cached = getCached('img:' + query, CACHE_TTL_LONG);
    if (cached) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(cached); return; }

    try {
      const result = await queuedFetch(`https://images-api.nasa.gov/search?${query}`);
      proxyResponse(res, result, 'img:' + query, CACHE_TTL_LONG);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ===== Static files =====
  const filePath = path.join(STATIC_DIR, url === '/' ? 'index.html' : url);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Artemis Tracker at http://localhost:${PORT}`);
  console.log('Proxies: /api/horizons, /api/dsn, /api/donki/*, /api/images');
});
