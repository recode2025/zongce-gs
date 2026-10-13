import { Fragment, useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Form, Input, Spin, Tag } from 'antd';
import { api } from './api.js';

// 图标用内联 SVG，避免打包整个 @ant-design/icons（省 ~600KB）
const svgProps = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
const LogoutIcon = () => (<svg {...svgProps} width={16} height={16}><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>);
const UserIcon = () => (<svg {...svgProps}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>);
const LockIcon = (p) => (<svg {...svgProps} {...p}><rect x="4" y="10" width="16" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>);
const ShieldIcon = () => (<svg {...svgProps}><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>);
const ChartIcon = () => (<svg {...svgProps}><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></svg>);
const PodiumIcon = () => (<svg {...svgProps}><path d="M9 21V9h6v12" /><path d="M3 21v-7h6" /><path d="M15 21v-5h6v5" /><path d="M2 21h20" /><path d="M12 3l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 5.1l2-.3z" /></svg>);
const AwardIcon = () => (<svg {...svgProps}><circle cx="12" cy="9" r="6" /><path d="M8.5 14.2L7 22l5-3 5 3-1.5-7.8" /></svg>);

// 三类得分用固定色相（dataviz 校验通过的前三槽位；文字一律用墨色，色块只承载类别身份）
const CATEGORIES = [
  { key: 'pinde', label: '品德行为表现', color: '#2a78d6' },
  { key: 'xueye', label: '学业表现', color: '#eb6834' },
  { key: 'wenti', label: '文体表现', color: '#1baf7a' },
];

const DEFAULT_ROUND = '大一学年度';
// 分数统一两位小数（与原表显示一致）
const score = (v) => (typeof v === 'number' ? v.toFixed(2) : '—');

/* ================= 登录页 ================= */
function LoginView({ roundLabel, onLogin }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [captcha, setCaptcha] = useState({ svg: '', token: '' });

  const refreshCaptcha = async () => {
    try {
      setCaptcha(await api('/api/captcha'));
    } catch {
      /* 网络异常时保留旧图，提交时会得到明确报错 */
    }
  };

  useEffect(() => {
    refreshCaptcha();
  }, []);

  const submit = async ({ username, password, captchaText }) => {
    setLoading(true);
    setError(null);
    try {
      await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password, captchaToken: captcha.token, captchaText }),
      });
      await onLogin();
    } catch (e) {
      setError(e.message);
      // 验证码一次一用：无论何种失败都换图并清空输入
      form.setFieldValue('captchaText', '');
      refreshCaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lp">
      <div className="lp-bg" aria-hidden="true" />
      <div className="lp-card">
        <section className="lp-brand">
          <div className="lp-brand-head">
            <span className="brand-mark brand-mark-glass">综</span>
            <div>
              <div className="lp-school">大连外国语大学</div>
              <div className="lp-school-sub">软件学院 · 学生综合素质评价</div>
            </div>
          </div>

          <div className="lp-intro">
            <span className="lp-pill"><span className="lp-pill-dot" />{roundLabel} · 结果公示中</span>
            <h1 className="lp-title">综测成绩查询</h1>
            <p className="lp-desc">
              公示期间，同学可登录查询本人的学年总分、各学期成绩、专业排名、年级排名及奖学金评定结果。
            </p>
          </div>

          <ul className="lp-features">
            <li>
              <span className="lp-feat-icon"><ChartIcon /></span>
              <div><b>学年总分</b><span>各学期综测成绩汇总，分项一目了然</span></div>
            </li>
            <li>
              <span className="lp-feat-icon"><PodiumIcon /></span>
              <div><b>专业排名 · 年级排名</b><span>排名全部公布，并列名次如实标注</span></div>
            </li>
            <li>
              <span className="lp-feat-icon"><AwardIcon /></span>
              <div><b>奖学金评定</b><span>评定结果与备注一并公示</span></div>
            </li>
          </ul>
        </section>

        <main className="lp-main">
          <div className="lp-form">
            <h2 className="lp-form-title">账号登录</h2>
            <p className="lp-form-sub">使用「数字大外」统一身份认证账号</p>

            {error && <Alert className="lp-alert" type="error" showIcon message={error} />}

            <Form form={form} layout="vertical" size="large" onFinish={submit} requiredMark={false}>
              <Form.Item label="学号" name="username" rules={[{ required: true, message: '请输入学号' }]}>
                <Input prefix={<UserIcon />} placeholder="9 位学号" autoComplete="username" inputMode="numeric" autoFocus />
              </Form.Item>
              <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password prefix={<LockIcon />} placeholder="统一身份认证密码" autoComplete="current-password" />
              </Form.Item>
              <Form.Item label="验证码" required>
                <div className="captcha-row">
                  <Form.Item name="captchaText" noStyle rules={[{ required: true, message: '请输入验证码' }]}>
                    <Input prefix={<ShieldIcon />} placeholder="右侧字符" maxLength={4} autoComplete="off" />
                  </Form.Item>
                  <button
                    type="button"
                    className="captcha-img"
                    title="看不清？点击换一张"
                    aria-label="验证码图片，点击换一张"
                    onClick={refreshCaptcha}
                    dangerouslySetInnerHTML={{ __html: captcha.svg }}
                  />
                </div>
              </Form.Item>
              <Button type="primary" htmlType="submit" className="lp-submit" block loading={loading}>
                登录并查询
              </Button>
            </Form>

            <p className="lp-note">
              <LockIcon width={14} height={14} />
              密码仅用于向学校统一身份认证核验身份，本站不保存
            </p>
          </div>
        </main>
      </div>
      <footer className="lp-foot">如对成绩有疑问，请在公示期内联系学院综测负责人</footer>
    </div>
  );
}

