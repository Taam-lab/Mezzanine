"""공유 DB 연결 — Next.js와 동일한 SQLite/Postgres DB 사용"""

import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./dev.db")

# sqlite -> sqlite+aiosqlite, postgresql -> postgresql+asyncpg
if DATABASE_URL.startswith("sqlite:"):
    DATABASE_URL = DATABASE_URL.replace("sqlite:", "sqlite+aiosqlite:", 1)
elif DATABASE_URL.startswith("postgresql:"):
    DATABASE_URL = DATABASE_URL.replace("postgresql:", "postgresql+asyncpg:", 1)
elif DATABASE_URL.startswith("file:"):
    path = DATABASE_URL.replace("file:", "").replace("./", "")
    DATABASE_URL = f"sqlite+aiosqlite:///{path}"

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
Base = declarative_base()


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
