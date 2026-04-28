# LINE FAQ抽出パイプライン (Step 3)

過去のLINE会話データを分析して「よく聞かれる質問TOP30」を自動抽出します。

## 前提

- Python 3.11+
- `scripts/.env` に以下が設定済みであること（`.env.example` を参照）

```
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-api03-...
# Worker に書き戻す場合のみ
WORKER_URL=http://localhost:5173
LH_API_KEY=...
```

## セットアップ

```bash
pip install -r scripts/requirements.txt
```

> Windows 環境での注意: `hdbscan` と `umap-learn` は C コンパイルが必要です。
> インストールに失敗する場合は Visual C++ Build Tools をインストールしてください。
> または `pip install hdbscan umap-learn --prefer-binary` を試してください。

## 入力ファイル

`scripts/output/messages.json` — `parse-line-csv.py` の出力（10,806件のユーザー発言）

## 実行例

### 1. 動作確認 (最初にこれを実行)

```bash
python scripts/extract-faq.py --dry-run --max-messages 200
```

200件だけ処理して `scripts/output/faq-result.json` を生成します。  
所要時間: 約1〜2分 / コスト: 約$0.01未満

### 2. 本番データ dry-run

```bash
python scripts/extract-faq.py --dry-run
```

全10,806件を処理してJSONを生成します。Worker への POST はスキップ。  
所要時間: 約5〜10分 / コスト: 約$0.5

### 3. 本番Workerに書き戻し

```bash
python scripts/extract-faq.py --submit
```

処理後、Worker の `POST /api/faq-extraction/runs` に結果を送信します。  
`WORKER_URL` と `LH_API_KEY` の設定が必要です。

## オプション一覧

| オプション | デフォルト | 説明 |
|---|---|---|
| `--input PATH` | `scripts/output/messages.json` | 入力JSONパス |
| `--output PATH` | `scripts/output/faq-result.json` | 出力JSONパス |
| `--dry-run` | True | Worker POST をスキップ |
| `--submit` | False | Worker に POST する |
| `--top-n N` | 30 | 出力する提案数 |
| `--min-cluster-size N` | max(20, N*0.005) | HDBSCAN min_cluster_size |
| `--umap-components N` | 15 | UMAP n_components |
| `--max-messages N` | 全件 | 入力件数を絞る (debug用) |

## 想定コスト (1万件)

| 処理 | モデル | 想定コスト |
|---|---|---|
| Embedding | text-embedding-3-small | ~$0.002 |
| クラスタ命名 | Claude Sonnet 4.6 | ~$0.5 |
| **合計** | | **~$0.5** |

## 出力形式

`faq-result.json` は Worker の `POST /api/faq-extraction/runs` と同一の body shape です。

```json
{
  "lineAccountId": null,
  "dateFrom": "2024-01-01T...",
  "dateTo": "2026-04-28T...",
  "messageCount": 10806,
  "clusterCount": 32,
  "noiseCount": 1247,
  "costUsd": 0.52,
  "processedMessageIds": ["csv-...", ...],
  "proposals": [
    {
      "rank": 1,
      "clusterLabel": "配送日数について",
      "representativeText": "配送はどのくらいかかりますか？",
      "exampleMessages": ["送料は？", "発送いつ？"],
      "messageCount": 142,
      "suggestedAnswer": "通常2〜4営業日でお届けします。",
      "suggestedCategory": "shipping"
    }
  ]
}
```

## パイプライン

```
messages.json
  → load & deduplicate
  → OpenAI text-embedding-3-small (1024次元, バッチ200)
  → UMAP 次元削減 (15次元, cosine)
  → HDBSCAN クラスタリング
  → medoid 選択 + 代表メッセージ抽出
  → Claude Sonnet 4.6 でクラスタ命名 (3並列, prompt caching)
  → faq-result.json 出力
  → [--submit 時] Worker POST /api/faq-extraction/runs
```
