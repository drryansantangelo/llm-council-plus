"""Firestore-based storage for conversations.

Each user's conversations are stored at: users/{user_id}/conversations/{conversation_id}
"""

from datetime import datetime
from typing import List, Dict, Any, Optional

from google.cloud import firestore as gc_firestore

from .firebase_config import get_db


def _conv_ref(user_id: str, conversation_id: str):
    """Get document reference for a specific conversation."""
    return (
        get_db()
        .collection("users")
        .document(user_id)
        .collection("conversations")
        .document(conversation_id)
    )


def _conv_collection(user_id: str):
    """Get collection reference for a user's conversations."""
    return (
        get_db()
        .collection("users")
        .document(user_id)
        .collection("conversations")
    )


def create_conversation(user_id: str, conversation_id: str) -> Dict[str, Any]:
    """Create a new conversation."""
    conversation = {
        "id": conversation_id,
        "created_at": datetime.utcnow().isoformat(),
        "title": "New Conversation",
        "messages": [],
        "message_count": 0,
    }
    _conv_ref(user_id, conversation_id).set(conversation)
    return conversation


def get_conversation(user_id: str, conversation_id: str) -> Optional[Dict[str, Any]]:
    """Load a conversation from Firestore."""
    doc = _conv_ref(user_id, conversation_id).get()
    if not doc.exists:
        return None
    return doc.to_dict()


def save_conversation(user_id: str, conversation: Dict[str, Any]):
    """Save a conversation to Firestore, updating message_count."""
    conversation["message_count"] = len(conversation.get("messages", []))
    _conv_ref(user_id, conversation["id"]).set(conversation)


def list_conversations(user_id: str) -> List[Dict[str, Any]]:
    """List all conversations (metadata only), sorted newest first."""
    docs = (
        _conv_collection(user_id)
        .select(["id", "created_at", "title", "message_count"])
        .order_by("created_at", direction=gc_firestore.Query.DESCENDING)
        .stream()
    )
    return [
        {
            "id": d.get("id") or doc.id,
            "created_at": d.get("created_at", ""),
            "title": d.get("title", "New Conversation"),
            "message_count": d.get("message_count", 0),
        }
        for doc in docs
        for d in [doc.to_dict()]
    ]


def add_user_message(
    user_id: str,
    conversation_id: str,
    content: str,
    file_metadatas: Optional[List[Dict[str, Any]]] = None,
):
    """Add a user message to a conversation."""
    conversation = get_conversation(user_id, conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    msg: Dict[str, Any] = {"role": "user", "content": content}
    if file_metadatas:
        msg["files"] = [
            {
                "id": m["id"],
                "filename": m["filename"],
                "original_name": m["original_name"],
                "type": m["type"],
                "mime_type": m["mime_type"],
                "size": m["size"],
            }
            for m in file_metadatas
        ]

    conversation["messages"].append(msg)
    save_conversation(user_id, conversation)


def add_assistant_message(
    user_id: str,
    conversation_id: str,
    stage1: List[Dict[str, Any]],
    stage2: Optional[List[Dict[str, Any]]] = None,
    stage3: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
):
    """Add an assistant (council) message to a conversation."""
    conversation = get_conversation(user_id, conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    message: Dict[str, Any] = {"role": "assistant", "stage1": stage1}
    if stage2 is not None:
        message["stage2"] = stage2
    if stage3 is not None:
        message["stage3"] = stage3
    if metadata:
        message["metadata"] = metadata

    conversation["messages"].append(message)
    save_conversation(user_id, conversation)


def add_error_message(user_id: str, conversation_id: str, error_text: str):
    """Record a failed turn in the conversation."""
    conversation = get_conversation(user_id, conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    message = {
        "role": "assistant",
        "content": None,
        "error": error_text,
        "stage1": [],
        "stage2": [],
        "stage3": None,
    }
    conversation["messages"].append(message)
    save_conversation(user_id, conversation)


def add_chat_message(
    user_id: str,
    conversation_id: str,
    chat_response: Dict[str, Any],
    metadata: Optional[Dict[str, Any]] = None,
):
    """Save a single-model chat response."""
    conversation = get_conversation(user_id, conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    message: Dict[str, Any] = {
        "role": "assistant",
        "mode": "chat",
        "chat_response": chat_response,
    }
    if metadata:
        message["metadata"] = metadata

    conversation["messages"].append(message)
    save_conversation(user_id, conversation)


def add_debate_message(
    user_id: str,
    conversation_id: str,
    debate_entries: List[Dict[str, Any]],
    summary: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
):
    """Save a debate result message."""
    conversation = get_conversation(user_id, conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    message: Dict[str, Any] = {
        "role": "assistant",
        "mode": "debate",
        "debate_entries": debate_entries,
        "summary": summary,
    }
    if metadata:
        message["metadata"] = metadata

    conversation["messages"].append(message)
    save_conversation(user_id, conversation)


def update_conversation_title(user_id: str, conversation_id: str, title: str):
    """Update the title of a conversation."""
    _conv_ref(user_id, conversation_id).update({"title": title})


def get_conversation_debate_config(
    user_id: str, conversation_id: str
) -> Optional[Dict[str, Any]]:
    """Return the per-conversation debate_config, or None."""
    conversation = get_conversation(user_id, conversation_id)
    if conversation is None:
        return None
    return conversation.get("debate_config")


def update_conversation_debate_config(
    user_id: str, conversation_id: str, config: Optional[Dict[str, Any]]
):
    """Set or clear the per-conversation debate_config."""
    conversation = get_conversation(user_id, conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    if config is None:
        conversation.pop("debate_config", None)
    else:
        conversation["debate_config"] = config
    save_conversation(user_id, conversation)


def delete_conversation(user_id: str, conversation_id: str) -> bool:
    """Delete a conversation. Returns True if it existed."""
    ref = _conv_ref(user_id, conversation_id)
    doc = ref.get()
    if not doc.exists:
        return False
    ref.delete()
    return True
