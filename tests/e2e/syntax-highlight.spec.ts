import { test, expect } from '@playwright/test';
import { signInForE2E } from './_auth';

// VS Code Dark+ token colors (as rendered rgb()).
const PURPLE = 'rgb(197, 134, 192)'; // keyword.control
const BLUE = 'rgb(86, 156, 214)'; // keyword / storage
const TAN = 'rgb(206, 145, 120)'; // string
const SAGE = 'rgb(181, 206, 168)'; // number
const LIGHT_BLUE = 'rgb(156, 220, 254)'; // variable / identifier
const YELLOW = 'rgb(220, 220, 170)'; // entity.name.function
const TEAL = 'rgb(78, 201, 176)'; // types
const FG = 'rgb(212, 212, 212)'; // default text
const BG = 'rgb(8, 15, 28)'; // Azemax Midnight Blue (preserved)
const GREEN = 'rgb(106, 153, 85)'; // comment

const CSHARP = `using System;

class Program
{
    static void Main()
    {
        Console.Write("Enter a number: ");
        int n = int.Parse(Console.ReadLine());
        long fact = 1;

        for (int i = 1; i <= n; i++)
        {
            fact *= i;
        }

        Console.WriteLine($"Factorial: {fact}");
    }
}`;

const JAVA = `import java.util.List;

public class Demo {
    public static void main(String[] args) {
        List<String> names = List.of("a", "b");
        int count = names.size();
        System.out.println("count = " + count);
    }
}`;

const TYPESCRIPT = `interface User<T> { id: number; name: string; }
class Service<T> implements User<T> {
  constructor(public id: number, public name: string) {}
}
const svc: Service<string> = new Service(1, "a");
export function run(u: User<string>): void { console.log(u.name); }`;

const PYTHON = `import os

class Greeter:
    def __init__(self, name: str):
        self.name = name

    def greet(self) -> str:
        # greet
        return f"Hello, {self.name}"

g: Greeter = Greeter("x")
print(g.greet())`;

const SEED_TREE = JSON.stringify([
  {
    id: 'root',
    name: 'deep-context-ide',
    type: 'folder',
    isOpen: true,
    children: [
      { id: 'file-cs-id', name: 'Program.cs', type: 'file', parentId: 'root', content: CSHARP },
      { id: 'file-java-id', name: 'Demo.java', type: 'file', parentId: 'root', content: JAVA },
      { id: 'file-ts-id', name: 'app.ts', type: 'file', parentId: 'root', content: TYPESCRIPT },
      { id: 'file-py-id', name: 'main.py', type: 'file', parentId: 'root', content: PYTHON },
    ],
  },
]);

async function seedAndReload(page: import('@playwright/test').Page, activeId = 'file-cs-id') {
  await page.addInitScript(
    ({ tree, active }) => {
      localStorage.clear();
      localStorage.setItem('azemax-file-tree', tree);
      localStorage.setItem('azemax-active-file-id', active);
      localStorage.setItem('azemax-expanded-folders', JSON.stringify(['root']));
    },
    { tree: SEED_TREE, active: activeId },
  );
  await page.goto('/app');
  await page.waitForSelector('[data-testid="editor-root"]', { timeout: 20_000 });
  await page.waitForSelector('.monaco-editor', { timeout: 20_000 });
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__azemax_editor, { timeout: 20_000 });
}

/** Map of exact token text -> every rendered color for that text. */
async function tokenColors(page: import('@playwright/test').Page, text: string): Promise<string[]> {
  return page.evaluate((t) => {
    const colors: string[] = [];
    document.querySelectorAll('.view-lines .view-line span').forEach((sp) => {
      if ((sp.textContent ?? '').replace(/\u00a0/g, ' ') === t && sp.children.length === 0) {
        colors.push(window.getComputedStyle(sp as Element).color);
      }
    });
    return colors;
  }, text);
}

