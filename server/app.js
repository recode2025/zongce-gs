import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import scoreRoutes from './routes/score.js';
import config from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '../web/dist');

export function createApp() {
  const app = express();

  // 前面是 DCDN / nginx 代理，信任代理头（限流取真实 IP）
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use(express.json({ limit: '8kb' }));
  app.use(cookieParser());

  // 健康检查（DCDN / 负载均衡探活，不走会话）
  app.get('/healthz', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.use(authRoutes);
  app.use(scoreRoutes);

  // 静态托管前端（Vite 产物，带 hash 文件名 → immutable 长缓存，DCDN 可放心边缘缓存）
  if (fs.existsSync(WEB_DIST)) {
    app.use(
      express.static(WEB_DIST, {
        maxAge: '1y',
        immutable: true,
        index: false,
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache'); // HTML 永远回源校验
          }
        },
      })
    );
    // SPA fallback
    app.get(/^(?!\/api\/|\/healthz).*/, (req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  }

  // 404 + 统一错误处理
  app.use((req, res) => res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '接口不存在' }));
  app.use((err, req, res, next) => {
    console.error('[app] error:', err);
    if (res.headersSent) return next(err);
    res.status(500).json({ ok: false, code: 'INTERNAL', message: '服务异常，请稍后再试' });
  });

  return app;
}
