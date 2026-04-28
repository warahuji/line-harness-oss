"""
LINE FAQ抽出パイプライン — Step 3

Reads scripts/output/messages.json (produced by parse-line-csv.py),
clusters user messages via OpenAI embeddings + UMAP + HDBSCAN,
names clusters with Claude Sonnet, and writes scripts/output/faq-result.json.

Optionally POSTs the result to the LINE Harness Worker.

Usage:
  python extract-faq.py --dry-run --max-messages 200   # smoke test
  python extract-faq.py --dry-run                       # full dry-run
  python extract-faq.py --submit                        # write back to Worker
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import requests
from anthropic import Anthropic
from dotenv import load_dotenv
from openai import OpenAI
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPTS_DIR = Path(__file__).parent
ENV_FILE = SCRIPTS_DIR / ".env"
DEFAULT_INPUT = SCRIPTS_DIR / "output" / "messages.json"
DEFAULT_OUTPUT = SCRIPTS_DIR / "output" / "faq-result.json"

JST = timezone(timedelta(hours=9))

# ---------------------------------------------------------------------------
# Cost constants (USD per 1M tokens)
# ---------------------------------------------------------------------------
# OpenAI text-embedding-3-small: $0.02 / 1M tokens
EMBED_COST_PER_1M = 0.020
# Claude Sonnet 4.6: input $3.0 / output $15.0 per 1M tokens (cache read $0.30)
CLAUDE_INPUT_COST_PER_1M  = 3.0
CLAUDE_OUTPUT_COST_PER_1M = 15.0
CLAUDE_CACHE_COST_PER_1M  = 0.30


# ===========================================================================
# 1. Environment
# ===========================================================================

def load_env(require_worker: bool = False) -> dict[str, str]:
    """Load .env and validate required keys."""
    load_dotenv(ENV_FILE)

    def require(key: str) -> str:
        val = os.environ.get(key, "").strip()
        if not val:
            print(f"[error] {key} が未設定です。scripts/.env を確認してください。", file=sys.stderr)
            sys.exit(1)
        return val

    cfg: dict[str, str] = {
        "OPENAI_API_KEY":    require("OPENAI_API_KEY"),
        "ANTHROPIC_API_KEY": require("ANTHROPIC_API_KEY"),
    }

    if require_worker:
        cfg["WORKER_URL"] = require("WORKER_URL").rstrip("/")
        cfg["LH_API_KEY"]  = require("LH_API_KEY")

    return cfg


# ===========================================================================
# 2. Load messages
# ===========================================================================

def load_messages(input_path: Path, max_messages: int | None) -> tuple[list[dict], str, str]:
    """
    Return (deduped_messages, date_from_iso, date_to_iso).
    Deduplication is done on content exact-match.
    """
    print(f"[info] 入力ファイル読み込み中: {input_path}")
    with open(input_path, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    raw: list[dict] = data.get("messages", [])
    print(f"[info] 元件数: {len(raw):,}")

    # Deduplicate on content
    seen_contents: set[str] = set()
    deduped: list[dict] = []
    for m in raw:
        c = m.get("content", "")
        if c not in seen_contents:
            seen_contents.add(c)
            deduped.append(m)

    removed = len(raw) - len(deduped)
    if removed:
        print(f"[info] 重複除去: {removed:,} 件削除 → {len(deduped):,} 件")

    if max_messages and len(deduped) > max_messages:
        deduped = deduped[:max_messages]
        print(f"[info] --max-messages により {max_messages:,} 件に絞り込み")

    # Date range
    dates = [m.get("createdAt", "") for m in deduped if m.get("createdAt")]
    date_from = min(dates) if dates else datetime.now(JST).isoformat()
    date_to   = max(dates) if dates else datetime.now(JST).isoformat()

    print(f"[info] 処理対象: {len(deduped):,} 件 ({date_from[:10]} ～ {date_to[:10]})")
    return deduped, date_from, date_to


# ===========================================================================
# 3. Embed
# ===========================================================================

@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type(Exception),
    reraise=True,
)
def _embed_batch(client: OpenAI, texts: list[str]) -> tuple[list[list[float]], int]:
    """Embed one batch; returns (vectors, total_tokens)."""
    resp = client.embeddings.create(
        model="text-embedding-3-small",
        input=texts,
        dimensions=1024,
        encoding_format="float",
    )
    vectors = [d.embedding for d in resp.data]
    tokens = resp.usage.total_tokens
    return vectors, tokens


def embed(
    messages: list[dict],
    openai_client: OpenAI,
    batch_size: int = 200,
) -> tuple[np.ndarray, int]:
    """
    Embed all messages. Returns (embeddings_float32, total_tokens).
    """
    texts = [m["content"] for m in messages]
    n = len(texts)
    embeddings: list[list[float]] = []
    total_tokens = 0

    print(f"[info] Embedding {n:,} 件 (batch={batch_size}, model=text-embedding-3-small) ...")
    batches = [texts[i : i + batch_size] for i in range(0, n, batch_size)]

    with tqdm(total=n, unit="msg", ncols=80) as bar:
        for batch in batches:
            vecs, tok = _embed_batch(openai_client, batch)
            embeddings.extend(vecs)
            total_tokens += tok
            bar.update(len(batch))

    arr = np.array(embeddings, dtype=np.float32)
    print(f"[info] Embedding 完了: shape={arr.shape}, tokens={total_tokens:,}")
    return arr, total_tokens


# ===========================================================================
# 4. Cluster
# ===========================================================================

def cluster(
    embeddings: np.ndarray,
    min_cluster_size: int,
    umap_components: int,
) -> np.ndarray:
    """
    UMAP 次元削減 → HDBSCAN クラスタリング。
    Returns label array (int), -1 = noise.
    """
    # Lazy import to avoid slow import at top-level
    import umap
    import hdbscan

    n = embeddings.shape[0]
    print(f"[info] UMAP 次元削減: {embeddings.shape[1]}d → {umap_components}d (n={n:,})")
    reducer = umap.UMAP(
        n_components=umap_components,
        n_neighbors=15,
        metric="cosine",
        random_state=42,
        verbose=False,
    )
    reduced = reducer.fit_transform(embeddings)

    print(f"[info] HDBSCAN クラスタリング: min_cluster_size={min_cluster_size}")
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=5,
        metric="euclidean",
        cluster_selection_method="eom",
    )
    labels: np.ndarray = clusterer.fit_predict(reduced)

    n_clusters = int(labels.max()) + 1
    n_noise    = int((labels == -1).sum())
    print(f"[info] クラスタ数: {n_clusters}, ノイズ: {n_noise:,}")
    return labels


# ===========================================================================
# 5. Build clusters (medoid + examples)
# ===========================================================================

def build_clusters(
    messages: list[dict],
    embeddings: np.ndarray,
    labels: np.ndarray,
    top_n: int,
) -> list[dict]:
    """
    Group messages by cluster label, pick medoid as representative,
    sort by message_count DESC, return top_n clusters.
    """
    from collections import defaultdict

    cluster_indices: dict[int, list[int]] = defaultdict(list)
    for idx, lbl in enumerate(labels):
        if lbl == -1:
            continue
        cluster_indices[int(lbl)].append(idx)

    clusters: list[dict] = []

    for lbl, idxs in cluster_indices.items():
        vecs = embeddings[idxs]  # (k, d)

        # Medoid = argmin sum-of-distances to centroid
        centroid = vecs.mean(axis=0)
        dists = np.linalg.norm(vecs - centroid, axis=1)
        medoid_pos = int(np.argmin(dists))
        medoid_idx = idxs[medoid_pos]

        # Up to 4 nearest non-medoid examples
        sorted_pos = np.argsort(dists).tolist()
        example_idxs = [idxs[p] for p in sorted_pos if p != medoid_pos][:4]

        clusters.append({
            "_label":             lbl,
            "representativeText": messages[medoid_idx]["content"],
            "exampleMessages":    [messages[i]["content"] for i in example_idxs],
            "messageCount":       len(idxs),
            "_memberIds":         [messages[i]["id"] for i in idxs],
        })

    # Sort by messageCount DESC, trim to top_n
    clusters.sort(key=lambda c: c["messageCount"], reverse=True)
    return clusters[:top_n]


# ===========================================================================
# 6. Name clusters with Claude
# ===========================================================================

CLAUDE_SYSTEM = """\
あなたはECショップのFAQ整理アシスタントです。LINE上の質問クラスタを分析して、
JSON形式で以下を出力してください:
{
  "clusterLabel": "簡潔なカテゴリ名 (例: 配送日数について)",
  "representativeText": "クラスタを代表する標準形の質問1文",
  "suggestedCategory": "general | product | shipping | faq | policy | campaign のどれか",
  "suggestedAnswer": "ナレッジベース登録用の回答下書き (200字以内、不明部分は[要記入])"
}

