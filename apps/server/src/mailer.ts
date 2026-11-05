import nodemailer from 'nodemailer';
import { config } from './config.js';
import { logger } from './logger.js';

const transporter = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth:
        config.SMTP_USER && config.SMTP_PASS
          ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
          : undefined
    })
  : null;

export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  if (!transporter) {
    // In a real production deployment configure SMTP. In development the reset
    // URL is also written to the API log, which avoids a local mail trap.
    logger.warn({ email, resetUrl }, 'SMTP is not configured; password reset link logged');
    return;
  }

  await transporter.sendMail({
    from: config.SMTP_FROM,
    to: email,
    subject: 'Восстановление пароля — Chips Poker',
    text: [
      'Вы запросили восстановление пароля в Chips Poker.',
      '',
      `Перейдите по ссылке (действует 60 минут): ${resetUrl}`,
      '',
      'Если это были не вы, просто проигнорируйте письмо.'
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17212b">
        <h2>Восстановление пароля</h2>
        <p>Вы запросили смену пароля в <b>Chips Poker</b>.</p>
        <p><a href="${resetUrl}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#1f9d75;color:#fff;text-decoration:none">Задать новый пароль</a></p>
        <p>Ссылка действует 60 минут. Если вы не запрашивали смену пароля — проигнорируйте письмо.</p>
      </div>`
  });
}
