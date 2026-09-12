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
    } catch (err: any) {
      process.stderr.write(`[WARN] Navigation to builder.aws.com failed: ${err.message}\n`);
      return false;
    }
  }

  const currentUrl = page.url();

  // Tier 1: If on an external auth/SSO/signin portal, user is in the middle of authenticating
  if (
    !currentUrl.includes('builder.aws.com') ||
    currentUrl.includes('profile.aws.amazon.com') ||
    currentUrl.includes('signin.aws') ||
    currentUrl.includes('authPortalURL') ||
    currentUrl.includes('signin')
  ) {
    return false;
  }

  // Tier 2: Check for presence of ANY visible "Sign in" button.
  // If a Sign In button is visible, the user is definitively NOT authenticated.
  try {
    const signInButtons = await page.$$(
      'button[aria-label*="Sign in" i], button:has-text("Sign in"), a[href*="signin"], button:has-text("Log in"), button[aria-label*="Log in" i]'
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
    const avatar = await page.$(
      '[data-testid*="user-profile"], [data-testid*="avatar"], button[aria-label*="profile" i], button[aria-label*="account" i], div[class*="ProfileMenu"], [data-testid="header-user-menu"]'
    );
    if (avatar) {
      const isAvatarVisible = await avatar.isVisible().catch(() => false);
      if (isAvatarVisible) {
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
    // Continue to storage checks
  }

  // Tier 5: Verify valid Cognito/Builder session tokens in localStorage
  const freshness = await checkTokenFreshness(page);
  if (freshness.isValid) {
    return true;
  }

  // Tier 6: Check specific authenticated cookies (not generic tracking cookies)
  try {
    const cookies = await page.context().cookies('https://builder.aws.com');
    const hasAuthCookie = cookies.some(
      (c) =>
        c.name === 'builder-session-token' ||
        c.name === 'builder-auth-provider' ||
        c.name.includes('builder-session') ||
        c.name.includes('IdToken') ||
        c.name.includes('aws-userInfo') ||
        c.name === 'builder-id'
    );
    if (hasAuthCookie) {
      return true;
    }
  } catch {
    return false;
  }

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
