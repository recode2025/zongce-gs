import { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Empty, Form, Grid, Input, Row, Spin, Table, Tabs, Tag,
} from 'antd';
import { api } from './api.js';

// 图标用内联 SVG，避免打包整个 @ant-design/icons（省 ~600KB）
const svgProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
const LogoutIcon = () => (<svg {...svgProps}><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>);

// 三类得分用固定色相（文字一律用墨色，色块只承载类别身份）
const CATEGORY_COLOR = { pinde: '#2a78d6', xueye: '#eb6834', wenti: '#1baf7a' };

const DEFAULT_ROUND = '第二轮';
const fmt = (v) => (typeof v === 'number' ? Number(v.toFixed(2)) : v);

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
      <aside className="lp-side">
        <div className="lp-head">
          <span className="lp-seal">综测</span>
          <span className="lp-school">大连外国语大学</span>
        </div>

        <div className="lp-intro">
          <h1 className="lp-title">综合素质评价<br />成绩查询</h1>
          <p className="lp-desc">
            {roundLabel}综测结果公示期间，同学可登录查询本人的各项得分、专业排名与年级排名。
          </p>
          <dl className="lp-meta">
            <div><dt>轮次</dt><dd>{roundLabel}</dd></div>
            <div><dt>账号</dt><dd>数字大外统一身份认证</dd></div>
            <div><dt>范围</dt><dd>仅可查询本人成绩</dd></div>
          </dl>
        </div>

        <div className="lp-side-foot">如对成绩有疑问，请在公示期内联系学院综测负责人</div>
      </aside>

      <main className="lp-main">
        <div className="lp-form">
          <h2 className="lp-form-title">登录</h2>
          <p className="lp-form-sub">请使用「数字大外」账号和密码</p>

          {error && <Alert className="lp-alert" type="error" showIcon message={error} />}

          <Form form={form} layout="vertical" size="large" onFinish={submit} requiredMark={false}>
            <Form.Item label="学号" name="username" rules={[{ required: true, message: '请输入学号' }]}>
              <Input placeholder="9 位学号" autoComplete="username" inputMode="numeric" autoFocus />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password placeholder="统一身份认证密码" autoComplete="current-password" />
            </Form.Item>
            <Form.Item label="验证码" required>
              <div className="captcha-row">
                <Form.Item name="captchaText" noStyle rules={[{ required: true, message: '请输入验证码' }]}>
                  <Input placeholder="右侧字符" maxLength={4} autoComplete="off" />
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
            密码仅用于向学校统一身份认证核验身份，本站不保存。
          </p>
        </div>
        <div className="lp-main-foot">学生综合素质评价 · {roundLabel}</div>
      </main>
    </div>
  );
}

