"""FastAPI backend for LLM Council."""

from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import os
import uuid
import json
import asyncio

from . import storage
from .council import generate_conversation_title, generate_search_query, stage1_collect_responses, stage2_collect_rankings, stage3_synthesize_final, calculate_aggregate_rankings, PROVIDERS
from .debate import run_debate, add_interjection
from .search import perform_web_search, SearchProvider
from .settings import get_settings, update_settings, Settings, DEFAULT_COUNCIL_MODELS, DEFAULT_CHAIRMAN_MODEL, AVAILABLE_MODELS
from .uploads import save_upload, get_upload_path, MAX_FILES_PER_MESSAGE, ALLOWED_EXTENSIONS
from . import campaigns

app = FastAPI(title="LLM Council Plus API")

# Enable CORS for local development and network access
# Allow requests from any hostname on ports 5173 and 3000 (frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://.*:(5173|5174|3000)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateConversationRequest(BaseModel):
    """Request to create a new conversation."""
    pass


class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str
    web_search: bool = False
    execution_mode: str = "full"  # 'chat_only', 'chat_ranking', 'full'


class DebateMessageRequest(BaseModel):
    """Request to start a debate in a conversation."""
    content: str
    web_search: bool = False
    file_ids: Optional[List[str]] = None
    mode: Optional[str] = None
    chat_model: Optional[str] = None


class InterjectionRequest(BaseModel):
    """Request to interject in an active debate."""
    content: str


class ConversationMetadata(BaseModel):
    """Conversation metadata for list view."""
    id: str
    created_at: str
    title: str
    message_count: int


class Conversation(BaseModel):
    """Full conversation with all messages."""
    id: str
    created_at: str
    title: str
    messages: List[Dict[str, Any]]


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "LLM Council API"}


@app.get("/api/conversations", response_model=List[ConversationMetadata])
async def list_conversations():
    """List all conversations (metadata only)."""
    return storage.list_conversations()


@app.post("/api/conversations", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest):
    """Create a new conversation."""
    conversation_id = str(uuid.uuid4())
    conversation = storage.create_conversation(conversation_id)
    return conversation


