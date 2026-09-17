import { Router } from 'express';
import { casLogin, CasError } from '../lib/cas.js';
import { createCaptcha, verifyCaptcha } from '../lib/captcha.js';
import { issueSession, clearSession, readSession } from '../session.js';
import { makeIpLimiter, makeConcurrencyGate } from '../middleware/rateLimit.js';

const router = Router();

// 登录要打学校 CAS 上游 —— 双重保护：IP 限速 + 全局并发闸门
const loginIpLimiter = makeIpLimiter({ max: 10, message: '登录尝试过于频繁，请 1 分钟后再试' });
const casGate = makeConcurrencyGate({ maxConcurrent: 20, burst: 300 });
const captchaLimiter = makeIpLimiter({ max: 30, message: '请求过于频繁，请稍后再试' });

// 图形验证码：纯 CPU 生成 SVG + 签名，无状态，无性能影响
router.get('/api/captcha', captchaLimiter, (req, res) => {
  const { svg, token } = createCaptcha();
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, data: { svg, token } });
});

router.post('/api/login', loginIpLimiter, casGate, async (req, res) => {
  const { username, password, captchaToken, captchaText } = req.body ?? {};

  // 验证码先于 CAS 校验（错误时完全不触碰学校上游）
  if (!verifyCaptcha(captchaToken, captchaText)) {
    return res.status(400).json({ ok: false, code: 'CAPTCHA_WRONG', message: '验证码错误或已过期，请重新输入' });
  }

  try {
    const { studentId, name } = await casLogin(String(username ?? ''), String(password ?? ''));
    issueSession(res, { studentId, name });
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, data: { studentId, name } });
  } catch (e) {
    if (e instanceof CasError) {
      const status =
        e.code === 'WRONG_CREDENTIALS' ? 401 :
        e.code === 'BAD_INPUT' ? 400 :
        e.code === 'CAS_UNAVAILABLE' ? 502 : 502;
      return res.status(status).json({ ok: false, code: e.code, message: e.message });
    }
    console.error('[auth] login error:', e);
    return res.status(500).json({ ok: false, code: 'INTERNAL', message: '服务异常，请稍后再试' });
  }
});

router.post('/api/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

export default router;