回答はJSONのみ。マークダウンや解説は不要。"""


def _name_one_cluster(
    anthropic_client: Anthropic,
    cluster: dict,
    rank: int,
) -> dict:
    """Call Claude for one cluster. Returns merged dict with naming fields."""
    examples = [cluster["representativeText"]] + cluster["exampleMessages"]
    lines = "\n".join(f"{i+1}. {t}" for i, t in enumerate(examples[:5]))
    user_msg = (
        f"クラスタ #{rank} (件数: {cluster['messageCount']})\n"
        f"代表メッセージ:\n{lines}"
    )

    # Prompt caching: system as first content block with cache_control
    resp = anthropic_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        system=[
            {
                "type": "text",
                "text": CLAUDE_SYSTEM,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_msg}],
    )

    raw = resp.content[0].text.strip()
    # Strip possible markdown fences
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    usage = resp.usage
    return {
        "clusterLabel":      None,
        "representativeText": cluster["representativeText"],
        "suggestedAnswer":   None,
        "suggestedCategory": "faq",
        "_raw_json":         raw,
        "_usage": {
            "input_tokens":         usage.input_tokens,
            "output_tokens":        usage.output_tokens,
            "cache_creation_tokens": getattr(usage, "cache_creation_input_tokens", 0) or 0,
            "cache_read_tokens":    getattr(usage, "cache_read_input_tokens", 0) or 0,
        },
    }


def name_clusters(
    clusters: list[dict],
    anthropic_client: Anthropic,
    parallelism: int = 3,
) -> tuple[list[dict], dict]:
    """
    Name all clusters with Claude (parallelism=3 threads).
    Returns (enriched_clusters, aggregated_usage).
    """
    print(f"[info] Claude でクラスタ命名中 ({len(clusters)} クラスタ, 並列度={parallelism}) ...")

    total_usage: dict[str, int] = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_tokens": 0,
        "cache_read_tokens": 0,
    }

    enriched: list[dict | None] = [None] * len(clusters)

    with ThreadPoolExecutor(max_workers=parallelism) as executor:
        future_to_idx = {
            executor.submit(_name_one_cluster, anthropic_client, cl, rank=i + 1): i
            for i, cl in enumerate(clusters)
        }
        with tqdm(total=len(clusters), unit="cluster", ncols=80) as bar:
            for future in as_completed(future_to_idx):
                idx = future_to_idx[future]
                try:
                    result = future.result()
                    # Parse JSON from Claude
                    try:
                        parsed = json.loads(result["_raw_json"])
                        result["clusterLabel"]      = parsed.get("clusterLabel")
                        result["representativeText"] = parsed.get("representativeText") or clusters[idx]["representativeText"]
                        result["suggestedAnswer"]   = parsed.get("suggestedAnswer")
                        result["suggestedCategory"] = parsed.get("suggestedCategory", "faq")
                    except json.JSONDecodeError:
                        print(f"[warn] クラスタ {idx+1}: Claude レスポンス JSON パース失敗 → fallback", file=sys.stderr)

                    # Accumulate usage
                    u = result.pop("_usage", {})
                    for k in total_usage:
                        total_usage[k] += u.get(k, 0)

                    result.pop("_raw_json", None)
                    enriched[idx] = result
                except Exception as e:
                    print(f"[warn] クラスタ {idx+1} 命名失敗: {e}", file=sys.stderr)
                    enriched[idx] = {
                        "clusterLabel":      f"クラスタ {idx+1}",
                        "representativeText": clusters[idx]["representativeText"],
                        "suggestedAnswer":   None,
                        "suggestedCategory": "faq",
                    }
                bar.update(1)

    return [e for e in enriched if e is not None], total_usage


# ===========================================================================
# 7. Compute cost
# ===========================================================================

def compute_cost(
    embed_tokens: int,
    claude_usage: dict[str, int],
) -> tuple[float, float, float]:
    """Returns (total_usd, embed_usd, claude_usd)."""
    embed_usd = embed_tokens / 1_000_000 * EMBED_COST_PER_1M

    input_usd  = claude_usage.get("input_tokens", 0) / 1_000_000 * CLAUDE_INPUT_COST_PER_1M
    output_usd = claude_usage.get("output_tokens", 0) / 1_000_000 * CLAUDE_OUTPUT_COST_PER_1M
    cache_read_usd = claude_usage.get("cache_read_tokens", 0) / 1_000_000 * CLAUDE_CACHE_COST_PER_1M
    claude_usd = input_usd + output_usd + cache_read_usd

    total_usd = embed_usd + claude_usd
    return total_usd, embed_usd, claude_usd


# ===========================================================================
# 8. Build output JSON
# ===========================================================================

def build_result(
    messages: list[dict],
    clusters: list[dict],
    naming_results: list[dict],
    labels: np.ndarray,
    date_from: str,
    date_to: str,
    cost_usd: float,
) -> dict:
    """Assemble final result matching Worker POST /api/faq-extraction/runs body."""
    n_clusters = int(labels.max()) + 1 if labels.max() >= 0 else 0
    n_noise    = int((labels == -1).sum())

    proposals: list[dict] = []
    for rank, (cl, naming) in enumerate(zip(clusters, naming_results), start=1):
        proposals.append({
            "rank":               rank,
            "clusterLabel":       naming.get("clusterLabel") or f"クラスタ {rank}",
            "representativeText": naming.get("representativeText") or cl["representativeText"],
            "exampleMessages":    cl["exampleMessages"],
            "messageCount":       cl["messageCount"],
            "suggestedAnswer":    naming.get("suggestedAnswer"),
            "suggestedCategory":  naming.get("suggestedCategory", "faq"),
        })

    # All message IDs (for processedMessageIds)
    processed_ids = [m["id"] for m in messages]

    return {
        "lineAccountId":      None,
        "dateFrom":           date_from,
        "dateTo":             date_to,
        "messageCount":       len(messages),
        "clusterCount":       n_clusters,
        "noiseCount":         n_noise,
        "costUsd":            round(cost_usd, 4),
        "processedMessageIds": processed_ids,
        "proposals":          proposals,
    }


# ===========================================================================
# 9. Write output
# ===========================================================================

def write_output(result: dict, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
    size_kb = output_path.stat().st_size // 1024
    print(f"[info] 出力完了: {output_path} ({size_kb} KB)")


# ===========================================================================
# 10. Submit to Worker
# ===========================================================================

def submit_to_worker(result: dict, worker_url: str, api_key: str) -> None:
    url = f"{worker_url}/api/faq-extraction/runs"
    headers = {
        "Content-Type":  "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    print(f"[info] Worker に POST 中: {url}")
    resp = requests.post(url, json=result, headers=headers, timeout=30)
    if not resp.ok:
        print(f"[error] Worker POST 失敗: {resp.status_code} {resp.text}", file=sys.stderr)
        sys.exit(1)
    data = resp.json()
    run_id       = data.get("data", {}).get("runId", "?")
    proposal_cnt = data.get("data", {}).get("proposalCount", "?")
    print(f"[info] Worker 書き戻し成功: runId={run_id}, proposalCount={proposal_cnt}")


# ===========================================================================
# CLI
# ===========================================================================

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="LINE FAQ抽出パイプライン (Embedding → Cluster → Claude命名)",
    )
    p.add_argument("--input",  type=Path, default=DEFAULT_INPUT,  help="入力JSONパス")
    p.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="出力JSONパス")
    p.add_argument("--dry-run", action="store_true", default=True,
                   help="Worker への POST をスキップ (default: True)")
    p.add_argument("--submit", action="store_true", default=False,
                   help="Worker に POST する (--dry-run の逆)")
    p.add_argument("--top-n", type=int, default=30, dest="top_n",
                   help="出力する提案数 (default: 30)")
    p.add_argument("--min-cluster-size", type=int, default=None, dest="min_cluster_size",
                   help="HDBSCAN min_cluster_size (default: max(20, N*0.005))")
    p.add_argument("--umap-components", type=int, default=15, dest="umap_components",
                   help="UMAP n_components (default: 15)")
    p.add_argument("--max-messages", type=int, default=None, dest="max_messages",
                   help="入力件数を絞る (debug用)")
    return p.parse_args()


# ===========================================================================
# Main
# ===========================================================================

def main() -> int:
    args = parse_args()

    # --submit が指定された場合は dry-run を解除
    do_submit = args.submit
    dry_run   = not do_submit

    print(f"[info] === LINE FAQ抽出パイプライン ({'dry-run' if dry_run else 'submit'}) ===")
    t0 = time.time()

    # --- Env ---
    cfg = load_env(require_worker=do_submit)
    openai_client    = OpenAI(api_key=cfg["OPENAI_API_KEY"])
    anthropic_client = Anthropic(api_key=cfg["ANTHROPIC_API_KEY"])

    # --- Load ---
    messages, date_from, date_to = load_messages(args.input, args.max_messages)
    if len(messages) < 5:
        print(f"[error] メッセージが少なすぎます ({len(messages)} 件)。入力ファイルを確認してください。",
              file=sys.stderr)
        return 1

    # --- min_cluster_size default ---
    n = len(messages)
    min_cs = args.min_cluster_size if args.min_cluster_size else max(20, int(n * 0.005))
    # For very small debug runs, be more lenient
    if n <= 200:
        min_cs = max(3, min_cs // 4)
    print(f"[info] min_cluster_size={min_cs}")

    # --- Embed ---
    embeddings, embed_tokens = embed(messages, openai_client)

    # --- Cluster ---
    labels = cluster(embeddings, min_cluster_size=min_cs, umap_components=args.umap_components)

    n_clusters_found = int(labels.max()) + 1 if labels.max() >= 0 else 0
    if n_clusters_found == 0:
        print("[warn] クラスタが見つかりませんでした。min_cluster_size を下げてみてください。")
        # Output empty result so pipeline doesn't crash
        result = {
            "lineAccountId":       None,
            "dateFrom":            date_from,
            "dateTo":              date_to,
            "messageCount":        len(messages),
            "clusterCount":        0,
            "noiseCount":          int((labels == -1).sum()),
            "costUsd":             0.0,
            "processedMessageIds": [m["id"] for m in messages],
            "proposals":           [],
        }
        write_output(result, args.output)
        return 0

    # --- Build clusters ---
    clusters_raw = build_clusters(messages, embeddings, labels, top_n=args.top_n)
    print(f"[info] 上位 {len(clusters_raw)} クラスタを処理対象に")

    # --- Name clusters ---
    naming_results, claude_usage = name_clusters(clusters_raw, anthropic_client)

    # --- Cost ---
    total_usd, embed_usd, claude_usd = compute_cost(embed_tokens, claude_usage)
    print(
        f"[info] 推定コスト: ${total_usd:.4f} "
        f"(embedding ${embed_usd:.4f} + claude ${claude_usd:.4f})"
    )

    # --- Build result ---
    result = build_result(
        messages, clusters_raw, naming_results,
        labels, date_from, date_to, total_usd,
    )

    # --- Write ---
    write_output(result, args.output)

    # --- Submit ---
    if do_submit:
        submit_to_worker(result, cfg["WORKER_URL"], cfg["LH_API_KEY"])

    elapsed = time.time() - t0
    print(f"[done] 完了 ({elapsed:.1f}秒) - proposals: {len(result['proposals'])}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n[warn] 中断されました。", file=sys.stderr)
        sys.exit(130)
    except Exception:
        print("[error] 予期しないエラーが発生しました:", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
