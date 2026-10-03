import { BrandLogo } from '@/components/brand-logo';
import { ThemeToggle } from '@/components/theme-provider';
import { ResetPasswordForm } from './reset-password-form';

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-between gap-4">
          <BrandLogo href="/login" size="large" />
          <ThemeToggle />
        </div>
        <ResetPasswordForm />
      </div>
    </main>
  );
}
