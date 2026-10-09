import { Router } from 'express';
import { buildLoginUrl, buildLogoutUrl, validateTicket, CasError } from '../lib/cas.js';
import { issueSession, clearSession } from '../session.js';
import { makeIpLimiter, makeConcurrencyGate } from '../middleware/rateLimit.js';
import config from '../config.js';

const router = Router();

// 回调要打学校 CAS 上游校验票据 —— 双重保护：IP 限速 + 全局并发闸门
// 回调是浏览器整页访问，被拒时跳回首页带错误码，而不是吐 JSON
const redirectReject = (res, status, body) => res.redirect(302, `/?login_error=${encodeURIComponent(body.code)}`);
const callbackIpLimiter = makeIpLimiter({ max: 20, message: '登录尝试过于频繁，请 1 分钟后再试', reject: redirectReject });
const casGate = makeConcurrencyGate({ maxConcurrent: 20, burst: 300, reject: redirectReject });

/**
 * 本站对外根地址。CAS 校验要求 service 前后完全一致，生产必须在 .env 配 PUBLIC_URL
 * （DCDN 终结 HTTPS 后回源是 http，从请求推断会得到错误协议）；开发环境按请求推断。
 */
function publicBase(req) {
  return config.publicUrl || `${req.protocol}://${req.get('host')}`;
}
const serviceUrl = (req) => `${publicBase(req)}/api/cas/callback`;

// 首页「登录」按钮 → 跳学校统一认证
router.get('/api/cas/login', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.redirect(302, buildLoginUrl(serviceUrl(req)));
});

// 学校 CAS 登录成功后带 ticket 回到这里
router.get('/api/cas/callback', callbackIpLimiter, casGate, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const fail = (code) => res.redirect(302, `/?login_error=${encodeURIComponent(code)}`);
  try {
    const { studentId, name } = await validateTicket(serviceUrl(req), String(req.query.ticket ?? ''));
    issueSession(res, { studentId, name });
    return res.redirect(302, '/');
  } catch (e) {
    if (e instanceof CasError) return fail(e.code);
    console.error('[auth] cas callback error:', e);
    return fail('INTERNAL');
  }
});

// 退出：清本站会话，并让学校 CAS 一并登出（否则再点登录会被 SSO 直接放行）
router.get('/api/logout', (req, res) => {
  clearSession(res);
  res.set('Cache-Control', 'no-store');
  res.redirect(302, buildLogoutUrl(`${publicBase(req)}/`));
});

export default router;
