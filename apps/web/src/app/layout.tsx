import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ConfirmHost } from '../components/confirm';
import { InputHelpers } from '../components/input-helpers';
import { TelegramSetup } from '../components/telegram';
import { LocaleRoot } from '../lib/i18n';
import { SessionProvider } from '../lib/session';
import './globals.css';

export const metadata: Metadata = {
  title: 'Haydar · Organization Management',
  description: 'Shifts, output, tasks, orders and deliveries for your organization.',
  icons: { icon: '/logo.png' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0b3a8c' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Montserrat:wght@600;700;800&display=swap"
        />
      </head>
      <body>
        <InputHelpers />
        <TelegramSetup />
        <SessionProvider>
          <LocaleRoot>
            {children}
            <ConfirmHost />
          </LocaleRoot>
        </SessionProvider>
      </body>
    </html>
  );
}
