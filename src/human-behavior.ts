import crypto from 'node:crypto';
import type { Page } from 'rebrowser-playwright';

export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export function randomWindowDelay(windowMinutes: number): number {
  const maxMs = windowMinutes * 60 * 1000;
  return crypto.randomInt(0, Math.max(1, maxMs));
}

export async function humanScroll(page: Page): Promise<void> {
  const scrollSteps = crypto.randomInt(3, 7);
  for (let i = 0; i < scrollSteps; i++) {
    const deltaY = crypto.randomInt(120, 380);
    await page.mouse.wheel(0, deltaY);
    await randomDelay(300, 1100);
  }
}

/**
 * Scroll progressively to the bottom of the page in a natural, reading-like pattern.
 * AWS Builder Center articles can be very long and the comment section is typically
 * located far below the article content. This function ensures we reach it.
 */
export async function humanScrollToBottom(page: Page): Promise<void> {
  let previousHeight = 0;
  let staleCount = 0;

  while (staleCount < 3) {
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    const currentScroll = await page.evaluate(() => window.scrollY);

    // Already at or near the bottom
    if (currentScroll + viewportHeight >= currentHeight - 50) {
      break;
    }

    // Scroll in natural chunks (300-700px per step, like reading through content)
    const scrollChunks = crypto.randomInt(3, 6);
    for (let i = 0; i < scrollChunks; i++) {
      const deltaY = crypto.randomInt(300, 700);
      await page.mouse.wheel(0, deltaY);
      await randomDelay(400, 1200);
    }

    // Occasional longer pause to simulate reading a section
    if (Math.random() < 0.3) {
      await randomDelay(1500, 3000);
    }

    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === previousHeight) {
      staleCount++;
    } else {
      staleCount = 0;
    }
    previousHeight = newHeight;
  }

  // Final scroll to absolute bottom to ensure comment section is in view
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
  await randomDelay(1000, 2000);
}

/**
 * Generate cubic bezier point: B(t) = (1-t)^3*P0 + 3*(1-t)^2*t*P1 + 3*(1-t)*t^2*P2 + t^3*P3
 */
function cubicBezier(
  t: number,
  p0: number,
  p1: number,
  p2: number,
  p3: number
): number {
  const u = 1 - t;
  return (
    u * u * u * p0 +
    3 * u * u * t * p1 +
    3 * u * t * t * p2 +
    t * t * t * p3
  );
}

export async function humanMouseMove(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): Promise<void> {
  const steps = crypto.randomInt(8, 16);

  // Pick two random control points for realistic curvature
  const deviationX = (toX - fromX) * 0.3 + crypto.randomInt(-50, 50);
  const deviationY = (toY - fromY) * 0.3 + crypto.randomInt(-50, 50);

  const cp1X = fromX + deviationX;
  const cp1Y = fromY + deviationY;
  const cp2X = toX - deviationX * 0.5;
  const cp2Y = toY - deviationY * 0.5;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const currentX = cubicBezier(t, fromX, cp1X, cp2X, toX);
    const currentY = cubicBezier(t, fromY, cp1Y, cp2Y, toY);
    await page.mouse.move(currentX, currentY);
    await randomDelay(12, 35);
  }
}

export async function humanClick(page: Page, selector: string): Promise<void> {
  const element = await page.waitForSelector(selector, { state: 'visible', timeout: 10000 });
  const box = await element.boundingBox();
  if (!box) {
    // Fallback to regular click if box cannot be measured
    await element.click();
    return;
  }

  // Click within the inner 70% of the element to look natural
  const paddingX = box.width * 0.15;
  const paddingY = box.height * 0.15;
  const targetX = box.x + paddingX + Math.random() * (box.width - 2 * paddingX);
  const targetY = box.y + paddingY + Math.random() * (box.height - 2 * paddingY);

  // Move from approximate current mouse location (or center of viewport)
  const currentPos = { x: box.x + box.width / 2 - 100, y: box.y + box.height / 2 - 100 };
  await humanMouseMove(page, currentPos.x, currentPos.y, targetX, targetY);

  await randomDelay(150, 400);
  await page.mouse.click(targetX, targetY);
  await randomDelay(200, 500);
}

export async function humanType(page: Page, selector: string, text: string): Promise<void> {
  await humanClick(page, selector);
  await randomDelay(250, 600);

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    await page.keyboard.type(char);

    // Variable inter-keystroke delay (60-180ms base)
    const baseDelay = crypto.randomInt(60, 180);
    // Add jitter
    await randomDelay(baseDelay, baseDelay + 40);

    // Occasional brief pauses (simulating thinking / reading while typing)
    if (i > 0 && i % crypto.randomInt(8, 16) === 0) {
      await randomDelay(350, 750);
    }
  }
}

export async function randomViewportJitter(page: Page): Promise<void> {
  const baseWidth = 1280;
  const baseHeight = 800;
  const jitterW = crypto.randomInt(-25, 25);
  const jitterH = crypto.randomInt(-20, 20);
  await page.setViewportSize({
    width: baseWidth + jitterW,
    height: baseHeight + jitterH,
  });
}
