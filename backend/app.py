from flask import Flask, request, jsonify, send_from_directory
from pathlib import Path
import os
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from openai import OpenAI


BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = (BASE_DIR / ".." / "frontend").resolve()
DB_PATH = BASE_DIR / "conversations.db"

# Load environment variables from .env (if present)
load_dotenv(BASE_DIR / ".env")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

app = Flask(
    __name__,
    static_folder=str(FRONTEND_DIR),
    static_url_path="",
)

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """
You are an experienced, patient, and motivating English teacher named "Robot".
Your goal is to help the student practice English conversation about any topic they choose,
including hobbies, studies, work, and daily life.

Rules:
1. Always respond in English. Do not use Portuguese or any other language.
2. Encourage the student to write or speak short sentences.
3. Ask open-ended questions so the student can choose the topic of conversation.
4. If the student explicitly asks to be corrected (e.g. "Can you correct me?" or "correct my mistakes"),
   call the `correct_grammar` tool with their sentence; otherwise do NOT correct them.
5. When it is natural to introduce a new word or phrase, call the `suggest_vocabulary` tool.
6. Be patient, encouraging, and praise the student's progress.
7. Keep your conversational replies between 5 and 10 words.
8. Start the conversation with a question about daily life: hobbies, studies, work, or daily routines.
""".strip()

# ---------------------------------------------------------------------------
# Agent tools (OpenAI function-calling)
# ---------------------------------------------------------------------------
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "correct_grammar",
            "description": (
                "Use this tool ONLY when the student explicitly asks for grammar correction. "
                "Provide the corrected sentence and a brief, encouraging explanation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "original": {
                        "type": "string",
                        "description": "The student's original sentence, exactly as written.",
                    },
                    "corrected": {
                        "type": "string",
                        "description": "The grammatically correct version of the sentence.",
                    },
                    "explanation": {
                        "type": "string",
                        "description": "A short, friendly explanation of what was fixed (max 20 words).",
                    },
                },
                "required": ["original", "corrected", "explanation"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_vocabulary",
            "description": (
                "Introduce a useful English word or phrase that fits naturally into the current topic. "
                "Use this at most once every few exchanges."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "word": {
                        "type": "string",
                        "description": "The English word or short phrase to teach.",
                    },
                    "meaning": {
                        "type": "string",
                        "description": "Simple definition in English (max 15 words).",
                    },
                    "example": {
                        "type": "string",
                        "description": "A short example sentence using the word.",
                    },
                },
                "required": ["word", "meaning", "example"],
            },
        },
    },
]

# ---------------------------------------------------------------------------
# In-memory conversation store  {session_id: [{"role": ..., "content": ...}]}
# _DB_LOCK serialises all SQLite writes so concurrent requests don't collide.
# ---------------------------------------------------------------------------
_CONVERSATIONS: dict[str, list[dict]] = {}
_DB_LOCK = threading.Lock()

# ---------------------------------------------------------------------------
# SQLite persistence helpers
# ---------------------------------------------------------------------------

