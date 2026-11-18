import { type ReactNode } from 'react';
import { LanguagePicker, t } from '../lib/i18n';

/** Centered card on white used by sign-in, registration and the start screens. */
export function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-card">
        {/* The logo is the brand mark; the blue comes from it. */}
        <img src="/logo.png" alt="Haydar Inc" className="auth-logo" />
        <h1>{t(title)}</h1>
        {children}
        <div className="row" style={{ justifyContent: 'center' }}>
          <LanguagePicker />
        </div>
      </div>
    </main>
  );
}
