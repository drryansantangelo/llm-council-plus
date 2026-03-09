"""File upload handling: storage, text extraction, image encoding, and multimodal prompt building."""

import base64
import mimetypes
import os
import uuid
from pathlib import Path
from typing import Dict, Any, List, Optional, Union

UPLOADS_DIR = Path("data/uploads")

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
DOCUMENT_EXTENSIONS = {".pdf", ".docx", ".doc"}
TEXT_EXTENSIONS = {".txt", ".html", ".htm", ".md", ".csv"}
ALLOWED_EXTENSIONS = IMAGE_EXTENSIONS | DOCUMENT_EXTENSIONS | TEXT_EXTENSIONS

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB
MAX_FILES_PER_MESSAGE = 5

MIME_MAP = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".txt": "text/plain",
    ".html": "text/html",
    ".htm": "text/html",
    ".md": "text/markdown",
    ".csv": "text/csv",
}


def _ensure_dir(conversation_id: str) -> Path:
    """Ensure upload directory exists for a conversation."""
    directory = UPLOADS_DIR / conversation_id
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def get_upload_path(conversation_id: str, filename: str) -> Optional[Path]:
    """Get full path for an uploaded file, or None if it doesn't exist."""
    path = UPLOADS_DIR / conversation_id / filename
    if path.exists():
        return path
    return None


