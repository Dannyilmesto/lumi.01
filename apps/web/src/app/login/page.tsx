import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { BrandLogo } from '@/components/brand-logo';
import { ThemeToggle } from '@/components/theme-provider';
import { auth } from '@/lib/auth';
import { AuthForm } from './sign-in-form';

export default async function LoginPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect('/dashboard');

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between gap-4">
          <BrandLogo href="/login" size="large" />
          <ThemeToggle />
        </div>
        <AuthForm />
      </div>
    </main>
  );
}
