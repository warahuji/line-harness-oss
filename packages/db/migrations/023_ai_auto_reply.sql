-- AI自動返信設定（アカウント単位）
CREATE TABLE IF NOT EXISTS ai_settings (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT,
  provider        TEXT NOT NULL DEFAULT 'anthropic',
  api_key         TEXT NOT NULL,
  model_id        TEXT DEFAULT 'claude-sonnet-4-6',
  system_prompt   TEXT,
  max_tokens      INTEGER DEFAULT 500,
  temperature     REAL DEFAULT 0.7,
  is_active       INTEGER DEFAULT 1,
  created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ナレッジベース（お店の情報）
CREATE TABLE IF NOT EXISTS knowledge_articles (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  category    TEXT DEFAULT 'general',
  content     TEXT NOT NULL,
  source_url  TEXT,
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- AI返信ログ
CREATE TABLE IF NOT EXISTS ai_reply_logs (
  id              TEXT PRIMARY KEY,
  friend_id       TEXT REFERENCES friends(id),
  user_message    TEXT NOT NULL,
  ai_response     TEXT NOT NULL,
  knowledge_used  TEXT,
  tokens_used     INTEGER,
  latency_ms      INTEGER,
  created_at      TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_reply_logs_friend ON ai_reply_logs(friend_id);
CREATE INDEX IF NOT EXISTS idx_ai_reply_logs_created ON ai_reply_logs(created_at);
