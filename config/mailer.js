// ═══════════════════════════════════════════════════════════════
// وحدة إرسال البريد — ج-3 (نسيت كلمة السر)
// في التطوير: تطبع الرابط في السجل. في الإنتاج: تُرسل عبر SMTP إن ضُبطت المتغيّرات.
//
// للتفعيل الفعلي على السيرفر، اضبط متغيّرات البيئة التالية:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// وثبّت الحزمة: npm install nodemailer
// ═══════════════════════════════════════════════════════════════

let transporter = null;
let nodemailer = null;

// تشخيص اتصال SMTP من بيئة التشغيل (يُفعَّل بمتغير SMTP_DIAG=1)
function runSMTPDiagnostics() {
  const net = require('net');
  const targets = [
    ['smtp.office365.com', 587],
    ['smtp.office365.com', 465],
    ['smtp.office365.com', 25],
    ['outlook.office365.com', 587],
    ['smtp.gmail.com', 587],
  ];
  console.log('🔍 تشخيص اتصال SMTP (مهلة 10 ثوانٍ لكل هدف)...');
  targets.forEach(([h, p]) => {
    const s = net.connect({ host: h, port: p, timeout: 10000 });
    s.on('connect', () => { console.log(`   ✅ ${h}:${p} — متاح`); s.destroy(); });
    s.on('timeout', () => { console.log(`   ⏱️ ${h}:${p} — مهلة (غير متاح)`); s.destroy(); });
    s.on('error', (e) => { console.log(`   ❌ ${h}:${p} — ${e.code || e.message}`); });
  });
}
if (process.env.SMTP_DIAG === '1') runSMTPDiagnostics();

function initTransporter() {
  if (transporter !== null) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER) {
    transporter = false; // غير مضبوط — سنطبع في السجل بدلاً من الإرسال
    return transporter;
  }
  try {
    nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  } catch (e) {
    console.warn('⚠️  nodemailer غير مثبّت — سيُطبع رابط إعادة التعيين في السجل. ثبّت: npm install nodemailer');
    transporter = false;
  }
  return transporter;
}

// يرسل بريد إعادة تعيين كلمة المرور. يُرجع true إن أُرسل فعلياً، false إن طُبع فقط.
async function sendPasswordReset(toEmail, resetLink, userName) {
  const t = initTransporter();
  const subject = 'إعادة تعيين كلمة المرور — منصة الأندلس للتطوّر المهني';
  const text = `مرحباً ${userName || ''}،\n\nلإعادة تعيين كلمة المرور، افتح الرابط التالي (صالح لمدة ساعة):\n${resetLink}\n\nإن لم تطلب ذلك، تجاهل هذه الرسالة.\n\nشركة الأندلس التعليمية`;
  const html = `<div dir="rtl" style="font-family:sans-serif;color:#15385C">
    <h2>إعادة تعيين كلمة المرور</h2>
    <p>مرحباً ${userName || ''}،</p>
    <p>لإعادة تعيين كلمة مرور حسابك في منصة الأندلس للتطوّر المهني، اضغط الزرّ التالي (صالح لمدة ساعة):</p>
    <p><a href="${resetLink}" style="background:#15385C;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">إعادة تعيين كلمة المرور</a></p>
    <p style="color:#5B7A9E;font-size:13px">إن لم تطلب ذلك، تجاهل هذه الرسالة.</p>
    <p style="color:#5B7A9E;font-size:13px">شركة الأندلس التعليمية</p>
  </div>`;

  if (!t) {
    // لا SMTP مضبوط — نطبع الرابط (للتطوير/الاختبار)
    console.log('\n📧 [بريد إعادة التعيين — لم يُرسل فعلياً، اضبط SMTP للإرسال]');
    console.log(`   إلى: ${toEmail}`);
    console.log(`   الرابط: ${resetLink}\n`);
    return false;
  }
  // تجنّب تعليق الطلب إذا تعذّر الوصول لخادم البريد (نربط الإرسال بمهلة زمنية)
  const smtpTimeout = Number(process.env.SMTP_TIMEOUT) || 90000;
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('انتهت مهلة الاتصال بخادم البريد (SMTP)')), smtpTimeout));
  try {
    await Promise.race([
      t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: toEmail, subject, text, html }),
      timeout,
    ]);
    console.log(`📧 أُرسل بريد إعادة التعيين إلى: ${toEmail} (SMTP) ✓`);
    return true;
  } catch (e) {
    console.error(`⚠️ فشل إرسال بريد إعادة التعيين إلى ${toEmail}:`, e.message);
    console.log(`   الرابط (احتياطي — في سجل الخادم): ${resetLink}`);
    return false;
  }
}

module.exports = { sendPasswordReset };
