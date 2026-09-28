import { test, expect } from '@playwright/test';

const SEED_TREE = JSON.stringify([
  {
    id: 'root',
    name: 'repro',
    type: 'folder',
    isOpen: true,
    children: [
      { id: 'file-js', name: 'app.js', type: 'file', parentId: 'root', content: 'const x = 5;\n' },
    ],
  },
]);

test('repro: /// literal fast path via real keystrokes', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => {
    const t = `[${m.type()}] ${m.text()}`;
    if (t.includes('AI Auto-Replace') || t.includes('///') || t.includes('triple') || m.type() === 'error') {
      logs.push(t.slice(0, 300));
    }
  });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message.slice(0, 300)}`));

  await page.addInitScript(
    ({ tree }) => {
      localStorage.clear();
      localStorage.setItem('azemax-file-tree', tree);
      localStorage.setItem('azemax-active-file-id', 'file-js');
      localStorage.setItem('azemax-expanded-folders', JSON.stringify(['root']));
    },
    { tree: SEED_TREE },
  );
  await page.goto('/app');
  await page.waitForSelector('.monaco-editor', { timeout: 15_000 });
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__azemax_editor, { timeout: 15_000 });

  // Focus editor, go to end of line 1, type the trigger with real keystrokes
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const ed = w.__azemax_editor as { focus?: () => void; setPosition?: (p: { lineNumber: number; column: number }) => void } | undefined;
    ed?.focus?.();
    ed?.setPosition?.({ lineNumber: 1, column: 13 });
  });
  await page.waitForTimeout(300);
  await page.keyboard.type(' ///pass different inputs;');
  // Fast path is deterministic — allow generous time for import + apply
  await page.waitForTimeout(4000);

  const val = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const ed = w.__azemax_editor as { getValue?: () => string } | undefined;
    return ed?.getValue?.() ?? '';
  });

  console.log('FINAL_VALUE:\n' + val);
  console.log('LOGS:\n' + (logs.length ? logs.join('\n') : '(none)'));
  expect(val).toContain('// pass different inputs');
  // Guard must not misfire on our own apply
  expect(logs.join('\n')).not.toContain('Skipping stale post-check');
  // Cursor should be placed at end of the replaced line
  const pos = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const ed = w.__azemax_editor as { getPosition?: () => { lineNumber: number; column: number } | null } | undefined;
    return ed?.getPosition?.() ?? null;
  });
  expect(pos?.lineNumber).toBe(1);
  expect(pos?.column).toBeGreaterThan(20);
});

test('repro: /// instruction verb reaches AI and transforms code', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => {
    const t = `[${m.type()}] ${m.text()}`;
    if (t.includes('AI Auto-Replace') || m.type() === 'error') logs.push(t.slice(0, 300));
  });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message.slice(0, 300)}`));

  await page.addInitScript(
    ({ tree }) => {
      localStorage.clear();
      localStorage.setItem('azemax-file-tree', tree);
      localStorage.setItem('azemax-active-file-id', 'file-js');
      localStorage.setItem('azemax-expanded-folders', JSON.stringify(['root']));
    },
    { tree: SEED_TREE },
  );
  await page.goto('/app');
  await page.waitForSelector('.monaco-editor', { timeout: 15_000 });
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__azemax_editor, { timeout: 15_000 });

  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const ed = w.__azemax_editor as { focus?: () => void; setPosition?: (p: { lineNumber: number; column: number }) => void } | undefined;
    ed?.focus?.();
    ed?.setPosition?.({ lineNumber: 1, column: 13 });
  });
  await page.waitForTimeout(300);
  // "use const instead" is an instruction -> must go to AI, must NOT echo as a comment
  await page.keyboard.type(' ///use const instead;');
  await page.waitForTimeout(25000);

  const val = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const ed = w.__azemax_editor as { getValue?: () => string } | undefined;
    return ed?.getValue?.() ?? '';
  });

  console.log('AI_PATH_VALUE:\n' + val);
  console.log('AI_PATH_LOGS:\n' + (logs.length ? logs.join('\n') : '(none)'));
  expect(val).not.toContain('///');
  expect(val).toContain('const x = 5;');
});
