"""Campaign workspace: persistent marketing funnel projects with ordered stages."""

import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

from . import storage
from .uploads import ALLOWED_EXTENSIONS, MIME_MAP, IMAGE_EXTENSIONS, MAX_FILE_SIZE, extract_document_text

CAMPAIGNS_DIR = "data/campaigns"
SOURCES_SUBDIR = "sources"
REVERSE_INDEX_FILE = "_conv_to_campaign.json"


def _ensure_dir():
    Path(CAMPAIGNS_DIR).mkdir(parents=True, exist_ok=True)


def _campaign_path(campaign_id: str) -> str:
    return os.path.join(CAMPAIGNS_DIR, f"{campaign_id}.json")


def _reverse_index_path() -> str:
    return os.path.join(CAMPAIGNS_DIR, REVERSE_INDEX_FILE)


def _load_reverse_index() -> Dict[str, Dict[str, str]]:
    path = _reverse_index_path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _save_reverse_index(index: Dict[str, Dict[str, str]]):
    _ensure_dir()
    with open(_reverse_index_path(), "w") as f:
        json.dump(index, f, indent=2)


def _add_to_reverse_index(conversation_id: str, campaign_id: str, stage_id: str):
    idx = _load_reverse_index()
    idx[conversation_id] = {"campaign_id": campaign_id, "stage_id": stage_id}
    _save_reverse_index(idx)


def _remove_from_reverse_index(conversation_id: str):
    idx = _load_reverse_index()
    if conversation_id in idx:
        del idx[conversation_id]
        _save_reverse_index(idx)


def lookup_campaign_for_conversation(conversation_id: str) -> Optional[Dict[str, str]]:
    """Check if a conversation belongs to a campaign stage.

    Returns {"campaign_id": ..., "stage_id": ...} or None.
    """
    idx = _load_reverse_index()
    return idx.get(conversation_id)


def _migrate_stage(stage: Dict[str, Any]) -> Dict[str, Any]:
    """Convert legacy single conversation_id to conversation_ids array."""
    if "conversation_ids" not in stage:
        old_id = stage.pop("conversation_id", None)
        stage["conversation_ids"] = [old_id] if old_id else []
    return stage


def _load_campaign(campaign_id: str) -> Optional[Dict[str, Any]]:
    """Load a campaign, auto-migrating stages to the multi-conversation format."""
    path = _campaign_path(campaign_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r") as f:
            campaign = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None

    migrated = False
    for stage in campaign.get("stages", []):
        if "conversation_ids" not in stage:
            _migrate_stage(stage)
            migrated = True

    if migrated:
        _save_campaign(campaign)

    return campaign


def _save_campaign(campaign: Dict[str, Any]):
    _ensure_dir()
    with open(_campaign_path(campaign["id"]), "w") as f:
        json.dump(campaign, f, indent=2)


def create_campaign(name: str, description: str = "") -> Dict[str, Any]:
    """Create a new campaign and return it."""
    campaign = {
        "id": uuid.uuid4().hex[:12],
        "name": name,
        "description": description,
        "created_at": datetime.utcnow().isoformat(),
        "stages": [],
    }
    _save_campaign(campaign)
    return campaign


def get_campaign(campaign_id: str) -> Optional[Dict[str, Any]]:
    return _load_campaign(campaign_id)


def list_campaigns() -> List[Dict[str, Any]]:
    """List all campaigns (metadata only, with migration)."""
    _ensure_dir()
    campaigns = []
    for fname in os.listdir(CAMPAIGNS_DIR):
        if fname.endswith(".json") and fname != REVERSE_INDEX_FILE:
            try:
                cid = fname.replace(".json", "")
                data = _load_campaign(cid)
                if data is None:
                    continue
                campaigns.append({
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
                        }
                        for s in data.get("stages", [])
                    ],
                })
            except (KeyError, TypeError):
                continue

    campaigns.sort(key=lambda x: x["created_at"], reverse=True)
    return campaigns


