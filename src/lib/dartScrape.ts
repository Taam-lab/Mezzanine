/**
 * DART 공시 원문 스크래핑 (공개 뷰어)
 * 정형 API가 못 넘겨주는 조항(풋/콜 옵션 등)을 얻기 위해 사용.
 */

const BASE = "https://dart.fss.or.kr";

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/\s+/g, " ")
    .trim();
}

function isRealContent(text: string): boolean {
  const strong = (text.match(/이자율|만기일|납입일|전환가액|전환청구|행사가액|표면금리|수익률|사채의\s*권면|매도청구권|조기상환/g) ?? []).length;
  return strong >= 3 && text.length >= 500;
}

function relevanceScore(text: string): number {
  return (
    (text.match(/전환|사채|발행|이자율|만기|전환가|납입|매도청구|조기상환|풋옵션|콜옵션/g) ?? []).length
  );
}

function collectDocPatterns(html: string, docUrls: Set<string>, dcmNos: Set<string>): void {
  for (const m of html.matchAll(/<(?:frame|iframe)[^>]+src=["']([^"']+)["']/gi)) {
    const u = m[1].replace(/&amp;/g, "&").trim();
    if (u && !u.startsWith("javascript") && u !== "about:blank") {
      docUrls.add(u.startsWith("http") ? u : `${BASE}${u.startsWith("/") ? u : "/" + u}`);
    }
  }
  for (const m of html.matchAll(/["'(]([^"'()]*\/report\/viewer\.do\?[^"'()]+)["')]/gi)) {
    const u = m[1].replace(/&amp;/g, "&");
    docUrls.add(u.startsWith("http") ? u : `${BASE}${u}`);
  }
  const dcmPatterns = [
    /['"]?dcmNo['"]?\s*[:=,]\s*['"]?(\d{6,12})/gi,
    /name=["']dcmNo["']\s+value=["'](\d{6,12})["']/gi,
    /value=["'](\d{6,12})["']\s+name=["']dcmNo["']/gi,
    /data-(?:dcm|dcmno|dcm-no)=["'](\d{6,12})["']/gi,
    /(?:goView|viewDoc|fn_view|openDoc|viewReport|openPdfDownload|openSelected)\s*\(\s*['"]?\d*['"]?\s*,\s*['"]?(\d{6,12})/gi,
    /(?:goView|viewDoc|fn_view|openDoc|viewReport)\s*\(\s*['"]?(\d{6,12})/gi,
  ];
  for (const re of dcmPatterns) {
    for (const m of html.matchAll(re)) {
      if (m[1] && m[1].length >= 6) dcmNos.add(m[1]);
    }
  }
}

/**
 * DART 공개 뷰어에서 공시 본문 텍스트 추출.
 * 여러 viewer.do 후보 중 관련도 최고인 것을 반환.
 */
export async function fetchDisclosureBodyText(rcpNo: string): Promise<string> {
  const headers = { ...HEADERS };
  const mainUrl = `${BASE}/dsaf001/main.do?rcpNo=${rcpNo}`;
  const mainRes = await fetch(mainUrl, { signal: AbortSignal.timeout(10000), headers });
  if (!mainRes.ok) throw new Error(`DART viewer HTTP ${mainRes.status}`);
  const mainHtml = await mainRes.text();

  const setCookie = mainRes.headers.get("set-cookie");
  if (setCookie) headers["Cookie"] = setCookie.split(";")[0];

  const docUrls = new Set<string>();
  const dcmNos = new Set<string>();
  collectDocPatterns(mainHtml, docUrls, dcmNos);

  // sub.do (문서 인덱스) 병렬 조회
  try {
    const subRes = await fetch(`${BASE}/dsaf001/sub.do?rcpNo=${rcpNo}`, {
      signal: AbortSignal.timeout(8000),
      headers: { ...headers, Referer: mainUrl },
    });
    if (subRes.ok) {
      const subHtml = await subRes.text();
      collectDocPatterns(subHtml, docUrls, dcmNos);
    }
  } catch {
    // sub.do 실패는 무시
  }

  // dcmNo → viewer.do URL 조합
  for (const dcm of dcmNos) {
    for (const eleId of ["0", "1", "2"]) {
      docUrls.add(
        `${BASE}/report/viewer.do?rcpNo=${rcpNo}&dcmNo=${dcm}&eleId=${eleId}&offset=0&length=0&dtd=dart3.xsd`,
      );
    }
  }

  if (docUrls.size === 0) {
    throw new Error("본문 URL을 찾을 수 없습니다.");
  }

  const candidates = [...docUrls].slice(0, 12);
  const fetched = await Promise.allSettled(
    candidates.map(async (docUrl) => {
      const r = await fetch(docUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { ...headers, Referer: mainUrl },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ct = (r.headers.get("content-type") ?? "").toLowerCase();
      const html =
        ct.includes("euc-kr") || ct.includes("ks_c_5601")
          ? Buffer.from(await r.arrayBuffer()).toString("latin1")
          : await r.text();
      return htmlToText(html);
    }),
  );

  let bestText = "";
  let bestScore = 0;
  for (const r of fetched) {
    if (r.status !== "fulfilled") continue;
    const t = r.value;
    if (t.length < 200) continue;
    const score = relevanceScore(t);
    if (score > bestScore) {
      bestScore = score;
      bestText = t;
    }
  }

  if (!bestText || !isRealContent(bestText)) {
    throw new Error("본문 내용을 확인할 수 없습니다.");
  }
  return bestText;
}
