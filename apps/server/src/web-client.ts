import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import { logger } from './logger.js';

/** Paths that belong to the API and must never fall back to the SPA shell. */
const API_PREFIXES = ['/api/', '/uploads/', '/socket.io/'];

/** Files that must be revalidated on every load so a deploy reaches players. */
const NO_CACHE_FILES = new Set(['index.html', 'sw.js', 'manifest.webmanifest', 'offline.html']);

/**
 * Serves the built web client (apps/web/dist) from the API process, so one
 * container and one port carry the whole site. Mirrors the old nginx rules:
 * hashed assets are immutable, the PWA files are never cached, and any other
 * GET falls back to index.html for client-side routes.
 */
export function mountWebClient(app: Express, distDir: string): void {
  const indexFile = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexFile)) {
    logger.warn({ distDir }, 'WEB_DIST_DIR has no index.html; the web client is not served');
    return;
  }

  app.use(
    express.static(distDir, {
      index: false,
      setHeaders(res, filePath) {
        const name = path.basename(filePath);
        if (NO_CACHE_FILES.has(name)) {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=86400');
        }
        if (name === 'manifest.webmanifest') {
          res.setHeader('Content-Type', 'application/manifest+json');
        }
      }
    })
  );

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (API_PREFIXES.some((prefix) => req.path.startsWith(prefix)) || req.path === '/api') return next();
    // A missing hashed asset is a real 404, not a client-side route.
    if (req.path.startsWith('/assets/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });

  logger.info({ distDir }, 'Serving the web client');
}