@app.get("/api/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """Get a specific conversation with all its messages."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


class RenameConversationRequest(BaseModel):
    title: str


@app.put("/api/conversations/{conversation_id}/title")
async def rename_conversation(conversation_id: str, body: RenameConversationRequest):
    """Rename a conversation."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    storage.update_conversation_title(conversation_id, body.title)
    return {"status": "updated", "title": body.title}


@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """Delete a conversation, also removing it from any campaign stage."""
    campaign_lookup = campaigns.lookup_campaign_for_conversation(conversation_id)
    if campaign_lookup:
        campaigns.remove_conversation_from_stage(
            campaign_lookup["campaign_id"],
            campaign_lookup["stage_id"],
            conversation_id,
        )

    deleted = storage.delete_conversation(conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "deleted"}


@app.post("/api/conversations/{conversation_id}/message/stream")
async def send_message_stream(conversation_id: str, body: SendMessageRequest, request: Request):
    """Send a message and stream the 3-stage council process."""
    # Validate execution_mode
    valid_modes = ["chat_only", "chat_ranking", "full"]
    if body.execution_mode not in valid_modes:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid execution_mode. Must be one of: {valid_modes}"
        )
    
    # Check if conversation exists
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Check if this is the first message
    is_first_message = len(conversation["messages"]) == 0

    async def event_generator():
        try:
            # Initialize variables for metadata
            stage1_results = []
            stage2_results = []
            stage3_result = None
            label_to_model = {}
            aggregate_rankings = {}
            
            # Add user message
            storage.add_user_message(conversation_id, body.content)

            # Start title generation in parallel (don't await yet)
            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(body.content))

            # Perform web search if requested
            search_context = ""
            search_query = ""
            if body.web_search:
                # Check for disconnect before starting search
                if await request.is_disconnected():
                    print("Client disconnected before web search")
                    raise asyncio.CancelledError("Client disconnected")

                settings = get_settings()
                provider = SearchProvider(settings.search_provider)

                # Set API keys if configured
                if settings.serper_api_key and provider == SearchProvider.SERPER:
                    os.environ["SERPER_API_KEY"] = settings.serper_api_key
                if settings.tavily_api_key and provider == SearchProvider.TAVILY:
                    os.environ["TAVILY_API_KEY"] = settings.tavily_api_key
                if settings.brave_api_key and provider == SearchProvider.BRAVE:
                    os.environ["BRAVE_API_KEY"] = settings.brave_api_key

                yield f"data: {json.dumps({'type': 'search_start', 'data': {'provider': provider.value}})}\n\n"

                # Check for disconnect before generating search query
                if await request.is_disconnected():
                    print("Client disconnected during search setup")
                    raise asyncio.CancelledError("Client disconnected")

                # Generate search query (passthrough - no AI model needed)
                search_query = generate_search_query(body.content)

                # Check for disconnect before performing search
                if await request.is_disconnected():
                    print("Client disconnected before search execution")
                    raise asyncio.CancelledError("Client disconnected")

                # Run search (now fully async for Tavily/Brave, threaded only for DuckDuckGo)
                search_result = await perform_web_search(
                    search_query, 
                    settings.search_result_count,  # Configurable result count (default 8)
                    provider, 
                    settings.full_content_results,
                    settings.search_keyword_extraction,
                    hybrid_mode=settings.search_hybrid_mode  # Combine web+news for DuckDuckGo
                )
                search_context = search_result["results"]
                extracted_query = search_result["extracted_query"]
                search_intent = search_result.get("intent", "unknown")
                yield f"data: {json.dumps({'type': 'search_complete', 'data': {'search_query': search_query, 'extracted_query': extracted_query, 'search_context': search_context, 'provider': provider.value, 'intent': search_intent}})}\n\n"
                await asyncio.sleep(0.05)

            # Stage 1: Collect responses
            yield f"data: {json.dumps({'type': 'stage1_start'})}\n\n"
            await asyncio.sleep(0.05)
            
            total_models = 0
            
            async for item in stage1_collect_responses(body.content, search_context, request):
                if isinstance(item, int):
                    total_models = item
                    print(f"DEBUG: Sending stage1_init with total={total_models}")
                    yield f"data: {json.dumps({'type': 'stage1_init', 'total': total_models})}\n\n"
                    continue
                
                stage1_results.append(item)
                yield f"data: {json.dumps({'type': 'stage1_progress', 'data': item, 'count': len(stage1_results), 'total': total_models})}\n\n"
                await asyncio.sleep(0.01)

            yield f"data: {json.dumps({'type': 'stage1_complete', 'data': stage1_results})}\n\n"
            await asyncio.sleep(0.05)

            # Check if any models responded successfully in Stage 1
            if not any(r for r in stage1_results if not r.get('error')):
                error_msg = 'All models failed to respond in Stage 1, likely due to rate limits or API errors. Please try again or adjust your model selection.'
                storage.add_error_message(conversation_id, error_msg)
                yield f"data: {json.dumps({'type': 'error', 'message': error_msg})}\n\n"
                return # Stop further processing

            # Stage 2: Only if mode is 'chat_ranking' or 'full'
            if body.execution_mode in ["chat_ranking", "full"]:
                yield f"data: {json.dumps({'type': 'stage2_start'})}\n\n"
                await asyncio.sleep(0.05)
                
                # Iterate over the async generator
                async for item in stage2_collect_rankings(body.content, stage1_results, search_context, request):
                    # First item is the label mapping
                    if isinstance(item, dict) and not item.get('model'):
                        label_to_model = item
                        # Send init event with total count
                        yield f"data: {json.dumps({'type': 'stage2_init', 'total': len(label_to_model)})}\n\n"
                        continue
                    
                    # Subsequent items are results
                    stage2_results.append(item)
                    
                    # Send progress update
                    print(f"Stage 2 Progress: {len(stage2_results)}/{len(label_to_model)} - {item['model']}")
                    yield f"data: {json.dumps({'type': 'stage2_progress', 'data': item, 'count': len(stage2_results), 'total': len(label_to_model)})}\n\n"
                    await asyncio.sleep(0.01)

                aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
                yield f"data: {json.dumps({'type': 'stage2_complete', 'data': stage2_results, 'metadata': {'label_to_model': label_to_model, 'aggregate_rankings': aggregate_rankings, 'search_query': search_query, 'search_context': search_context}})}\n\n"
                await asyncio.sleep(0.05)

            # Stage 3: Only if mode is 'full'
            if body.execution_mode == "full":
                yield f"data: {json.dumps({'type': 'stage3_start'})}\n\n"
                await asyncio.sleep(0.05)

                # Check for disconnect before starting Stage 3
                if await request.is_disconnected():
                    print("Client disconnected before Stage 3")
                    raise asyncio.CancelledError("Client disconnected")

                stage3_result = await stage3_synthesize_final(body.content, stage1_results, stage2_results, search_context)
                yield f"data: {json.dumps({'type': 'stage3_complete', 'data': stage3_result})}\n\n"

            # Wait for title generation if it was started
            if title_task:
                try:
                    title = await title_task
                    storage.update_conversation_title(conversation_id, title)
                    yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"
                except Exception as e:
                    print(f"Error waiting for title task: {e}")

            # Save complete assistant message with metadata
            metadata = {
                "execution_mode": body.execution_mode,  # Save mode for historical context
            }
            
            # Only include stage2/stage3 metadata if they were executed
            if body.execution_mode in ["chat_ranking", "full"]:
                metadata["label_to_model"] = label_to_model
                metadata["aggregate_rankings"] = aggregate_rankings
            
            if search_context:
                metadata["search_context"] = search_context
            if search_query:
                metadata["search_query"] = search_query

            storage.add_assistant_message(
                conversation_id,
                stage1_results,
                stage2_results if body.execution_mode in ["chat_ranking", "full"] else None,
                stage3_result if body.execution_mode == "full" else None,
                metadata
            )

            # Send completion event
            yield f"data: {json.dumps({'type': 'complete'})}\n\n"

        except asyncio.CancelledError:
            print(f"Stream cancelled for conversation {conversation_id}")
            # Even if cancelled, try to save the title if it's ready or nearly ready
            if title_task:
                try:
                    # Give it a small grace period to finish if it's close
                    title = await asyncio.wait_for(title_task, timeout=2.0)
                    storage.update_conversation_title(conversation_id, title)
                    print(f"Saved title despite cancellation: {title}")
                except Exception as e:
                    print(f"Could not save title during cancellation: {e}")
            raise
        except Exception as e:
            print(f"Stream error: {e}")
            # Save error to conversation history
            storage.add_error_message(conversation_id, f"Error: {str(e)}")
            # Send error event
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@app.post("/api/conversations/{conversation_id}/debate/stream")
async def debate_stream(conversation_id: str, body: DebateMessageRequest, request: Request):
    """Start a debate and stream results via SSE."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    is_first_message = len(conversation["messages"]) == 0

    # Resolve file metadata from file_ids before entering the generator
    file_metadatas = []
    if body.file_ids:
        from .uploads import get_upload_path, UPLOADS_DIR, IMAGE_EXTENSIONS, DOCUMENT_EXTENSIONS, MIME_MAP
        import json as _json
        from pathlib import Path as _Path

        conv_upload_dir = UPLOADS_DIR / conversation_id
        if conv_upload_dir.is_dir():
            for fid in body.file_ids:
                for f in conv_upload_dir.iterdir():
                    if f.stem == fid and f.is_file():
                        ext = f.suffix.lower()
                        file_type = "image" if ext in IMAGE_EXTENSIONS else "document"
                        meta = {
                            "id": fid,
                            "filename": f.name,
                            "original_name": f.name,
                            "type": file_type,
                            "mime_type": MIME_MAP.get(ext, "application/octet-stream"),
                            "size": f.stat().st_size,
                        }
                        if file_type == "document":
                            from .uploads import extract_document_text
                            meta["extracted_text"] = extract_document_text(str(f))
                        file_metadatas.append(meta)
                        break

    async def event_generator():
        try:
            storage.add_user_message(conversation_id, body.content, file_metadatas=file_metadatas if file_metadatas else None)

            title_task = None
            if is_first_message:
                title_task = asyncio.create_task(generate_conversation_title(body.content))

            search_context = ""
            if body.web_search:
                if await request.is_disconnected():
                    raise asyncio.CancelledError("Client disconnected")

                settings = get_settings()
                provider = SearchProvider(settings.search_provider)

                if settings.tavily_api_key and provider == SearchProvider.TAVILY:
                    os.environ["TAVILY_API_KEY"] = settings.tavily_api_key
                if settings.brave_api_key and provider == SearchProvider.BRAVE:
                    os.environ["BRAVE_API_KEY"] = settings.brave_api_key

                yield f"data: {json.dumps({'type': 'search_start', 'data': {'provider': provider.value}})}\n\n"

                search_query = generate_search_query(body.content)

                search_result = await perform_web_search(
                    search_query,
                    settings.search_result_count,
                    provider,
                    settings.full_content_results,
                    settings.search_keyword_extraction,
                    hybrid_mode=settings.search_hybrid_mode,
                )
                search_context = search_result["results"]
                extracted_query = search_result["extracted_query"]
                search_intent = search_result.get("intent", "unknown")
                yield f"data: {json.dumps({'type': 'search_complete', 'data': {'search_query': search_query, 'extracted_query': extracted_query, 'search_context': search_context, 'provider': provider.value, 'intent': search_intent}})}\n\n"
                await asyncio.sleep(0.05)

            campaign_context = ""
            campaign_lookup = campaigns.lookup_campaign_for_conversation(conversation_id)
            if campaign_lookup:
                campaign_context = campaigns.get_stage_context(
                    campaign_lookup["campaign_id"], campaign_lookup["stage_id"]
                )
                sources_context = campaigns.get_sources_context(campaign_lookup["campaign_id"])
                if sources_context:
                    campaign_context = campaign_context + "\n\n" + sources_context if campaign_context else sources_context

            enriched_content = body.content
            if campaign_context:
                enriched_content = campaign_context + "\n\n" + body.content

            debate_entries = []
            summary_data = None
            chat_response_data = None

            force_chat = body.chat_model if body.mode == "chat" and body.chat_model else None

            async for event in run_debate(conversation_id, enriched_content, search_context, request, file_metadatas=file_metadatas, force_chat_model=force_chat):
                event_type = event.get("type")

                if event_type == "turn_complete":
                    debate_entries.append(event["data"])
                elif event_type == "interjection_applied":
                    debate_entries.append({"type": "interjection", "content": event["data"]["content"]})
                elif event_type == "summary_complete":
                    summary_data = event["data"]
                elif event_type == "chat_complete":
                    chat_response_data = event["data"]

                yield f"data: {json.dumps(event)}\n\n"

            if summary_data and campaign_lookup:
                try:
                    campaigns.update_stage(
                        campaign_lookup["campaign_id"],
                        campaign_lookup["stage_id"],
                        {"summary": summary_data.get("response", "")},
                    )
                except Exception as e:
                    print(f"Failed to auto-save campaign stage summary: {e}")

            if title_task:
                try:
                    title = await title_task
                    storage.update_conversation_title(conversation_id, title)
                    yield f"data: {json.dumps({'type': 'title_complete', 'data': {'title': title}})}\n\n"
                except Exception as e:
                    print(f"Error waiting for title task: {e}")

            metadata = {}
            if search_context:
                metadata["search_context"] = search_context

            if chat_response_data:
                storage.add_chat_message(
                    conversation_id,
                    chat_response_data,
                    metadata if metadata else None,
                )
            else:
                storage.add_debate_message(
                    conversation_id,
                    debate_entries,
                    summary_data,
                    metadata if metadata else None,
                )

        except asyncio.CancelledError:
            print(f"Debate stream cancelled for {conversation_id}")
            if title_task:
                try:
                    title = await asyncio.wait_for(title_task, timeout=2.0)
                    storage.update_conversation_title(conversation_id, title)
                except Exception:
                    pass
            raise
        except Exception as e:
            print(f"Debate stream error: {e}")
            storage.add_error_message(conversation_id, f"Error: {str(e)}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.post("/api/conversations/{conversation_id}/interject")
async def interject_in_debate(conversation_id: str, body: InterjectionRequest):
    """Submit an interjection to an active debate."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    add_interjection(conversation_id, body.content)
    return {"status": "interjection_queued", "content": body.content}


# ── Campaign endpoints ──────────────────────────────────────────────────


class CreateCampaignRequest(BaseModel):
    name: str
    description: Optional[str] = ""


class UpdateCampaignRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class AddStageRequest(BaseModel):
    name: str


class ReorderStagesRequest(BaseModel):
    stage_ids: List[str]


class UpdateStageRequest(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None


@app.post("/api/campaigns")
async def create_campaign(body: CreateCampaignRequest):
    campaign = campaigns.create_campaign(body.name, description=body.description or "")
    return campaign


@app.get("/api/campaigns")
async def list_all_campaigns():
    return campaigns.list_campaigns()


@app.get("/api/campaigns/{campaign_id}")
async def get_campaign(campaign_id: str):
    campaign = campaigns.get_campaign(campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign


@app.put("/api/campaigns/{campaign_id}")
async def update_campaign(campaign_id: str, body: UpdateCampaignRequest):
    result = campaigns.update_campaign(campaign_id, name=body.name, description=body.description)
    if result is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return result


@app.delete("/api/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str):
    deleted = campaigns.delete_campaign(campaign_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return {"status": "deleted"}


@app.post("/api/campaigns/{campaign_id}/stages")
async def add_campaign_stage(campaign_id: str, body: AddStageRequest):
    stage = campaigns.add_stage(campaign_id, body.name)
    if stage is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return stage


@app.put("/api/campaigns/{campaign_id}/stages/reorder")
async def reorder_campaign_stages(campaign_id: str, body: ReorderStagesRequest):
    result = campaigns.reorder_stages(campaign_id, body.stage_ids)
    if result is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return result


@app.put("/api/campaigns/{campaign_id}/stages/{stage_id}")
async def update_campaign_stage(campaign_id: str, stage_id: str, body: UpdateStageRequest):
    updates = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.status is not None:
        updates["status"] = body.status
    result = campaigns.update_stage(campaign_id, stage_id, updates)
    if result is None:
        raise HTTPException(status_code=404, detail="Campaign or stage not found")
    return result


@app.delete("/api/campaigns/{campaign_id}/stages/{stage_id}")
async def delete_campaign_stage(campaign_id: str, stage_id: str):
    deleted = campaigns.delete_stage(campaign_id, stage_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Campaign or stage not found")
    return {"status": "deleted"}


@app.post("/api/campaigns/{campaign_id}/stages/{stage_id}/conversations")
async def add_stage_conversation(campaign_id: str, stage_id: str):
    result = campaigns.add_conversation_to_stage(campaign_id, stage_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Campaign or stage not found")
    return result


# ── Campaign Sources ──────────────────────────────────────────────────


class TextSourceBody(BaseModel):
    name: str
    content: str


@app.post("/api/campaigns/{campaign_id}/sources/text")
async def create_text_source(campaign_id: str, body: TextSourceBody):
    """Create a source from pasted text."""
    try:
        meta = campaigns.add_text_source(campaign_id, body.name, body.content)
        if meta is None:
            raise HTTPException(status_code=404, detail="Campaign not found")
        return meta
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create text source: {str(e)}")


@app.post("/api/campaigns/{campaign_id}/sources")
async def upload_campaign_source(campaign_id: str, file: UploadFile = File(...)):
    """Upload a source file to a campaign."""
    try:
        meta = await campaigns.add_source(campaign_id, file)
        if meta is None:
            raise HTTPException(status_code=404, detail="Campaign not found")
        return meta
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@app.get("/api/campaigns/{campaign_id}/sources")
async def list_campaign_sources(campaign_id: str):
    """List all source files for a campaign."""
    sources = campaigns.list_sources(campaign_id)
    if sources is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return sources


class RenameSourceBody(BaseModel):
    name: str


@app.patch("/api/campaigns/{campaign_id}/sources/{source_id}")
async def rename_campaign_source(campaign_id: str, source_id: str, body: RenameSourceBody):
    """Rename a campaign source."""
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    result = campaigns.rename_source(campaign_id, source_id, body.name)
    if result is None:
        raise HTTPException(status_code=404, detail="Source not found")
    return result


@app.delete("/api/campaigns/{campaign_id}/sources/{source_id}")
async def delete_campaign_source(campaign_id: str, source_id: str):
    """Delete a source file from a campaign."""
    deleted = campaigns.delete_source(campaign_id, source_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Source not found")
    return {"status": "deleted"}


@app.get("/api/campaigns/{campaign_id}/sources/{source_id}/file")
async def serve_campaign_source(campaign_id: str, source_id: str):
    """Serve a campaign source file."""
    filepath = campaigns.get_source_path(campaign_id, source_id)
    if filepath is None:
        raise HTTPException(status_code=404, detail="Source not found")
    return FileResponse(filepath)


# ── Debate Config (per-stage / per-chat) ──────────────────────────────


class DebateConfigBody(BaseModel):
    debate_models: List[str]
    debate_roles: List[str]


@app.get("/api/campaigns/{campaign_id}/stages/{stage_id}/debate-config")
async def get_stage_debate_config(campaign_id: str, stage_id: str):
    """Get the stage-level expert/debate config override."""
    campaign = campaigns.get_campaign(campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found")
    cfg = campaigns.get_stage_debate_config(campaign_id, stage_id)
    return {"debate_config": cfg}


@app.put("/api/campaigns/{campaign_id}/stages/{stage_id}/debate-config")
async def set_stage_debate_config(campaign_id: str, stage_id: str, body: DebateConfigBody):
    """Set stage-level expert/debate config override."""
    result = campaigns.update_stage(
        campaign_id, stage_id,
        {"debate_config": {"debate_models": body.debate_models, "debate_roles": body.debate_roles}},
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Campaign or stage not found")
    return {"status": "updated", "debate_config": result.get("debate_config")}


@app.delete("/api/campaigns/{campaign_id}/stages/{stage_id}/debate-config")
async def clear_stage_debate_config(campaign_id: str, stage_id: str):
    """Remove stage-level expert config (revert to global defaults)."""
    result = campaigns.update_stage(campaign_id, stage_id, {"debate_config": None})
    if result is None:
        raise HTTPException(status_code=404, detail="Campaign or stage not found")
    return {"status": "cleared"}


@app.get("/api/conversations/{conversation_id}/debate-config")
async def get_conversation_debate_config(conversation_id: str):
    """Get the per-chat expert/debate config override."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    cfg = storage.get_conversation_debate_config(conversation_id)
    return {"debate_config": cfg}


@app.put("/api/conversations/{conversation_id}/debate-config")
async def set_conversation_debate_config(conversation_id: str, body: DebateConfigBody):
    """Set per-chat expert/debate config override."""
    try:
        storage.update_conversation_debate_config(
            conversation_id,
            {"debate_models": body.debate_models, "debate_roles": body.debate_roles},
        )
    except ValueError:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "updated", "debate_config": {"debate_models": body.debate_models, "debate_roles": body.debate_roles}}


@app.delete("/api/conversations/{conversation_id}/debate-config")
async def clear_conversation_debate_config(conversation_id: str):
    """Remove per-chat expert config (revert to stage/global defaults)."""
    try:
        storage.update_conversation_debate_config(conversation_id, None)
    except ValueError:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "cleared"}


