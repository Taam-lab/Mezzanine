"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

export interface PricePoint {
  date: string;
  price: number;
}

/**
 * 주가 차트. recharts 는 ~110KB 로 상세 페이지 번들의 절반을 차지하는데
 * 정작 스크롤 아래에 있어 첫 페인트에 필요하지 않다.
 * 이 파일을 next/dynamic(ssr:false) 로 불러 초기 번들에서 제외한다.
 */
export default function PriceChart({
  data,
  conversionPrice,
}: {
  data: PricePoint[];
  conversionPrice?: number | null;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => v.toLocaleString()}
          domain={["auto", "auto"]}
        />
        <Tooltip
          formatter={(v: unknown) => [(v as number).toLocaleString() + "원", "주가"]}
        />
        {conversionPrice && (
          <ReferenceLine
            y={conversionPrice}
            stroke="#FF6B35"
            strokeDasharray="4 4"
            label={{ value: "전환가", position: "right", fontSize: 10 }}
          />
        )}
        <Line type="monotone" dataKey="price" stroke="#0A2A5E" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
