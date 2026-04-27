-- FAQ抽出ジョブ: messages_log → クラスタリング → ナレッジ提案
CREATE TABLE IF NOT EXISTS faq_extraction_runs (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  started_at      TEXT,
  completed_at    TEXT,
  message_count   INTEGER NOT NULL DEFAULT 0,
  cluster_count   INTEGER NOT NULL DEFAULT 0,
  noise_count     INTEGER NOT NULL DEFAULT 0,
  date_from       TEXT,
  date_to         TEXT,
  cost_usd        REAL,
  error_message   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- 抽出された質問クラスタ（= TOP20候補）
CREATE TABLE IF NOT EXISTS faq_proposals (
  id                   TEXT PRIMARY KEY,
  run_id               TEXT NOT NULL REFERENCES faq_extraction_runs(id) ON DELETE CASCADE,
  cluster_label        TEXT,
  representative_text  TEXT NOT NULL,
  example_messages     TEXT NOT NULL,
  message_count        INTEGER NOT NULL,
  rank                 INTEGER NOT NULL,
  suggested_answer     TEXT,
  suggested_category   TEXT DEFAULT 'faq',
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','adopted','rejected','duplicate')),
  knowledge_article_id TEXT REFERENCES knowledge_articles(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_faq_proposals_run ON faq_proposals(run_id);
CREATE INDEX IF NOT EXISTS idx_faq_proposals_status ON faq_proposals(status);

-- 処理済みメッセージ（差分抽出マーカー）
CREATE TABLE IF NOT EXISTS faq_processed_messages (
  message_id   TEXT PRIMARY KEY REFERENCES messages_log(id) ON DELETE CASCADE,
  run_id       TEXT NOT NULL REFERENCES faq_extraction_runs(id) ON DELETE CASCADE,
  proposal_id  TEXT REFERENCES faq_proposals(id) ON DELETE SET NULL,
  processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_faq_processed_run ON faq_processed_messages(run_id);
