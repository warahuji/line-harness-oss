import { jstNow } from '@line-crm/db';

interface AiSettings {
  id: string;
  provider: string;
  api_key: string;
  model_id: string;
  system_prompt: string | null;
  max_tokens: number;
  temperature: number;
  is_active: number;
}

interface KnowledgeArticle {
  id: string;
  title: string;
  category: string;
  content: string;
}

interface AiReplyResult {
  response: string;
  knowledgeUsed: string[];
  tokensUsed: number;
  latencyMs: number;
}

const DEFAULT_SYSTEM_PROMPT = `あなたはお店のカスタマーサポートAIです。
以下のナレッジベースの情報を元に、お客様の質問に丁寧に回答してください。
ナレッジにない情報については「確認してお返事しますので少々お待ちください」と回答してください。
回答は簡潔に、LINEメッセージとして読みやすい長さ（200文字以内目安）にしてください。`;

export async function getAiSettings(db: D1Database, lineAccountId: string | null): Promise<AiSettings | null> {
  const query = lineAccountId
    ? `SELECT * FROM ai_settings WHERE is_active = 1 AND (line_account_id IS NULL OR line_account_id = ?) ORDER BY line_account_id DESC LIMIT 1`
    : `SELECT * FROM ai_settings WHERE is_active = 1 AND line_account_id IS NULL LIMIT 1`;
  const stmt = db.prepare(query);
  return lineAccountId ? stmt.bind(lineAccountId).first<AiSettings>() : stmt.first<AiSettings>();
}

export async function generateAiReply(
  db: D1Database,
  userMessage: string,
  friendId: string,
  friendName: string | null,
  lineAccountId: string | null,
): Promise<AiReplyResult | null> {
  const settings = await getAiSettings(db, lineAccountId);
  if (!settings) return null;

  // ナレッジ取得
  const articles = await db
    .prepare(`SELECT id, title, category, content FROM knowledge_articles WHERE is_active = 1`)
    .all<KnowledgeArticle>();

  const knowledgeText = articles.results.length > 0
    ? articles.results.map(a => `【${a.category}】${a.title}\n${a.content}`).join('\n\n---\n\n')
    : '';

  const systemPrompt = (settings.system_prompt || DEFAULT_SYSTEM_PROMPT)
    + (knowledgeText ? `\n\n## ナレッジベース\n\n${knowledgeText}` : '');

  const userContext = friendName ? `（${friendName}さんからのメッセージ）` : '';

  const startTime = Date.now();
  let response: string;
  let tokensUsed = 0;

  try {
    if (settings.provider === 'anthropic') {
      const result = await callAnthropic(settings, systemPrompt, `${userContext}${userMessage}`);
      response = result.text;
      tokensUsed = result.tokens;
    } else if (settings.provider === 'google') {
      const result = await callGemini(settings, systemPrompt, `${userContext}${userMessage}`);
      response = result.text;
      tokensUsed = result.tokens;
    } else {
      return null;
    }
  } catch (err) {
    console.error(`[ai-reply] ${settings.provider} API error:`, err);
    return null;
  }

  const latencyMs = Date.now() - startTime;
  const knowledgeUsed = articles.results.map(a => a.id);

  // ログ記録（テスト時はfriend_id FK制約を回避するためスキップ）
  if (friendId !== 'test') {
    await db
      .prepare(
        `INSERT INTO ai_reply_logs (id, friend_id, user_message, ai_response, knowledge_used, tokens_used, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        friendId,
        userMessage,
        response,
      JSON.stringify(knowledgeUsed),
      tokensUsed,
      latencyMs,
      jstNow(),
    )
    .run();
  }

  return { response, knowledgeUsed, tokensUsed, latencyMs };
}

async function callAnthropic(
  settings: AiSettings,
  systemPrompt: string,
  userMessage: string,
): Promise<{ text: string; tokens: number }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.api_key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: settings.model_id,
      max_tokens: settings.max_tokens,
      temperature: settings.temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };

  return {
    text: data.content[0]?.text || '',
    tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
  };
}

async function callGemini(
  settings: AiSettings,
  systemPrompt: string,
  userMessage: string,
): Promise<{ text: string; tokens: number }> {
  const model = settings.model_id || 'gemini-2.5-flash';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.api_key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: {
          maxOutputTokens: settings.max_tokens,
          temperature: settings.temperature,
        },
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API ${res.status}: ${err}`);
  }

  const data = await res.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    usageMetadata?: { totalTokenCount?: number };
  };

  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    tokens: data.usageMetadata?.totalTokenCount || 0,
  };
}