def update_campaign(campaign_id: str, name: str = None, description: str = None) -> Optional[Dict[str, Any]]:
    campaign = get_campaign(campaign_id)
    if campaign is None:
        return None
    if name is not None:
        campaign["name"] = name
    if description is not None:
        campaign["description"] = description
    _save_campaign(campaign)
    return campaign


def delete_campaign(campaign_id: str) -> bool:
    campaign = get_campaign(campaign_id)
    if campaign is None:
        return False

    for stage in campaign.get("stages", []):
        for conv_id in stage.get("conversation_ids", []):
            _remove_from_reverse_index(conv_id)
            storage.delete_conversation(conv_id)

    path = _campaign_path(campaign_id)
    if os.path.exists(path):
        os.remove(path)
    return True


def add_stage(campaign_id: str, name: str) -> Optional[Dict[str, Any]]:
    """Add a new stage to a campaign. Creates an initial linked conversation."""
    campaign = get_campaign(campaign_id)
    if campaign is None:
        return None

    conv_id = str(uuid.uuid4())
    storage.create_conversation(conv_id)
    storage.update_conversation_title(conv_id, "New Conversation")

    position = len(campaign["stages"])
    stage = {
        "id": uuid.uuid4().hex[:8],
        "name": name,
        "position": position,
        "conversation_ids": [conv_id],
        "summary": None,
        "status": "active",
        "created_at": datetime.utcnow().isoformat(),
    }

    campaign["stages"].append(stage)
    _save_campaign(campaign)
    _add_to_reverse_index(conv_id, campaign_id, stage["id"])
    return stage


def add_conversation_to_stage(campaign_id: str, stage_id: str) -> Optional[Dict[str, Any]]:
    """Create a new conversation within an existing stage and return it."""
    campaign = get_campaign(campaign_id)
    if campaign is None:
        return None

    target = None
    for s in campaign["stages"]:
        if s["id"] == stage_id:
            target = s
            break

    if target is None:
        return None

    conv_id = str(uuid.uuid4())
    title = "New Conversation"

    storage.create_conversation(conv_id)
    storage.update_conversation_title(conv_id, title)

    target["conversation_ids"].append(conv_id)
    _save_campaign(campaign)
    _add_to_reverse_index(conv_id, campaign_id, stage_id)

    return {"conversation_id": conv_id, "title": title}


def reorder_stages(campaign_id: str, stage_ids: List[str]) -> Optional[Dict[str, Any]]:
    """Reorder stages by accepting an ordered list of stage IDs."""
    campaign = get_campaign(campaign_id)
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
    _save_campaign(campaign)
    return campaign


def update_stage(
    campaign_id: str, stage_id: str, updates: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """Update a stage's name, status, or summary."""
    campaign = get_campaign(campaign_id)
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
            _save_campaign(campaign)
            return stage
    return None


def remove_conversation_from_stage(campaign_id: str, stage_id: str, conversation_id: str) -> bool:
    """Remove a conversation from a stage's conversation_ids and reverse index."""
    campaign = get_campaign(campaign_id)
    if campaign is None:
        return False

    for stage in campaign["stages"]:
        if stage["id"] == stage_id:
            ids = stage.get("conversation_ids", [])
            if conversation_id in ids:
                ids.remove(conversation_id)
                stage["conversation_ids"] = ids
                _save_campaign(campaign)
                _remove_from_reverse_index(conversation_id)
                return True
    return False


def delete_stage(campaign_id: str, stage_id: str) -> bool:
    campaign = get_campaign(campaign_id)
    if campaign is None:
        return False

    target = None
    for s in campaign["stages"]:
        if s["id"] == stage_id:
            target = s
            break

    if target is None:
        return False

    for conv_id in target.get("conversation_ids", []):
        _remove_from_reverse_index(conv_id)
        storage.delete_conversation(conv_id)

    campaign["stages"] = [s for s in campaign["stages"] if s["id"] != stage_id]
    for i, s in enumerate(campaign["stages"]):
        s["position"] = i
    _save_campaign(campaign)
    return True


def get_stage_context(campaign_id: str, stage_id: str) -> str:
    """Build a context string from campaign description and prior stages' summaries."""
    campaign = get_campaign(campaign_id)
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
            [s for s in campaign["stages"] if s["position"] < target_pos and s.get("summary")],
            key=lambda s: s["position"],
        )

    if not description and not prior:
        return ""

    lines = [
        f"=== CAMPAIGN CONTEXT: {campaign['name']} ===",
    ]

    if description:
        lines.append("")
        lines.append("--- Campaign Brief ---")
        lines.append(description)
        lines.append("")

    if prior:
        lines.append("The following are summaries from earlier stages of this marketing funnel.")
        lines.append("Use this context to ensure consistency with the overall customer journey.")
        lines.append("")

        for s in prior:
            status = s.get("status", "active")
            lines.append(f"--- Stage: {s['name']} ({status}) ---")
            lines.append(s["summary"])
            lines.append("")

    lines.append("=== END CAMPAIGN CONTEXT ===")
    return "\n".join(lines)