async def save_upload(conversation_id: str, file) -> Dict[str, Any]:
    """
    Save a FastAPI UploadFile and return metadata.

    Returns dict with: id, filename, original_name, type, category, size, extracted_text
    """
    original_name = file.filename or "unknown"
    ext = Path(original_name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {ext}. Allowed: {', '.join(ALLOWED_EXTENSIONS)}")

    content = await file.read()

    if len(content) > MAX_FILE_SIZE:
        raise ValueError(f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB")

    file_id = uuid.uuid4().hex[:12]
    safe_name = f"{file_id}{ext}"

    directory = _ensure_dir(conversation_id)
    filepath = directory / safe_name
    filepath.write_bytes(content)

    if ext in IMAGE_EXTENSIONS:
        category = "image"
    else:
        category = "document"
    extracted_text = None
    if category == "document":
        extracted_text = extract_document_text(str(filepath))

    return {
        "id": file_id,
        "filename": safe_name,
        "original_name": original_name,
        "type": category,
        "mime_type": MIME_MAP.get(ext, "application/octet-stream"),
        "category": category,
        "size": len(content),
        "extracted_text": extracted_text,
    }


def extract_document_text(filepath: str) -> Optional[str]:
    """Extract text content from PDF, Word, or plain text documents."""
    ext = Path(filepath).suffix.lower()

    if ext == ".pdf":
        return _extract_pdf_text(filepath)
    elif ext in (".docx", ".doc"):
        return _extract_docx_text(filepath)
    elif ext in (".txt", ".md", ".csv"):
        return _extract_plain_text(filepath)
    elif ext in (".html", ".htm"):
        return _extract_html_text(filepath)

    return None


def _extract_pdf_text(filepath: str) -> str:
    """Extract text from a PDF using PyMuPDF."""
    import fitz

    text_parts = []
    try:
        with fitz.open(filepath) as doc:
            for page in doc:
                text_parts.append(page.get_text())
    except Exception as e:
        return f"[Could not extract PDF text: {e}]"

    text = "\n".join(text_parts).strip()
    if len(text) < 50:
        return "[PDF contained very little extractable text — it may be image-based]"
    return text


def _extract_docx_text(filepath: str) -> str:
    """Extract text from a Word document."""
    from docx import Document

    try:
        doc = Document(filepath)
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        text = "\n".join(paragraphs)
        if not text.strip():
            return "[Document contained no extractable text]"
        return text
    except Exception as e:
        return f"[Could not extract document text: {e}]"


def _extract_plain_text(filepath: str) -> str:
    """Read a plain text, markdown, or CSV file."""
    try:
        text = Path(filepath).read_text(encoding="utf-8", errors="replace")
        if not text.strip():
            return "[File contained no text]"
        return text
    except Exception as e:
        return f"[Could not read text file: {e}]"


def _extract_html_text(filepath: str) -> str:
    """Extract text from HTML, preserving structure as readable text."""
    import re
    try:
        raw = Path(filepath).read_text(encoding="utf-8", errors="replace")
        if not raw.strip():
            return "[HTML file was empty]"
        text = re.sub(r'<script[^>]*>.*?</script>', '', raw, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
        text = re.sub(r'</(p|div|h[1-6]|li|tr|section|article|header|footer)>', '\n', text, flags=re.IGNORECASE)
        text = re.sub(r'<[^>]+>', '', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = text.strip()
        if not text:
            return "[HTML file contained no extractable text]"
        return text
    except Exception as e:
        return f"[Could not extract HTML text: {e}]"


def get_image_base64(filepath: str) -> str:
    """Read an image file and return a base64 data URL."""
    path = Path(filepath)
    ext = path.suffix.lower()
    mime = MIME_MAP.get(ext, "image/png")

    data = path.read_bytes()
    b64 = base64.b64encode(data).decode("utf-8")
    return f"data:{mime};base64,{b64}"


def build_multimodal_content(
    text_prompt: str,
    file_metadatas: List[Dict[str, Any]],
    conversation_id: str,
) -> Union[str, List[Dict[str, Any]]]:
    """
    Build multimodal message content from a text prompt and file metadata.

    If there are no image files, returns a plain string (with document text prepended).
    If there are images, returns an OpenAI-compatible content array with image_url blocks.
    """
    if not file_metadatas:
        return text_prompt

    doc_context_parts = []
    image_blocks = []

    for meta in file_metadatas:
        file_type = meta.get("type", meta.get("category", ""))

        if file_type == "document":
            extracted = meta.get("extracted_text")
            if not extracted:
                fpath = get_upload_path(conversation_id, meta["filename"])
                if fpath:
                    extracted = extract_document_text(str(fpath))
            if extracted:
                name = meta.get("original_name", meta.get("filename", "document"))
                doc_context_parts.append(f"--- Attached Document: {name} ---\n{extracted}")

        elif file_type == "image":
            fpath = get_upload_path(conversation_id, meta["filename"])
            if fpath:
                data_url = get_image_base64(str(fpath))
                image_blocks.append({
                    "type": "image_url",
                    "image_url": {"url": data_url},
                })

    full_text = text_prompt
    if doc_context_parts:
        full_text = "\n\n".join(doc_context_parts) + "\n\n" + text_prompt

    if not image_blocks:
        return full_text

    content: List[Dict[str, Any]] = list(image_blocks)
    content.append({"type": "text", "text": full_text})
    return content


def get_file_metadata(conversation_id: str, file_id: str) -> Optional[Dict[str, Any]]:
    """Look up a file by its ID and return metadata."""
    directory = UPLOADS_DIR / conversation_id
    if not directory.exists():
        return None

    for f in directory.iterdir():
        if f.stem == file_id or f.name.startswith(file_id):
            ext = f.suffix.lower()
            category = "image" if ext in IMAGE_EXTENSIONS else "document"
            return {
                "id": file_id,
                "filename": f.name,
                "path": str(f),
                "type": MIME_MAP.get(ext, "application/octet-stream"),
                "category": category,
                "size": f.stat().st_size,
            }

    return None


def list_uploads(conversation_id: str) -> List[Dict[str, Any]]:
    """List all uploaded files for a conversation."""
    directory = UPLOADS_DIR / conversation_id
    if not directory.exists():
        return []

    files = []
    for f in sorted(directory.iterdir()):
        ext = f.suffix.lower()
        if ext in ALLOWED_EXTENSIONS:
            category = "image" if ext in IMAGE_EXTENSIONS else "document"
            files.append({
                "id": f.stem,
                "filename": f.name,
                "type": MIME_MAP.get(ext, "application/octet-stream"),
                "category": category,
                "size": f.stat().st_size,
            })
    return files
