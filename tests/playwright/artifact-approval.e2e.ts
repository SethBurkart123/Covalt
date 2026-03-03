import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const BACKEND_URL = 'http://127.0.0.1:3100';
const REQUIRED_TOOL_IDS = ['e2e_echo', 'e2e_requires_approval'];

function buildAppUrl(chatId?: string): string {
  const params = new URLSearchParams({ backend: BACKEND_URL });
  if (chatId) params.set('chatId', chatId);
  return `/?${params.toString()}`;
}

type ProviderConfig = {
  provider: string;
  enabled: boolean;
};

type ProviderSettingsResponse = {
  providers: ProviderConfig[];
};

type DefaultToolsResponse = {
  toolIds: string[];
};

async function callCommand<T>(
  request: APIRequestContext,
  command: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const response = await request.post(`${BACKEND_URL}/command/${command}`, {
    data: payload,
  });

  expect(response.ok()).toBeTruthy();
  const json = (await response.json()) as { result?: T } & T;
  return (json?.result ?? json) as T;
}

async function configureCoreFlowFixtures(
  request: APIRequestContext,
): Promise<() => Promise<void>> {
  const defaultTools = await callCommand<DefaultToolsResponse>(request, 'get_default_tools');
  const providerSettings = await callCommand<ProviderSettingsResponse>(request, 'get_provider_settings');
  const priorE2eEnabled = providerSettings.providers.find((item) => item.provider === 'e2e')?.enabled;

  await callCommand(request, 'save_provider_settings', {
    body: {
      provider: 'e2e',
      enabled: true,
    },
  });

  const nextToolIds = Array.from(new Set([...(defaultTools.toolIds ?? []), ...REQUIRED_TOOL_IDS]));
  await callCommand(request, 'set_default_tools', {
    body: {
      toolIds: nextToolIds,
    },
  });

  return async () => {
    await callCommand(request, 'set_default_tools', {
      body: {
        toolIds: defaultTools.toolIds ?? [],
      },
    });

    await callCommand(request, 'save_provider_settings', {
      body: {
        provider: 'e2e',
        enabled: priorE2eEnabled ?? false,
      },
    });
  };
}

async function openChatWithBackend(page: Page, chatId?: string): Promise<void> {
  await page.goto(buildAppUrl(chatId));
  await expect(page).toHaveTitle(/covalt/i);
  await expect(page.locator('form.chat-input-form')).toBeVisible();
}

async function selectModel(page: Page, modelId: string): Promise<void> {
  const modelSelector = page.locator('form.chat-input-form [role="combobox"]').first();
  await modelSelector.click();

  const search = page.getByPlaceholder('Search model or agent...');
  await expect(search).toBeVisible();
  await search.fill(modelId);

  const option = page.locator('[cmdk-item]').filter({ hasText: modelId }).first();
  await expect(option).toBeVisible();
  await option.click();

  await expect(search).toBeHidden();
  await expect(modelSelector).toContainText(modelId);
}

async function submitPrompt(
  page: Page,
  prompt: string,
  mention?: { value: string },
): Promise<void> {
  const composer = page.locator('form.chat-input-form [contenteditable="true"]').first();
  await composer.click();
  await page.keyboard.type(prompt);

  if (mention) {
    await page.keyboard.type(' @');
    await page.keyboard.type(mention.value);

    const suggestion = page
      .locator('button')
      .filter({ hasText: `@${mention.value}` })
      .first();

    await expect(suggestion).toBeVisible({ timeout: 10_000 });
    await suggestion.click();
  }

  const submitButton = page.locator('form.chat-input-form button[type="submit"]');
  await expect(submitButton).toBeVisible();
  await submitButton.click();
}

function getChatIdFromPageUrl(page: Page): string {
  const chatId = new URL(page.url()).searchParams.get('chatId');
  return chatId ?? '';
}

function createIsolatedChatId(): string {
  return `pw-${randomUUID().slice(0, 8)}`;
}

