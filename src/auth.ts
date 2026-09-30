import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'rebrowser-playwright';
import type { Config } from './types.js';

export interface AuthContextResult {
  context: BrowserContext;
  page: Page;
}

export interface TokenFreshness {
  isValid: boolean;
  lastRefresh: string | null;
  ageMs: number;
}

export async function launchAuthenticatedContext(
  config: Config,
  headed: boolean = false
): Promise<AuthContextResult> {
  const profileDir = path.resolve(config.browser.profileDir);
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  let context: BrowserContext;
  try {
    const isHeadless = headed ? false : !process.env.DISPLAY;
    context = await chromium.launchPersistentContext(profileDir, {
      headless: isHeadless,
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    });
  } catch (err: any) {
    if (
      err.message?.includes("Executable doesn't exist") ||
      err.message?.includes('Please run the following command')
    ) {
      process.stderr.write(`
================================================================================
❌ Host Chromium binary is missing.

👉 Recommended (Containerized-First):
   Run the login flow inside Docker where Chromium is pre-installed:
   $ pnpm run docker:auth
   (or: docker compose run --rm --service-ports auth)

👉 Or install Chromium locally on your host:
   $ pnpm exec playwright install chromium
================================================================================
\n`);
    }
    throw err;
  }

  const authStorageFile = path.join(profileDir, 'storage_state.json');
  if (fs.existsSync(authStorageFile)) {
    try {
      const raw = fs.readFileSync(authStorageFile, 'utf-8');
      const state = JSON.parse(raw);
      if (Array.isArray(state.cookies) && state.cookies.length > 0) {
        await context.addCookies(state.cookies);
      }
    } catch (err: any) {
      process.stderr.write(`[WARN] Could not restore storage_state.json cookies: ${err.message}\n`);
    }
  }

  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  return { context, page };
}

export async function persistSession(context: BrowserContext, profileDir: string): Promise<void> {
  const authStorageFile = path.join(path.resolve(profileDir), 'storage_state.json');
  try {
    await context.storageState({ path: authStorageFile });
  } catch (err: any) {
    process.stderr.write(`[WARN] Failed to save session storage state: ${err.message}\n`);
  }
}

export async function checkTokenFreshness(page: Page): Promise<TokenFreshness> {
  try {
    const tokenState = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const hasCognitoToken = keys.some(
        (k) =>
          (k.startsWith('CognitoIdentityServiceProvider') && (k.endsWith('.idToken') || k.endsWith('.accessToken'))) ||
          k === 'builder-session-token' ||
          k === 'builder-id' ||
          k === 'builder-profile-id'
      );
      const rawRefresh = localStorage.getItem('lastTokenRefresh');
      return {
        hasSessionTokens: hasCognitoToken,
        lastRefresh: rawRefresh,
      };
    });

    if (tokenState.hasSessionTokens) {
      const lastRefreshMs = tokenState.lastRefresh ? Number(tokenState.lastRefresh) : Date.now();
      const ageMs = Date.now() - lastRefreshMs;
      return {
        isValid: ageMs < 48 * 60 * 60 * 1000,
        lastRefresh: tokenState.lastRefresh ? new Date(lastRefreshMs).toISOString() : new Date().toISOString(),
        ageMs,
      };
    }
  } catch {
    // Evaluation error during navigation
  }

  return { isValid: false, lastRefresh: null, ageMs: Number.POSITIVE_INFINITY };
}

