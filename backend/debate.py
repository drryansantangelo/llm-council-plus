"""Iterative debate flow for LLM Council Plus."""

import asyncio
import re
import logging
from typing import List, Dict, Any, Optional

from .council import query_model
from .settings import get_settings
from .config import get_chairman_model
from .prompts import STAGE1_SEARCH_CONTEXT_TEMPLATE
from .uploads import build_multimodal_content

logger = logging.getLogger(__name__)

_pending_interjections: Dict[str, List[str]] = {}


def add_interjection(conversation_id: str, content: str):
    """Add a user interjection to be picked up by the debate loop."""
    if conversation_id not in _pending_interjections:
        _pending_interjections[conversation_id] = []
    _pending_interjections[conversation_id].append(content)


def get_pending_interjections(conversation_id: str) -> List[str]:
    """Get and clear pending interjections for a conversation."""
    return _pending_interjections.pop(conversation_id, [])


def _build_debate_history_text(debate_history: List[Dict]) -> str:
    """Format debate history into readable text for model context."""
    parts = []
    for entry in debate_history:
        if entry.get("type") == "interjection":
            parts.append(f"[USER DIRECTION]: {entry['content']}")
        elif entry.get("type") == "turn":
            role_label = entry.get("role", "Expert")
            parts.append(f"[{role_label}] (Round {entry['round']}):\n{entry['response']}")
    return "\n\n---\n\n".join(parts)


