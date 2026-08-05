// ═══════════════════════════════════════════════════════════════
// وحدة إرسال البريد — ج-3 (نسيت كلمة السر)
// أولوية الإرسال:
//   1) Brevo (API عبر HTTPS — لا يتطلب ملكية دومين المستلم) إن وُجد BREVO_API_KEY
//   2) Resend (API عبر HTTPS) إن وُجد RESEND_API_KEY
//   3) SMTP (nodemailer) إن وُجدت متغيّرات SMTP_*
//   4) طباعة الرابط في السجل (تطوير/احتياط)
// ═══════════════════════════════════════════════════════════════

const RESEND_URL = 'https://api.resend.com/emails';
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

let transporter = null;
let nodemailer = null;

function initTransporter() {
  if (transporter !== null) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER) {
    transporter = false;
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
    console.warn('⚠️  nodemailer غير مثبّت — سيُطبع رابط إعادة التعيين في السجل.');
    transporter = false;
  }
  return transporter;
}

// يرسل عبر Brevo HTTP API. يُرجع true عند النجاح، false إن لم تُضبط المتغيّرات.
async function sendViaBrevo(toEmail, toName, subject, text, html) {
  const key = process.env.BREVO_API_KEY;
  if (!key) return false;
  const from = process.env.BREVO_FROM || 'no-reply@yourdomain.com';
  const fromName = process.env.BREVO_FROM_NAME || 'منصة الأندلس';
  const timeout = Number(process.env.MAIL_TIMEOUT) || 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: fromName, email: from },
        to: [{ email: toEmail, name: toName || '' }],
        subject, textContent: text, htmlContent: html,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg = data && data.message ? data.message : `HTTP ${res.status}`;
      throw new Error(`Brevo ${res.status}: ${msg}`);
    }
    console.log(`✉️ أُرسل بريد إعادة التعيين إلى: ${toEmail} (Brevo) ✓`);
    return true;
  } catch (e) {
    console.error(`⚠️ فشل إرسال بريد إعادة التعيين إلى ${toEmail}:`, e.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// يرسل عبر Resend HTTP API. يُرجع true عند النجاح، false إن لم تُضبط المتغيّرات.
async function sendViaResend(toEmail, subject, text, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const from = process.env.RESEND_FROM || 'onboarding@resend.dev';
  const timeout = Number(process.env.MAIL_TIMEOUT) || 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: toEmail, subject, text, html }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Resend ${res.status}: ${data.message || 'خطأ غير معروف'}`);
    }
    console.log(`📧 أُرسل بريد إعادة التعيين إلى: ${toEmail} (Resend) ✓ [${data.id || ''}]`);
    return true;
  } catch (e) {
    console.error(`⚠️ فشل إرسال بريد إعادة التعيين إلى ${toEmail}:`, e.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// يرسل بريد إعادة تعيين كلمة المرور. يُرجع true إن أُرسل فعلياً، false إن طُبع فقط.
async function sendPasswordReset(toEmail, resetLink, userName) {
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

  // 1) Brevo — لا يتطلب ملكية دومين المستلم
  const sentBrevo = await sendViaBrevo(toEmail, userName, subject, text, html);
  if (sentBrevo) return true;
  if (process.env.BREVO_API_KEY) {
    console.log(`   الرابط (احتياطي — في سجل الخادم): ${resetLink}`);
    return false;
  }

  // 2) Resend — إن لم تُضبط Brevo
  const sentResend = await sendViaResend(toEmail, subject, text, html);
  if (sentResend) return true;
  // إن كانت Resend مضبوطة ولم تنجح، نتوقّف (لا نلجأ لـ SMTP المحجوب على بعض الاستضافات)
  if (process.env.RESEND_API_KEY) {
    console.log(`   الرابط (احتياطي — في سجل الخادم): ${resetLink}`);
    return false;
  }

  // 3) SMTP — احتياطي (فقط إن لم تُضبط أي خدمة HTTP)
  const t = initTransporter();
  if (t) {
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

  // 3) لا شيء مضبوط — طباعة الرابط
  console.log('\n📧 [بريد إعادة التعيين — لم يُرسل فعلياً، اضبط RESEND_API_KEY أو SMTP للإرسال]');
  console.log(`   إلى: ${toEmail}`);
  console.log(`   الرابط: ${resetLink}\n`);
  return false;
}

module.exports = { sendPasswordReset };
