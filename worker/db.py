"""공유 DB 연결 — Next.js와 동일한 SQLite/Postgres DB 사용"""

import os
from datetime import datetime, timedelta, timezone
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


def utcnow() -> datetime:
    """DB 에 넣을 현재 시각 — tz 없는 UTC.

    Prisma 는 timestamp(3) (타임존 없음) 컬럼을 UTC 로 읽고 쓴다. 컨테이너는
    TZ=Asia/Seoul 이라 datetime.now() 가 KST 벽시계를 주는데, 그걸 그대로 넣으면
    웹앱에는 9시간 뒤 시각으로 보인다 (알림이 목록 맨 위로 튀고, 당일 중복 판정·
    3일 정리 기준도 어긋난다). 장 시간 판단처럼 KST 가 필요한 곳만 datetime.now() 를 쓴다.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


def kst_day_start_utc() -> datetime:
    """오늘 KST 자정을 tz 없는 UTC 로 (웹앱 api/alerts 의 kstDayStart 와 같은 값)."""
    kst_now = datetime.now(timezone.utc) + timedelta(hours=9)
    kst_midnight = kst_now.replace(hour=0, minute=0, second=0, microsecond=0)
    return (kst_midnight - timedelta(hours=9)).replace(tzinfo=None)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
