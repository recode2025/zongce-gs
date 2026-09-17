import { Router } from 'express';
import { requireSession, readSession } from '../session.js';
import { store } from '../db.js';
import { makeIpLimiter } from '../middleware/rateLimit.js';
import config from '../config.js';

const router = Router();

const queryLimiter = makeIpLimiter({ max: 60, message: '查询过于频繁，请稍后再试' });

/**
 * 前 N 名不公布第一轮综测排名。
 * 关键：遮蔽发生在服务端 —— 被隐藏的排名数值绝不发给浏览器，
 * 前端只拿到 rankHidden 标记，抓包/改页面都拿不到真实名次。
 */
function maskRank(record) {
  const d = record.data;
  const judgeRank = config.hideRule === 'major' ? d.majorRank : d.totalRank;
  const hidden = Number.isFinite(judgeRank) && judgeRank > 0 && judgeRank <= config.hideTopN;
  return {
    majorRank: hidden ? null : (d.majorRank ?? null),
    majorCount: d.majorCount ?? null,
    totalRank: hidden ? null : (d.totalRank ?? null),
    totalCount: d.totalCount ?? null,
    rankHidden: hidden,
  };
}

router.get('/api/score', requireSession, queryLimiter, (req, res) => {
  const record = store.get(req.session.studentId);
  if (!record) {
    // CAS 账号存在，但综测表里没有该学号（未参评/非本年级等）
    console.warn(`[score] NO_RECORD studentId=${JSON.stringify(req.session.studentId)} name=${JSON.stringify(req.session.name ?? '')} 库内共 ${store.size} 条`);
    return res.status(404).json({
      ok: false,
      code: 'NO_RECORD',
      message: '未查询到你的综测记录，请确认是否在本次综测评级范围内',
    });
  }
  res.set('Cache-Control', 'no-store');
  return res.json({
    ok: true,
    data: {
      studentId: record.studentId,
      name: record.name,
      college: record.college,
      major: record.major,
      clazz: record.clazz,
      roundLabel: config.roundLabel,
      importedAt: store.meta.importedAt,
      categories: [
        { key: 'pinde', label: '品德行为表现', ...fmtCategory(record.data.pinde) },
        { key: 'xueye', label: '学业表现', ...fmtCategory(record.data.xueye) },
        { key: 'wenti', label: '文体表现', ...fmtCategory(record.data.wenti) },
      ],
      total: record.data.total ?? null,
      rank: maskRank(record),
    },
  });
});

const fmtCategory = (cat) => ({
  total: cat?.total ?? 0,
  items: cat?.items ?? [],
});

/** 轻量状态接口（探活/前端判断登录态） */
router.get('/api/me', (req, res) => {
  const session = readSession(req);
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    loggedIn: !!session,
    studentId: session?.studentId ?? null,
    name: session?.name ?? null,
    studentCount: store.size,
    roundLabel: config.roundLabel,
  });
});

export default router;