@app.post("/api/conversations/{conversation_id}/upload")
async def upload_file(conversation_id: str, file: UploadFile = File(...)):
    """Upload a file attachment for a conversation."""
    conversation = storage.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    try:
        metadata = await save_upload(conversation_id, file)
        return metadata
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@app.get("/api/files/{conversation_id}/{filename}")
async def serve_file(conversation_id: str, filename: str):
    """Serve an uploaded file for frontend display."""
    filepath = get_upload_path(conversation_id, filename)
    if filepath is None:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(filepath)


class UpdateSettingsRequest(BaseModel):
    """Request to update settings."""
    search_provider: Optional[str] = None
    search_keyword_extraction: Optional[str] = None
    ollama_base_url: Optional[str] = None
    full_content_results: Optional[int] = None

    # Custom OpenAI-compatible endpoint
    custom_endpoint_name: Optional[str] = None
    custom_endpoint_url: Optional[str] = None
    custom_endpoint_api_key: Optional[str] = None

    # API Keys
    serper_api_key: Optional[str] = None
    tavily_api_key: Optional[str] = None
    brave_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    google_api_key: Optional[str] = None
    mistral_api_key: Optional[str] = None
    deepseek_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None

    # Enabled Providers
    enabled_providers: Optional[Dict[str, bool]] = None
    direct_provider_toggles: Optional[Dict[str, bool]] = None

    # Council Configuration (unified)
    council_models: Optional[List[str]] = None
    chairman_model: Optional[str] = None
    
    # Remote/Local filters
    council_member_filters: Optional[Dict[int, str]] = None
    chairman_filter: Optional[str] = None
    search_query_filter: Optional[str] = None

    # Temperature Settings
    council_temperature: Optional[float] = None
    chairman_temperature: Optional[float] = None
    stage2_temperature: Optional[float] = None

    # Execution Mode
    execution_mode: Optional[str] = None

    # System Prompts
    stage1_prompt: Optional[str] = None
    stage2_prompt: Optional[str] = None
    stage3_prompt: Optional[str] = None

    # Debate Mode
    debate_models: Optional[List[str]] = None
    debate_roles: Optional[List[str]] = None
    debate_max_rounds: Optional[int] = None
    debate_auto_stop: Optional[bool] = None
    debate_temperature: Optional[float] = None
    debate_initial_prompt: Optional[str] = None
    debate_review_prompt: Optional[str] = None
    debate_summary_prompt: Optional[str] = None