# ── Campaign Sources ─────────────────────────────────────────────────────


def _sources_dir(campaign_id: str) -> Path:
    return Path(CAMPAIGNS_DIR) / campaign_id / SOURCES_SUBDIR


def _ensure_sources_dir(campaign_id: str) -> Path:
    d = _sources_dir(campaign_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


async def add_source(campaign_id: str, file) -> Optional[Dict[str, Any]]:
    """Upload a source file to a campaign. Returns metadata or None if campaign missing."""
    campaign = get_campaign(campaign_id)
    if campaign is None:
        return None

    original_name = file.filename or "unknown"
    ext = Path(original_name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {ext}")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise ValueError(f"File too large. Maximum is {MAX_FILE_SIZE // (1024*1024)}MB")

    source_id = uuid.uuid4().hex[:12]
    safe_name = f"{source_id}{ext}"

    directory = _ensure_sources_dir(campaign_id)
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
    _save_campaign(campaign)

    meta["extracted_text"] = extracted_text
    return meta


def list_sources(campaign_id: str) -> Optional[List[Dict[str, Any]]]:
    """List all sources for a campaign. Returns None if campaign not found."""
    campaign = get_campaign(campaign_id)
    if campaign is None:
        return None
    return campaign.get("sources", [])


def delete_source(campaign_id: str, source_id: str) -> bool:
    """Delete a source file and its metadata. Returns False if not found."""
    campaign = get_campaign(campaign_id)
    if campaign is None:
        return False

    sources = campaign.get("sources", [])
    target = None
    for s in sources:
        if s["id"] == source_id:
            target = s
            break

    if target is None:
        return False

    filepath = _sources_dir(campaign_id) / target["filename"]
    if filepath.exists():
        filepath.unlink()

    campaign["sources"] = [s for s in sources if s["id"] != source_id]
    _save_campaign(campaign)
    return True


def get_source_path(campaign_id: str, source_id: str) -> Optional[Path]:
    """Get the file path for a source, or None."""
    campaign = get_campaign(campaign_id)
    if campaign is None:
        return None
    for s in campaign.get("sources", []):
        if s["id"] == source_id:
            p = _sources_dir(campaign_id) / s["filename"]
            return p if p.exists() else None
    return None


def get_sources_context(campaign_id: str) -> str:
    """Build a context string from all campaign source documents."""
    campaign = get_campaign(campaign_id)
    if campaign is None:
        return ""

    sources = campaign.get("sources", [])
    doc_sources = [s for s in sources if s.get("category") == "document"]
    if not doc_sources:
        return ""

    parts = ["=== CAMPAIGN SOURCES ===", ""]
    for s in doc_sources:
        filepath = _sources_dir(campaign_id) / s["filename"]
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