export async function verifyAuthentication(
  page: Page,
  navigate: boolean = false
): Promise<boolean> {
  if (navigate) {
    try {
      await page.goto('https://builder.aws.com', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      // Allow React client-side hydration to complete
      await page.waitForTimeout(3000);
    } catch (err: any) {
      process.stderr.write(`[WARN] Navigation to builder.aws.com failed: ${err.message}\n`);
      return false;
    }
  }

  const currentUrl = page.url();

  // Tier 1: External auth/SSO/signin portal means user is actively logging in or unauthenticated
  if (
    !currentUrl.includes('builder.aws.com') ||
    currentUrl.includes('profile.aws.amazon.com') ||
    currentUrl.includes('signin.aws') ||
    currentUrl.includes('authPortalURL') ||
    currentUrl.includes('signin')
  ) {
    return false;
  }

  // Tier 2: Check for presence of ANY visible "Sign in" or "Log in" button.
  // If a Sign In button is visible, the user is definitively NOT authenticated.
  try {
    const signInButtons = await page.$$(
      'button[aria-label*="Sign in" i], button:has-text("Sign in"), a[href*="signin"], button:has-text("Log in"), button[aria-label*="Log in" i], a:has-text("Sign in")'
    );
    for (const btn of signInButtons) {
      const isVisible = await btn.isVisible().catch(() => false);
      if (isVisible) {
        return false;
      }
    }
  } catch {
    // If selector evaluation fails, continue
  }

  // Tier 3: Verify authenticated avatar/profile menu in the DOM
  try {
    const avatarSelectors = [
      '[data-testid*="user-profile"]',
      '[data-testid*="avatar"]',
      'button[aria-label*="profile" i]',
      'button[aria-label*="account" i]',
      'div[class*="ProfileMenu"]',
      '[data-testid="header-user-menu"]',
      'a[href*="/profile/"]',
      'button[aria-label*="User menu" i]',
    ];

    for (const sel of avatarSelectors) {
      const avatar = await page.$(sel);
      if (avatar && (await avatar.isVisible().catch(() => false))) {
        return true;
      }
    }
  } catch {
    // Continue to next checks
  }

  // Tier 4: Verify via authenticated Builder Center badges endpoint
  try {
    const isAuthedApi = await page.evaluate(async () => {
      try {
        const res = await fetch('https://api.builder.aws.com/rms/badges/progress', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locale: 'en', pageSize: 1 }),
        });
        return res.status === 200;
      } catch {
        return false;
      }
    });
    if (isAuthedApi) {
      return true;
    }
  } catch {
    // Continue to token check
  }

  // Tier 5: Verify valid Cognito session tokens in localStorage
  const freshness = await checkTokenFreshness(page);
  if (freshness.isValid) {
    return true;
  }

  // If none of the above confirmed authentication, the user is NOT authenticated.
  // (Never trust raw cookie existence alone, as expired or guest cookies share the same names)
  return false;
}

export async function waitForTokenRefresh(page: Page, timeoutMs: number = 15000): Promise<boolean> {
  const startTime = Date.now();
  const initialRefresh = await page.evaluate(() => localStorage.getItem('lastTokenRefresh'));

  while (Date.now() - startTime < timeoutMs) {
    const currentRefresh = await page.evaluate(() => localStorage.getItem('lastTokenRefresh'));
    if (currentRefresh && currentRefresh !== initialRefresh) {
      return true;
    }
    await page.waitForTimeout(1000);
  }

  return false;
}

export interface AutoLoginCredentials {
  email: string;
  password: string;
}

export function getStoredCredentials(): AutoLoginCredentials | null {
  const email = process.env.AWS_BUILDER_EMAIL;
  const password = process.env.AWS_BUILDER_PASSWORD;

  if (!email || !password) {
    return null;
  }

  return { email, password };
}

/**
 * Automated credential-based re-login for AWS Builder Center.
 * Uses AWS_BUILDER_EMAIL and AWS_BUILDER_PASSWORD from the environment (.env file).
 *
 * Flow: Navigate to builder.aws.com → redirected to sign-in → enter email → enter password
 *       → trust device → wait for session → persist cookies.
 *
 * Returns true if re-authentication succeeded, false if it couldn't complete.
 */
