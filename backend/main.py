from fastapi import FastAPI, HTTPException, Depends  # type: ignore[import]
from fastapi.middleware.cors import CORSMiddleware  # type: ignore[import]
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials  # type: ignore[import]
from pydantic import BaseModel  # type: ignore[import]
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime  # type: ignore[import]
from sqlalchemy.ext.declarative import declarative_base  # type: ignore[import]
from sqlalchemy.orm import sessionmaker, Session  # type: ignore[import]
from passlib.context import CryptContext  # type: ignore[import]
from jose import JWTError, jwt  # type: ignore[import]
from datetime import datetime, timedelta
from typing import Optional, Any
import httpx
import time
import json
import os
import anthropic  # type: ignore[import]

# ─── Database setup ────────────────────────────────────────────────────────────

DATABASE_URL = "sqlite:///./deviq.db"

# check_same_thread=False is required for SQLite when used with FastAPI
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
Base = declarative_base()


# ─── Database models ───────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id         = Column(Integer, primary_key=True, index=True)
    username   = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class UserData(Base):
    """Key-value store for per-user app data (history, collections, env vars, etc.)"""
    __tablename__ = "user_data"

    id      = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    key     = Column(String, nullable=False)   # e.g. "history", "collections"
    value   = Column(Text, default="null")     # JSON-encoded value


Base.metadata.create_all(bind=engine)


# ─── Auth setup ────────────────────────────────────────────────────────────────

SECRET_KEY  = "deviq-secret-key-change-in-production"
ALGORITHM   = "HS256"
TOKEN_EXPIRE_MINUTES = 60 * 24 * 7   # 7 days

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer      = HTTPBearer()


# ─── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="DevIQ API Tester")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── DB dependency ─────────────────────────────────────────────────────────────