/* ================= 顶栏 ================= */
function TopBar({ roundLabel, name, onLogout }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-title">
          <span className="brand-mark brand-mark-sm">综</span>
          <span className="topbar-text">综测成绩查询</span>
          <Tag color="blue" bordered={false}>{roundLabel}</Tag>
        </div>
        <div className="topbar-right">
          {name && <span className="topbar-user">{name}</span>}
          <Button icon={<LogoutIcon />} onClick={onLogout}>退出</Button>
        </div>
      </div>
    </header>
  );
}

/* ================= 排名卡 ================= */
function RankTile({ title, rank, count, tied, scope }) {
  return (
    <div className="tile">
      <div className="tile-label">
        <span className="tile-icon"><PodiumIcon /></span>
        {title}
      </div>
      <div className="tile-value">
        {rank ?? '—'}
        <span className="tile-denom">/ {count ?? '—'}</span>
      </div>
      <div className="tile-sub">
        {tied && <span className="tile-badge">并列</span>}
        {scope ?? '名次 / 参与排名人数'}
      </div>
    </div>
  );
}

function ScholarshipTile({ value }) {
  // 原表多项奖学金以「、」分隔，如「校三等、文体奖学金」
  const awards = value ? value.split(/[、，,]/).map((s) => s.trim()).filter(Boolean) : [];
  return (
    <div className="tile tile-award">
      <div className="tile-label">
        <span className="tile-icon tile-icon-gold"><AwardIcon /></span>
        奖学金评定
      </div>
      {awards.length ? (
        <>
          <div className="award-list">
            {awards.map((a) => <span key={a} className="award">{a}</span>)}
          </div>
          <div className="tile-sub">本学年评定结果</div>
        </>
      ) : (
        <>
          <div className="tile-value tile-value-muted">—</div>
          <div className="tile-sub">本学年无奖学金评定记录</div>
        </>
      )}
    </div>
  );
}