export async function autoLogin(
  page: Page,
  credentials: AutoLoginCredentials,
  profileDir: string
): Promise<boolean> {
  process.stdout.write(`[AUTO-LOGIN] Attempting automated re-authentication with stored credentials...\n`);

  try {
    // Navigate to Builder Center, which redirects to the sign-in flow
    await page.goto('https://builder.aws.com', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for the sign-in page to load (could be profile.aws.amazon.com or similar)
    await page.waitForTimeout(3000);

    // Step 1: Find and fill the email field
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[id*="email" i]',
      'input[placeholder*="email" i]',
      'input[aria-label*="email" i]',
      'input[name="username"]',
      'input[id*="username" i]',
    ];

    let emailFilled = false;
    for (const sel of emailSelectors) {
      try {
        const el = await page.$(sel);
        if (el && (await el.isVisible().catch(() => false))) {
          await el.click();
          await page.waitForTimeout(300);
          // Clear any existing value
          await el.fill('');
          await page.waitForTimeout(200);
          // Type email character by character with slight delays for anti-detection
          for (const char of credentials.email) {
            await page.keyboard.type(char);
            await page.waitForTimeout(50 + Math.floor(Math.random() * 80));
          }
          emailFilled = true;
          process.stdout.write(`[AUTO-LOGIN] Email entered.\n`);
          break;
        }
      } catch {
        continue;
      }
    }

    if (!emailFilled) {
      // Check if we're already past the email step (e.g., session partially valid)
      const isAlreadyAuth = await verifyAuthentication(page, false);
      if (isAlreadyAuth) {
        process.stdout.write(`[AUTO-LOGIN] Already authenticated — no login needed.\n`);
        return true;
      }
      process.stderr.write(`[AUTO-LOGIN] Could not find email input field on sign-in page.\n`);
      return false;
    }

    // Click "Next" / "Continue" / "Sign in" button after email
    const nextBtnSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Next")',
      'button:has-text("Continue")',
      'button:has-text("Sign in")',
      'button:has-text("Log in")',
    ];

    for (const sel of nextBtnSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn && (await btn.isVisible().catch(() => false))) {
          await btn.click();
          break;
        }
      } catch {
        continue;
      }
    }

    // Wait for password field to appear
    await page.waitForTimeout(3000);

    // Step 2: Find and fill the password field
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[id*="password" i]',
      'input[placeholder*="password" i]',
      'input[aria-label*="password" i]',
    ];

    let passwordFilled = false;
    for (const sel of passwordSelectors) {
      try {
        const el = await page.$(sel);
        if (el && (await el.isVisible().catch(() => false))) {
          await el.click();
          await page.waitForTimeout(300);
          await el.fill('');
          await page.waitForTimeout(200);
          for (const char of credentials.password) {
            await page.keyboard.type(char);
            await page.waitForTimeout(40 + Math.floor(Math.random() * 60));
          }
          passwordFilled = true;
          process.stdout.write(`[AUTO-LOGIN] Password entered.\n`);
          break;
        }
      } catch {
        continue;
      }
    }

    if (!passwordFilled) {
      process.stderr.write(`[AUTO-LOGIN] Could not find password input field.\n`);
      return false;
    }

    // Click the sign-in / submit button
    for (const sel of nextBtnSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn && (await btn.isVisible().catch(() => false))) {
          await btn.click();
          break;
        }
      } catch {
        continue;
      }
    }

    // Wait for login to process (redirects, MFA prompts, etc.)
    await page.waitForTimeout(5000);

    // Step 3: Try to click "Trust this device" / "Remember" if present
    const trustSelectors = [
      'button:has-text("Trust")',
      'button:has-text("Remember")',
      'button:has-text("Yes")',
      'input[type="checkbox"][id*="remember" i]',
      'label:has-text("Remember")',
      'label:has-text("Trust")',
    ];

    for (const sel of trustSelectors) {
      try {
        const el = await page.$(sel);
        if (el && (await el.isVisible().catch(() => false))) {
          await el.click();
          process.stdout.write(`[AUTO-LOGIN] Clicked "Trust/Remember this device".\n`);
          await page.waitForTimeout(2000);
          break;
        }
      } catch {
        continue;
      }
    }

    // Step 4: Wait for authentication to complete (poll for up to 30 seconds)
    const maxWaitMs = 30_000;
    const pollIntervalMs = 2000;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      const isAuth = await verifyAuthentication(page, false);
      if (isAuth) {
        process.stdout.write(`[AUTO-LOGIN] ✅ Re-authentication successful!\n`);
        await persistSession(page.context(), profileDir);
        process.stdout.write(`[AUTO-LOGIN] Session cookies saved to ${profileDir}/storage_state.json.\n`);
        return true;
      }
      await page.waitForTimeout(pollIntervalMs);
    }

    // Check one final time after navigating explicitly
    const finalCheck = await verifyAuthentication(page, true);
    if (finalCheck) {
      process.stdout.write(`[AUTO-LOGIN] ✅ Re-authentication successful (final check)!\n`);
      await persistSession(page.context(), profileDir);
      return true;
    }

    process.stderr.write(
      `[AUTO-LOGIN] ⚠️ Auto-login could not verify authentication after 30s.\n` +
        `[AUTO-LOGIN] This may require manual MFA. Run: pnpm run auth\n`
    );
    return false;
  } catch (err: any) {
    process.stderr.write(`[AUTO-LOGIN] Failed: ${err.message}\n`);
    return false;
  }
}
