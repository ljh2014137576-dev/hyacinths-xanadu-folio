import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron } from '@playwright/test';

const repositoryRoot = resolve('.');
const fixtureRoot = resolve('.tmp/screenshot-order-service');
const sourceFixtureRoot = resolve('fixtures/order-service');
const userDataRoot = resolve('.tmp/screenshot-userdata');
const outputDirectory = resolve('docs/screenshots');
await fs.rm(userDataRoot, { recursive: true, force: true });
await fs.rm(fixtureRoot, { recursive: true, force: true });
await fs.cp(sourceFixtureRoot, fixtureRoot, { recursive: true, filter: (source) => !source.endsWith('broken.ts') });
await fs.mkdir(outputDirectory, { recursive: true });

const app = await electron.launch({
  args: ['.', ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  cwd: repositoryRoot,
  env: { ...process.env, XANADU_DEMO_WORKSPACE: fixtureRoot, XANADU_USER_DATA: userDataRoot },
});

try {
  const page = await app.firstWindow();
  await page.getByRole('button', { name: '选择本地 TypeScript 项目' }).click();
  await page.getByText('选择入口函数，创建 FlowPage').waitFor();
  await page.getByLabel('搜索文件、函数、方法或业务节点').fill('createOrder');
  await page.locator('.entry-picker button').filter({ hasText: 'createOrder' }).click();
  for (const target of ['validateOrderInput', 'getProducts', 'calculateOrderPricing', 'reserveInventory', 'saveOrder', 'followPaidBranch', 'inspectQueues']) {
    await page.getByRole('button', { name: new RegExp(`展开 ${target}`) }).click();
  }
  await page.getByRole('button', { name: /展开 shipOrder/ }).click();
  await page.getByRole('button', { name: /展开 requestPayment/ }).click();
  await page.locator('.source-card').filter({ has: page.locator('header strong', { hasText: /^createOrder$/ }) }).waitFor();
  await page.getByLabel('搜索文件、函数、方法或业务节点').fill('');
  await page.screenshot({ path: resolve(outputDirectory, 'standard-view.png'), fullPage: false });
  await page.getByRole('button', { name: '沉浸式' }).click();
  await page.locator('.workspace-shell--immersive').waitFor();
  await page.keyboard.press('Control+Space');
  await page.getByRole('dialog', { name: '项目目录抽屉' }).waitFor();
  await page.screenshot({ path: resolve(outputDirectory, 'immersive-view.png'), fullPage: false });
} finally {
  await app.close();
}
