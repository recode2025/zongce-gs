import { useEffect, useState } from 'react';
import {
  Button, Card, Col, Empty, Form, Input, Row, Spin, Table, Tabs, Tag, Tooltip, message,
} from 'antd';
import { api } from './api.js';

// 4 个图标用内联 SVG，避免打包整个 @ant-design/icons（省 ~600KB）
const svgProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
const UserIcon = () => (<svg {...svgProps}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" /></svg>);
const LockIcon = () => (<svg {...svgProps}><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></svg>);
const LogoutIcon = () => (<svg {...svgProps}><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>);
const InfoIcon = () => (<svg {...svgProps}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></svg>);
const ShieldIcon = () => (<svg {...svgProps} width={15} height={15}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" /><path d="M9.5 12l2 2 3.5-4" /></svg>);

// 三类得分用固定色相（dataviz 校验通过的前三槽位；文字一律用墨色，色块只承载类别身份）
const CATEGORY_COLOR = { pinde: '#2a78d6', xueye: '#eb6834', wenti: '#1baf7a' };

const fmt = (v) => (typeof v === 'number' ? Number(v.toFixed(2)) : v);
const HIDE_TIP = '根据规定，第一轮综测总排名前 30 名的同学，其专业排名与总排名不予公布';

/* ================= 登录页 ================= */
function LoginView({ onLogin }) {
  const [loading, setLoading] = useState(false);
  const [captcha, setCaptcha] = useState({ svg: '', token: '' });

  const refreshCaptcha = async () => {
    try {
      const data = await api('/api/captcha');
      setCaptcha(data);
    } catch {
      /* 网络异常时保留旧图，提交时会得到明确报错 */
    }
  };

  useEffect(() => {
    refreshCaptcha();
  }, []);

  const submit = async ({ username, password, captchaText }) => {
    setLoading(true);
    try {
      await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password, captchaToken: captcha.token, captchaText }),
      });
      await onLogin();
    } catch (e) {
      message.error(e.message);
      refreshCaptcha(); // 无论何种失败都换一张验证码
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-bg">
      <div className="login-wrap">
        <Card className="login-card">
          <div className="login-logo">综测</div>
          <div className="login-school">大连外国语大学</div>
          <div className="login-title">综合素质评价成绩查询</div>
          <Form layout="vertical" size="large" onFinish={submit} requiredMark={false}>
            <Form.Item label="学号" name="username" rules={[{ required: true, message: '请输入学号' }]}>
              <Input prefix={<UserIcon />} placeholder="请输入学号" autoComplete="username" autoFocus allowClear />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockIcon />} placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>
            <Form.Item label="验证码" style={{ marginBottom: 14 }}>
              <div className="captcha-row">
                <Form.Item name="captchaText" noStyle rules={[{ required: true, message: '请输入验证码' }]}>
                  <Input placeholder="请输入验证码" maxLength={4} allowClear />
                </Form.Item>
                <div
                  className="captcha-img"
                  title="看不清？点击刷新"
                  onClick={refreshCaptcha}
                  dangerouslySetInnerHTML={{ __html: captcha.svg }}
                />
              </div>
            </Form.Item>
            <Button type="primary" htmlType="submit" className="login-btn" block loading={loading}>
              登 录
            </Button>
          </Form>
          <div className="login-notice">
            <ShieldIcon />
            <span>请使用「数字大外」账号密码登录（与学校信息门户一致）</span>
          </div>
        </Card>
        <div className="login-foot">学生综合素质评价 · 第一轮</div>
      </div>
    </div>
  );
}