async def run_debate(
    conversation_id: str,
    user_query: str,
    search_context: str = "",
    request: Any = None,
    file_metadatas: Optional[List[Dict[str, Any]]] = None,
):
    """
    Run an iterative debate between models.

    For 1 model: Simple chat response.
    For 2-3 models: Iterative debate with rounds.

    Yields SSE-ready dicts with 'type' and 'data' keys.
    """
    settings = get_settings()
    models = settings.debate_models or []
    roles = settings.debate_roles or []
    max_rounds = settings.debate_max_rounds
    auto_stop = settings.debate_auto_stop
    temperature = settings.debate_temperature

    active_models = []
    active_roles = []
    for i, model in enumerate(models):
        if model and model.strip():
            active_models.append(model)
            role = roles[i] if i < len(roles) else ""
            active_roles.append(role if role else "You are a helpful expert.")

    if not active_models:
        yield {"type": "error", "message": "No debate models configured. Go to Settings to add models."}
        return

    search_context_block = ""
    if search_context:
        search_context_block = STAGE1_SEARCH_CONTEXT_TEMPLATE.format(search_context=search_context)

    # --- Single model: simple chat ---
    if len(active_models) == 1:
        model = active_models[0]
        role = active_roles[0]

        yield {"type": "chat_start", "data": {"model": model, "role": role}}
        await asyncio.sleep(0.05)

        prompt = f"{role}\n\n{search_context_block}\n{user_query}" if search_context_block else f"{role}\n\n{user_query}"
        content = build_multimodal_content(prompt, file_metadatas or [], conversation_id)
        messages = [{"role": "user", "content": content}]

        try:
            response = await query_model(model, messages, temperature=temperature)
            if response.get("error"):
                content = f"Error: {response.get('error_message', 'Unknown error')}"
            else:
                content = response.get("content", "")
        except Exception as e:
            content = f"Error: {str(e)}"

        yield {"type": "chat_complete", "data": {"model": model, "role": role, "response": content}}
        yield {"type": "complete"}
        return

    # --- Multi-model debate ---
    yield {"type": "debate_start", "data": {
        "models": [{"model": m, "role": r} for m, r in zip(active_models, active_roles)],
        "max_rounds": max_rounds,
    }}
    await asyncio.sleep(0.05)

    debate_history: List[Dict] = []

    for round_num in range(1, max_rounds + 1):
        if round_num > 1:
            interjections = get_pending_interjections(conversation_id)
            for interjection in interjections:
                entry = {"type": "interjection", "content": interjection}
                debate_history.append(entry)
                yield {"type": "interjection_applied", "data": {"content": interjection}}
                await asyncio.sleep(0.05)

        yield {"type": "round_start", "data": {"round": round_num}}
        await asyncio.sleep(0.05)

        for turn_idx, (model, role) in enumerate(zip(active_models, active_roles)):
            if request and await request.is_disconnected():
                raise asyncio.CancelledError("Client disconnected")

            yield {"type": "turn_start", "data": {
                "model": model, "role_name": role,
                "round": round_num, "turn": turn_idx + 1,
            }}
            await asyncio.sleep(0.05)

            if not debate_history:
                prompt = settings.debate_initial_prompt.format(
                    role_description=role,
                    user_query=user_query,
                    search_context_block=search_context_block,
                )
            else:
                history_text = _build_debate_history_text(debate_history)
                mid_interjections = get_pending_interjections(conversation_id)
                interjection_block = ""
                for inj in mid_interjections:
                    entry = {"type": "interjection", "content": inj}
                    debate_history.append(entry)
                    yield {"type": "interjection_applied", "data": {"content": inj}}
                    interjection_block += f"\n\n[USER DIRECTION]: {inj}"

                prompt = settings.debate_review_prompt.format(
                    role_description=role,
                    user_query=user_query,
                    search_context_block=search_context_block,
                    debate_history=history_text,
                    interjection_block=interjection_block,
                )

            # Only attach images on the first turn to avoid resending large base64 payloads
            use_files = file_metadatas if (not debate_history and file_metadatas) else []
            msg_content = build_multimodal_content(prompt, use_files, conversation_id)
            messages = [{"role": "user", "content": msg_content}]

            try:
                response = await query_model(model, messages, temperature=temperature)
                if response.get("error"):
                    content = f"Error: {response.get('error_message', 'Unknown error')}"
                else:
                    content = response.get("content", "")
            except Exception as e:
                content = f"Error: {str(e)}"

            turn_entry = {
                "type": "turn",
                "model": model,
                "role": role,
                "response": content,
                "round": round_num,
                "turn": turn_idx + 1,
            }
            debate_history.append(turn_entry)

            yield {"type": "turn_complete", "data": turn_entry}
            await asyncio.sleep(0.05)

        yield {"type": "round_complete", "data": {"round": round_num}}
        await asyncio.sleep(0.05)

        if auto_stop and round_num >= 2 and round_num < max_rounds:
            agreement = await _check_convergence(
                active_models[0], user_query, debate_history, temperature
            )
            yield {"type": "convergence_check", "data": {
                "agreement": agreement, "converged": agreement >= 90,
            }}
            if agreement >= 90:
                break

    # --- Chairman summary ---
    chairman = get_chairman_model()
    if chairman and chairman.strip():
        yield {"type": "summary_start", "data": {"model": chairman}}
        await asyncio.sleep(0.05)

        history_text = _build_debate_history_text(debate_history)
        summary_prompt = settings.debate_summary_prompt.format(
            user_query=user_query,
            search_context_block=search_context_block,
            debate_history=history_text,
        )

        # Include document context (text only) for the chairman summary
        doc_only = [m for m in (file_metadatas or []) if m["type"] == "document"]
        summary_content = build_multimodal_content(summary_prompt, doc_only, conversation_id)
        messages = [{"role": "user", "content": summary_content}]

        try:
            response = await query_model(
                chairman, messages, temperature=settings.chairman_temperature
            )
            if response.get("error"):
                summary = f"Error: {response.get('error_message', 'Unknown error')}"
            else:
                summary = response.get("content", "")
        except Exception as e:
            summary = f"Error generating summary: {str(e)}"

        yield {"type": "summary_complete", "data": {"model": chairman, "response": summary}}

    yield {"type": "complete"}


async def _check_convergence(
    model: str,
    user_query: str,
    debate_history: List[Dict],
    temperature: float,
) -> int:
    """Estimate agreement percentage between debate participants."""
    history_text = _build_debate_history_text(debate_history)
    prompt = (
        f"Review the following debate about this question: {user_query}\n\n"
        f"{history_text}\n\n"
        "Based on the most recent round, estimate the percentage of agreement "
        "between the experts on their core recommendations. Consider:\n"
        "- Are the key recommendations aligned?\n"
        "- Have major disagreements been resolved?\n"
        "- Are remaining differences minor/stylistic rather than substantive?\n\n"
        "Respond with ONLY a number between 0 and 100. Nothing else."
    )

    messages = [{"role": "user", "content": prompt}]

    try:
        response = await query_model(model, messages, temperature=0.1)
        content = response.get("content", "50").strip()
        match = re.search(r"\d+", content)
        if match:
            return min(100, max(0, int(match.group())))
        return 50
    except Exception:
        return 50
