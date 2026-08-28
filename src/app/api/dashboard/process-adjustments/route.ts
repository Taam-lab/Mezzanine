import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchDisclosureBodyText } from "@/lib/dartScrape";
import {
  extractConversionAdjustment,
  isAdjustmentDisclosure,
} from "@/lib/conversionAdjustExtract";
import {
  fetchDartDisclosuresByCorpCode,
  resolveCorpCodeByRcpNo,
  type DartDisclosure,
} from "@/lib/dartDisclosures";
import { sendTelegramAlert } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * 보유 종목의 최근 공시 (DART OpenAPI 우선, corp_code 없으면 Naver 폴백) 를 스캔해
 * "전환가액 조정" 공시가 있으면 회차를 확인 후 자동으로 currentConversionPrice 조정 +
 * ConversionPriceHistory 기록 + CRITICAL 알림 (텔레그램 발송).
 */
// 프로세스 단위 스로틀: 여러 탭/기기가 동시에 대시보드를 열어도 lambda 하나당
// 15분에 1번만 실제 스캔. (DART 스크래핑 + 종목별 순차 fetch 라 비용이 큼)
let lastRunAt = 0;
const RUN_INTERVAL_MS = 15 * 60 * 1000;

export async function GET(req: NextRequest) {
  const force = new URL(req.url).searchParams.get("force") === "true";
  if (!force && Date.now() - lastRunAt < RUN_INTERVAL_MS) {
    return NextResponse.json({ skipped: true, reason: "throttled" });
  }
  lastRunAt = Date.now();

  const apiKey = process.env.DART_API_KEY;
  const positions = await prisma.position.findMany({
    where: { isActive: true },
    select: {
      id: true,
      underlyingTicker: true,
      underlyingCompanyName: true,
      mezzanineType: true,
      seriesNumber: true,
      corpCode: true,
      currentConversionPrice: true,
      initialConversionPrice: true,
      sourceDisclosureUrl: true,
    },
  });

  // 티커별 그룹핑 + corp_code 백필 (없는 종목만, 최대 1회 sourceDisclosureUrl 조회)
  const posByTicker = new Map<string, typeof positions>();
  for (const p of positions) {
    if (!/^\d{6}$/.test(p.underlyingTicker)) continue;
    const arr = posByTicker.get(p.underlyingTicker) ?? [];
    arr.push(p);
    posByTicker.set(p.underlyingTicker, arr);
  }

  // corp_code 백필: 티커별로 첫 번째 corp_code 를 찾아서 그 티커의 모든 포지션에 저장
  if (apiKey) {
    for (const [, tickerPositions] of posByTicker.entries()) {
      const existing = tickerPositions.find((p) => p.corpCode);
      if (existing) {
        // 같은 티커의 corp_code 없는 형제들에 복제
        for (const p of tickerPositions) {
          if (!p.corpCode && existing.corpCode) {
            p.corpCode = existing.corpCode;
            await prisma.position.update({
              where: { id: p.id },
              data: { corpCode: existing.corpCode },
            });
          }
        }
        continue;
      }
      // 하나도 없으면 sourceDisclosureUrl 로 resolve
      const withUrl = tickerPositions.find((p) => p.sourceDisclosureUrl);
      if (!withUrl?.sourceDisclosureUrl) continue;
      const rcpMatch = withUrl.sourceDisclosureUrl.match(/rcpNo=(\d+)/i);
      if (!rcpMatch) continue;
      const resolved = await resolveCorpCodeByRcpNo(rcpMatch[1], apiKey);
      if (!resolved) continue;
      for (const p of tickerPositions) {
        p.corpCode = resolved;
        await prisma.position.update({
          where: { id: p.id },
          data: { corpCode: resolved },
        });
      }
    }
  }

  const summary: Array<{
    ticker: string;
    source: "DART" | "NAVER" | "SKIP";
    processed: number;
    updated: number;
    errors: string[];
  }> = [];

  for (const [ticker, tickerPositions] of posByTicker.entries()) {
    const stat = {
      ticker,
      source: "SKIP" as "DART" | "NAVER" | "SKIP",
      processed: 0,
      updated: 0,
      errors: [] as string[],
    };
    try {
      const corpCode = tickerPositions[0]?.corpCode;
      let disclosures: DartDisclosure[] = [];
      if (corpCode && apiKey) {
        disclosures = await fetchDartDisclosuresByCorpCode(corpCode, apiKey, 30);
        stat.source = "DART";
      } else {
        // Naver 폴백
        disclosures = await scrapeNaverDisclosures(ticker);
        stat.source = "NAVER";
      }
      const candidates = disclosures.filter((d) => isAdjustmentDisclosure(d.title));

      for (const disc of candidates) {
        stat.processed++;
        const rcpNo = disc.rcpNo || extractRcpNo(disc.url);
        if (!rcpNo) continue;

        const existing = await prisma.disclosure.findUnique({
          where: { rceptNo: rcpNo },
          select: { id: true },
        });
        if (existing) continue;

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
          await prisma.disclosure.create({
            data: {
              positionId: matched.id,
              rceptNo: rcpNo,
              corpCode: corpCode ?? null,
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

        await prisma.$transaction(async (tx) => {
          const disclosureRow = await tx.disclosure.create({
            data: {
              positionId: matched.id,
              rceptNo: rcpNo,
              corpCode: corpCode ?? null,
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

  return NextResponse.json({
    totalUpdated: summary.reduce((s, r) => s + r.updated, 0),
    totalProcessed: summary.reduce((s, r) => s + r.processed, 0),
    tickers: summary.length,
    details: summary,
  });
}

// ─────────────────────────────────────────────
// Naver 폴백 (corp_code 없을 때만)
// ─────────────────────────────────────────────

async function scrapeNaverDisclosures(ticker: string): Promise<DartDisclosure[]> {
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

  const items: DartDisclosure[] = [];
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
    const rcpMatch = href.match(/rcpNo=(\d+)/i);
    const rcpNo = rcpMatch ? rcpMatch[1] : "";
    if (rcpMatch) href = `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcpNo}`;
    const title = t[2].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
    if (title && rcpNo) {
      items.push({
        title,
        reportName: title,
        url: href,
        rcpNo,
        date: "",
        isoDate: "",
      });
    }
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
  corpCode: string | null;
}

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