/* ================= 顶栏 ================= */
function TopBar({ roundLabel, name, onLogout }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-title">
          <span className="topbar-mark">综测</span>
          <span className="topbar-text">综合素质评价成绩查询</span>
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

/* ================= 明细表 ================= */
function CategoryTable({ category }) {
  // 手机端（<768px）收紧「得分/备注」定宽并改紧凑行距，
  // 否则两列桌面定宽会把「测评项目」列挤成一字一行的竖排
  const compact = Grid.useBreakpoint().md === false;
  const rows = (category.items ?? []).map((it, i) => ({ key: i, ...it }));
  return (
    <Table
      size={compact ? 'small' : 'middle'}
      pagination={false}
      dataSource={rows}
      summary={() => (
        <Table.Summary.Row className="table-sum">
          <Table.Summary.Cell index={0}><strong>{category.label}总分</strong></Table.Summary.Cell>
          <Table.Summary.Cell index={1} align="right">
            <strong style={{ fontSize: 16 }}>{fmt(category.total)}</strong>
          </Table.Summary.Cell>
          <Table.Summary.Cell index={2} />
        </Table.Summary.Row>
      )}
    >
      <Table.Column title="测评项目" dataIndex="label" key="label" />
      <Table.Column
        title="得分"
        dataIndex="value"
        key="value"
        align="right"
        width={compact ? 88 : 140}
        render={(v) => {
          if (v === null || v === undefined) {
            return <Tag color="orange">缓考，未进行计算</Tag>;
          }
          if (v === 0) return <span className="num-zero">–</span>;
          return <span className={v < 0 ? 'num-neg' : 'num'}>{fmt(v)}</span>;
        }}
      />
      <Table.Column
        title="备注"
        dataIndex="note"
        key="note"
        width={compact ? 110 : 200}
        render={(n) => (n && n.indexOf('缓考') < 0 ? <Tag bordered={false}>{n}</Tag> : null)}
      />
    </Table>
  );
}

/* ================= 排名块 ================= */
function RankBlock({ title, rank, denom, absent }) {
  return (
    <div className="rank-block">
      <div className="rank-title">{title}</div>
      {absent ? (
        <div>
          <div className="rank-num stat-value-muted">—</div>
          <div className="rank-sub">该专业未参与年级排名</div>
        </div>
      ) : (
        <div className="rank-num">
          {rank ?? '–'}
          <span className="rank-denom"> / {denom ?? '–'}</span>
        </div>
      )}
    </div>
  );
}

/* ================= 结果页 ================= */
function ResultView({ data, onLogout }) {
  const { rank, categories } = data;
  const total = fmt(data.total) ?? 0;
  const roundLabel = data.roundLabel ?? DEFAULT_ROUND;

  return (
    <>
      <TopBar roundLabel={roundLabel} name={data.name} onLogout={onLogout} />
      <main className="page">
        {/* 概览横幅 */}
        <section className="hero">
          <div className="hero-main">
            <div>
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
                {total}
                <span className="hero-score-unit">分</span>
              </div>
            </div>
          </div>
          {/* 总分构成：品德 / 学业 / 文体 */}
          <div className="comp-bar">
            {categories.map((c) => (
              <div
                key={c.key}
                className="comp-seg"
                style={{ width: `${Math.max(2, (c.total / (total || 1)) * 100)}%`, background: CATEGORY_COLOR[c.key] }}
              />
            ))}
          </div>
          <div className="comp-legend">
            {categories.map((c) => (
              <span key={c.key} className="comp-legend-item">
                <span className="comp-dot" style={{ background: CATEGORY_COLOR[c.key] }} />
                {c.label} {fmt(c.total)}
              </span>
            ))}
          </div>
        </section>

        {/* 三类得分 */}
        <Row gutter={[14, 14]} className="section">
          {categories.map((c) => {
            const share = total ? Math.max(0, Math.min(100, (c.total / total) * 100)) : 0;
            return (
              <Col xs={24} sm={8} key={c.key}>
                <Card className="stat-tile">
                  <div className="stat-label">
                    <span className="stat-chip" style={{ background: CATEGORY_COLOR[c.key] }} />
                    {c.label}
                  </div>
                  <div className="stat-value">{fmt(c.total)}</div>
                  <div className="stat-track">
                    <div className="stat-fill" style={{ width: `${share}%`, background: CATEGORY_COLOR[c.key] }} />
                  </div>
                  <div className="stat-share">占总分 {share.toFixed(1)}%</div>
                </Card>
              </Col>
            );
          })}
        </Row>

        {/* 排名 */}
        <Card className="section panel" title={<span className="panel-title">综测排名</span>} extra={<Tag color="blue" bordered={false}>{roundLabel}</Tag>}>
          <Row>
            <Col xs={24} sm={12} className="rank-col">
              <RankBlock
                title={`专业排名 · ${data.major}`}
                rank={rank.majorRank}
                denom={rank.majorCount}
              />
            </Col>
            <Col xs={24} sm={12}>
              <RankBlock
                title="年级总排名"
                rank={rank.totalRank}
                denom={rank.totalCount}
                absent={rank.totalRank == null}
              />
            </Col>
          </Row>
        </Card>

        {/* 分项明细 */}
        <Card className="section panel" title={<span className="panel-title">分项明细</span>}>
          <Tabs
            items={categories.map((c) => ({
              key: c.key,
              label: (
                <span className="tab-label">
                  <span className="comp-dot" style={{ background: CATEGORY_COLOR[c.key] }} />
                  {c.label}
                </span>
              ),
              children: <CategoryTable category={c} />,
            }))}
          />
        </Card>

        <footer className="foot-note">
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
