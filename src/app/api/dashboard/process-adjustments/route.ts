import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchDisclosureBodyText } from "@/lib/dartScrape";
import {
  extractConversionAdjustment,
  isAdjustmentDisclosure,
} from "@/lib/conversionAdjustExtract";
import { sendTelegramAlert } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * 보유 종목의 최근 공시를 스캔해 "전환가액 조정" 공시가 있으면 회차를 확인 후
 * 자동으로 currentConversionPrice 조정 + ConversionPriceHistory 기록 + CRITICAL 알림.
 *
 * 처리 흐름:
 *   1. 활성 포지션 목록 (unique ticker)
 *   2. 각 티커의 Naver 공시 최근 목록 스크래핑
 *   3. 제목이 "전환가액 조정" 매칭인 것만 대상
 *   4. rcpNo 뽑아서 Disclosure 테이블에 이미 있으면 skip (dedup)
 *   5. DART 본문 스크래핑 + 파싱 → 회차, 조정 후 전환가, 조정일
 *   6. 해당 티커의 포지션 중 seriesNumber 일치 (또는 seriesNumber 없으면 유일 포지션에) 매칭
 *   7. 새 가격이 현재와 다르면:
 *        - position.currentConversionPrice 업데이트
 *        - Disclosure row 생성
 *        - ConversionPriceHistory row 생성 (Disclosure 링크)
 *        - Alert CRITICAL 생성 → Telegram 발송
 */
export async function GET(_req: NextRequest) {
  const positions = await prisma.position.findMany({
    where: { isActive: true },
    select: {
      id: true,
      underlyingTicker: true,
      underlyingCompanyName: true,
      mezzanineType: true,
      seriesNumber: true,
      currentConversionPrice: true,
      initialConversionPrice: true,
    },
  });

  // 티커별 포지션 그룹핑 (한 회사에 여러 회차)
  const posByTicker = new Map<string, typeof positions>();
  for (const p of positions) {
    if (!/^\d{6}$/.test(p.underlyingTicker)) continue;
    const arr = posByTicker.get(p.underlyingTicker) ?? [];
    arr.push(p);
    posByTicker.set(p.underlyingTicker, arr);
  }

  const summary: Array<{
    ticker: string;
    processed: number;
    updated: number;
    errors: string[];
  }> = [];

  for (const [ticker, tickerPositions] of posByTicker.entries()) {
    const stat = { ticker, processed: 0, updated: 0, errors: [] as string[] };
    try {
      const disclosures = await scrapeNaverDisclosures(ticker);
      const candidates = disclosures.filter((d) => isAdjustmentDisclosure(d.title));

      for (const disc of candidates) {
        stat.processed++;
        const rcpNo = extractRcpNo(disc.url);
        if (!rcpNo) continue;

        // dedup: 이미 처리된 rcpNo 는 skip
        const existing = await prisma.disclosure.findUnique({
          where: { rceptNo: rcpNo },
          select: { id: true },
        });
        if (existing) continue;

        // 본문 스크래핑 + 파싱
        let bodyText: string;
        try {
          bodyText = await fetchDisclosureBodyText(rcpNo);
        } catch (e) {
          stat.errors.push(`${rcpNo} 본문 실패: ${(e as Error).message.slice(0, 60)}`);
          continue;
        }
        const parsed = extractConversionAdjustment(bodyText);
        if (parsed.newPrice === null) {
          stat.errors.push(`${rcpNo} newPrice 파싱 실패`);
          continue;
        }

        // 회차 매칭: parsed.seriesNumber 가 있으면 그것과 일치, 없으면 회사에 포지션이 하나뿐일 때만 적용
        const matched = matchPositionBySeries(tickerPositions, parsed.seriesNumber);
        if (!matched) {
          stat.errors.push(
            `${rcpNo} 회차 매칭 실패 (파싱: ${parsed.seriesNumber ?? "?"})`,
          );
          continue;
        }

        const currentPrice =
          matched.currentConversionPrice ?? matched.initialConversionPrice ?? null;
        if (currentPrice !== null && Math.abs(currentPrice - parsed.newPrice) < 0.01) {
          // 이미 같은 값 — 그래도 Disclosure는 기록해서 다음 스캔에 dedup
          await prisma.disclosure.create({
            data: {
              positionId: matched.id,
              rceptNo: rcpNo,
              reportName: disc.title,
              reportType: "CONVERSION_PRICE_ADJUSTMENT",
              severity: "INFO",
              filedAt: parsed.adjustedAt ? new Date(parsed.adjustedAt) : new Date(),
              dartUrl: disc.url,
              parsedData: JSON.stringify(parsed),
            },
          });
          continue;
        }

        // 업데이트 트랜잭션
        await prisma.$transaction(async (tx) => {
          const disclosureRow = await tx.disclosure.create({
            data: {
              positionId: matched.id,
              rceptNo: rcpNo,
              reportName: disc.title,
              reportType: "CONVERSION_PRICE_ADJUSTMENT",
              severity: "CRITICAL",
              filedAt: parsed.adjustedAt ? new Date(parsed.adjustedAt) : new Date(),
              dartUrl: disc.url,
              parsedData: JSON.stringify(parsed),
            },
          });
          await tx.conversionPriceHistory.create({
            data: {
              positionId: matched.id,
              oldPrice: currentPrice ?? parsed.oldPrice ?? 0,
              newPrice: parsed.newPrice as number,
              adjustmentReason: parsed.reason,
              sourceDisclosureId: disclosureRow.id,
              adjustedAt: parsed.adjustedAt ? new Date(parsed.adjustedAt) : new Date(),
              isAutomatic: true,
            },
          });
          await tx.position.update({
            where: { id: matched.id },
            data: { currentConversionPrice: parsed.newPrice as number },
          });
          // Alert 저장 (Telegram 발송은 아래에서 별도)
          await tx.alert.create({
            data: {
              positionId: matched.id,
              alertType: "CONVERSION_PRICE_ADJUSTMENT",
              severity: "CRITICAL",
              title: `[${matched.underlyingCompanyName} ${matched.seriesNumber ?? ""}회 ${matched.mezzanineType}] 전환가액 조정: ${(
                currentPrice ?? 0
              ).toLocaleString()}원 → ${parsed.newPrice!.toLocaleString()}원`,
              body: parsed.reason ?? undefined,
              sourceUrl: disc.url,
            },
          });
        });

        // Telegram 발송 (fire-and-forget)
        sendTelegramAlert({
          severity: "CRITICAL",
          title: `[${matched.underlyingCompanyName} ${matched.seriesNumber ?? ""}회 ${matched.mezzanineType}] 전환가액 조정`,
          body: `${(currentPrice ?? 0).toLocaleString()}원 → ${parsed.newPrice!.toLocaleString()}원${
            parsed.reason ? `\n사유: ${parsed.reason}` : ""
          }${parsed.adjustedAt ? `\n적용일: ${parsed.adjustedAt}` : ""}`,
          sourceUrl: disc.url,
        }).catch(() => {});

        stat.updated++;
      }
    } catch (e) {
      stat.errors.push(`ticker ${ticker}: ${(e as Error).message.slice(0, 80)}`);
    }
    summary.push(stat);
  }

  const totalUpdated = summary.reduce((s, r) => s + r.updated, 0);
  const totalProcessed = summary.reduce((s, r) => s + r.processed, 0);
  return NextResponse.json({
    totalUpdated,
    totalProcessed,
    tickers: summary.length,
    details: summary,
  });
}

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