/* ================= 学期成绩表 ================= */
function SemesterTable({ semesters, yearTotal }) {
  return (
    <div className="sem-scroll">
      <table className="sem-table">
        <thead>
          <tr>
            <th scope="col">测评项目</th>
            {semesters.map((s) => (
              <th scope="col" key={s.label}>
                {s.label}
                {s.missing && <span className="sem-missing">无成绩</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CATEGORIES.map((c) => (
            <tr key={c.key}>
              <th scope="row">
                <span className="cat-chip" style={{ background: c.color }} />
                {c.label}
              </th>
              {semesters.map((s) => (
                <td key={s.label} className={s.missing ? 'num-empty' : undefined}>{score(s[c.key])}</td>
              ))}
            </tr>
          ))}
          <tr className="sem-subtotal">
            <th scope="row">学期综测总分</th>
            {semesters.map((s) => (
              <td key={s.label} className={s.missing ? 'num-empty' : undefined}>{score(s.total)}</td>
            ))}
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">学年总分</th>
            <td colSpan={semesters.length}>{score(yearTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ================= 结果页 ================= */
function ResultView({ data, onLogout }) {
  const { rank, semesters } = data;
  const roundLabel = data.roundLabel ?? DEFAULT_ROUND;

  return (
    <>
      <TopBar roundLabel={roundLabel} name={data.name} onLogout={onLogout} />
      <main className="page">
        {/* 概览横幅 */}
        <section className="hero">
          <div className="hero-id">
            <div className="hero-hello">你好，</div>
            <div className="hero-name">{data.name}</div>
            <div className="hero-tags">
              <span className="hero-tag">学号 {data.studentId}</span>
              {data.major && <span className="hero-tag">{data.major}</span>}
              {data.clazz && <span className="hero-tag">{data.clazz}</span>}
            </div>
          </div>
          <div className="hero-score-box">
            <div className="hero-score-label">{roundLabel}综测总分</div>
            <div className="hero-score">
              {score(data.yearTotal)}
              <span className="hero-score-unit">分</span>
            </div>
            <div className="hero-parts">
              {semesters.map((s, i) => (
                <Fragment key={s.label}>
                  {i > 0 && <span className="hero-plus">+</span>}
                  <span className="hero-part">
                    {s.label} <b>{s.missing ? '无成绩' : score(s.total)}</b>
                  </span>
                </Fragment>
              ))}
            </div>
          </div>
        </section>

        {data.remark && (
          <Alert className="section remark" type="info" showIcon message={<>备注：{data.remark}</>} />
        )}

        {/* 排名 + 奖学金 */}
        <section className="section tiles">
          <RankTile
            title="年级排名"
            rank={rank.gradeRank}
            count={rank.gradeCount}
            tied={rank.gradeTied}
            scope={rank.gradeScope}
          />
          <RankTile
            title={`专业排名 · ${data.major}`}
            rank={rank.majorRank}
            count={rank.majorCount}
            tied={rank.majorTied}
          />
          <ScholarshipTile value={data.scholarship} />
        </section>

        {/* 学期成绩 */}
        <Card
          className="section panel"
          title={<span className="panel-title">学期成绩</span>}
          extra={<span className="panel-extra">单位：分</span>}
          styles={{ body: { padding: 0 } }}
        >
          <SemesterTable semesters={semesters} yearTotal={data.yearTotal} />
        </Card>

        <footer className="foot-note">
          排名按学年总分计，分数相同者名次并列<br />
          如对成绩有疑问，请在公示期内咨询学院综合素质评价负责人<br />
          数据导入时间：{data.importedAt ? new Date(data.importedAt).toLocaleString('zh-CN') : '–'}
        </footer>
      </main>
    </>
  );
}

/* ================= 无记录页 ================= */
function NoRecordView({ onLogout, me }) {
  const roundLabel = me?.roundLabel ?? DEFAULT_ROUND;
  return (
    <>
      <TopBar roundLabel={roundLabel} name={me?.name} onLogout={onLogout} />
      <main className="page">
        <Card className="panel" styles={{ body: { padding: '48px 24px' } }}>
          <Empty description="未查询到你的综测记录，请确认是否在本次综测评级范围内" />
          {me?.studentId && (
            <div className="norecord-info">
              <div>
                当前登录学号：<strong>{me.studentId}</strong>
                {me.name ? `（${me.name}）` : ''}
              </div>
              <div>{roundLabel}综测共覆盖 {me.studentCount ?? '–'} 名同学（软件学院各专业）</div>
              <div className="norecord-tip">
                若上面显示的学号与你的不一致，请联系管理员
              </div>
            </div>
          )}
        </Card>
      </main>
    </>
  );
}

/* ================= 根组件 ================= */
export default function App() {
  const [view, setView] = useState('boot'); // boot | login | result | norecord
  const [data, setData] = useState(null);
  const [me, setMe] = useState(null);

  const load = async () => {
    try {
      const meRes = await api('/api/me');
      setMe(meRes);
      if (!meRes.loggedIn) return setView('login');
      setData(await api('/api/score'));
      setView('result');
    } catch (e) {
      setView(e.code === 'NO_RECORD' ? 'norecord' : 'login');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const logout = async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch {
      /* 会话 cookie 会自然过期，前端照常回到登录页 */
    }
    setData(null);
    setMe((m) => (m ? { ...m, loggedIn: false, studentId: null, name: null } : m));
    setView('login');
  };

  if (view === 'boot') {
    return (
      <div className="boot">
        <Spin size="large" />
      </div>
    );
  }
  if (view === 'login') return <LoginView roundLabel={me?.roundLabel ?? DEFAULT_ROUND} onLogin={load} />;
  if (view === 'norecord') return <NoRecordView onLogout={logout} me={me} />;
  return <ResultView data={data} onLogout={logout} />;
}