/** Colors of leaf spans whose text contains the given substring. */
async function tokenColorsContaining(page: import('@playwright/test').Page, text: string): Promise<string[]> {
  return page.evaluate((t) => {
    const colors: string[] = [];
    document.querySelectorAll('.view-lines .view-line span').forEach((sp) => {
      if (sp.children.length === 0 && (sp.textContent ?? '').replace(/\u00a0/g, ' ').includes(t)) {
        colors.push(window.getComputedStyle(sp as Element).color);
      }
    });
    return colors;
  }, text);
}

async function expectToken(page: import('@playwright/test').Page, text: string, color: string) {
  // Tokenization settles asynchronously (lazy language load, factory
  // resolution, background retokenization): poll until the token is rendered
  // with the expected color. Transient mid-tokenization splits resolve on
  // their own; only a genuinely wrong theme burns the full timeout.
  await expect
    .poll(async () => tokenColors(page, text), { timeout: 15_000 })
    .toContain(color);
}

async function expectTokenContaining(page: import('@playwright/test').Page, text: string, color: string) {
  await expect
    .poll(async () => tokenColorsContaining(page, text), { timeout: 15_000 })
    .toContain(color);
}

async function waitForHighlight(page: import('@playwright/test').Page) {
  // Tokenization is async (lazy language load + tokenizer factory): poll
  // until the C# `using` keyword resolves to Dark+ purple.
  await expect.poll(async () => tokenColors(page, 'using'), { timeout: 25_000 }).toContain(PURPLE);
}

/** Scroll through the whole file so every line is tokenized and rendered. */
async function revealFullFile(page: import('@playwright/test').Page) {
  // Immediate (non-animated) scrolls: smooth scrolling would race the
  // assertions below.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const monaco = w.__azemax_monaco as { editor: { ScrollType: { Immediate: number } } } | undefined;
    const ed = w.__azemax_editor as {
      getModel: () => { getLineCount: () => number } | null;
      revealLineInCenter: (n: number, s?: number) => void;
    } | undefined;
    const count = ed?.getModel()?.getLineCount() ?? 1;
    ed?.revealLineInCenter(count, monaco?.editor.ScrollType.Immediate ?? 1);
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const monaco = w.__azemax_monaco as { editor: { ScrollType: { Immediate: number } } } | undefined;
    (w.__azemax_editor as { revealLineInCenter: (n: number, s?: number) => void } | undefined)?.revealLineInCenter(
      1,
      monaco?.editor.ScrollType.Immediate ?? 1,
    );
  });
  await page.waitForTimeout(1200);
}

