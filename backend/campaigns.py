"""Campaign workspace: persistent marketing funnel projects with ordered stages.

Campaigns are stored per-user in Firestore at: users/{user_id}/campaigns/{campaign_id}
Campaign-conversation linkage is stored on the conversation document itself
(campaign_id / stage_id fields) rather than a separate reverse index.
Source files remain on the local filesystem under data/users/{user_id}/campaigns/{id}/sources/.
"""

import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

from . import storage
from .firebase_config import get_db
from .uploads import (
    ALLOWED_EXTENSIONS,
    MIME_MAP,
    IMAGE_EXTENSIONS,
    MAX_FILE_SIZE,
    extract_document_text,
)

CAMPAIGNS_BASE = "data/users"
SOURCES_SUBDIR = "sources"


# ── Firestore helpers ────────────────────────────────────────────────────


def _camp_ref(user_id: str, campaign_id: str):
    return (
        get_db()
        .collection("users")
        .document(user_id)
        .collection("campaigns")
        .document(campaign_id)
    )


def _camp_collection(user_id: str):
    return (
        get_db()
        .collection("users")
        .document(user_id)
        .collection("campaigns")
    )


# ── Reverse-index via conversation fields ────────────────────────────────


def lookup_campaign_for_conversation(
    user_id: str, conversation_id: str
) -> Optional[Dict[str, str]]:
    """Check if a conversation belongs to a campaign stage.

    Returns {"campaign_id": ..., "stage_id": ...} or None.
    """
    conv = storage.get_conversation(user_id, conversation_id)
    if conv is None:
        return None
    cid = conv.get("campaign_id")
    sid = conv.get("stage_id")
    if cid and sid:
        return {"campaign_id": cid, "stage_id": sid}
    return None


def _link_conversation(user_id: str, conversation_id: str, campaign_id: str, stage_id: str):
    """Tag a conversation with its parent campaign/stage."""
    conv = storage.get_conversation(user_id, conversation_id)
    if conv:
        conv["campaign_id"] = campaign_id
        conv["stage_id"] = stage_id
        storage.save_conversation(user_id, conv)


def _unlink_conversation(user_id: str, conversation_id: str):
    """Remove campaign/stage tags from a conversation."""
    conv = storage.get_conversation(user_id, conversation_id)
    if conv:
        conv.pop("campaign_id", None)
        conv.pop("stage_id", None)
        storage.save_conversation(user_id, conv)


# ── CRUD ─────────────────────────────────────────────────────────────────


def create_campaign(user_id: str, name: str, description: str = "") -> Dict[str, Any]:
    campaign = {
        "id": uuid.uuid4().hex[:12],
        "name": name,
        "description": description,
        "created_at": datetime.utcnow().isoformat(),
        "stages": [],
        "sources": [],
    }
    _camp_ref(user_id, campaign["id"]).set(campaign)
    return campaign


def get_campaign(user_id: str, campaign_id: str) -> Optional[Dict[str, Any]]:
    doc = _camp_ref(user_id, campaign_id).get()
    if not doc.exists:
        return None
    return doc.to_dict()


def _save_campaign(user_id: str, campaign: Dict[str, Any]):
    _camp_ref(user_id, campaign["id"]).set(campaign)


def list_campaigns(user_id: str) -> List[Dict[str, Any]]:
    from google.cloud import firestore as gc_firestore

    docs = (
        _camp_collection(user_id)
        .order_by("created_at", direction=gc_firestore.Query.DESCENDING)
        .stream()
    )
    result = []
    for doc in docs:
        data = doc.to_dict()
        result.append(
            {
                "id": data["id"],
                "name": data["name"],
                "description": data.get("description", ""),
                "created_at": data["created_at"],
                "stage_count": len(data.get("stages", [])),
                "stages": [
                    {
                        "id": s["id"],
                        "name": s["name"],
                        "position": s["position"],
                        "status": s.get("status", "active"),
                        "conversation_ids": s.get("conversation_ids", []),
                        "debate_config": s.get("debate_config"),
                    }
                    for s in data.get("stages", [])
                ],
            }
        )
    return result


