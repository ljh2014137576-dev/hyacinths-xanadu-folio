import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

const repositoryRoot = resolve('.');
const fixtureRoot = resolve('fixtures/order-service');
const userDataRoot = resolve('.tmp/e2e-userdata');

const launch = async (): Promise<{ readonly app: ElectronApplication; readonly page: Page }> => {
  const app = await electron.launch({
    args: ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    cwd: repositoryRoot,
    env: { ...process.env, XANADU_DEMO_WORKSPACE: fixtureRoot, XANADU_USER_DATA: userDataRoot },
  });
  return { app, page: await app.firstWindow() };
};

const selectFixture = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: '选择本地 TypeScript 项目' }).click();
  await expect(page.getByText(/选择入口函数|静态查看过滤/).first()).toBeVisible();
};

test('indexes, reads, organizes, switches modes and restores the MVP workspace', async () => {
  await fs.rm(userDataRoot, { recursive: true, force: true });
  let running = await launch();
  const invalidHandleRejected = await running.page.evaluate(async () => {
    try {
      await window.xanadu.loadUserState({ handle: '../escape' });
      return false;
    } catch {
      return true;
    }
  });
  expect(invalidHandleRejected).toBe(true);
  await selectFixture(running.page);
  const search = running.page.getByLabel('搜索文件、函数、方法或业务节点');
  await search.fill('createOrder');
  await running.page.locator('.entry-picker button').filter({ hasText: 'createOrder' }).click();
  const entryCard = running.page.locator('.source-card').filter({ has: running.page.locator('header strong', { hasText: /^createOrder$/ }) });
  await expect(entryCard).toBeVisible();
  await expect(running.page.locator('.source-card')).toHaveCount(1);
  await expect(running.page.locator('svg .bridge-stroke')).toHaveCount(0);
  for (const target of ['validateOrderInput', 'getProducts', 'calculateOrderPricing', 'reserveInventory', 'saveOrder', 'followPaidBranch', 'inspectQueues']) {
    await running.page.getByRole('button', { name: new RegExp(`展开 ${target}`) }).click();
  }
  await expect(running.page.locator('svg .bridge-stroke').first()).toBeVisible();
  await expect(running.page.getByText(/LoopRegion/).first()).toBeVisible();
  await running.page.getByRole('button', { name: /展开 shipOrder/ }).click();
  await running.page.getByRole('button', { name: /展开 requestPayment/ }).click();

  await entryCard.locator('header button').click();
  await expect(running.page.getByRole('heading', { name: 'createOrder' })).toBeVisible();
  await running.page.getByRole('button', { name: '← 返回流程页' }).click();
  await expect(running.page.locator('.source-card').filter({ has: running.page.locator('header strong', { hasText: /^createOrder$/ }) })).toBeVisible();

  const branchSelect = running.page.getByLabel('分支查看');
  await branchSelect.selectOption('A');
  await expect(running.page.getByText(/已弱化/)).toBeVisible();
  const firstLoop = running.page.locator('.loop-region > button').first();
  await firstLoop.click();
  await expect(firstLoop).toHaveAttribute('aria-expanded', 'false');
  await running.page.locator('[data-testid="flow-scroller"]').evaluate((element) => element.scrollTo(180, 90));
  await running.page.waitForTimeout(400);
  await running.page.getByRole('button', { name: '沉浸式' }).click();
  await expect(running.page.getByLabel('中央组合流程文档')).toBeVisible();
  await expect(running.page.locator('.immersive-source--left')).toBeVisible();
  await expect(running.page.locator('.immersive-source--right')).toBeVisible();
  await running.page.keyboard.press('Control+Space');
  await expect(running.page.getByRole('dialog', { name: '项目目录抽屉' })).toBeVisible();
  const drawerSearch = running.page.getByRole('dialog', { name: '项目目录抽屉' }).getByLabel('搜索文件、函数、方法或业务节点');
  for (const name of ['createOrder', 'validateOrderInput', 'reserveInventory', 'saveOrder']) {
    await drawerSearch.fill(name);
    await running.page.getByLabel(`选择 ${name}`).check();
  }
  await running.page.getByRole('button', { name: /创建业务节点 · 4/ }).click();
  await running.page.getByRole('button', { name: '保存业务节点' }).click();
  await drawerSearch.fill('创建订单');
  await expect(running.page.getByText('4 个函数 · 打开 FlowPage')).toBeVisible();
  await running.page.locator('.search-results button').filter({ hasText: '创建订单' }).click();
  await expect(running.page.locator('[data-business-node-id]')).toBeVisible();
  await expect(running.page.getByText('定义来源')).toBeVisible();
  await running.page.getByRole('button', { name: '沉浸式' }).click();
  await expect(running.page.getByLabel('中央组合流程文档')).toBeVisible();
  await running.app.close();

  running = await launch();
  await selectFixture(running.page);
  await expect(running.page.locator('.workspace-shell--immersive')).toBeVisible();
  await expect(running.page.locator('[data-business-node-id]')).toBeVisible();
  await expect(running.page.getByLabel('中央组合流程文档')).toBeVisible();
  await running.page.keyboard.press('Control+Space');
  await expect(running.page.getByText('4 个函数 · 打开 FlowPage')).toBeVisible();
  await running.page.locator('.recent-pages button').filter({ hasText: /^createOrder$/ }).click();
  await expect(running.page.getByLabel('分支查看')).toHaveValue('A');
  await expect(running.page.locator('.loop-region > button').first()).toHaveAttribute('aria-expanded', 'false');
  await running.app.close();
});
