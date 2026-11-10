/** Opt-in, offline Chromium proofs for generated-page visual failures. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Frame, type Page } from '@playwright/test';
import { INTERACTIVE_VALIDATION_DRIVER } from '@/lib/interactive/validate-generated-html';
import { findInteractiveScriptSyntaxFailure } from '../../../packages/@ljkt/generation/src/interactive-script-validator';
import { interactiveVisualFixture } from '../../fixtures/interactive-visual-contract';

describe.skipIf(process.env.INTERACTIVE_VISUAL_BROWSER !== '1')(
  'interactive visual contracts in Chromium',
  () => {
    let browser: Browser;
    let page: Page;

    beforeAll(async () => {
      browser = await chromium.launch({
        headless: true,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        args: ['--disable-crash-reporter', '--disable-crashpad'],
      });
    });
    afterAll(async () => {
      await browser?.close();
    });

    async function load(html: string): Promise<Frame> {
      await page?.close();
      page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      await page.route('**/*', (route) => route.abort());
      await page.setContent(`<script>
        window.visualErrors = [];
        addEventListener('message', function (event) {
          if (event.source === document.querySelector('iframe').contentWindow &&
              event.data && event.data.kind === 'runtime-error') {
            window.visualErrors.push(event.data.message);
          }
        });
      </script><iframe sandbox="allow-scripts" style="width:960px;height:540px"></iframe>`);
      await page.locator('iframe').evaluate((element, source) => {
        (element as HTMLIFrameElement).srcdoc = source;
      }, html);
      const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!;
      await frame.waitForSelector('#simulation-canvas');
      return frame;
    }

    async function errors(): Promise<string[]> {
      return page.evaluate(
        () => (window as typeof window & { visualErrors: string[] }).visualErrors,
      );
    }

    it('reproduces a visible hidden error overlay despite valid JavaScript and a working canvas', async () => {
      const html = interactiveVisualFixture({ hiddenFix: false });
      expect(findInteractiveScriptSyntaxFailure(html)).toBeNull();
      const frame = await load(html);
      expect(
        await frame.locator('#error-box').evaluate((element) => ({
          hidden: (element as HTMLElement).hidden,
          display: getComputedStyle(element).display,
        })),
      ).toEqual({ hidden: true, display: 'grid' });
      expect(
        await frame
          .locator('canvas')
          .evaluate((canvas) => !!(canvas as HTMLCanvasElement).getContext('2d')),
      ).toBe(true);
    });

    it('reports the hidden-overlay conflict before a teacher saves the page', async () => {
      await load(
        interactiveVisualFixture({ hiddenFix: false, driver: INTERACTIVE_VALIDATION_DRIVER }),
      );
      await expect
        .poll(errors)
        .toContainEqual(expect.stringContaining('Hidden element remains displayed'));
    });

    it('detects intrinsic canvas growth at a stable viewport without requiring a script exception', async () => {
      const html = interactiveVisualFixture({
        canvasFix: false,
        driver: INTERACTIVE_VALIDATION_DRIVER,
      });
      expect(findInteractiveScriptSyntaxFailure(html)).toBeNull();
      await load(html);
      await expect.poll(errors).toContainEqual(expect.stringContaining('Canvas keeps growing'));
    });

    it('accepts until-found hiding and a normally bounded canvas', async () => {
      await load(
        interactiveVisualFixture({ hiddenUntilFound: true, driver: INTERACTIVE_VALIDATION_DRIVER }),
      );
      await page.waitForTimeout(800);
      expect(await errors()).toEqual([]);
    });

    it('does not reject a large canvas whose CSS and bitmap sizes are stable', async () => {
      await load(
        interactiveVisualFixture({ driver: INTERACTIVE_VALIDATION_DRIVER }).replace(
          'height: 300px; align-self: start;',
          'height: 3000px; align-self: start;',
        ),
      );
      await page.waitForTimeout(800);
      expect(await errors()).toEqual([]);
    });

    it('allows a bounded size animation and one incidental observer warning', async () => {
      await load(
        interactiveVisualFixture({ driver: INTERACTIVE_VALIDATION_DRIVER })
          .replace(
            '</style>',
            '@keyframes grow{from{height:300px}to{height:600px}} .surface{animation:grow .4s linear forwards}</style>',
          )
          .replace(
            '</body>',
            `<script>setTimeout(function(){dispatchEvent(new ErrorEvent('error',{message:'ResizeObserver loop completed with undelivered notifications.'}));},30);</script></body>`,
          ),
      );
      await page.waitForTimeout(800);
      expect(await errors()).toEqual([]);
    });

    it('keeps the corrected canvas bounded across viewport resizes', async () => {
      const frame = await load(interactiveVisualFixture({ driver: INTERACTIVE_VALIDATION_DRIVER }));
      for (const width of [320, 768, 960]) {
        await page.locator('iframe').evaluate((element, value) => {
          (element as HTMLElement).style.width = value + 'px';
        }, width);
        await page.waitForTimeout(120);
        const before = await frame
          .locator('canvas')
          .evaluate((canvas) => [
            (canvas as HTMLCanvasElement).width,
            (canvas as HTMLCanvasElement).height,
          ]);
        await page.waitForTimeout(120);
        const after = await frame
          .locator('canvas')
          .evaluate((canvas) => [
            (canvas as HTMLCanvasElement).width,
            (canvas as HTMLCanvasElement).height,
          ]);
        expect(after).toEqual(before);
        expect(after[1]).toBe(600);
      }
      expect(await errors()).toEqual([]);
    });

    it.each([false, true])(
      'demonstrates reset readout synchronization (fixed=%s)',
      async (resetFix) => {
        const frame = await load(interactiveVisualFixture({ resetFix }));
        for (let run = 0; run < 2; run++) {
          await frame.locator('#start-btn').click();
          await expect.poll(() => frame.locator('#time').textContent()).not.toBe('0.0');
          await frame.locator('#reset-btn').click();
          expect(await frame.locator('#time').textContent()).toEqual(
            resetFix ? '0.0' : expect.not.stringMatching(/^0\.0$/),
          );
          if (resetFix) {
            expect(await frame.locator('#temperature').textContent()).toBe('25');
            expect(await frame.locator('#start-btn').textContent()).toBe('Start');
            await page.waitForTimeout(120);
            expect(await frame.locator('#time').textContent()).toBe('0.0');
          } else {
            // A reset that only changes the state object leaves a misleading label too.
            expect(await frame.locator('#start-btn').textContent()).toBe('Pause');
            break;
          }
        }
        if (resetFix) {
          await frame.locator('#start-btn').click();
          await expect.poll(() => frame.locator('#time').textContent()).not.toBe('0.0');
          await frame.locator('body').press('r');
          expect(await frame.locator('#time').textContent()).toBe('0.0');
          expect(await frame.locator('#temperature').textContent()).toBe('25');
        }
      },
    );
  },
);