interface DiscMeta {
  title: string;
  url: string;
}

/** Naver 공시 목록 스크래핑 (feed API 로직 축소판). rcpNo 유지를 위해 URL 은 원본. */
async function scrapeNaverDisclosures(ticker: string): Promise<DiscMeta[]> {
  const url = `https://finance.naver.com/item/news_notice.naver?code=${ticker}&page=1`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(5000),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const buf = await res.arrayBuffer();
  const ct = res.headers.get("content-type") || "";
  const charsetMatch = ct.match(/charset=([\w\-]+)/i);
  let enc = charsetMatch ? charsetMatch[1].toLowerCase() : "";
  if (!enc) {
    const sniff = new TextDecoder("latin1").decode(buf.slice(0, 2048));
    const metaMatch = sniff.match(/<meta[^>]+charset=["']?([\w\-]+)/i);
    enc = metaMatch ? metaMatch[1].toLowerCase() : "euc-kr";
  }
  let html: string;
  try {
    html = new TextDecoder(enc).decode(buf);
  } catch {
    html = new TextDecoder("utf-8").decode(buf);
  }

  const items: DiscMeta[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null && items.length < 15) {
    const row = m[1];
    if (!row.includes('class="title"')) continue;
    const t = row.match(
      /<td[^>]*class=["']?title["']?[^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/,
    );
    if (!t) continue;
    let href = t[1];
    if (href.startsWith("/")) href = `https://finance.naver.com${href}`;
    const title = t[2].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
    if (title) items.push({ title, url: href });
  }
  return items;
}

function extractRcpNo(url: string): string | null {
  const m = url.match(/rcpNo=(\d+)/i);
  return m ? m[1] : null;
}

interface PosSlim {
  id: string;
  underlyingCompanyName: string;
  mezzanineType: string;
  seriesNumber: number | null;
  currentConversionPrice: number | null;
  initialConversionPrice: number | null;
}

/**
 * 회차 매칭.
 *   - parsed 회차가 있고 포지션 회차와 정확히 일치하면 그 포지션
 *   - parsed 회차가 없고 티커에 활성 포지션이 1개뿐이면 그 포지션 (안전한 fallback)
 *   - 그 외는 null (모호해서 자동 적용 안 함)
 */
function matchPositionBySeries(
  positions: PosSlim[],
  parsedSeries: number | null,
): PosSlim | null {
  if (parsedSeries !== null) {
    const hit = positions.find((p) => p.seriesNumber === parsedSeries);
    if (hit) return hit;
    return null;
  }
  if (positions.length === 1) return positions[0];
  return null;
}
