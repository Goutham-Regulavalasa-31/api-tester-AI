from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional, Any
import httpx
import time
import json

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