def update_campaign(
    user_id: str, campaign_id: str, name: str = None, description: str = None
) -> Optional[Dict[str, Any]]:
    campaign = get_campaign(user_id, campaign_id)
    if campaign is None:
        return None
    if name is not None:
        campaign["name"] = name
    if description is not None:
        campaign["description"] = description
    _save_campaign(user_id, campaign)
    return campaign


def delete_campaign(user_id: str, campaign_id: str) -> bool:
    campaign = get_campaign(user_id, campaign_id)
    if campaign is None:
        return False

    for stage in campaign.get("stages", []):
        for conv_id in stage.get("conversation_ids", []):
            _unlink_conversation(user_id, conv_id)
            storage.delete_conversation(user_id, conv_id)

    _camp_ref(user_id, campaign_id).delete()
    return True


# ── Stages ───────────────────────────────────────────────────────────────


def add_stage(user_id: str, campaign_id: str, name: str) -> Optional[Dict[str, Any]]:
    campaign = get_campaign(user_id, campaign_id)
    if campaign is None:
        return None

    position = len(campaign["stages"])
    stage = {
        "id": uuid.uuid4().hex[:8],
        "name": name,
        "position": position,
        "conversation_ids": [],
        "summary": None,
        "status": "active",
        "created_at": datetime.utcnow().isoformat(),
    }
    campaign["stages"].append(stage)
    _save_campaign(user_id, campaign)
    return stage


def add_conversation_to_stage(
    user_id: str, campaign_id: str, stage_id: str
) -> Optional[Dict[str, Any]]:
    campaign = get_campaign(user_id, campaign_id)
    if campaign is None:
        return None

    target = next((s for s in campaign["stages"] if s["id"] == stage_id), None)
    if target is None:
        return None

    conv_id = str(uuid.uuid4())
    title = "New Conversation"

    storage.create_conversation(user_id, conv_id)
    storage.update_conversation_title(user_id, conv_id, title)
    _link_conversation(user_id, conv_id, campaign_id, stage_id)

    target["conversation_ids"].append(conv_id)
    _save_campaign(user_id, campaign)

    return {"conversation_id": conv_id, "title": title}


def reorder_stages(
    user_id: str, campaign_id: str, stage_ids: List[str]
) -> Optional[Dict[str, Any]]:
    campaign = get_campaign(user_id, campaign_id)
    if campaign is None:
        return None

    id_to_stage = {s["id"]: s for s in campaign["stages"]}
    reordered = []
    for i, sid in enumerate(stage_ids):
        if sid in id_to_stage:
            stage = id_to_stage[sid]
            stage["position"] = i
            reordered.append(stage)

    for s in campaign["stages"]:
        if s["id"] not in {r["id"] for r in reordered}:
            s["position"] = len(reordered)
            reordered.append(s)

    campaign["stages"] = reordered
    _save_campaign(user_id, campaign)
    return campaign


