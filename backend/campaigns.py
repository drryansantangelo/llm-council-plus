"""Campaign workspace: persistent marketing funnel projects with ordered stages."""

import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

from . import storage

CAMPAIGNS_DIR = "data/campaigns"
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
    path = _campaign_path(campaign_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def list_campaigns() -> List[Dict[str, Any]]:
    """List all campaigns (metadata only)."""
    _ensure_dir()
    campaigns = []
    for fname in os.listdir(CAMPAIGNS_DIR):
        if fname.endswith(".json") and fname != REVERSE_INDEX_FILE:
            try:
                with open(os.path.join(CAMPAIGNS_DIR, fname), "r") as f:
                    data = json.load(f)
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
                                "conversation_id": s.get("conversation_id"),
                            }
                            for s in data.get("stages", [])
                        ],
                    })
            except (json.JSONDecodeError, OSError, KeyError):
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
        conv_id = stage.get("conversation_id")
        if conv_id:
            _remove_from_reverse_index(conv_id)
            storage.delete_conversation(conv_id)

    path = _campaign_path(campaign_id)
    if os.path.exists(path):
        os.remove(path)
    return True


def add_stage(campaign_id: str, name: str) -> Optional[Dict[str, Any]]:
    """Add a new stage to a campaign. Creates a linked conversation."""
    campaign = get_campaign(campaign_id)
    if campaign is None:
        return None

    conv_id = str(uuid.uuid4())
    storage.create_conversation(conv_id)
    storage.update_conversation_title(conv_id, f"{campaign['name']} — {name}")

    position = len(campaign["stages"])
    stage = {
        "id": uuid.uuid4().hex[:8],
        "name": name,
        "position": position,
        "conversation_id": conv_id,
        "summary": None,
        "status": "active",
        "created_at": datetime.utcnow().isoformat(),
    }

    campaign["stages"].append(stage)
    _save_campaign(campaign)
    _add_to_reverse_index(conv_id, campaign_id, stage["id"])
    return stage


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

    conv_id = target.get("conversation_id")
    if conv_id:
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
