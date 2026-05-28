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
  investmentAmount: z.number().positive("투자금액은 0보다 커야 합니다.").optional(),
  issueAmount: z.number().positive("발행총액은 0보다 커야 합니다.").optional(),
  maturityDate: z.string().optional(),
  couponRate: z.number().min(0).max(100).optional(),
  ytm: z.number().min(0).max(100).optional(),
  initialConversionPrice: z.number().positive().optional(),
  minConversionPrice: z.number().positive().optional(),
  currentConversionPrice: z.number().positive().optional(),
  conversionStartDate: z.string().optional(),
  conversionEndDate: z.string().optional(),
  putOptionRate: z.number().min(0).max(100).optional(),
  putOptionStartDate: z.string().optional(),
  putOptionEndDate: z.string().optional(),
  callOptionRatio: z.number().min(0).max(100).optional(),
  callOptionStartDate: z.string().optional(),
  callOptionEndDate: z.string().optional(),
  callOptionRate: z.number().min(0).max(100).optional(),
  seriesNumber: z.number().int().positive().optional(),
  sourceDisclosureUrl: z.string().url().optional().or(z.literal("")),
  note: z.string().optional(),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type PositionInput = z.infer<typeof positionSchema>;
