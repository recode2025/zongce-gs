import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = path.resolve(__dirname, '../data/zongce.db');

/**
 * 数据层设计（高并发的关键）：
 * - SQLite 仅作持久化存储（导入 Excel 时写入，WAL 模式）
 * - 服务启动时全量加载进内存 Map，查询为 O(1) 内存命中
 *   → 300 并发 / 1000 用户场景下 QPS 可达数万，无任何数据库竞争
 * - 数据更新后向进程发 SIGHUP 即可热重载，不用停服
 */
class Store {
  constructor() {
    this.byStudentId = new Map();
    this.meta = {};
    this.loadedAt = null;
  }

  load() {
    if (!fs.existsSync(DB_PATH)) {
      throw new Error(`数据库不存在: ${DB_PATH}，请先运行 npm run import 导入 Excel`);
    }
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    try {
      const metaRow = db.prepare("SELECT value FROM meta WHERE key = 'imported_at'").get();
      const metaCount = db.prepare("SELECT value FROM meta WHERE key = 'student_count'").get();
      const metaRound = db.prepare("SELECT value FROM meta WHERE key = 'round_label'").get();
      this.meta = {
        importedAt: metaRow?.value ?? null,
        studentCount: metaCount?.value ?? null,
        roundLabel: metaRound?.value ?? null,
      };

      const rows = db.prepare('SELECT student_id, name, college, major, clazz, data FROM students').all();
      const map = new Map();
      for (const r of rows) {
        map.set(String(r.student_id), {
          studentId: String(r.student_id),
          name: r.name,
          college: r.college,
          major: r.major,
          clazz: r.clazz,
          data: JSON.parse(r.data), // 分数明细 + 排名（导入时计算）
        });
      }
      this.byStudentId = map;
      this.loadedAt = Date.now();
      console.log(`[db] 已加载 ${map.size} 条学生记录 (imported_at=${this.meta.importedAt})`);
    } finally {
      db.close();
    }
  }

  get(studentId) {
    return this.byStudentId.get(String(studentId)) ?? null;
  }

  get size() {
    return this.byStudentId.size;
  }
}

export const store = new Store();
