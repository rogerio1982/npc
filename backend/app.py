from flask import Flask, request, jsonify, send_from_directory
from pathlib import Path
import os

from dotenv import load_dotenv
from openai import OpenAI


BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = (BASE_DIR / ".." / "frontend").resolve()

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


@app.route("/")
def index():
    # Serve the frontend index.html
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    user_message = data.get("message", "").strip()

    if not user_message:
        reply = "Hello! I'm your English tutor. Let's practice English. Please say a sentence in English."
        return jsonify({"reply": reply})

    # If no real API key is configured, fall back to a simple, local rule-based reply
    if client is None:
        reply = (
            "Great sentence! (Demo mode, no real AI). "
            "Add your OpenAI API key in backend/.env to enable real ChatGPT answers."
        )
        return jsonify({"reply": reply})

    try:
        completion = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        """
    You are an experienced, patient, and motivating English teacher, call "robot".
    Your goal is to help the student practice English conversation about any topic they choose,
    including hobbies, studies, work, and daily life.

    Rules:
    1. Always respond in English. Do not use Portuguese or any other language.
    2. Encourage the student to write or speak short sentences.
    3. Ask open-ended questions so the student can choose the topic of conversation.
    4. Correct mistakes ONLY if the student explicitly asks for correction (e.g., "Can you correct me?").
    5. Be patient, encouraging, and praise the student's progress.
    6. Introduce new vocabulary and expressions naturally during the conversation.
    7. use answers between 5 and 10 words.
    8. start the conversation with a question related to daily life: hobbies, studies, work, and daily routines.
    """
                    ),
                },
                {"role": "user", "content": user_message},
            ],
        )
        reply = completion.choices[0].message.content.strip()
    except Exception as exc:  # noqa: BLE001
        print(f"[chat] OpenAI error: {exc}")
        reply = (
            "Sorry, I had a problem reaching the tutor brain in the cloud. "
            "Please try again in a moment."
        )

    return jsonify({"reply": reply})


if __name__ == "__main__":
    # Default development server
    app.run(host="127.0.0.1", port=5002, debug=True)

