"""
Migration script: Import existing JSON conversations and campaigns into Firestore.

Usage:
  1. Set FIREBASE_SERVICE_ACCOUNT_KEY in your .env (path to service account JSON)
  2. Set MIGRATE_USER_ID to the Firebase Auth UID you want to import data under
     (find this in Firebase Console > Authentication > Users)
  3. Run:  python migrate_to_firestore.py

This is safe to run multiple times -- it overwrites docs with the same ID.
"""

import json
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

MIGRATE_USER_ID = os.getenv("MIGRATE_USER_ID", "")
CONVERSATIONS_DIR = Path("data/conversations")
CAMPAIGNS_DIR = Path("data/campaigns")
INDEX_FILE = "conversations_index.json"
REVERSE_INDEX = "_conv_to_campaign.json"


def main():
    if not MIGRATE_USER_ID:
        print("ERROR: Set MIGRATE_USER_ID env var to your Firebase Auth UID.")
        print("Find it in Firebase Console > Authentication > Users.")
        sys.exit(1)

    # Initialize Firebase
    from backend.firebase_config import init_firebase, get_db
    init_firebase()
    db = get_db()

    user_ref = db.collection("users").document(MIGRATE_USER_ID)

    # ── Conversations ────────────────────────────────────────────
    conv_count = 0
    if CONVERSATIONS_DIR.exists():
        for f in CONVERSATIONS_DIR.iterdir():
            if f.suffix != ".json" or f.name == INDEX_FILE:
                continue
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                conv_id = data.get("id", f.stem)
                data["message_count"] = len(data.get("messages", []))
                user_ref.collection("conversations").document(conv_id).set(data)
                conv_count += 1
                print(f"  Conversation: {data.get('title', conv_id)[:50]}")
            except Exception as e:
                print(f"  SKIP {f.name}: {e}")
    print(f"\nImported {conv_count} conversations.\n")

    # ── Campaigns ────────────────────────────────────────────────
    camp_count = 0
    if CAMPAIGNS_DIR.exists():
        for f in CAMPAIGNS_DIR.iterdir():
            if f.suffix != ".json" or f.name == REVERSE_INDEX:
                continue
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                camp_id = data.get("id", f.stem)

                # Migrate stages to multi-conversation format
                for stage in data.get("stages", []):
                    if "conversation_ids" not in stage:
                        old_id = stage.pop("conversation_id", None)
                        stage["conversation_ids"] = [old_id] if old_id else []

                user_ref.collection("campaigns").document(camp_id).set(data)
                camp_count += 1
                print(f"  Campaign: {data.get('name', camp_id)[:50]}")

                # Link conversations to campaigns via campaign_id/stage_id fields
                for stage in data.get("stages", []):
                    for cid in stage.get("conversation_ids", []):
                        conv_ref = user_ref.collection("conversations").document(cid)
                        doc = conv_ref.get()
                        if doc.exists:
                            conv_ref.update({
                                "campaign_id": camp_id,
                                "stage_id": stage["id"],
                            })

            except Exception as e:
                print(f"  SKIP {f.name}: {e}")
    print(f"Imported {camp_count} campaigns.\n")

    # ── Settings ─────────────────────────────────────────────────
    settings_path = Path("data/settings.json")
    if settings_path.exists():
        print("Note: settings.json stays on the server filesystem.")
        print("API keys should be moved to .env file as environment variables.\n")

    print("Migration complete!")
    print(f"All data imported under user: {MIGRATE_USER_ID}")


if __name__ == "__main__":
    main()