class TestTavilyRequest(BaseModel):
    """Request to test Tavily API key."""
    api_key: str | None = None


@app.get("/api/settings")
async def get_app_settings():
    """Get current application settings."""
    settings = get_settings()
    return {
        "search_provider": settings.search_provider,
        "search_keyword_extraction": settings.search_keyword_extraction,
        "ollama_base_url": settings.ollama_base_url,
        "full_content_results": settings.full_content_results,

        # Custom Endpoint
        "custom_endpoint_name": settings.custom_endpoint_name,
        "custom_endpoint_url": settings.custom_endpoint_url,
        # Don't send the API key to frontend for security

        # API Key Status
        "serper_api_key_set": bool(settings.serper_api_key),
        "tavily_api_key_set": bool(settings.tavily_api_key),
        "brave_api_key_set": bool(settings.brave_api_key),
        "openrouter_api_key_set": bool(settings.openrouter_api_key),
        "openai_api_key_set": bool(settings.openai_api_key),
        "anthropic_api_key_set": bool(settings.anthropic_api_key),
        "google_api_key_set": bool(settings.google_api_key),
        "mistral_api_key_set": bool(settings.mistral_api_key),
        "deepseek_api_key_set": bool(settings.deepseek_api_key),
        "groq_api_key_set": bool(settings.groq_api_key),
        "custom_endpoint_api_key_set": bool(settings.custom_endpoint_api_key),

        # Enabled Providers
        "enabled_providers": settings.enabled_providers,
        "direct_provider_toggles": settings.direct_provider_toggles,

        # Council Configuration (unified)
        "council_models": settings.council_models,
        "chairman_model": settings.chairman_model,
        
        # Remote/Local filters
        "council_member_filters": settings.council_member_filters,
        "chairman_filter": settings.chairman_filter,
        "search_query_filter": settings.search_query_filter,

        # Temperature Settings
        "council_temperature": settings.council_temperature,
        "chairman_temperature": settings.chairman_temperature,
        "stage2_temperature": settings.stage2_temperature,

        # Prompts
        "stage1_prompt": settings.stage1_prompt,
        "stage2_prompt": settings.stage2_prompt,
        "stage3_prompt": settings.stage3_prompt,

        # Debate Mode
        "debate_models": settings.debate_models,
        "debate_roles": settings.debate_roles,
        "debate_max_rounds": settings.debate_max_rounds,
        "debate_auto_stop": settings.debate_auto_stop,
        "debate_temperature": settings.debate_temperature,
        "debate_initial_prompt": settings.debate_initial_prompt,
        "debate_review_prompt": settings.debate_review_prompt,
        "debate_summary_prompt": settings.debate_summary_prompt,
    }


