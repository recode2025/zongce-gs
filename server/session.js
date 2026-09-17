import jwt from 'jsonwebtoken';
import config from './config.js';

const COOKIE_NAME = 'zc_token';

export function issueSession(res, { studentId, name }) {
  const token = jwt.sign({ sid: studentId, name }, config.jwtSecret, {
    expiresIn: config.sessionTtl,
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd, // 生产走 https（DCDN/nginx 终结）
    maxAge: config.sessionTtl * 1000,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

/** 从 cookie 解出登录态；失败返回 null */
export function readSession(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return { studentId: payload.sid, name: payload.name };
  } catch {
    return null;
  }
}

export function requireSession(req, res, next) {
  const session = readSession(req);
  if (!session) {
    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED', message: '请先登录' });
  }
  req.session = session;
  next();
}
