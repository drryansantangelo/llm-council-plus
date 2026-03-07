"""Google Gemini provider implementation."""

import httpx
from typing import List, Dict, Any
from .base import LLMProvider
from ..settings import get_settings

class GoogleProvider(LLMProvider):
    """Google Gemini API provider."""
    
    BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"
    
    def _get_api_key(self) -> str:
        settings = get_settings()
        return settings.google_api_key or ""

    def _content_to_gemini_parts(self, content):
        """Convert OpenAI-format content (string or multimodal array) to Gemini parts."""
        if isinstance(content, str):
            return [{"text": content}]

        if not isinstance(content, list):
            return [{"text": str(content)}]

        parts = []
        for block in content:
            if block.get("type") == "text":
                parts.append({"text": block["text"]})
            elif block.get("type") == "image_url":
                data_url = block["image_url"]["url"]
                if data_url.startswith("data:"):
                    header, b64data = data_url.split(",", 1)
                    mime_type = header.split(":")[1].split(";")[0]
                    parts.append({"inline_data": {"mime_type": mime_type, "data": b64data}})
        return parts if parts else [{"text": str(content)}]

    async def query(self, model_id: str, messages: List[Dict[str, str]], timeout: float = 120.0, temperature: float = 0.7) -> Dict[str, Any]:
        api_key = self._get_api_key()
        if not api_key:
            return {"error": True, "error_message": "Google API key not configured"}
            
        model = model_id.removeprefix("google:")
        
        contents = []
        system_instruction = None
        
        for msg in messages:
            if msg["role"] == "system":
                sys_content = msg["content"] if isinstance(msg["content"], str) else str(msg["content"])
                system_instruction = {"parts": [{"text": sys_content}]}
            elif msg["role"] == "user":
                contents.append({"role": "user", "parts": self._content_to_gemini_parts(msg["content"])})
            elif msg["role"] == "assistant":
                contents.append({"role": "model", "parts": self._content_to_gemini_parts(msg["content"])})
        
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                payload = {
                    "contents": contents,
                    "generationConfig": {
                        "temperature": temperature
                    }
                }
                if system_instruction:
                    payload["system_instruction"] = system_instruction
                    
                response = await client.post(
                    f"{self.BASE_URL}/{model}:generateContent",
                    params={"key": api_key},
                    headers={"Content-Type": "application/json"},
                    json=payload
                )
                
                if response.status_code != 200:
                    return {
                        "error": True, 
                        "error_message": f"Google API error: {response.status_code} - {response.text}"
                    }
                    
                data = response.json()
                try:
                    content = data["candidates"][0]["content"]["parts"][0]["text"]
                    return {"content": content, "error": False}
                except (KeyError, IndexError):
                    return {"error": True, "error_message": "Unexpected response format from Google API"}
                
        except Exception as e:
            return {"error": True, "error_message": str(e)}

    async def get_models(self) -> List[Dict[str, Any]]:
        api_key = self._get_api_key()
        if not api_key:
            return []
            
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    self.BASE_URL,
                    params={"key": api_key, "pageSize": 100}
                )
                
                if response.status_code != 200:
                    return []
                    
                data = response.json()
                models = []
                
                for model in data.get("models", []):
                    # Filter for models that support content generation
                    if "generateContent" in model.get("supportedGenerationMethods", []):
                        # Clean up ID (remove models/ prefix)
                        model_id = model["name"].removeprefix("models/")
                        
                        # Extra safety check for embeddings/vision-only if they sneak in
                        if "embed" in model_id.lower() or "vision" in model_id.lower():
                            continue
                            
                        models.append({
                            "id": f"google:{model_id}",
                            "name": f"{model.get('displayName', model_id)} [Google]",
                            "provider": "Google"
                        })
                
                return sorted(models, key=lambda x: x["name"])
                
        except Exception:
            return []

    async def validate_key(self, api_key: str) -> Dict[str, Any]:
        try:
            # Test by listing models (more robust than generating content with a specific model)
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    self.BASE_URL,
                    params={"key": api_key, "pageSize": 1}
                )
                
                if response.status_code == 200:
                    return {"success": True, "message": "API key is valid"}
                else:
                    try:
                        error_data = response.json()
                        if "error" in error_data:
                            message = error_data['error'].get('message', 'Unknown error')
                            return {"success": False, "message": f"Error {response.status_code}: {message}"}
                        else:
                            return {"success": False, "message": f"Error {response.status_code}: {str(error_data)[:200]}"}
                    except:
                        return {"success": False, "message": f"Error {response.status_code}: {response.text[:200]}"}
        except Exception as e:
            return {"success": False, "message": str(e)}
