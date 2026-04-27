import { Hono } from 'hono';
import { jstNow } from '@line-crm/db';
import { generateAiReply } from '../services/ai-reply.js';
import type { Env } from '../index.js';

function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

const aiSettings = new Hono<Env>();

// GET /api/ai-settings
aiSettings.get('/api/ai-settings', async (c) => {
  try {
    const row = await c.env.DB
      .prepare(`SELECT * FROM ai_settings ORDER BY created_at DESC LIMIT 1`)
      .first();
    if (!row) return c.json({ success: true, data: null });
    return c.json({
      success: true,
      data: { ...row, api_key: maskApiKey((row as { api_key: string }).api_key) },
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// PUT /api/ai-settings
aiSettings.put('/api/ai-settings', async (c) => {
  try {
    const body = await c.req.json<{
      provider?: string;
      apiKey?: string;
      modelId?: string;
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
      isActive?: boolean;
      lineAccountId?: string | null;
    }>();

    const existing = await c.env.DB
      .prepare(`SELECT * FROM ai_settings ORDER BY created_at DESC LIMIT 1`)
      .first<{ id: string; api_key: string }>();

    const now = jstNow();

    if (existing) {
      // apiKeyが未送信 or masked (****含む) なら既存値を保持
      const apiKey = body.apiKey && !body.apiKey.includes('****') && !body.apiKey.includes('••••') ? body.apiKey : existing.api_key;
      await c.env.DB
        .prepare(
          `UPDATE ai_settings SET provider = ?, api_key = ?, model_id = ?, system_prompt = ?,
           max_tokens = ?, temperature = ?, is_active = ?, line_account_id = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          body.provider || 'anthropic',
          apiKey,
          body.modelId || 'claude-sonnet-4-6',
          body.systemPrompt || null,
          body.maxTokens || 500,
          body.temperature ?? 0.7,
          body.isActive === false ? 0 : 1,
          body.lineAccountId || null,
          now,
          existing.id,
        )
        .run();
    } else {
      if (!body.apiKey) return c.json({ success: false, error: 'APIキーは必須です' }, 400);
      const id = crypto.randomUUID();
      await c.env.DB
        .prepare(
          `INSERT INTO ai_settings (id, line_account_id, provider, api_key, model_id, system_prompt, max_tokens, temperature, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          body.lineAccountId || null,
          body.provider || 'anthropic',
          body.apiKey,
          body.modelId || 'claude-sonnet-4-6',
          body.systemPrompt || null,
          body.maxTokens || 500,
          body.temperature ?? 0.7,
          body.isActive === false ? 0 : 1,
          now,
          now,
        )
        .run();
    }

    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// POST /api/ai-settings/test — テスト返信
aiSettings.post('/api/ai-settings/test', async (c) => {
  try {
    const { message } = await c.req.json<{ message: string }>();
    if (!message) return c.json({ success: false, error: 'メッセージは必須です' }, 400);

    const result = await generateAiReply(c.env.DB, message, 'test', 'テストユーザー', null);
    if (!result) return c.json({ success: false, error: 'AI設定が無効です。APIキーとプロバイダーを確認してください。' });

    return c.json({
      success: true,
      data: {
        response: result.response,
        tokensUsed: result.tokensUsed,
        latencyMs: result.latencyMs,
      },
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// GET /api/ai-reply-logs
aiSettings.get('/api/ai-reply-logs', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '50');
    const rows = await c.env.DB
      .prepare(
        `SELECT l.*, f.display_name FROM ai_reply_logs l
         LEFT JOIN friends f ON f.id = l.friend_id
         ORDER BY l.created_at DESC LIMIT ?`,
      )
      .bind(limit)
      .all();
    return c.json({ success: true, data: rows.results });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

export default aiSettings;
