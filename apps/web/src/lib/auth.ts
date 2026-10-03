import { prismaAdapter } from 'better-auth/adapters/prisma';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { organization } from 'better-auth/plugins';
import nodemailer from 'nodemailer';
import { prisma } from '@/lib/prisma';

const smtpPort = Number(process.env.SMTP_PORT ?? 1025);
const authBaseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3001';
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? '127.0.0.1',
  port: smtpPort,
  secure: process.env.SMTP_SECURE === 'true',
  auth:
    process.env.SMTP_USER && process.env.SMTP_PASSWORD
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
});

async function sendAuthEmail(to: string, subject: string, url: string) {
  await mailer.sendMail({
    from: process.env.SMTP_FROM ?? 'Lumi <noreply@localhost>',
    to,
    subject,
    text: `Apri questo link per continuare: ${url}`,
  });
}

export const auth = betterAuth({
  appName: 'Lumi',
  baseURL: authBaseURL,
  trustedOrigins: async (request) => {
    const origins = [authBaseURL];
    const requestOrigin = request?.headers.get('origin');

    if (process.env.NODE_ENV !== 'production' && requestOrigin && URL.canParse(requestOrigin)) {
      const origin = new URL(requestOrigin);
      if (
        origin.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) &&
        !origin.username &&
        !origin.password
      ) {
        origins.push(origin.origin);
      }
    }

    return origins;
  },
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail(user.email, 'Reimposta la password', url);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail(user.email, 'Verifica il tuo indirizzo email', url);
    },
  },
  plugins: [
    organization({
      requireEmailVerificationOnInvitation: true,
      schema: {
        organization: { modelName: 'organization' },
        member: { modelName: 'membership' },
      },
    }),
    nextCookies(),
  ],
});
