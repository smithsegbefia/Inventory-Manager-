import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { label: string; sales: number };

export default function SalesChart({ data, formatMoney }: { data: Point[]; formatMoney: (value: number) => string }) {
  return <ResponsiveContainer width="100%" height="100%">
    <AreaChart data={data} margin={{ top: 10, right: 6, left: -18, bottom: 0 }}>
      <defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#278b88" stopOpacity={0.2} /><stop offset="95%" stopColor="#278b88" stopOpacity={0} /></linearGradient></defs>
      <CartesianGrid stroke="#edf1f5" vertical={false} />
      <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#8290a2", fontSize: 12 }} dy={10} />
      <YAxis axisLine={false} tickLine={false} tick={{ fill: "#8290a2", fontSize: 11 }} tickFormatter={(value: number) => value === 0 ? "0" : `${value / 1000}k`} />
      <Tooltip formatter={(value) => formatMoney(Number(value))} contentStyle={{ borderRadius: 10, border: "1px solid #e8edf2", boxShadow: "0 8px 24px #102a4314" }} />
      <Area type="monotone" dataKey="sales" stroke="#278b88" strokeWidth={2.5} fill="url(#salesFill)" activeDot={{ r: 5, fill: "#278b88" }} />
    </AreaChart>
  </ResponsiveContainer>;
}
