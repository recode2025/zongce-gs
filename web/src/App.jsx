import { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Col, Empty, Grid, Row, Spin, Table, Tabs, Tag, Tooltip,
} from 'antd';
import { api } from './api.js';

// 图标用内联 SVG，避免打包整个 @ant-design/icons（省 ~600KB）
const svgProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
const LogoutIcon = () => (<svg {...svgProps}><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>);
const InfoIcon = () => (<svg {...svgProps} width={13} height={13}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></svg>);
const ShieldIcon = () => (<svg {...svgProps} width={15} height={15}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" /><path d="M9.5 12l2 2 3.5-4" /></svg>);
const ArrowIcon = () => (<svg {...svgProps} width={18} height={18}><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></svg>);
const KeyIcon = () => (<svg {...svgProps} width={18} height={18}><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2L20 3" /><path d="M16 7l3 3" /></svg>);

// 三类得分用固定色相（文字一律用墨色，色块只承载类别身份）
const CATEGORY_COLOR = { pinde: '#2a78d6', xueye: '#eb6834', wenti: '#1baf7a' };

const DEFAULT_ROUND = '第二轮';
const fmt = (v) => (typeof v === 'number' ? Number(v.toFixed(2)) : v);
const hideTip = (round, topN) =>
  `根据规定，${round}综测总排名前 ${topN ?? 30} 名的同学，其专业排名与总排名不予公布`;

// CAS 回调失败时服务端以 ?login_error=CODE 带回首页
const LOGIN_ERRORS = {
  TICKET_INVALID: '登录票据校验失败，请重新登录',
  BAD_INPUT: '登录票据缺失，请重新登录',
  CAS_UNAVAILABLE: '学校统一认证服务暂时不可用，请稍后再试',
  NO_USER_ID: '认证成功但未获取到学号信息，请联系管理员',
  RATE_LIMITED: '登录尝试过于频繁，请 1 分钟后再试',
  BUSY: '当前登录人数较多，请稍后再试',
  INTERNAL: '服务异常，请稍后再试',
};

function takeLoginError() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('login_error');
  if (!code) return null;
  params.delete('login_error');
  const qs = params.toString();
  window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  return LOGIN_ERRORS[code] ?? `登录失败（${code}），请重试`;
}

/* ================= 登录页 ================= */
function LoginView({ error, roundLabel }) {
  const [jumping, setJumping] = useState(false);
  const goCas = () => {
    setJumping(true);
    window.location.href = '/api/cas/login';
  };

  return (
    <div className="login-bg">
      <div className="login-grid" aria-hidden="true" />
      <div className="login-wrap">
        <section className="login-brand">
          <div className="brand-mark">综测</div>
          <div className="brand-school">大连外国语大学</div>
          <h1 className="brand-title">综合素质评价<br />成绩查询</h1>
          <div className="brand-round">
            <span className="brand-round-dot" />
            {roundLabel}结果公示中
          </div>
        </section>

        <Card className="login-card">
          <div className="login-card-title">登录查询</div>
          <div className="login-card-sub">使用学校统一身份认证，仅可查询本人成绩</div>

          {error && <Alert className="login-alert" type="error" showIcon message={error} />}

          <Button type="primary" className="login-btn" block loading={jumping} onClick={goCas}>
            {!jumping && <KeyIcon />}
            统一身份认证登录
            {!jumping && <ArrowIcon />}
          </Button>

          <ol className="login-steps">
            <li>点击按钮跳转至学校统一身份认证页面</li>
            <li>输入「数字大外」账号密码完成认证</li>
            <li>自动返回本站并显示你的综测成绩</li>
          </ol>

          <div className="login-notice">
            <ShieldIcon />
            <span>本站不接触你的密码，认证全程在学校系统完成</span>
          </div>
        </Card>
      </div>
      <div className="login-foot">学生综合素质评价 · {roundLabel}</div>
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
function RankBlock({ title, rank, denom, hidden, absent, tip }) {
  return (
    <div className="rank-block">
      <div className="rank-title">{title}</div>
      {hidden ? (
        <Tooltip title={tip}>
          <div className="rank-hidden">
            <span className="rank-hidden-badge">不公布</span>
            <div className="rank-sub"><InfoIcon /> 按规定不予公布</div>
          </div>
        </Tooltip>
      ) : absent ? (
        <div>
          <div className="rank-num stat-value-muted">—</div>
          <div className="rank-sub">该专业未参与年级排名</div>
        </div>
      ) : (
        <div className="rank-num">
          {rank}
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
  const tip = hideTip(roundLabel, data.hideTopN);

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
                hidden={rank.rankHidden}
                tip={tip}
              />
            </Col>
            <Col xs={24} sm={12}>
              <RankBlock
                title="年级总排名"
                rank={rank.totalRank}
                denom={rank.totalCount}
                hidden={rank.rankHidden}
                absent={!rank.rankHidden && rank.totalRank == null}
                tip={tip}
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
                当前登录账号：<strong>{me.studentId}</strong>
                {me.name ? `（${me.name}）` : ''}
              </div>
              <div>{roundLabel}综测共覆盖 {me.studentCount ?? '–'} 名同学（软件学院各专业）</div>
              <div className="norecord-tip">
                若学号与上面显示的不一致，说明学校认证返回的账号并非你的学号，请联系管理员
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
  const [loginError, setLoginError] = useState(null);

  useEffect(() => {
    const err = takeLoginError();
    (async () => {
      let meRes = null;
      try {
        meRes = await api('/api/me');
        setMe(meRes);
        if (!meRes.loggedIn) {
          setLoginError(err);
          return setView('login');
        }
        setData(await api('/api/score'));
        setView('result');
      } catch (e) {
        if (e.code === 'NO_RECORD') return setView('norecord');
        if (!meRes) setLoginError(e.message);
        setView('login');
      }
    })();
  }, []);

  // 走服务端跳转：清本站会话后一并登出学校 CAS
  const logout = () => {
    window.location.href = '/api/logout';
  };

  if (view === 'boot') {
    return (
      <div className="boot">
        <Spin size="large" />
      </div>
    );
  }
  if (view === 'login') return <LoginView error={loginError} roundLabel={me?.roundLabel ?? DEFAULT_ROUND} />;
  if (view === 'norecord') return <NoRecordView onLogout={logout} me={me} />;
  return <ResultView data={data} onLogout={logout} />;
}
