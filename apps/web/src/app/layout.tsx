import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import './dashboard/dashboard-crm.css';
import './design-system.css';
import { ThemeProvider } from '@/components/theme-provider';

export const metadata: Metadata = {
  title: 'Lumi | Preventivi e listini',
  description: 'Gestione intelligente di listini e preventivi.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body>
        <Script id="lumi-theme-init" strategy="beforeInteractive">
          {`try {
            const saved = localStorage.getItem('lumi-theme');
            const theme = saved === 'light' || saved === 'dark'
              ? saved
              : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
            document.documentElement.dataset.theme = theme;
          } catch {}`}
        </Script>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
