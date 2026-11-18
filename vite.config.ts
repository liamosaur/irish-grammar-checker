import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { APP_NAME } from './web/config.ts';

// Nothing may be fetched from anywhere but our own origin, except Cloudflare Web
// Analytics (a cookieless visit counter that Cloudflare Pages injects into the page:
// its script, and the endpoint it reports page views to). The CSP makes the browser
// enforce that rather than us merely promising it. Applied to the production build only, because the dev
// server needs inline scripts and a websocket. It goes into the page as a <meta>
// tag (works on any host) and into Cloudflare Pages' _headers file as a real
// header, which can also forbid framing (frame-ancestors is ignored in <meta>).
const CSP_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'self' https://static.cloudflareinsights.com",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://cloudflareinsights.com",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
];
const CSP = CSP_DIRECTIVES.join('; ');

// Cloudflare Pages _headers (https://developers.cloudflare.com/pages/configuration/headers/).
// Hashed assets never change; the page, service worker and size list must be revalidated
// so that a new deployment is picked up.
const HEADERS = `/*
  Content-Security-Policy: ${[...CSP_DIRECTIVES, "frame-ancestors 'none'"].join('; ')}
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
/assets.json
  Cache-Control: no-cache
`;

function walk(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name), base) : [path.relative(base, path.join(dir, d.name)).split(path.sep).join('/')],
  );
}

function site(): Plugin {
  let outDir = '';
  return {
    name: 'gramadoir-site',
    configResolved(cfg) { outDir = path.resolve(cfg.root, cfg.build.outDir); },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        let out = html.replaceAll('%APP_NAME%', APP_NAME);
        if (ctx.server === undefined) {
          out = out.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`);
        }
        return out;
      },
    },
    // After the bundle is written: record the size of each data file (so the
    // loader can show real progress), generate the service worker and the host's headers file.
    closeBundle() {
      if (!fs.existsSync(outDir)) return;
      const files = walk(outDir).filter((f) => f !== 'sw.js' && f !== 'assets.json' && f !== '_headers');
      const sizes: Record<string, number> = {};
      for (const f of files.filter((x) => x.endsWith('.json'))) sizes[path.basename(f)] = fs.statSync(path.join(outDir, f)).size;
      fs.writeFileSync(path.join(outDir, 'assets.json'), JSON.stringify(sizes));
      const shell = ['./', ...files.filter((f) => !f.endsWith('.json'))];
      const build = createHash('sha1').update(files.join('\n')).digest('hex').slice(0, 10);
      const tpl = fs.readFileSync(path.resolve('web/sw.template.js'), 'utf8');
      fs.writeFileSync(path.join(outDir, 'sw.js'), tpl.replace('__BUILD__', () => build).replace('__SHELL__', () => JSON.stringify(shell)));
      // Not served by Cloudflare Pages itself, so it must not be in the service worker's list above.
      fs.writeFileSync(path.join(outDir, '_headers'), HEADERS);
    },
  };
}

// Static site: everything (engine + data) is bundled and runs in the browser.
export default defineConfig({
  root: 'web',
  base: './', // works from any sub-path (GitHub Pages, Cloudflare Pages, ...)
  plugins: [site()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsInlineLimit: 0, // keep data files as separate, cacheable assets
    target: 'es2022',
  },
  worker: { format: 'es' },
});
