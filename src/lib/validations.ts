import { z } from "zod";

export const signupSchema = z.object({
  email: z
    .string()
    .email("올바른 이메일 형식이 아닙니다.")
    .refine(
      (email) => {
        const allowed = (process.env.ALLOWED_DOMAINS || "miraeasset.com").split(",");
        return allowed.some((d) => email.endsWith("@" + d.trim()));
      },
      "미래에셋 이메일(@miraeasset.com)로만 가입 가능합니다."
    ),
  name: z.string().min(2, "이름은 2자 이상이어야 합니다.").max(50),
  password: z
    .string()
    .min(8, "비밀번호는 8자 이상이어야 합니다.")
    .regex(/^(?=.*[a-zA-Z])(?=.*[0-9])/, "영문과 숫자를 조합해야 합니다."),
});

export const loginSchema = z.object({
  email: z.string().email("올바른 이메일 형식이 아닙니다."),
  password: z.string().min(1, "비밀번호를 입력해주세요."),
});

/**
 * react-hook-form이 `valueAsNumber: true` 로 등록된 빈 input을 `NaN` 으로 넘기는데,
 * Zod의 `z.number()` 는 NaN 을 거부해서 optional이어도 저장이 막힌다.
 * NaN / "" / null / undefined 를 모두 undefined 로 정규화한 뒤 검증.
 */
const optionalNumber = (rule?: (n: z.ZodNumber) => z.ZodNumber) => {
  const base = z.number();
  return z.preprocess(
    (v: unknown) => {
      if (v === "" || v === null || v === undefined) return undefined;
      if (typeof v === "number" && Number.isNaN(v)) return undefined;
      return v;
    },
    (rule ? rule(base) : base).optional(),
  );
};

export const positionSchema = z.object({
  bondCode: z.string().optional(),
  assetName: z.string().min(1, "메자닌 자산명을 입력해주세요."),
  underlyingTicker: z
    .string()
    .min(6, "종목코드는 6자리입니다.")
    .max(6, "종목코드는 6자리입니다."),
  underlyingCompanyName: z.string().min(1, "회사명을 입력해주세요."),
  underlyingMarket: z.enum(["KOSPI", "KOSDAQ"]),
  mezzanineType: z.enum(["CB", "BW", "EB", "RCPS"]),
  issueDate: z.string().optional(),
  investmentType: z.enum(["DIRECT", "INDIRECT"]),
  investmentAmount: optionalNumber((n) => n.positive("투자금액은 0보다 커야 합니다.")),
  issueAmount: optionalNumber((n) => n.positive("발행총액은 0보다 커야 합니다.")),
  maturityDate: z.string().optional(),
  couponRate: optionalNumber((n) => n.min(0).max(100)),
  ytm: optionalNumber((n) => n.min(0).max(100)),
  initialConversionPrice: optionalNumber((n) => n.positive()),
  minConversionPrice: optionalNumber((n) => n.positive()),
  currentConversionPrice: optionalNumber((n) => n.positive()),
  conversionStartDate: z.string().optional(),
  conversionEndDate: z.string().optional(),
  putOptionRate: optionalNumber((n) => n.min(0).max(100)),
  putOptionStartDate: z.string().optional(),
  putOptionEndDate: z.string().optional(),
  callOptionRatio: optionalNumber((n) => n.min(0).max(100)),
  callOptionStartDate: z.string().optional(),
  callOptionEndDate: z.string().optional(),
  callOptionRate: optionalNumber((n) => n.min(0).max(100)),
  seriesNumber: optionalNumber((n) => n.int().positive()),
  sourceDisclosureUrl: z.string().url().optional().or(z.literal("")),
  note: z.string().optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PositionInput = z.infer<typeof positionSchema>;
