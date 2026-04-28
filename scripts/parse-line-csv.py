"""
LINE Chat Pro CSV → messages.json (for FAQ extraction pipeline)

Reads all CSV files in scripts/input/ and outputs scripts/output/messages.json
with the same shape as the Worker's GET /api/faq-extraction/messages-export response.

CSV format (LINE Official Account Manager export):
  Row 1: アカウント名,KURITA JEWELRY
  Row 2: タイムゾーン,'+09:00
  Row 3: ダウンロード日時,2026/04/28 09:45
  Row 4: 送信者タイプ,送信者名,送信日,送信時刻,内容
  Row 5+: data
  - 送信者タイプ: Account (bot) | User (customer)

Output shape:
  {
    "exported_at": "2026-04-28T...",
    "source": "line-csv",
    "messages": [
      {"id": "csv-...", "content": "...", "createdAt": "ISO8601+09:00",
       "friendId": "csv-friend-NNN"}
    ]
  }
"""
from __future__ import annotations

import csv
import glob
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

INPUT_DIR = Path(__file__).parent / "input"
OUTPUT_DIR = Path(__file__).parent / "output"
OUTPUT_FILE = OUTPUT_DIR / "messages.json"

JST = timezone(timedelta(hours=9))

# Filter constraints (mirror Worker's messages-export SQL)
MIN_LEN = 4
MAX_LEN = 500

# PII regex (simple but effective for Japanese context)
RE_PHONE = re.compile(r"\b0\d{1,3}[-\s]?\d{2,4}[-\s]?\d{3,4}\b")
RE_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
RE_URL = re.compile(r"https?://\S+")
RE_ORDER = re.compile(r"#\d{4,}")  # #610959 etc.


def sanitize_unicode(text: str) -> str:
    """Remove unpaired surrogates (U+D800-U+DFFF) that break json.dump."""
    return "".join(c for c in text if not 0xD800 <= ord(c) <= 0xDFFF)


def mask_pii(text: str) -> str:
    text = sanitize_unicode(text)
    text = RE_URL.sub("<URL>", text)
    text = RE_EMAIL.sub("<EMAIL>", text)
    text = RE_PHONE.sub("<PHONE>", text)
    text = RE_ORDER.sub("<ORDER>", text)
    return text


def parse_csv(path: Path, friend_seq: int) -> list[dict]:
    """Extract User messages from one CSV file."""
    friend_id = f"csv-friend-{friend_seq:04d}"
    msgs: list[dict] = []

    try:
        with open(path, "r", encoding="utf-8-sig", newline="") as fh:
            # Skip first 3 metadata rows
            for _ in range(3):
                next(fh, None)
            reader = csv.reader(fh)
            header = next(reader, None)  # 送信者タイプ,送信者名,送信日,送信時刻,内容
            for row in reader:
                if not row or len(row) < 5:
                    continue
                stype = row[0].strip()
                if stype != "User":
                    continue
                date_str = row[2].strip()    # 2026/04/28
                time_str = row[3].strip()    # 09:42:35
                content = row[4]
                if not content:
                    continue

                content = content.strip()
                if len(content) < MIN_LEN or len(content) > MAX_LEN:
                    continue

                content = mask_pii(content)

                try:
                    dt = datetime.strptime(f"{date_str} {time_str}", "%Y/%m/%d %H:%M:%S")
                    dt = dt.replace(tzinfo=JST)
                    iso = dt.isoformat()
                except ValueError:
                    continue

                msgs.append({
                    "id": f"csv-{uuid.uuid4()}",
                    "content": content,
                    "createdAt": iso,
                    "friendId": friend_id,
                    "sourceFile": sanitize_unicode(path.name),
                })
    except Exception as e:
        print(f"[warn] {path.name}: {e}", file=sys.stderr)

    return msgs


def main() -> int:
    if not INPUT_DIR.exists():
        print(f"input dir not found: {INPUT_DIR}", file=sys.stderr)
        return 1

    OUTPUT_DIR.mkdir(exist_ok=True)

    csv_paths = sorted(INPUT_DIR.glob("*.csv"))
    print(f"[info] {len(csv_paths)} CSV files found")

    all_msgs: list[dict] = []
    for i, p in enumerate(csv_paths):
        msgs = parse_csv(p, friend_seq=i)
        all_msgs.extend(msgs)
        if (i + 1) % 500 == 0:
            print(f"[info] processed {i + 1}/{len(csv_paths)} files, {len(all_msgs):,} messages so far")

    # Sort by createdAt ASC
    all_msgs.sort(key=lambda m: m["createdAt"])

    output = {
        "exported_at": datetime.now(JST).isoformat(),
        "source": "line-csv",
        "totalCsvFiles": len(csv_paths),
        "totalUserMessages": len(all_msgs),
        "messages": all_msgs,
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(output, fh, ensure_ascii=False, indent=2)

    size_kb = os.path.getsize(OUTPUT_FILE) // 1024
    print(f"[done] {len(all_msgs):,} user messages -> {OUTPUT_FILE} ({size_kb} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
