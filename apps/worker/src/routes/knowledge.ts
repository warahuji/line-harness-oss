import { Hono } from 'hono';
import { jstNow } from '@line-crm/db';
import type { Env } from '../index.js';

const knowledge = new Hono<Env>();

// GET /api/knowledge
knowledge.get('/api/knowledge', async (c) => {
  try {
    const rows = await c.env.DB
      .prepare(`SELECT * FROM knowledge_articles ORDER BY created_at DESC`)
      .all();
    return c.json({ success: true, data: rows.results });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// POST /api/knowledge — 手動追加
knowledge.post('/api/knowledge', async (c) => {
  try {
    const body = await c.req.json<{
      title: string;
      category?: string;
      content: string;
      sourceUrl?: string;
    }>();
    if (!body.title || !body.content) {
      return c.json({ success: false, error: 'タイトルと内容は必須です' }, 400);
    }

    const id = crypto.randomUUID();
    const now = jstNow();
    await c.env.DB
      .prepare(
        `INSERT INTO knowledge_articles (id, title, category, content, source_url, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(id, body.title, body.category || 'general', body.content, body.sourceUrl || null, now, now)
      .run();

    return c.json({ success: true, data: { id } });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// POST /api/knowledge/scrape — URL読み取り
knowledge.post('/api/knowledge/scrape', async (c) => {
  try {
    const { url } = await c.req.json<{ url: string }>();
    if (!url) return c.json({ success: false, error: 'URLは必須です' }, 400);

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LineHarness/1.0)',
        'Accept': 'text/html',
      },
    });

    if (!res.ok) {
      return c.json({ success: false, error: `ページの取得に失敗しました (${res.status})` }, 400);
    }

    const html = await res.text();

    // 軽量HTML解析
    const title = extractTag(html, 'title') || url;
    const metaDesc = extractMetaContent(html, 'description') || '';
    const ogTitle = extractMetaProperty(html, 'og:title') || '';
    const ogDesc = extractMetaProperty(html, 'og:description') || '';

    // 本文抽出: <main> or <article> or <body>
    const mainContent = extractMainContent(html);

    // テキストクリーニング
    const cleanText = cleanHtml(mainContent)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 10000); // 最大10,000文字

    const content = [
      ogDesc || metaDesc ? `【概要】${ogDesc || metaDesc}` : '',
      cleanText ? `【本文】${cleanText}` : '',
    ].filter(Boolean).join('\n\n');

    return c.json({
      success: true,
      data: {
        title: ogTitle || title,
        content,
        sourceUrl: url,
        category: 'general',
      },
    });
  } catch (err) {
    return c.json({ success: false, error: `スクレイピングエラー: ${String(err)}` }, 500);
  }
});

// PUT /api/knowledge/:id
knowledge.put('/api/knowledge/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      title?: string;
      category?: string;
      content?: string;
      sourceUrl?: string;
      isActive?: boolean;
    }>();

    const existing = await c.env.DB
      .prepare(`SELECT * FROM knowledge_articles WHERE id = ?`)
      .bind(id)
      .first();
    if (!existing) return c.json({ success: false, error: '見つかりません' }, 404);

    await c.env.DB
      .prepare(
        `UPDATE knowledge_articles SET title = ?, category = ?, content = ?, source_url = ?, is_active = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        body.title || (existing as { title: string }).title,
        body.category || (existing as { category: string }).category,
        body.content || (existing as { content: string }).content,
        body.sourceUrl !== undefined ? body.sourceUrl : (existing as { source_url: string }).source_url,
        body.isActive === false ? 0 : 1,
        jstNow(),
        id,
      )
      .run();

    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// DELETE /api/knowledge/:id
knowledge.delete('/api/knowledge/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await c.env.DB.prepare(`DELETE FROM knowledge_articles WHERE id = ?`).bind(id).run();
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// --- HTML解析ヘルパー ---

function extractTag(html: string, tag: string): string {
  const match = html.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i'));
  return match?.[1]?.trim() || '';
}

function extractMetaContent(html: string, name: string): string {
  const match = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'));
  return match?.[1]?.trim() || '';
}

function extractMetaProperty(html: string, property: string): string {
  const match = html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'));
  return match?.[1]?.trim() || '';
}

function extractMainContent(html: string): string {
  // <main>を優先、なければ<article>、最終的に<body>
  for (const tag of ['main', 'article']) {
    const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    if (match) return match[1];
  }
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch?.[1] || html;
}

function cleanHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export default knowledge;