def update_stage(
    user_id: str, campaign_id: str, stage_id: str, updates: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    campaign = get_campaign(user_id, campaign_id)
    if campaign is None:
        return None

    for stage in campaign["stages"]:
        if stage["id"] == stage_id:
            if "name" in updates:
                stage["name"] = updates["name"]
            if "status" in updates:
                stage["status"] = updates["status"]
            if "summary" in updates:
                stage["summary"] = updates["summary"]
            if "debate_config" in updates:
                if updates["debate_config"] is None:
                    stage.pop("debate_config", None)
                else:
                    stage["debate_config"] = updates["debate_config"]
            _save_campaign(user_id, campaign)
            return stage
    return None


def remove_conversation_from_stage(
    user_id: str, campaign_id: str, stage_id: str, conversation_id: str
) -> bool:
    campaign = get_campaign(user_id, campaign_id)
    if campaign is None:
        return False

    for stage in campaign["stages"]:
        if stage["id"] == stage_id:
            ids = stage.get("conversation_ids", [])
            if conversation_id in ids:
                ids.remove(conversation_id)
                stage["conversation_ids"] = ids
                _save_campaign(user_id, campaign)
                _unlink_conversation(user_id, conversation_id)
                return True
    return False


def delete_stage(user_id: str, campaign_id: str, stage_id: str) -> bool:
    campaign = get_campaign(user_id, campaign_id)
    if campaign is None:
        return False

    target = next((s for s in campaign["stages"] if s["id"] == stage_id), None)
    if target is None:
        return False

    for conv_id in target.get("conversation_ids", []):
        _unlink_conversation(user_id, conv_id)
        storage.delete_conversation(user_id, conv_id)

    campaign["stages"] = [s for s in campaign["stages"] if s["id"] != stage_id]
    for i, s in enumerate(campaign["stages"]):
        s["position"] = i
    _save_campaign(user_id, campaign)
    return True


def get_stage_debate_config(
    user_id: str, campaign_id: str, stage_id: str
) -> Optional[Dict[str, Any]]:
    campaign = get_campaign(user_id, campaign_id)
    if campaign is None:
        return None
    for stage in campaign.get("stages", []):
        if stage["id"] == stage_id:
            return stage.get("debate_config")
    return None


def get_stage_context(user_id: str, campaign_id: str, stage_id: str) -> str:
    """Build a context string from campaign description and prior stages."""
    campaign = get_campaign(user_id, campaign_id)
    if campaign is None:
        return ""

    description = campaign.get("description", "").strip()

    target_pos = None
    for s in campaign["stages"]:
        if s["id"] == stage_id:
            target_pos = s["position"]
            break

    prior = []
    if target_pos is not None and target_pos > 0:
        prior = sorted(
            [
                s
                for s in campaign["stages"]
                if s["position"] < target_pos and s.get("summary")
            ],
            key=lambda s: s["position"],
        )

    if not description and not prior:
        return ""

    lines = [f"=== CAMPAIGN CONTEXT: {campaign['name']} ==="]

    if description:
        lines += ["", "--- Campaign Brief ---", description, ""]

    if prior:
        lines.append(
            "The following are summaries from earlier stages of this marketing funnel."
        )
        lines.append(
            "Use this context to ensure consistency with the overall customer journey."
        )
        lines.append("")
        for s in prior:
            status = s.get("status", "active")
            lines.append(f"--- Stage: {s['name']} ({status}) ---")
            lines.append(s["summary"])
            lines.append("")

    lines.append("=== END CAMPAIGN CONTEXT ===")
    return "\n".join(lines)


# ── Campaign Sources (filesystem) ────────────────────────────────────────


def _sources_dir(user_id: str, campaign_id: str) -> Path:
    return Path(CAMPAIGNS_BASE) / user_id / "campaigns" / campaign_id / SOURCES_SUBDIR


def _ensure_sources_dir(user_id: str, campaign_id: str) -> Path:
    d = _sources_dir(user_id, campaign_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


async def add_source(
    user_id: str, campaign_id: str, file
) -> Optional[Dict[str, Any]]:
    campaign = get_campaign(user_id, campaign_id)
    if campaign is None:
        return None

    original_name = file.filename or "unknown"
    ext = Path(original_name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {ext}")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise ValueError(f"File too large. Maximum is {MAX_FILE_SIZE // (1024 * 1024)}MB")

    source_id = uuid.uuid4().hex[:12]
    safe_name = f"{source_id}{ext}"

    directory = _ensure_sources_dir(user_id, campaign_id)
    filepath = directory / safe_name
    filepath.write_bytes(content)

    category = "image" if ext in IMAGE_EXTENSIONS else "document"
    extracted_text = None
    if category == "document":
        extracted_text = extract_document_text(str(filepath))

    meta = {
        "id": source_id,
        "filename": safe_name,
        "original_name": original_name,
        "category": category,
        "mime_type": MIME_MAP.get(ext, "application/octet-stream"),
        "size": len(content),
        "uploaded_at": datetime.utcnow().isoformat(),
    }

    sources = campaign.get("sources", [])
    sources.append(meta)
    campaign["sources"] = sources
    _save_campaign(user_id, campaign)

    meta["extracted_text"] = extracted_text
    return meta


def add_text_source(
    user_id: str, campaign_id: str, name: str, content: str
) -> Optional[Dict[str, Any]]:
    campaign = get_campaign(user_id, campaign_id)
    if campaign is None:
        return None

    if not content.strip():
        raise ValueError("Text content cannot be empty")

    source_id = uuid.uuid4().hex[:12]
    safe_name = f"{source_id}.txt"

    directory = _ensure_sources_dir(user_id, campaign_id)
    filepath = directory / safe_name
    filepath.write_text(content, encoding="utf-8")

    original_name = (name.strip() or "Text Source") + ".txt"

    meta = {
        "id": source_id,
        "filename": safe_name,
        "original_name": original_name,
        "category": "document",
        "mime_type": "text/plain",
        "size": len(content.encode("utf-8")),
        "uploaded_at": datetime.utcnow().isoformat(),
    }

    sources = campaign.get("sources", [])
    sources.append(meta)
    campaign["sources"] = sources
    _save_campaign(user_id, campaign)

    meta["extracted_text"] = content
    return meta


def list_sources(user_id: str, campaign_id: str) -> Optional[List[Dict[str, Any]]]:
    campaign = get_campaign(user_id, campaign_id)
    if campaign is None:
        return None
    return campaign.get("sources", [])


def rename_source(
    user_id: str, campaign_id: str, source_id: str, new_name: str
) -> Optional[Dict[str, Any]]:
    campaign = get_campaign(user_id, campaign_id)
    if campaign is None:
        return None

    for s in campaign.get("sources", []):
        if s["id"] == source_id:
            s["original_name"] = new_name.strip()
            _save_campaign(user_id, campaign)
            return s
    return None


def delete_source(user_id: str, campaign_id: str, source_id: str) -> bool:
    campaign = get_campaign(user_id, campaign_id)
    if campaign is None:
        return False

    sources = campaign.get("sources", [])
    target = next((s for s in sources if s["id"] == source_id), None)
    if target is None:
        return False

    filepath = _sources_dir(user_id, campaign_id) / target["filename"]
    if filepath.exists():
        filepath.unlink()

    campaign["sources"] = [s for s in sources if s["id"] != source_id]
    _save_campaign(user_id, campaign)
    return True


def get_source_path(
    user_id: str, campaign_id: str, source_id: str
) -> Optional[Path]:
    campaign = get_campaign(user_id, campaign_id)
    if campaign is None:
        return None
    for s in campaign.get("sources", []):
        if s["id"] == source_id:
            p = _sources_dir(user_id, campaign_id) / s["filename"]
            return p if p.exists() else None
    return None


def get_sources_context(user_id: str, campaign_id: str) -> str:
    """Build a context string from all campaign source documents."""
    campaign = get_campaign(user_id, campaign_id)
    if campaign is None:
        return ""

    sources = campaign.get("sources", [])
    doc_sources = [s for s in sources if s.get("category") == "document"]
    if not doc_sources:
        return ""

    parts = ["=== CAMPAIGN SOURCES ===", ""]
    for s in doc_sources:
        filepath = _sources_dir(user_id, campaign_id) / s["filename"]
        if not filepath.exists():
            continue
        text = extract_document_text(str(filepath))
        if text:
            parts.append(f"--- Source: {s['original_name']} ---")
            parts.append(text)
            parts.append("")

    if len(parts) <= 2:
        return ""

    parts.append("=== END CAMPAIGN SOURCES ===")
    return "\n".join(parts)