def get_db():
    """Yield a database session and guarantee it closes even if an error occurs."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─── Auth helpers ──────────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_token(user_id: int) -> str:
    expires = datetime.utcnow() + timedelta(minutes=TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": str(user_id), "exp": expires}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    """FastAPI dependency — decode the JWT and return the matching User row."""
    try:
        payload  = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id  = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ─── Pydantic schemas ──────────────────────────────────────────────────────────

class AuthRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str


class DataRequest(BaseModel):
    value: Any   # accepts any JSON-serialisable value


class APIRequest(BaseModel):
    method:  str
    url:     str
    headers: Optional[dict] = {}
    body:    Optional[dict] = None
    params:  Optional[dict] = {}


class APIResponse(BaseModel):
    status_code:      int
    headers:          dict
    body:             str
    response_time_ms: float
    success:          bool


# ─── Auth endpoints ────────────────────────────────────────────────────────────

@app.post("/auth/register", response_model=TokenResponse)
def register(req: AuthRequest, db: Session = Depends(get_db)):
    if len(req.username.strip()) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if db.query(User).filter(User.username == req.username.strip()).first():
        raise HTTPException(status_code=400, detail="Username already taken")

    user = User(username=req.username.strip(), password_hash=hash_password(req.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return TokenResponse(access_token=create_token(user.id), username=user.username)


@app.post("/auth/login", response_model=TokenResponse)
def login(req: AuthRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username.strip()).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return TokenResponse(access_token=create_token(user.id), username=user.username)


@app.get("/auth/me")
def me(current_user: User = Depends(get_current_user)):
    return {"id": current_user.id, "username": current_user.username}


# ─── User data endpoints ───────────────────────────────────────────────────────
# One generic key/value API handles all app data types:
# history · collections · env_vars · auth_config · test_script

@app.get("/data/{key}")
def get_data(
    key: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = (
        db.query(UserData)
        .filter(UserData.user_id == current_user.id, UserData.key == key)
        .first()
    )
    return {"value": json.loads(row.value) if row else None}


@app.put("/data/{key}")
def set_data(
    key: str,
    req: DataRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = (
        db.query(UserData)
        .filter(UserData.user_id == current_user.id, UserData.key == key)
        .first()
    )
    if row:
        row.value = json.dumps(req.value)
    else:
        db.add(UserData(user_id=current_user.id, key=key, value=json.dumps(req.value)))
    db.commit()
    return {"ok": True}


# ─── Execute endpoint ──────────────────────────────────────────────────────────

@app.post("/execute", response_model=APIResponse)
async def execute_request(
    request: APIRequest,
    current_user: User = Depends(get_current_user),
):
    start = time.time()

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.request(
            method=request.method.upper(),
            url=request.url,
            headers=request.headers,
            json=request.body if request.body else None,
            params=request.params,
        )

    return APIResponse(
        status_code=response.status_code,
        headers=dict(response.headers),
        body=response.text,
        response_time_ms=round((time.time() - start) * 1000, 2),
        success=200 <= response.status_code < 300,
    )


@app.get("/")
def health():
    return {"status": "DevIQ API running"}


# ─── AI schemas ────────────────────────────────────────────────────────────────

class AIGenerateRequest(BaseModel):
    prompt: str

class AIDebugRequest(BaseModel):
    method:           str
    url:              str
    status_code:      int
    response_body:    str
    response_time_ms: float

class AIExplainRequest(BaseModel):
    method:           str
    url:              str
    status_code:      int
    response_body:    str
    response_headers: dict


# ─── AI helper ─────────────────────────────────────────────────────────────────

def get_ai_client() -> anthropic.Anthropic:
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        raise HTTPException(
            status_code=503,
            detail="AI features are disabled — set ANTHROPIC_API_KEY in the backend environment.",
        )
    return anthropic.Anthropic(api_key=key)


AI_MODEL = "claude-haiku-4-5-20251001"


# ─── AI endpoints ──────────────────────────────────────────────────────────────

@app.post("/ai/generate")
def ai_generate(
    req: AIGenerateRequest,
    current_user: User = Depends(get_current_user),
):
    client = get_ai_client()
    msg = client.messages.create(
        model=AI_MODEL,
        max_tokens=512,
        messages=[{
            "role": "user",
            "content": (
                "You are an API request generator. Convert this plain-English description into an API request.\n\n"
                f"Description: {req.prompt}\n\n"
                "Respond with ONLY a JSON object — no markdown fences, no explanation — in this exact shape:\n"
                '{"method":"GET","url":"https://example.com/path","headers":[{"key":"Content-Type","value":"application/json","enabled":true}],"body":""}\n\n'
                "Rules:\n"
                "- method: one of GET POST PUT DELETE PATCH\n"
                "- url: a realistic URL — guess if not specified\n"
                "- headers: include Content-Type: application/json when there is a body\n"
                "- body: a JSON string or empty string\n"
                "- Return ONLY the JSON object."
            ),
        }],
    )
    raw = msg.content[0].text.strip()
    # strip accidental markdown fences
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="AI returned an unparseable response — try rephrasing.")


@app.post("/ai/debug")
def ai_debug(
    req: AIDebugRequest,
    current_user: User = Depends(get_current_user),
):
    client = get_ai_client()
    msg = client.messages.create(
        model=AI_MODEL,
        max_tokens=768,
        messages=[{
            "role": "user",
            "content": (
                "You are an API debugging expert. Analyse this failed request and explain what went wrong.\n\n"
                f"Request: {req.method} {req.url}\n"
                f"Status: {req.status_code}\n"
                f"Response time: {req.response_time_ms}ms\n"
                f"Response body:\n{req.response_body[:2000]}\n\n"
                "Provide:\n"
                "**What went wrong** — one sentence summary\n"
                "**Likely causes** — 2-3 bullet points\n"
                "**How to fix it** — concrete steps\n\n"
                "Be concise and practical. Use markdown."
            ),
        }],
    )
    return {"analysis": msg.content[0].text}


@app.post("/ai/explain")
def ai_explain(
    req: AIExplainRequest,
    current_user: User = Depends(get_current_user),
):
    client = get_ai_client()
    ct = next(
        (v for k, v in req.response_headers.items() if k.lower() == "content-type"),
        "unknown",
    )
    msg = client.messages.create(
        model=AI_MODEL,
        max_tokens=768,
        messages=[{
            "role": "user",
            "content": (
                "You are an API response explainer. Explain this response to a developer.\n\n"
                f"Request: {req.method} {req.url}\n"
                f"Status: {req.status_code}\n"
                f"Content-Type: {ct}\n"
                f"Response body:\n{req.response_body[:2000]}\n\n"
                "Provide:\n"
                "**Summary** — what this response means in one sentence\n"
                "**Key fields** — explain the important fields in the data\n"
                "**Next steps** — what a developer would typically do with this\n\n"
                "Be concise and practical. Use markdown."
            ),
        }],
    )
    return {"explanation": msg.content[0].text}
