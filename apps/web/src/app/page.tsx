import { colors, fonts, minTouchTarget, spacing } from '@manorg/ui';

/** Landing page shell (ACC-1). Sign-up and sign-in screens arrive in Phase 1. */
export default function LandingPage() {
  const button = {
    minHeight: minTouchTarget,
    padding: `0 ${spacing.md}px`,
    borderRadius: 8,
    border: `1px solid ${colors.primary}`,
    display: 'inline-flex',
    alignItems: 'center',
    textDecoration: 'none',
    fontWeight: 600,
  } as const;
  return (
    <main
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: spacing.xl,
        color: colors.text,
        fontFamily: fonts.body,
      }}
    >
      <img src="/logo.png" alt="Haydar Inc" width={120} height={120} />
      <h1 style={{ fontFamily: fonts.heading }}>Organization Management</h1>
      <p style={{ color: colors.textMuted }}>
        Shifts and punch cards, daily output, photo-proof tasks, and next-day contractor orders in
        one place.
      </p>
      <div style={{ display: 'flex', gap: spacing.sm }}>
        <a
          href="/register"
          style={{ ...button, background: colors.primary, color: colors.onPrimary }}
        >
          Create account
        </a>
        <a href="/login" style={{ ...button, color: colors.primary }}>
          Sign in
        </a>
      </div>
    </main>
  );
}