/* ================= 明细表 ================= */
function CategoryTable({ category, color }) {
  const rows = (category.items ?? []).map((it, i) => ({ key: i, ...it }));
  return (
    <Table
      size="middle"
      pagination={false}
      dataSource={rows}
      summary={() => (
        <Table.Summary.Row style={{ background: '#fafbfe' }}>
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
        width={140}
        render={(v) => {
          if (v === null || v === undefined) {
            return <Tag color="orange">缓考，未进行计算</Tag>;
          }
          if (v === 0) return <span style={{ color: 'rgba(0,0,0,0.25)' }}>–</span>;
          return <span className={v < 0 ? 'num-neg' : ''}>{fmt(v)}</span>;
        }}
      />
      <Table.Column
        title="备注"
        dataIndex="note"
        key="note"
        width={200}
        render={(n) => (n && n.indexOf('缓考') < 0 ? <Tag color="default">{n}</Tag> : null)}
      />
    </Table>
  );
}

/* ================= 排名块 ================= */
function RankBlock({ title, rank, denom, hidden, absent }) {
  return (
    <div className="rank-block">
      <div className="rank-title">{title}</div>
      {hidden ? (
        <Tooltip title={HIDE_TIP}>
          <div>
            <Tag color="gold" style={{ fontSize: 18, padding: '6px 18px', borderRadius: 10, cursor: 'help' }}>
              不公布
            </Tag>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 6 }}>
              <InfoIcon /> 按规定不予公布
            </div>
          </div>
        </Tooltip>
      ) : absent ? (
        <div>
          <div className="rank-num stat-value-muted">—</div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>该专业未参与年级排名</div>
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
  const byKey = Object.fromEntries(categories.map((c) => [c.key, c]));
  const total = fmt(data.total) ?? 0;

  return (
    <div className="page">
      <div className="topbar">
        <div className="topbar-title">
          综合素质评价成绩查询
          <Tag color="blue">{data.roundLabel ?? '第一轮'}</Tag>
        </div>
        <Button icon={<LogoutIcon />} onClick={onLogout}>退出登录</Button>
      </div>

      {/* 概览横幅 */}
      <Card className="hero" styles={{ body: { padding: '28px 32px' } }}>
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} sm={14}>
            <div className="hero-name">{data.name}</div>
            <div className="hero-tags">
              <span className="hero-tag">学号 {data.studentId}</span>
              <span className="hero-tag">{data.major}</span>
              <span className="hero-tag">{data.clazz}</span>
            </div>
          </Col>
          <Col xs={24} sm={10}>
            <div className="hero-score-label">综测总分</div>
            <div className="hero-score">
              {total}
              <span className="hero-score-unit">分</span>
            </div>
          </Col>
        </Row>
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
      </Card>

      {/* 三类得分 */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {categories.map((c) => (
          <Col xs={12} md={8} key={c.key}>
            <Card className="stat-tile" styles={{ body: { padding: '18px 20px' } }}>
              <div className="stat-label">
                <span className="stat-chip" style={{ background: CATEGORY_COLOR[c.key] }} />
                {c.label}
              </div>
              <div className="stat-value">{fmt(c.total)}</div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* 排名 */}
      <Card style={{ marginTop: 16 }} title={<>综测排名 <Tag color="blue">{data.roundLabel ?? '第一轮'}</Tag></>}>
        <Row>
          <Col xs={24} sm={12}>
            <RankBlock
              title={`专业排名（${data.major}）`}
              rank={rank.majorRank}
              denom={rank.majorCount}
              hidden={rank.rankHidden}
            />
          </Col>
          <Col xs={24} sm={12}>
            <RankBlock
              title="年级总排名"
              rank={rank.totalRank}
              denom={rank.totalCount}
              hidden={rank.rankHidden}
              absent={!rank.rankHidden && rank.totalRank == null}
            />
          </Col>
        </Row>
      </Card>

      {/* 分项明细 */}
      <Card style={{ marginTop: 16 }}>
        <Tabs
          items={categories.map((c) => ({
            key: c.key,
            label: (
              <span>
                <span className="comp-dot" style={{ background: CATEGORY_COLOR[c.key], display: 'inline-block', marginRight: 6 }} />
                {c.label}
              </span>
            ),
            children: <CategoryTable category={c} color={CATEGORY_COLOR[c.key]} />,
          }))}
        />
      </Card>

      <div className="foot-note">
        如对成绩有疑问，请咨询学院综合素质评价负责人<br />
        数据导入时间：{data.importedAt ? new Date(data.importedAt).toLocaleString('zh-CN') : '–'}
      </div>
    </div>
  );
}

/* ================= 无记录页 ================= */
function NoRecordView({ onLogout, me }) {
  return (
    <div className="page">
      <div className="topbar">
        <div className="topbar-title">综合素质评价成绩查询 <Tag color="blue">第一轮</Tag></div>
        <Button icon={<LogoutIcon />} onClick={onLogout}>退出登录</Button>
      </div>
      <Card styles={{ body: { padding: '48px 24px' } }}>
        <Empty description="未查询到你的综测记录，请确认是否在本次综测评级范围内" />
        {me?.studentId && (
          <div className="norecord-info">
            <div>
              当前登录账号：<strong>{me.studentId}</strong>
              {me.name ? `（${me.name}）` : ''}
            </div>
            <div>本轮综测共覆盖 {me.studentCount ?? '–'} 名同学（软件学院各专业）</div>
            <div className="norecord-tip">
              若学号与上面显示的不一致，说明学校认证返回的账号并非你的学号，请联系管理员
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ================= 根组件 ================= */
export default function App() {
  const [view, setView] = useState('boot'); // boot | login | result | norecord
  const [data, setData] = useState(null);
  const [me, setMe] = useState(null);

  const showNoRecord = async () => {
    try {
      setMe(await api('/api/me'));
    } catch { /* 展示降级：不显示账号信息 */ }
    setView('norecord');
  };

  useEffect(() => {
    (async () => {
      try {
        const meRes = await api('/api/me');
        if (!meRes.loggedIn) return setView('login');
        const score = await api('/api/score');
        setData(score);
        setView('result');
      } catch (e) {
        if (e.code === 'NO_RECORD') await showNoRecord();
        else setView('login');
      }
    })();
  }, []);

  const afterLogin = async () => {
    try {
      const score = await api('/api/score');
      setData(score);
      setView('result');
    } catch (e) {
      if (e.code === 'NO_RECORD') {
        await showNoRecord();
      } else {
        throw e;
      }
    }
  };

  const logout = async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch { /* ignore */ }
    setData(null);
    setView('login');
  };

  if (view === 'boot') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (view === 'login') return <LoginView onLogin={afterLogin} />;
  if (view === 'norecord') return <NoRecordView onLogout={logout} me={me} />;
  return <ResultView data={data} onLogout={logout} />;
}
