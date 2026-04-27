import { Hono } from 'hono';
import { jstNow } from '@line-crm/db';
import type { Env } from '../index.js';

const faqExtraction = new Hono<Env>();

// D1 batch は 1回100ステートメントまでなので分割して実行するヘルパー
async function batchInsert(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<void> {
  const CHUNK_SIZE = 100;
  for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
    const chunk = statements.slice(i, i + CHUNK_SIZE);
    await db.batch(chunk);
  }
}

// GET /api/faq-extraction/messages-export
faqExtraction.get('/api/faq-extraction/messages-export', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId') || null;
    const since = c.req.query('since') || null;
    const limitParam = parseInt(c.req.query('limit') || '2000');
    const limit = Math.min(limitParam > 0 ? limitParam : 2000, 2000);
    const cursor = c.req.query('cursor') || null;

    // cursor 解析: "${created_at}|${id}"
    let cursorCreatedAt: string | null = null;
    let cursorId: string | null = null;
    if (cursor) {
      const sepIdx = cursor.indexOf('|');
      if (sepIdx !== -1) {
        cursorCreatedAt = cursor.slice(0, sepIdx);
        cursorId = cursor.slice(sepIdx + 1);
      }
    }

    // タプル比較を WHERE created_at > ? OR (created_at = ? AND id > ?) に展開
    const whereClauses: string[] = [
      `m.direction = 'incoming'`,
      `m.source = 'user'`,
      `m.message_type = 'text'`,
      `length(m.content) >= 4`,
      `length(m.content) <= 500`,
      `p.message_id IS NULL`,
    ];
    const bindings: (string | null | number)[] = [];

    if (lineAccountId) {
      whereClauses.push(`f.line_account_id = ?`);
      bindings.push(lineAccountId);
    }

    if (since) {
      whereClauses.push(`m.created_at >= ?`);
      bindings.push(since);
    }

    if (cursorCreatedAt && cursorId) {
      whereClauses.push(`(m.created_at > ? OR (m.created_at = ? AND m.id > ?))`);
      bindings.push(cursorCreatedAt, cursorCreatedAt, cursorId);
    }

    const whereSQL = whereClauses.join(' AND ');

    const baseQuery = `
      FROM messages_log m
      LEFT JOIN faq_processed_messages p ON p.message_id = m.id
      LEFT JOIN friends f ON f.id = m.friend_id
      WHERE ${whereSQL}
    `;

    // COUNT クエリで全未処理件数を取得
    const countRow = await c.env.DB
      .prepare(`SELECT COUNT(*) as cnt ${baseQuery}`)
      .bind(...bindings)
      .first<{ cnt: number }>();
    const totalAvailable = countRow?.cnt ?? 0;

    // メッセージ取得
    bindings.push(limit);
    const rows = await c.env.DB
      .prepare(
        `SELECT m.id, m.content, m.created_at as createdAt, m.friend_id as friendId
         ${baseQuery}
         ORDER BY m.created_at ASC, m.id ASC
         LIMIT ?`,
      )
      .bind(...bindings)
      .all<{ id: string; content: string; createdAt: string; friendId: string }>();

    const messages = rows.results;

    let nextCursor: string | null = null;
    if (messages.length === limit && messages.length > 0) {
      const last = messages[messages.length - 1];
      nextCursor = `${last.createdAt}|${last.id}`;
    }

    return c.json({
      success: true,
      data: {
        messages,
        nextCursor,
        totalAvailable,
      },
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// POST /api/faq-extraction/runs — 抽出結果の書き戻し
faqExtraction.post('/api/faq-extraction/runs', async (c) => {
  try {
    const body = await c.req.json<{
      lineAccountId?: string | null;
      dateFrom?: string | null;
      dateTo?: string | null;
      messageCount: number;
      clusterCount: number;
      noiseCount: number;
      costUsd?: number | null;
      processedMessageIds: string[];
      proposals: {
        rank: number;
        clusterLabel?: string;
        representativeText: string;
        exampleMessages: string[];
        messageCount: number;
        suggestedAnswer?: string;
        suggestedCategory?: string;
      }[];
    }>();

    if (body.messageCount === undefined || body.messageCount === null) {
      return c.json({ success: false, error: 'messageCount は必須です' }, 400);
    }
    if (!Array.isArray(body.processedMessageIds)) {
      return c.json({ success: false, error: 'processedMessageIds は配列で必須です' }, 400);
    }
    if (!Array.isArray(body.proposals)) {
      return c.json({ success: false, error: 'proposals は配列で必須です' }, 400);
    }

    const runId = crypto.randomUUID();
    const now = jstNow();

    // 1. faq_extraction_runs INSERT
    await c.env.DB
      .prepare(
        `INSERT INTO faq_extraction_runs
           (id, line_account_id, status, started_at, completed_at,
            message_count, cluster_count, noise_count, date_from, date_to, cost_usd, created_at)
         VALUES (?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        runId,
        body.lineAccountId ?? null,
        now,
        now,
        body.messageCount,
        body.clusterCount,
        body.noiseCount,
        body.dateFrom ?? null,
        body.dateTo ?? null,
        body.costUsd ?? null,
        now,
      )
      .run();

    // 2. proposals INSERT (rank順)
    const sortedProposals = [...body.proposals].sort((a, b) => a.rank - b.rank);
    for (const p of sortedProposals) {
      if (!p.representativeText) continue;
      const proposalId = crypto.randomUUID();
      await c.env.DB
        .prepare(
          `INSERT INTO faq_proposals
             (id, run_id, cluster_label, representative_text, example_messages,
              message_count, rank, suggested_answer, suggested_category, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        )
        .bind(
          proposalId,
          runId,
          p.clusterLabel ?? null,
          p.representativeText,
          JSON.stringify(p.exampleMessages ?? []),
          p.messageCount,
          p.rank,
          p.suggestedAnswer ?? null,
          p.suggestedCategory ?? 'faq',
          now,
        )
        .run();
    }

    // 3. processedMessageIds を faq_processed_messages にバルク INSERT
    if (body.processedMessageIds.length > 0) {
      const stmts = body.processedMessageIds.map((msgId) =>
        c.env.DB
          .prepare(
            `INSERT OR IGNORE INTO faq_processed_messages (message_id, run_id, processed_at)
             VALUES (?, ?, ?)`,
          )
          .bind(msgId, runId, now),
      );
      await batchInsert(c.env.DB, stmts);
    }

    return c.json({
      success: true,
      data: { runId, proposalCount: sortedProposals.length },
    });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// GET /api/faq-extraction/runs — ジョブ履歴一覧
faqExtraction.get('/api/faq-extraction/runs', async (c) => {
  try {
    const limit = parseInt(c.req.query('limit') || '20');
    const rows = await c.env.DB
      .prepare(
        `SELECT id,
                line_account_id  as lineAccountId,
                status,
                started_at       as startedAt,
                completed_at     as completedAt,
                message_count    as messageCount,
                cluster_count    as clusterCount,
                noise_count      as noiseCount,
                date_from        as dateFrom,
                date_to          as dateTo,
                cost_usd         as costUsd,
                error_message    as errorMessage,
                created_at       as createdAt
         FROM faq_extraction_runs
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .bind(limit)
      .all();
    return c.json({ success: true, data: rows.results });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// GET /api/faq-extraction/runs/:id/proposals — 特定 run の提案一覧
faqExtraction.get('/api/faq-extraction/runs/:id/proposals', async (c) => {
  try {
    const id = c.req.param('id');
    const rows = await c.env.DB
      .prepare(
        `SELECT p.id,
                p.run_id               as runId,
                p.cluster_label        as clusterLabel,
                p.representative_text  as representativeText,
                p.example_messages     as exampleMessages,
                p.message_count        as messageCount,
                p.rank,
                p.suggested_answer     as suggestedAnswer,
                p.suggested_category   as suggestedCategory,
                p.status,
                p.knowledge_article_id as knowledgeArticleId,
                p.created_at           as createdAt
         FROM faq_proposals p
         WHERE p.run_id = ?
         ORDER BY p.rank ASC`,
      )
      .bind(id)
      .all<{
        id: string;
        runId: string;
        clusterLabel: string | null;
        representativeText: string;
        exampleMessages: string;
        messageCount: number;
        rank: number;
        suggestedAnswer: string | null;
        suggestedCategory: string | null;
        status: string;
        knowledgeArticleId: string | null;
        createdAt: string;
      }>();

    const data = rows.results.map((row) => ({
      ...row,
      exampleMessages: (() => {
        try {
          return JSON.parse(row.exampleMessages);
        } catch {
          return [];
        }
      })(),
    }));

    return c.json({ success: true, data });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// POST /api/faq-extraction/proposals/:id/adopt — 採用してナレッジ登録
faqExtraction.post('/api/faq-extraction/proposals/:id/adopt', async (c) => {
  try {
    const proposalId = c.req.param('id');
    const body = await c.req.json<{
      title: string;
      category?: string;
      content: string;
    }>();

    if (!body.title || !body.content) {
      return c.json({ success: false, error: 'タイトルと内容は必須です' }, 400);
    }

    const articleId = crypto.randomUUID();
    const now = jstNow();

    await c.env.DB.batch([
      c.env.DB
        .prepare(
          `INSERT INTO knowledge_articles
             (id, title, category, content, source_url, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, 1, ?, ?)`,
        )
        .bind(
          articleId,
          body.title,
          body.category ?? 'faq',
          body.content,
          now,
          now,
        ),
      c.env.DB
        .prepare(
          `UPDATE faq_proposals SET status = 'adopted', knowledge_article_id = ? WHERE id = ?`,
        )
        .bind(articleId, proposalId),
    ]);

    return c.json({ success: true, data: { knowledgeArticleId: articleId } });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// POST /api/faq-extraction/proposals/:id/reject — 却下
faqExtraction.post('/api/faq-extraction/proposals/:id/reject', async (c) => {
  try {
    const proposalId = c.req.param('id');
    await c.env.DB
      .prepare(`UPDATE faq_proposals SET status = 'rejected' WHERE id = ?`)
      .bind(proposalId)
      .run();
    return c.json({ success: true });
  } catch (err) {
    return c.json({ success: false, error: String(err) }, 500);
  }
});

export default faqExtraction;