test.describe('Azemax Dark+ syntax highlighting', () => {
  test.beforeEach(async ({ page }) => {
    // Firebase identity is required (no bypass). Skips without real credentials.
    await signInForE2E(page);
  });

  test('csharp renders VS Code Dark+ token colors on Midnight Blue', async ({ page }) => {
    await seedAndReload(page);
    await waitForHighlight(page);
    await revealFullFile(page);

    const bg = await page.evaluate(
      () => window.getComputedStyle(document.querySelector('.monaco-editor') as Element).backgroundColor,
    );
    expect(bg, 'midnight background preserved').toBe(BG);

    await expectToken(page, 'using', PURPLE);
    await expectToken(page, 'System', TEAL);
    await expectToken(page, 'class', BLUE);
    await expectToken(page, 'Program', TEAL);
    await expectToken(page, 'static', BLUE);
    await expectToken(page, 'void', TEAL);
    await expectToken(page, 'Main', YELLOW);
    await expectToken(page, 'Console', TEAL);
    await expectToken(page, 'Write', YELLOW);
    await expectToken(page, 'WriteLine', YELLOW);
    await expectToken(page, 'Parse', YELLOW);
    await expectToken(page, 'ReadLine', YELLOW);
    await expectToken(page, 'int', TEAL);
    await expectToken(page, 'long', TEAL);
    await expectToken(page, 'n', LIGHT_BLUE);
    await expectToken(page, 'fact', LIGHT_BLUE);
    await expectToken(page, 'i', LIGHT_BLUE);
    await expectToken(page, 'for', PURPLE);
    await expectToken(page, '1', SAGE);
    // String quotes may merge with content into one span or split; match by content.
    await expectTokenContaining(page, 'Enter a number', TAN);
    await expectToken(page, ';', FG);
  });

  test('theme survives tab switch; java highlights after switch', async ({ page }) => {
    await seedAndReload(page);
    await waitForHighlight(page);

    await page.locator('[data-file-name="Demo.java"]').click();
    await page.waitForTimeout(800);
    await expect.poll(async () => tokenColors(page, 'public'), { timeout: 25_000 }).toContain(BLUE);
    await revealFullFile(page);

    // Dark+ Java import rule: import keyword and path in editor foreground
    // (all one color, so the line merges into a single span).
    await expectTokenContaining(page, 'import java.util.List;', FG);
    await expectToken(page, 'public', BLUE);
    await expectToken(page, 'Demo', TEAL);
    await expectToken(page, 'main', YELLOW);
    await expectToken(page, 'void', TEAL);
    await expectToken(page, 'String', TEAL);
    await expectToken(page, 'args', LIGHT_BLUE);
    await expectToken(page, 'of', YELLOW);
    await expectToken(page, 'size', YELLOW);
    await expectToken(page, 'println', YELLOW);
    await expectToken(page, '"a"', TAN);

    // Switch back: C# theme intact, not reset.
    await page.locator('[data-file-name="Program.cs"]').click();
    await page.waitForTimeout(800);
    await expect.poll(async () => tokenColors(page, 'using'), { timeout: 25_000 }).toContain(PURPLE);
    await expectToken(page, 'Main', YELLOW);
    await expectToken(page, 'Console', TEAL);
    const bg = await page.evaluate(
      () => window.getComputedStyle(document.querySelector('.monaco-editor') as Element).backgroundColor,
    );
    expect(bg, 'midnight background preserved after switch').toBe(BG);
  });

  test('typescript and python render Dark+ token colors', async ({ page }) => {
    await seedAndReload(page, 'file-ts-id');
    await expect.poll(async () => tokenColors(page, 'interface'), { timeout: 25_000 }).toContain(BLUE);
    await revealFullFile(page);

    await expectToken(page, 'interface', BLUE);
    await expectToken(page, 'User', TEAL);
    await expectToken(page, 'number', TEAL);
    await expectToken(page, 'string', TEAL);
    await expectToken(page, 'class', BLUE);
    await expectToken(page, 'Service', TEAL);
    await expectToken(page, 'new', PURPLE);
    await expectToken(page, 'export', PURPLE);
    await expectToken(page, 'function', BLUE);
    await expectToken(page, 'run', YELLOW);
    await expectToken(page, 'void', TEAL);
    await expectToken(page, 'svc', LIGHT_BLUE);
    await expectToken(page, '"a"', TAN);

    await page.locator('[data-file-name="main.py"]').click();
    await page.waitForTimeout(800);
    await expect.poll(async () => tokenColors(page, 'def'), { timeout: 25_000 }).toContain(BLUE);
    await revealFullFile(page);

    await expectToken(page, 'import', PURPLE);
    await expectToken(page, 'class', BLUE);
    await expectToken(page, 'Greeter', TEAL);
    await expectToken(page, 'def', BLUE);
    await expectToken(page, '__init__', YELLOW);
    await expectToken(page, 'self', BLUE);
    await expectToken(page, 'greet', YELLOW);
    await expectToken(page, 'return', PURPLE);
    await expectToken(page, 'str', TEAL);
    await expectToken(page, '# greet', GREEN);
    await expectToken(page, 'print', YELLOW);
  });
});
