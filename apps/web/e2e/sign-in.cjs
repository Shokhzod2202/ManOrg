// Signs in through the real form. Sign-in is rate-limited per minute (spec section 12), so a
// refusal waits and tries again instead of failing the run.
async function signIn(page, base, email) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.goto(`${base}/login`);
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', 'Password123!');
    await page.click('button:has-text("Sign in")');
    try {
      await page.waitForURL('**/app', { timeout: 8000 });
      return;
    } catch {
      await page.waitForTimeout(15_000);
    }
  }
  throw new Error(`Could not sign in as ${email}`);
}
module.exports = { signIn };
