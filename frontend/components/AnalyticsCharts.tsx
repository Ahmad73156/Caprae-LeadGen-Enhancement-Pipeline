'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import type { Lead } from './types';

interface AnalyticsChartsProps {
  leads: Lead[];
}

const SCORE_BUCKETS = [
  { label: '0-20', min: 0, max: 20 },
  { label: '21-40', min: 21, max: 40 },
  { label: '41-60', min: 41, max: 60 },
  { label: '61-80', min: 61, max: 80 },
  { label: '81-100', min: 81, max: 100 },
];

const QUALITY_COLORS: Record<string, string> = {
  'High Quality': '#5eead4',
  Medium: '#fcd34d',
  'Low Quality': '#fb7185',
};

function tooltipStyle() {
  return {
    background: 'rgba(15, 15, 25, 0.92)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '0.75rem',
    color: '#e2e8f0',
    fontSize: '0.8rem',
    backdropFilter: 'blur(12px)',
  };
}

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="crystal crystal-specular crystal-reflection p-5 sm:p-6">
      <p className="text-sm font-medium text-slate-200">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
      <div className="mt-4 h-56">{children}</div>
    </div>
  );
}

export default function AnalyticsCharts({ leads }: AnalyticsChartsProps) {
  const scoreDistribution = useMemo(
    () =>
      SCORE_BUCKETS.map((bucket) => ({
        label: bucket.label,
        count: leads.filter((l) => l.score >= bucket.min && l.score <= bucket.max).length,
      })),
    [leads]
  );

  const qualityBreakdown = useMemo(() => {
    const counts: Record<string, number> = {
      'High Quality': 0,
      Medium: 0,
      'Low Quality': 0,
    };
    leads.forEach((l) => {
      if (counts[l.quality] !== undefined) counts[l.quality] += 1;
    });
    return Object.entries(counts)
      .filter(([, value]) => value > 0)
      .map(([name, value]) => ({ name, value }));
  }, [leads]);

  const addedOverTime = useMemo(() => {
    const days = 14;
    const buckets = new Map<string, number>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = days - 1; i >= 0; i -= 1) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const key = date.toISOString().slice(5, 10); // MM-DD
      buckets.set(key, 0);
    }

    leads.forEach((lead) => {
      if (!lead.createdAt) return;
      const created = new Date(lead.createdAt);
      created.setHours(0, 0, 0, 0);
      const diffDays = Math.round((today.getTime() - created.getTime()) / 86400000);
      if (diffDays >= 0 && diffDays < days) {
        const key = created.toISOString().slice(5, 10);
        buckets.set(key, (buckets.get(key) || 0) + 1);
      }
    });

    return Array.from(buckets.entries()).map(([label, count]) => ({ label, count }));
  }, [leads]);

  if (leads.length === 0) return null;

  return (
    <section aria-label="Lead analytics" className="mt-6">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-slate-300">
        <BarChart3 size={15} strokeWidth={1.9} />
        Analytics
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard title="Score distribution" hint="How leads spread across the 0-100 scale">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={scoreDistribution} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} fill="#818cf8" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Quality breakdown" hint="Share of High / Medium / Low leads">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={qualityBreakdown}
                dataKey="value"
                nameKey="name"
                innerRadius="58%"
                outerRadius="85%"
                paddingAngle={3}
                stroke="none"
              >
                {qualityBreakdown.map((entry) => (
                  <Cell key={entry.name} fill={QUALITY_COLORS[entry.name] || '#818cf8'} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle()} />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
            {qualityBreakdown.map((entry) => (
              <span key={entry.name} className="flex items-center gap-1.5 text-xs text-slate-400">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: QUALITY_COLORS[entry.name] || '#818cf8' }}
                />
                {entry.name} ({entry.value})
              </span>
            ))}
          </div>
        </ChartCard>

        <ChartCard title="Added, last 14 days" hint="New leads processed per day">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={addedOverTime} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#94a3b8', fontSize: 10 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                tickLine={false}
                interval={1}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={tooltipStyle()} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} fill="#5eead4" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </section>
  );
}
