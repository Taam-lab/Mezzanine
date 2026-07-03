/**
 * Claude API로 CB 공시 본문에서 풋/콜옵션 조항을 구조화 추출.
 * tool_use를 강제해서 항상 JSON 구조로 응답받는다.
 */

export interface PutCallExtraction {
  putOptionStartDate?: string;
  putOptionEndDate?: string;
  putOptionRate?: number;
  callOptionStartDate?: string;
  callOptionEndDate?: string;
  callOptionRatio?: number;
  callOptionRate?: number;
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001"; // fast + cheap, extraction용으로 충분

const TOOL_SCHEMA = {
  name: "record_put_call_options",
  description:
    "Record extracted put option (조기상환청구권) and call option (매도청구권) terms from the Korean convertible bond disclosure text.",
  input_schema: {
    type: "object",
    properties: {
      putOptionStartDate: {
        type: "string",
        description:
          "First date s채권자 can exercise the put option (조기상환청구권 시작일). Format YYYY-MM-DD. Omit if not present in text.",
      },
      putOptionEndDate: {
        type: "string",
        description: "Last date of put option exercise window (조기상환청구권 종료일). YYYY-MM-DD. Omit if absent.",
      },
      putOptionRate: {
        type: "number",
        description:
          "Put option yield / 조기상환수익률 as a percentage (e.g. 4.0). Look for phrases like '수익률', '보장수익률', '조기상환 이율'. Omit if absent.",
      },
      callOptionStartDate: {
        type: "string",
        description:
          "First 매매대금 지급기일 in the call option (매도청구권 / Call Option) table. YYYY-MM-DD. Omit if absent.",
      },
      callOptionEndDate: {
        type: "string",
        description: "Last 매매대금 지급기일 in the call option table. YYYY-MM-DD. Omit if absent.",
      },
      callOptionRatio: {
        type: "number",
        description:
          "Call option exercise range (매도청구권 행사 범위) as a percentage of the bond face value (e.g. 30). Omit if absent.",
      },
      callOptionRate: {
        type: "number",
        description:
          "Annual rate used to compute the call option purchase price (매매가액 계산에 사용된 연 이율, e.g. 4.0). Omit if absent.",
      },
    },
    additionalProperties: false,
  },
} as const;

interface AnthropicMessagesResponse {
  content?: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; name: string; input: Record<string, unknown> }
  >;
  stop_reason?: string;
  error?: { message?: string };
}

export async function extractPutCallWithClaude(text: string): Promise<PutCallExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.");

  // 원문이 너무 길면 앞부분만 사용 (풋/콜 조항은 보통 발행조건 표 근처)
  const excerpt = text.slice(0, 30_000);

  const body = {
    model: MODEL,
    max_tokens: 1024,
    tools: [TOOL_SCHEMA],
    tool_choice: { type: "tool" as const, name: TOOL_SCHEMA.name },
    messages: [
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: `다음은 한국거래소 상장사의 메자닌 사채(전환사채 CB / 신주인수권부사채 BW / 교환사채 EB) 발행결정 공시 본문이다. \
조기상환청구권(풋옵션)과 매도청구권(콜옵션) 조항에서 아래 필드를 추출해서 record_put_call_options 툴을 호출하라. \
본문에 없는 필드는 아예 넣지 말고 생략할 것. 날짜는 YYYY-MM-DD로 정규화하라. \
"연 4.0%의 이율" 처럼 %가 붙은 숫자는 4.0 처럼 number로 반환하라. \
콜옵션의 경우 "매도청구권(Call Option) 매매대금 지급기일" 표에서 첫 행/마지막 행 날짜가 각각 시작/종료일이다. \
콜옵션 비율은 보통 "매도청구권 행사 범위" 문단에 "발행가액의 30%" 형식으로 나온다. \
콜옵션 금리는 매매가액 산식에서 "연 N%의 이율" 표현으로 나온다.\n\n---\n\n${excerpt}`,
          },
        ],
      },
    ],
  };

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });

  const data = (await res.json()) as AnthropicMessagesResponse;
  if (!res.ok) {
    throw new Error(`Anthropic HTTP ${res.status}: ${data.error?.message ?? "unknown"}`);
  }

  const toolUse = data.content?.find(
    (c): c is { type: "tool_use"; name: string; input: Record<string, unknown> } =>
      c.type === "tool_use" && c.name === TOOL_SCHEMA.name,
  );
  if (!toolUse) return {};

  const raw = toolUse.input;
  const result: PutCallExtraction = {};
  const strFields: Array<keyof PutCallExtraction> = [
    "putOptionStartDate",
    "putOptionEndDate",
    "callOptionStartDate",
    "callOptionEndDate",
  ];
  const numFields: Array<keyof PutCallExtraction> = [
    "putOptionRate",
    "callOptionRatio",
    "callOptionRate",
  ];
  for (const k of strFields) {
    const v = raw[k];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) result[k] = v as never;
  }
  for (const k of numFields) {
    const v = raw[k];
    if (typeof v === "number" && Number.isFinite(v)) result[k] = v as never;
  }
  return result;
}
