import 'dotenv/config';

const env = (key, fallback) => {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
};

const num = (key, fallback) => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const isProd = process.env.NODE_ENV === 'production';

export default {
  port: num('PORT', 3000),
  workers: num('WORKERS', 0), // 0 = 自动（CPU 核数）
  // 生产环境缺密钥时 index.js 会拒绝启动；开发环境给默认值方便联调
  jwtSecret: env('JWT_SECRET', isProd ? '' : 'dev-only-secret'),
  sessionTtl: num('SESSION_TTL', 12 * 3600),
  roundLabel: env('ROUND_LABEL', '大一学年度'),
  casBaseUrl: env('CAS_BASE_URL', 'https://cas.dlufl.edu.cn'),
  isProd,
};
