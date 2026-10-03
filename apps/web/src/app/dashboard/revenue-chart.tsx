'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { money } from './dashboard-format';

export type MonthlyRevenue = {
  month: string;
  personalRevenue: number;
  companyRevenue: number;
};

export default function RevenueChart({ data }: { data: MonthlyRevenue[] }) {
  // Il grafico è caricato solo nel browser: window è sempre disponibile.
  const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="crmCompanyRevenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.28} />
            <stop offset="92%" stopColor="#38bdf8" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="crmPersonalRevenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.22} />
            <stop offset="92%" stopColor="#a78bfa" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--crm-line)" strokeDasharray="3 5" vertical={false} />
        <XAxis
          dataKey="month"
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--crm-muted)', fontSize: 12 }}
          tickMargin={12}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--crm-muted)', fontSize: 11 }}
          tickMargin={10}
          tickFormatter={(value: number) => value >= 1000 ? `€${(value / 1000).toFixed(0)}k` : `€${value}`}
        />
        <Tooltip
          cursor={{ stroke: 'var(--crm-accent)', strokeDasharray: '4 4' }}
          contentStyle={{ background: 'var(--crm-surface-raised)', border: '1px solid var(--crm-line)', borderRadius: 12, color: 'var(--crm-text)' }}
          labelStyle={{ color: 'var(--crm-muted)' }}
          formatter={(value, name) => [
            money(Number(value)),
            name === 'companyRevenue' ? 'Totale azienda' : 'Le mie vendite',
          ]}
        />
        <Area
          type="monotone"
          dataKey="companyRevenue"
          stroke="#38bdf8"
          strokeWidth={3}
          fill="url(#crmCompanyRevenueFill)"
          dot={{ fill: '#38bdf8', stroke: 'var(--crm-bg)', strokeWidth: 2, r: 3 }}
          activeDot={{ r: 5, fill: '#38bdf8', stroke: 'var(--crm-bg)', strokeWidth: 2 }}
          isAnimationActive={animate}
          animationDuration={800}
        />
        <Area
          type="monotone"
          dataKey="personalRevenue"
          stroke="#a78bfa"
          strokeWidth={2.5}
          fill="url(#crmPersonalRevenueFill)"
          dot={{ fill: '#a78bfa', stroke: 'var(--crm-bg)', strokeWidth: 2, r: 3 }}
          activeDot={{ r: 5, fill: '#a78bfa', stroke: 'var(--crm-bg)', strokeWidth: 2 }}
          isAnimationActive={animate}
          animationDuration={800}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