@app.get("/api/settings/defaults")
async def get_default_settings():
    """Get default model settings."""
    from .prompts import (
        STAGE1_PROMPT_DEFAULT,
        STAGE2_PROMPT_DEFAULT,
        STAGE3_PROMPT_DEFAULT,
        TITLE_PROMPT_DEFAULT
    )
    from .settings import DEFAULT_ENABLED_PROVIDERS
    return {
        "council_models": DEFAULT_COUNCIL_MODELS,
        "chairman_model": DEFAULT_CHAIRMAN_MODEL,
        "enabled_providers": DEFAULT_ENABLED_PROVIDERS,
        "stage1_prompt": STAGE1_PROMPT_DEFAULT,
        "stage2_prompt": STAGE2_PROMPT_DEFAULT,
        "stage3_prompt": STAGE3_PROMPT_DEFAULT,
    }


@app.put("/api/settings")
async def update_app_settings(request: UpdateSettingsRequest):
    """Update application settings."""
    updates = {}

    if request.search_provider is not None:
        # Validate provider
        try:
            provider = SearchProvider(request.search_provider)
            updates["search_provider"] = provider
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid search provider. Must be one of: {[p.value for p in SearchProvider]}"
            )

    if request.search_keyword_extraction is not None:
        if request.search_keyword_extraction not in ["direct", "yake"]:
             raise HTTPException(
                status_code=400,
                detail="Invalid keyword extraction mode. Must be 'direct' or 'yake'"
            )
        updates["search_keyword_extraction"] = request.search_keyword_extraction

    if request.ollama_base_url is not None:
        updates["ollama_base_url"] = request.ollama_base_url

    # Custom endpoint
    if request.custom_endpoint_name is not None:
        updates["custom_endpoint_name"] = request.custom_endpoint_name
    if request.custom_endpoint_url is not None:
        updates["custom_endpoint_url"] = request.custom_endpoint_url
    if request.custom_endpoint_api_key is not None:
        updates["custom_endpoint_api_key"] = request.custom_endpoint_api_key

    if request.full_content_results is not None:
        # Validate range
        if request.full_content_results < 0 or request.full_content_results > 10:
            raise HTTPException(
                status_code=400,
                detail="full_content_results must be between 0 and 10"
            )
        updates["full_content_results"] = request.full_content_results

    # Prompt updates
    if request.stage1_prompt is not None:
        updates["stage1_prompt"] = request.stage1_prompt
    if request.stage2_prompt is not None:
        updates["stage2_prompt"] = request.stage2_prompt
    if request.stage3_prompt is not None:
        updates["stage3_prompt"] = request.stage3_prompt

    if request.serper_api_key is not None:
        updates["serper_api_key"] = request.serper_api_key
        # Also set in environment for immediate use
        if request.serper_api_key:
            os.environ["SERPER_API_KEY"] = request.serper_api_key

    if request.tavily_api_key is not None:
        updates["tavily_api_key"] = request.tavily_api_key
        # Also set in environment for immediate use
        if request.tavily_api_key:
            os.environ["TAVILY_API_KEY"] = request.tavily_api_key

    if request.brave_api_key is not None:
        updates["brave_api_key"] = request.brave_api_key
        # Also set in environment for immediate use
        if request.brave_api_key:
            os.environ["BRAVE_API_KEY"] = request.brave_api_key

    if request.openrouter_api_key is not None:
        updates["openrouter_api_key"] = request.openrouter_api_key
        
    # Direct Provider Keys
    if request.openai_api_key is not None:
        updates["openai_api_key"] = request.openai_api_key
    if request.anthropic_api_key is not None:
        updates["anthropic_api_key"] = request.anthropic_api_key
    if request.google_api_key is not None:
        updates["google_api_key"] = request.google_api_key
    if request.mistral_api_key is not None:
        updates["mistral_api_key"] = request.mistral_api_key
    if request.deepseek_api_key is not None:
        updates["deepseek_api_key"] = request.deepseek_api_key
    if request.groq_api_key is not None:
        updates["groq_api_key"] = request.groq_api_key

    # Enabled Providers
    if request.enabled_providers is not None:
        updates["enabled_providers"] = request.enabled_providers

    if request.direct_provider_toggles is not None:
        updates["direct_provider_toggles"] = request.direct_provider_toggles

    # Council Configuration (unified)
    if request.council_models is not None:
        # Validate that at least two models are selected
        if len(request.council_models) < 2:
            raise HTTPException(
                status_code=400,
                detail="At least two council models must be selected"
            )
        if len(request.council_models) > 8:
            raise HTTPException(
                status_code=400,
                detail="Maximum of 8 council models allowed"
            )
        updates["council_models"] = request.council_models

    if request.chairman_model is not None:
        updates["chairman_model"] = request.chairman_model
        
    # Remote/Local filters
    if request.council_member_filters is not None:
        updates["council_member_filters"] = request.council_member_filters
    if request.chairman_filter is not None:
        updates["chairman_filter"] = request.chairman_filter
    if request.search_query_filter is not None:
        updates["search_query_filter"] = request.search_query_filter

    # Temperature Settings
    if request.council_temperature is not None:
        updates["council_temperature"] = request.council_temperature
    if request.chairman_temperature is not None:
        updates["chairman_temperature"] = request.chairman_temperature
    if request.stage2_temperature is not None:
        updates["stage2_temperature"] = request.stage2_temperature

    # Prompts   # Execution Mode
    if request.execution_mode is not None:
        valid_modes = ["chat_only", "chat_ranking", "full"]
        if request.execution_mode not in valid_modes:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid execution_mode. Must be one of: {valid_modes}"
            )
        updates["execution_mode"] = request.execution_mode

    # Debate settings
    if request.debate_models is not None:
        updates["debate_models"] = request.debate_models
    if request.debate_roles is not None:
        updates["debate_roles"] = request.debate_roles
    if request.debate_max_rounds is not None:
        updates["debate_max_rounds"] = max(1, min(5, request.debate_max_rounds))
    if request.debate_auto_stop is not None:
        updates["debate_auto_stop"] = request.debate_auto_stop
    if request.debate_temperature is not None:
        updates["debate_temperature"] = request.debate_temperature
    if request.debate_initial_prompt is not None:
        updates["debate_initial_prompt"] = request.debate_initial_prompt
    if request.debate_review_prompt is not None:
        updates["debate_review_prompt"] = request.debate_review_prompt
    if request.debate_summary_prompt is not None:
        updates["debate_summary_prompt"] = request.debate_summary_prompt

    if updates:
        settings = update_settings(**updates)
    else:
        settings = get_settings()

    return {
        "search_provider": settings.search_provider,
        "search_keyword_extraction": settings.search_keyword_extraction,
        "ollama_base_url": settings.ollama_base_url,
        "full_content_results": settings.full_content_results,

        # Custom Endpoint
        "custom_endpoint_name": settings.custom_endpoint_name,
        "custom_endpoint_url": settings.custom_endpoint_url,

        # API Key Status
        "serper_api_key_set": bool(settings.serper_api_key),
        "tavily_api_key_set": bool(settings.tavily_api_key),
        "brave_api_key_set": bool(settings.brave_api_key),
        "openrouter_api_key_set": bool(settings.openrouter_api_key),
        "openai_api_key_set": bool(settings.openai_api_key),
        "anthropic_api_key_set": bool(settings.anthropic_api_key),
        "google_api_key_set": bool(settings.google_api_key),
        "mistral_api_key_set": bool(settings.mistral_api_key),
        "deepseek_api_key_set": bool(settings.deepseek_api_key),
        "groq_api_key_set": bool(settings.groq_api_key),
        "custom_endpoint_api_key_set": bool(settings.custom_endpoint_api_key),

        # Enabled Providers
        "enabled_providers": settings.enabled_providers,
        "direct_provider_toggles": settings.direct_provider_toggles,

        # Council Configuration (unified)
        "council_models": settings.council_models,
        "chairman_model": settings.chairman_model,

        # Remote/Local filters
        "council_member_filters": settings.council_member_filters,
        "chairman_filter": settings.chairman_filter,

        # Prompts
        "stage1_prompt": settings.stage1_prompt,
        "stage2_prompt": settings.stage2_prompt,
        "stage3_prompt": settings.stage3_prompt,

        # Debate Mode
        "debate_models": settings.debate_models,
        "debate_roles": settings.debate_roles,
        "debate_max_rounds": settings.debate_max_rounds,
        "debate_auto_stop": settings.debate_auto_stop,
        "debate_temperature": settings.debate_temperature,
        "debate_initial_prompt": settings.debate_initial_prompt,
        "debate_review_prompt": settings.debate_review_prompt,
        "debate_summary_prompt": settings.debate_summary_prompt,
    }