test.describe('playwright core artifact and approval flows', () => {
  test('validates artifact rendering flow with UI assertions', async ({ page, request }, testInfo) => {
    const chatId = createIsolatedChatId();
    const restore = await configureCoreFlowFixtures(request);
    try {
      await callCommand(request, 'create_chat', {
        body: {
          id: chatId,
          title: `pw artifact ${testInfo.repeatEachIndex}`,
        },
      });
      await openChatWithBackend(page, chatId);
      await selectModel(page, 'builtin');
      await submitPrompt(page, 'Render an artifact-style tool card.', {
        value: 'e2e_echo',
      });

      const artifactCard = page
        .locator('[data-toolcall]')
        .filter({ hasText: 'e2e_echo' })
        .first();

      await expect(artifactCard).toBeVisible({ timeout: 20_000 });
      await expect(artifactCard).toContainText('e2e_echo');
      await artifactCard.click();
      await expect(page.getByText('E2E echo')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('form.chat-input-form button[type="submit"]')).toBeVisible();
    } finally {
      await restore();
    }
  });

  test('validates approval approve path completes with expected output evidence', async ({ page, request }, testInfo) => {
    const chatId = createIsolatedChatId();
    const restore = await configureCoreFlowFixtures(request);
    try {
      await callCommand(request, 'create_chat', {
        body: {
          id: chatId,
          title: `pw approve ${testInfo.repeatEachIndex}`,
        },
      });
      await openChatWithBackend(page, chatId);
      await selectModel(page, 'approval');
      await submitPrompt(page, 'Please run the approval action.', {
        value: 'e2e_requires_approval',
      });

      const approvalCard = page
        .locator('[data-toolcall]')
        .filter({ hasText: 'e2e_requires_approval' })
        .first();

      await expect(approvalCard).toBeVisible({ timeout: 20_000 });
      await expect(approvalCard.getByRole('button', { name: 'Approve' })).toBeVisible();
      await expect(approvalCard.getByRole('button', { name: 'Deny' })).toBeVisible();

      await approvalCard.getByRole('button', { name: 'Approve' }).click();

      await expect(approvalCard.getByRole('button', { name: 'Approve' })).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect(approvalCard.getByRole('button', { name: 'Deny' })).toHaveCount(0);
      await expect(approvalCard.getByText('Denied')).toHaveCount(0);
      await expect(approvalCard).toContainText('e2e_requires_approval');
      await approvalCard.click();
      await expect(page.getByText('E2E approval')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('form.chat-input-form button[type="submit"]')).toBeVisible();
    } finally {
      await restore();
    }
  });

  test('validates approval deny path and rejects false-success output', async ({ page, request }, testInfo) => {
    const chatId = createIsolatedChatId();
    const restore = await configureCoreFlowFixtures(request);
    try {
      await callCommand(request, 'create_chat', {
        body: {
          id: chatId,
          title: `pw deny ${testInfo.repeatEachIndex}`,
        },
      });
      await openChatWithBackend(page, chatId);
      await selectModel(page, 'approval');
      await submitPrompt(page, 'Please run the approval action and deny it.', {
        value: 'e2e_requires_approval',
      });

      const approvalCard = page
        .locator('[data-toolcall]')
        .filter({ hasText: 'e2e_requires_approval' })
        .first();

      await expect(approvalCard).toBeVisible({ timeout: 20_000 });
      await expect(approvalCard.getByRole('button', { name: 'Approve' })).toBeVisible();
      await expect(approvalCard.getByRole('button', { name: 'Deny' })).toBeVisible();

      await approvalCard.getByRole('button', { name: 'Deny' }).click();

      await expect(approvalCard.getByText('Denied')).toBeVisible({ timeout: 10_000 });
      await expect(approvalCard.getByText('Result')).toHaveCount(0);
      await expect(approvalCard.getByRole('button', { name: 'Approve' })).toHaveCount(0);
      await expect(approvalCard.getByRole('button', { name: 'Deny' })).toHaveCount(0);
      await expect(page.locator('form.chat-input-form button[type="submit"]')).toBeVisible();
    } finally {
      await restore();
    }
  });

  test('keeps generated tool output visible after page reload in the same session', async ({ page, request }, testInfo) => {
    const chatId = createIsolatedChatId();
    const restore = await configureCoreFlowFixtures(request);
    try {
      await callCommand(request, 'create_chat', {
        body: {
          id: chatId,
          title: `pw persistence ${testInfo.repeatEachIndex}`,
        },
      });
      await openChatWithBackend(page, chatId);
      await selectModel(page, 'builtin');
      await submitPrompt(page, 'Persist this output across a reload.', {
        value: 'e2e_echo',
      });

      const artifactCard = page
        .locator('[data-toolcall]')
        .filter({ hasText: 'e2e_echo' })
        .first();

      await expect(artifactCard).toBeVisible({ timeout: 20_000 });
      await page.waitForURL(/chatId=/, { timeout: 20_000 });

      const originalChatId = getChatIdFromPageUrl(page);
      expect(originalChatId).not.toBe('');

      await page.reload();
      await expect(page.locator('form.chat-input-form')).toBeVisible();
      await expect(artifactCard).toBeVisible({ timeout: 20_000 });
      await expect(artifactCard).toContainText('e2e_echo');
      await expect(page.getByText('Persist this output across a reload.')).toBeVisible();
      expect(getChatIdFromPageUrl(page)).toBe(originalChatId);
    } finally {
      await restore();
    }
  });
});
