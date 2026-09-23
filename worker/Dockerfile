# Mezzanine Watch — Python Worker
#
# 5분마다 네이버/pykrx 시세와 DART 공시를 수집해 DB(price_snapshots, alerts,
# disclosures)에 적재한다. 웹앱이 서드파티를 실시간으로 때리지 않아도 되도록
# 하는 것이 목적이다.
#
# slim 이미지를 쓰는 이유: pdfplumber(공시 PDF 파싱)와 pykrx(pandas/numpy 의존)가
# alpine 의 musl 환경에서 휠을 못 찾아 소스 빌드로 떨어진다.
FROM python:3.11-slim

# APScheduler 의 cron 은 컨테이너 로컬 타임존을 따른다.
# main.py 의 daily_close 는 hour=16 (장 마감 후 종가 확정) 인데, TZ 를 지정하지
# 않으면 컨테이너가 UTC 라서 KST 새벽 1시 30분에 돈다. 반드시 서울로 고정.
ENV TZ=Asia/Seoul
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# 빌드 의존성: pdfplumber 가 쓰는 cryptography 휠이 없을 때의 폴백용
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc tzdata \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

# 의존성만 먼저 복사해 레이어 캐시를 살린다
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y gcc && apt-get autoremove -y

COPY . .

# 플랫폼(Railway/Render)이 $PORT 를 주입한다. 없으면 8001.
ENV PORT=8001
EXPOSE 8001

# main.py 의 __main__ 블록은 reload=True 라 개발 전용이다.
# 운영에서는 uvicorn 을 직접 띄운다.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001}"]