@app.get("/api/models/direct")
async def get_direct_models():
    """Get available models from all configured direct providers."""
    all_models = []
    
    # Iterate over all providers
    for provider_id, provider in PROVIDERS.items():
        # Skip OpenRouter and Ollama as they are handled separately
        if provider_id in ["openrouter", "ollama", "hybrid"]:
            continue
            
        try:
            # Fetch models from provider
            models = await provider.get_models()
            all_models.extend(models)
        except Exception as e:
            print(f"Error fetching models for {provider_id}: {e}")
            
    return all_models


@app.post("/api/settings/test-tavily")
async def test_tavily_api(request: TestTavilyRequest):
    """Test Tavily API key with a simple search."""
    import httpx
    settings = get_settings()

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": request.api_key or settings.tavily_api_key,
                    "query": "test",
                    "max_results": 1,
                    "search_depth": "basic",
                },
            )

            if response.status_code == 200:
                return {"success": True, "message": "API key is valid"}
            elif response.status_code == 401:
                return {"success": False, "message": "Invalid API key"}
            else:
                return {"success": False, "message": f"API error: {response.status_code}"}

    except httpx.TimeoutException:
        return {"success": False, "message": "Request timed out"}
    except Exception as e:
        return {"success": False, "message": str(e)}


class TestBraveRequest(BaseModel):
    """Request to test Brave API key."""
    api_key: str | None = None


