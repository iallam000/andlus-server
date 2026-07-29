// ═══════════════════════════════════════════════════════════════
// وحدة الاتصال بقاعدة بيانات SQLite
// تستخدم better-sqlite3 (متزامن، سريع، مثالي لـ SQLite)
// ═══════════════════════════════════════════════════════════════
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// مسار ملف قاعدة البيانات (قابل للتهيئة عبر متغيّر بيئة)
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'andlus.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// تهيئة المخطّط عند أول تشغيل (idempotent — آمن للتكرار)
function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  console.log('✓ تمّت تهيئة مخطّط قاعدة البيانات');
}

// نبذر الإعدادات الافتراضية إن كانت القاعدة فارغة
function seedDefaults() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
  if (count === 0) {
    const defaults = {
      weights: { self:{"أساسية":5}, peer:{"أساسية":5}, supervisor:{"عامة":22.5,"فنية":22.5}, stage_mgr:{"أساسية":45} },
      comps: {}, jobs: {}, sources: {}, sourceMap: {}
    };
    const ins = db.prepare('INSERT INTO settings (skey, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(defaults)) ins.run(k, JSON.stringify(v));
    console.log('✓ بُذرت الإعدادات الافتراضية');
  }
}

module.exports = { db, initSchema, seedDefaults, DB_PATH };
