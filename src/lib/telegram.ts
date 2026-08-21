import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";

interface TelegramCreds {
  bot_token: string;
  chat_id: string;
}

// integrations DB에서 telegram row 를 자주 읽는 걸 피하려고 프로세스 메모리 캐시.
// 관리자 페이지에서 갱신 후 재배포하면 초기화됨. TTL 5분.
let cache: { creds: TelegramCreds | null; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadCreds(): Promise<TelegramCreds | null> {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.creds;
  try {
    const row = await prisma.integration.findUnique({
      where: { serviceName: "telegram" },
    });
    if (!row || !row.isEnabled || !row.credentials) {
      cache = { creds: null, ts: Date.now() };
      return null;
    }
    const decrypted = decrypt(row.credentials);
    const parsed = JSON.parse(decrypted) as Partial<TelegramCreds>;
    if (!parsed.bot_token || !parsed.chat_id) {
      cache = { creds: null, ts: Date.now() };
      return null;
    }
    const creds: TelegramCreds = { bot_token: parsed.bot_token, chat_id: parsed.chat_id };
    cache = { creds, ts: Date.now() };
    return creds;
  } catch {
    cache = { creds: null, ts: Date.now() };
    return null;
  }
}

/** 명시적으로 캐시 무효화 (관리자 페이지 저장 후 즉시 반영용). */
export function invalidateTelegramCredsCache(): void {
  cache = null;
}

interface SendArgs {
  title: string;
  body?: string | null;
  severity: "CRITICAL" | "WARNING" | "INFO";
  sourceUrl?: string | null;
}

/**
 * 텔레그램으로 알림 전송. CRITICAL/WARNING 만 전송, INFO 는 스킵.
 * 실패해도 throw 하지 않음 (알림 저장이 실패로 롤백되면 안 됨).
 */
export async function sendTelegramAlert(a: SendArgs): Promise<{
  ok: boolean;
  reason?: string;
}> {
  if (a.severity !== "CRITICAL" && a.severity !== "WARNING") {
    return { ok: false, reason: "severity below threshold" };
  }

  const creds = await loadCreds();
  if (!creds) return { ok: false, reason: "not configured" };

  const emoji = a.severity === "CRITICAL" ? "🚨" : "⚠️";
  const severityLabel = a.severity === "CRITICAL" ? "긴급" : "중요";

  // Telegram MarkdownV2 는 이스케이프 지옥이라 그냥 HTML mode 사용.
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = [
    `${emoji} <b>[${severityLabel}] ${esc(a.title)}</b>`,
  ];
  if (a.body) lines.push("", esc(a.body));
  if (a.sourceUrl) lines.push("", `<a href="${esc(a.sourceUrl)}">🔗 원문 보기</a>`);

  const text = lines.join("\n");

  try {
    const res = await fetch(`https://api.telegram.org/bot${creds.bot_token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: creds.chat_id,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { ok: false, reason: `HTTP ${res.status} ${errText.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