@app.post("/api/settings/test-brave")
async def test_brave_api(request: TestBraveRequest):
    """Test Brave API key with a simple search."""
    import httpx
    settings = get_settings()

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                params={"q": "test", "count": 1},
                headers={
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip",
                    "X-Subscription-Token": request.api_key or settings.brave_api_key,
                },
            )

            if response.status_code == 200:
                return {"success": True, "message": "API key is valid"}
            elif response.status_code == 401 or response.status_code == 403:
                return {"success": False, "message": "Invalid API key"}
            else:
                return {"success": False, "message": f"API error: {response.status_code}"}

    except httpx.TimeoutException:
        return {"success": False, "message": "Request timed out"}
    except Exception as e:
        return {"success": False, "message": str(e)}


class TestSerperRequest(BaseModel):
    """Request to test Serper API key."""
    api_key: str | None = None


@app.post("/api/settings/test-serper")
async def test_serper_api(request: TestSerperRequest):
    """Test Serper API key with a simple search."""
    import httpx
    settings = get_settings()

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://google.serper.dev/search",
                json={"q": "test", "num": 1},
                headers={
                    "X-API-KEY": request.api_key or settings.serper_api_key,
                    "Content-Type": "application/json",
                },
            )

            if response.status_code == 200:
                return {"success": True, "message": "API key is valid"}
            elif response.status_code == 401 or response.status_code == 403:
                return {"success": False, "message": "Invalid API key"}
            else:
                return {"success": False, "message": f"API error: {response.status_code}"}

    except httpx.TimeoutException:
        return {"success": False, "message": "Request timed out"}
    except Exception as e:
        return {"success": False, "message": str(e)}


class TestOpenRouterRequest(BaseModel):
    """Request to test OpenRouter API key."""
    api_key: Optional[str] = None


class TestProviderRequest(BaseModel):
    """Request to test a specific provider's API key."""
    provider_id: str
    api_key: str


