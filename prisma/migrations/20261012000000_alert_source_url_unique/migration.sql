-- 같은 공시(rcpNo)에 대한 알림이 여러 건 쌓이는 문제.
--
-- 앱 레벨 dedup(findFirst 후 create)은 동시 요청을 막지 못한다. 두 요청이
-- 거의 동시에 들어오면 둘 다 "없음"을 보고 둘 다 INSERT 한다. 탭 두 개를 열거나
-- 대시보드가 두 번 로드되면 바로 재현된다. DB가 직접 막게 한다.
--
-- source_url 이 NULL 인 알림(PRICE_MOVE 등)은 영향 없다 — Postgres 는 UNIQUE
-- 에서 NULL 을 서로 다른 값으로 취급하므로 몇 개든 들어간다.

-- 1) 기존 중복 정리: (alert_type, source_url) 당 가장 먼저 생긴 행만 남긴다.
--    읽음 상태(alert_user_status)가 FK 로 물려 있으므로 먼저 지운다.
CREATE TEMP TABLE _dupe_alerts AS
SELECT id
FROM (
  SELECT id,
         row_number() OVER (
           PARTITION BY alert_type, source_url
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM alerts
  WHERE source_url IS NOT NULL
) ranked
WHERE rn > 1;

DELETE FROM alert_user_status WHERE alert_id IN (SELECT id FROM _dupe_alerts);
DELETE FROM alerts            WHERE id       IN (SELECT id FROM _dupe_alerts);

DROP TABLE _dupe_alerts;

-- 2) 이후로는 DB 가 막는다. 이름은 Prisma 의 @@unique([alertType, sourceUrl])
--    가 생성하는 이름과 맞춰 db:push 시 드리프트가 생기지 않게 한다.
CREATE UNIQUE INDEX IF NOT EXISTS "alerts_alert_type_source_url_key"
  ON "alerts" ("alert_type", "source_url");
