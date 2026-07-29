// ═══════════════════════════════════════════════════════════════
// سكربت تحويل واجهة الـ artifact (JSX) إلى واجهة سيرفر
// يعدّل نقاط ربط التخزين ليستخدم andlusAPI بدل window.storage
//
// الاستخدام: node scripts/transform_frontend.js <input.jsx> <output.jsx>
// ═══════════════════════════════════════════════════════════════
const fs = require('fs');

const [,, inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('الاستخدام: node transform_frontend.js <input.jsx> <output.jsx>');
  process.exit(1);
}

let code = fs.readFileSync(inPath, 'utf8');
const report = [];

// 1) استبدال تعريف st ليستخدم andlusAPI (قبل أي معالجة لـ window.storage)
const stOld = /const st = \{\s*\n\s*get: async[\s\S]*?setShared: async[^\n]*\n\};/;
const stNew = `const st = {
  get: async k => { try { return await window.andlusAPI.get(k); } catch(e){ console.error(e); return null; } },
  set: async (k,v) => { try { await window.andlusAPI.set(k,v); } catch(e){ console.error(e); } },
  getShared: async k => { try { return await window.andlusAPI.getShared(k); } catch(e){ console.error(e); return null; } },
  setShared: async (k,v) => { try { await window.andlusAPI.setShared(k,v); } catch(e){ console.error(e); } },
};`;
if (stOld.test(code)) { code = code.replace(stOld, stNew); report.push('✓ استُبدل تعريف st'); }
else report.push('✗ لم يُعثر على تعريف st — راجع يدوياً');

// 2) استبدال أي window.storage.get/set مباشر متبقٍّ
const directGets = (code.match(/window\.storage\.get\(/g) || []).length;
const directSets = (code.match(/window\.storage\.set\(/g) || []).length;
code = code.replace(/await window\.storage\.get\("([^"]+)"\)/g, 'await window.andlusAPI.get("$1")');
code = code.replace(/await window\.storage\.set\("([^"]+)",\s*JSON\.stringify\(([^)]+)\)\)/g, 'await window.andlusAPI.set("$1", $2)');
// safeGet داخلي: window.storage.get(k, shared) → andlusAPI حسب shared
code = code.replace(/const r = await window\.storage\.get\(k, shared\); return r\?\.value \? JSON\.parse\(r\.value\) : null;/,
  'return shared ? await window.andlusAPI.getShared(k) : await window.andlusAPI.get(k);');
report.push(`✓ استُبدلت نداءات window.storage المباشرة (get:${directGets}, set:${directSets})`);

// 3) إزالة سطر import React (سيُوفَّر عالمياً عبر <script>)
code = code.replace(/^import React[^\n]*\n/m, '');
report.push('✓ أُزيل سطر import React');

// 4) استبدال export default بتصدير عالمي
code = code.replace(/export default function App/, 'function App');
if (!/window\.__AndlusApp/.test(code)) {
  code += '\n\nwindow.__AndlusApp = App;\n';
}
report.push('✓ حُوّل export default إلى window.__AndlusApp');

// 5) ربط شاشة الدخول بالمصادقة الحقيقية (API) بدل المقارنة المحلية
const loginOld = /const login = async \(\) => \{\s*\n\s*if \(u === ADMIN_CREDS[\s\S]*?if \(found\) onLogin\(found\); else \{ setErr\(true\); setP\(""\); \}\s*\n\s*\};/;
const loginNew = `const login = async () => {
  try {
    const user = await window.andlusAPI.auth.login(u, p);
    onLogin(user);
  } catch (e) {
    setErr(true); setP("");
  }
  };`;
if (loginOld.test(code)) { code = code.replace(loginOld, loginNew); report.push('✓ رُبطت شاشة الدخول بالـ API'); }
else report.push('⚠ لم يُطابق نمط login — راجع يدوياً');

fs.writeFileSync(outPath, code, 'utf8');
console.log('\n'.padEnd(2) + 'تقرير التحويل:');
report.forEach(r => console.log('  ' + r));
console.log(`\n✓ كُتب الناتج: ${outPath} (${Math.round(code.length/1024)}KB)`);