def _init_db() -> None:
    with _DB_LOCK, sqlite3.connect(DB_PATH, check_same_thread=False) as conn:
        conn.execute("PRAGMA journal_mode=WAL")  # safe concurrent reads
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS conversations (
                id          TEXT PRIMARY KEY,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                messages    TEXT NOT NULL
            )
            """
        )
        conn.commit()


def _save_conversation(session_id: str, messages: list[dict]) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _DB_LOCK, sqlite3.connect(DB_PATH, check_same_thread=False) as conn:
        conn.execute(
            """
            INSERT INTO conversations (id, created_at, updated_at, messages)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at,
                                          messages   = excluded.messages
            """,
            (session_id, now, now, json.dumps(messages)),
        )
        conn.commit()


def _load_conversation(session_id: str) -> list[dict] | None:
    with sqlite3.connect(DB_PATH, check_same_thread=False) as conn:
        row = conn.execute(
            "SELECT messages FROM conversations WHERE id = ?", (session_id,)
        ).fetchone()
    return json.loads(row[0]) if row else None


def _get_history(session_id: str) -> list[dict]:
    """Return the in-memory history, loading from DB if needed."""
    if session_id not in _CONVERSATIONS:
        persisted = _load_conversation(session_id)
        _CONVERSATIONS[session_id] = persisted if persisted is not None else []
    return _CONVERSATIONS[session_id]


_init_db()

# ---------------------------------------------------------------------------
# Tool call handler — turns an OpenAI tool call into a plain result string
# ---------------------------------------------------------------------------

def _handle_tool_call(name: str, args: dict) -> str:
    if name == "correct_grammar":
        return (
            f'✏️ **Correction:** "{args["corrected"]}" — {args["explanation"]}'
        )
    if name == "suggest_vocabulary":
        return (
            f'📚 **New word:** *{args["word"]}* — {args["meaning"]} '
            f'Example: "{args["example"]}"'
        )
    return "Done."


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/session/new", methods=["POST"])
def new_session():
    """Create a fresh conversation session and return its ID."""
    session_id = str(uuid.uuid4())
    _CONVERSATIONS[session_id] = []
    _save_conversation(session_id, [])
    return jsonify({"session_id": session_id})


@app.route("/session/<session_id>/history", methods=["GET"])
def get_history(session_id: str):
    """Return the visible message history for a session (no system messages)."""
    history = _get_history(session_id)
    visible = [m for m in history if m.get("role") != "system"]
    return jsonify({"session_id": session_id, "history": visible})


@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    user_message = data.get("message", "").strip()
    session_id = data.get("session_id") or str(uuid.uuid4())

    if not user_message:
        reply = "Hello! I'm your English tutor. Let's practice English. Please say a sentence in English."
        return jsonify({"reply": reply, "session_id": session_id})

    # Demo mode — no API key
    if client is None:
        reply = (
            "Great sentence! (Demo mode – no real AI). "
            "Add your OpenAI API key in backend/.env to enable real responses."
        )
        return jsonify({"reply": reply, "session_id": session_id})

    history = _get_history(session_id)

    # Build the full message list for this request
    messages_to_send = (
        [{"role": "system", "content": SYSTEM_PROMPT}]
        + history
        + [{"role": "user", "content": user_message}]
    )

    try:
        # ---- First completion pass (may call tools) ----
        completion = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=messages_to_send,
            tools=TOOLS,
            tool_choice="auto",
        )

        response_msg = completion.choices[0].message
        tool_outputs: list[dict] = []
        extra_text: list[str] = []

        if response_msg.tool_calls:
            for tc in response_msg.tool_calls:
                fn_args = json.loads(tc.function.arguments)
                result_text = _handle_tool_call(tc.function.name, fn_args)
                extra_text.append(result_text)
                tool_outputs.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result_text,
                    }
                )

            # ---- Second pass: let the model incorporate the tool results ----
            completion2 = client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=messages_to_send
                + [response_msg]
                + tool_outputs,
            )
            final_text = completion2.choices[0].message.content.strip()
        else:
            final_text = response_msg.content.strip()

        # Combine any tool output cards with the final reply
        reply = "\n\n".join(extra_text + [final_text]) if extra_text else final_text

        # ---- Persist to in-memory + DB ----
        history.append({"role": "user", "content": user_message})
        history.append({"role": "assistant", "content": reply})

        # Keep only the last 40 messages (20 exchanges) to stay within token limits
        if len(history) > 40:
            _CONVERSATIONS[session_id] = history[-40:]
        else:
            _CONVERSATIONS[session_id] = history

        _save_conversation(session_id, _CONVERSATIONS[session_id])

    except Exception as exc:  # noqa: BLE001
        print(f"[chat] OpenAI error: {exc}")
        reply = (
            "Sorry, I had a problem reaching the tutor brain in the cloud. "
            "Please try again in a moment."
        )

    return jsonify({"reply": reply, "session_id": session_id})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5002, debug=True)