@app.post("/api/settings/test-provider")
async def test_provider_api(request: TestProviderRequest):
    """Test an API key for a specific provider."""
    from .council import PROVIDERS
    from .settings import get_settings
    
    if request.provider_id not in PROVIDERS:
        raise HTTPException(status_code=400, detail="Invalid provider ID")
        
    api_key = request.api_key
    if not api_key:
        # Try to get from settings
        settings = get_settings()
        # Map provider_id to setting key (e.g. 'openai' -> 'openai_api_key')
        setting_key = f"{request.provider_id}_api_key"
        if hasattr(settings, setting_key):
             api_key = getattr(settings, setting_key)
    
    if not api_key:
         return {"success": False, "message": "No API key provided or configured"}

    provider = PROVIDERS[request.provider_id]
    return await provider.validate_key(api_key)


class TestOllamaRequest(BaseModel):
    """Request to test Ollama connection."""
    base_url: str


@app.get("/api/ollama/tags")
async def get_ollama_tags(base_url: Optional[str] = None):
    """Fetch available models from Ollama."""
    import httpx
    from .config import get_ollama_base_url
    
    if not base_url:
        base_url = get_ollama_base_url()
        
    if base_url.endswith('/'):
        base_url = base_url[:-1]
        
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{base_url}/api/tags")
            
            if response.status_code != 200:
                return {"models": [], "error": f"Ollama API error: {response.status_code}"}
                
            data = response.json()
            models = []
            for model in data.get("models", []):
                models.append({
                    "id": model.get("name"),
                    "name": model.get("name"),
                    # Ollama doesn't return context length in tags
                    "context_length": None,
                    "is_free": True,
                    "modified_at": model.get("modified_at")
                })
                
            # Sort by modified_at (newest first), fallback to name
            models.sort(key=lambda x: x.get("modified_at", ""), reverse=True)
            return {"models": models}
            
    except httpx.ConnectError:
        return {"models": [], "error": "Could not connect to Ollama. Is it running?"}
    except Exception as e:
        return {"models": [], "error": str(e)}


@app.post("/api/settings/test-ollama")
async def test_ollama_connection(request: TestOllamaRequest):
    """Test connection to Ollama instance."""
    import httpx
    
    base_url = request.base_url
    if base_url.endswith('/'):
        base_url = base_url[:-1]
        
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{base_url}/api/tags")
            
            if response.status_code == 200:
                return {"success": True, "message": "Successfully connected to Ollama"}
            else:
                return {"success": False, "message": f"Ollama API error: {response.status_code}"}
                
    except httpx.ConnectError:
        return {"success": False, "message": "Could not connect to Ollama. Is it running at this URL?"}
    except Exception as e:
        return {"success": False, "message": str(e)}


class TestCustomEndpointRequest(BaseModel):
    """Request to test custom OpenAI-compatible endpoint."""
    name: str
    url: str
    api_key: Optional[str] = None


@app.post("/api/settings/test-custom-endpoint")
async def test_custom_endpoint(request: TestCustomEndpointRequest):
    """Test connection to a custom OpenAI-compatible endpoint."""
    from .providers.custom_openai import CustomOpenAIProvider

    provider = CustomOpenAIProvider()
    return await provider.validate_connection(request.url, request.api_key or "")


@app.get("/api/custom-endpoint/models")
async def get_custom_endpoint_models():
    """Fetch available models from the custom endpoint."""
    from .providers.custom_openai import CustomOpenAIProvider
    from .settings import get_settings

    settings = get_settings()
    if not settings.custom_endpoint_url:
        return {"models": [], "error": "No custom endpoint configured"}

    provider = CustomOpenAIProvider()
    models = await provider.get_models()
    return {"models": models}


@app.get("/api/models")
async def get_openrouter_models():
    """Fetch available models from OpenRouter API."""
    import httpx
    from .config import get_openrouter_api_key

    api_key = get_openrouter_api_key()
    if not api_key:
        return {"models": [], "error": "No OpenRouter API key configured"}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )

            if response.status_code != 200:
                return {"models": [], "error": f"API error: {response.status_code}"}

            data = response.json()
            models = []
            
            # Comprehensive exclusion list for non-text/chat models
            excluded_terms = [
                "embed", "audio", "whisper", "tts", "dall-e", "realtime", 
                "vision-only", "voxtral", "speech", "transcribe", "sora"
            ]

            for model in data.get("data", []):
                mid = model.get("id", "").lower()
                name_lower = model.get("name", "").lower()
                
                if any(term in mid for term in excluded_terms) or any(term in name_lower for term in excluded_terms):
                    continue

                # Extract pricing - free models have 0 cost
                pricing = model.get("pricing", {})
                prompt_price = float(pricing.get("prompt", "0") or "0")
                completion_price = float(pricing.get("completion", "0") or "0")
                is_free = prompt_price == 0 and completion_price == 0

                models.append({
                    "id": f"openrouter:{model.get('id')}",
                    "name": f"{model.get('name', model.get('id'))} [OpenRouter]",
                    "provider": "OpenRouter",
                    "context_length": model.get("context_length"),
                    "is_free": is_free,
                })

            # Sort by name
            models.sort(key=lambda x: x["name"].lower())
            return {"models": models}

    except httpx.TimeoutException:
        return {"models": [], "error": "Request timed out"}
    except Exception as e:
        return {"models": [], "error": str(e)}


@app.post("/api/settings/test-openrouter")
async def test_openrouter_api(request: TestOpenRouterRequest):
    """Test OpenRouter API key with a simple request."""
    import httpx
    from .config import get_openrouter_api_key

    # Use provided key or fall back to saved key
    api_key = request.api_key if request.api_key else get_openrouter_api_key()
    
    if not api_key:
        return {"success": False, "message": "No API key provided or configured"}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={
                    "Authorization": f"Bearer {api_key}",
                },
            )

            if response.status_code == 200:
                return {"success": True, "message": "API key is valid"}
            elif response.status_code == 401:
                return {"success": False, "message": "Invalid API key"}
            else:
                return {"success": False, "message": f"API error: {response.status_code}"}

    except httpx.TimeoutException:
        return {"success": False, "message": "Request timed out"}
    except Exception as e:
        return {"success": False, "message": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
