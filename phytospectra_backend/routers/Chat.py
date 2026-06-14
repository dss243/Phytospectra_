import httpx
import logging
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import List
from core.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"

SYSTEM_PROMPT = """You are Phytospectra AI, an expert agricultural assistant specializing in crop monitoring,
drone imagery analysis, and precision agriculture. You help farmers and agronomists interpret field data,
understand crop stress indicators, and make data-driven decisions.

Format every reply for easy reading:
- Start with a short summary paragraph when helpful.
- Put a blank line between paragraphs.
- Use numbered lists (1. 2. 3.) for steps or multiple causes, with each item on its own line.
- Use bullet lists (- item) for short options or tips.
- Use **bold** for key terms or headings within a line.
Be concise, practical, and scientific."""


class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[Message]


class ChatResponse(BaseModel):
    reply: str
    model: str


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    if not settings.GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured")

    logger.info("Raw incoming messages (%d): %s", len(request.messages), [
        {"role": m.role, "content": m.content[:60]} for m in request.messages
    ])

    # Keep only valid roles
    messages = [m for m in request.messages if m.role in ("user", "assistant")]

    # Drop any leading assistant messages — Groq requires user first
    while messages and messages[0].role != "user":
        messages.pop(0)

    logger.info("Filtered messages (%d): %s", len(messages), [
        {"role": m.role, "content": m.content[:60]} for m in messages
    ])

    if not messages:
        raise HTTPException(status_code=400, detail="No user message found in conversation")

    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            *[{"role": m.role, "content": m.content} for m in messages],
        ],
        "temperature": 0.7,
        "max_tokens": 1024,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(
                GROQ_API_URL,
                headers={
                    "Authorization": f"Bearer {settings.GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            if not response.is_success:
                logger.error("Groq %s: %s", response.status_code, response.text)
                raise HTTPException(status_code=response.status_code, detail=response.text)
        except httpx.RequestError as e:
            raise HTTPException(status_code=503, detail=f"Groq API unreachable: {e}")

    data = response.json()
    reply = data["choices"][0]["message"]["content"]
    model_used = data.get("model", GROQ_MODEL)

    return ChatResponse(reply=reply, model=model_used)