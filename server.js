const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const path = require('path');
const fs = require('fs');

// Load .env before Next.js starts — use absolute path so it works regardless of cwd
const envProd = path.join(__dirname, '.env.production');
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envProd)) {
  require('dotenv').config({ path: envProd });
  console.log('> Loaded env from .env.production');
} else if (fs.existsSync(envFile)) {
  require('dotenv').config({ path: envFile });
  console.log('> Loaded env from .env');
} else {
  console.warn('> WARNING: No .env or .env.production file found!');
}

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = process.env.PORT || 3000;
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer(async (req, res) => {
    try {
      // Be sure to pass `true` as the second argument to `url.parse`.
      // This tells it to parse the query portion of the URL.
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  })
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
});
