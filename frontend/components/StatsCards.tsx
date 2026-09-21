'use client';

import { useEffect, useRef, useState } from 'react';
import { Database, MailCheck, Gauge, Sparkles } from 'lucide-react';
import type { LeadStats } from './types';

interface StatsCardsProps {
  stats: LeadStats;
  loading?: boolean;
}

interface CardSpec {
  key: keyof LeadStats;
  label: string;
  hint: string;
  suffix?: string;
  icon: typeof Database;
  glow: string;
  tint: string;
}

const CARDS: CardSpec[] = [
  {
    key: 'totalLeads',
    label: 'Leads processed',
    hint: 'Everything in the pipeline',
    icon: Database,
    glow: 'rgba(129,140,248,0.45)',
    tint: 'text-indigo-200',
  },
  {
    key: 'mxVerifiedRate',
    label: 'Mail servers confirmed',
    hint: 'Share with working MX records',
    suffix: '%',
    icon: MailCheck,
    glow: 'rgba(45,212,191,0.4)',
    tint: 'text-teal-200',
  },
  {
    key: 'averageScore',
    label: 'Average score',
    hint: 'Across every stored lead',
    icon: Gauge,
    glow: 'rgba(252,211,77,0.35)',
    tint: 'text-amber-200',
  },
  {
    key: 'highQualityCount',
    label: 'Ready to contact',
    hint: 'Scoring 80 and above',
    icon: Sparkles,
    glow: 'rgba(217,70,239,0.35)',
    tint: 'text-fuchsia-200',
  },
];

/** Counts up to a target value once, then tracks it directly. */
function useCountUp(target: number, duration = 700) {
  const [value, setValue] = useState(target);
  const previous = useRef(target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const from = previous.current;
    const to = target;
    previous.current = target;

    if (from === to) {
      setValue(to);
      return;
    }

    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setValue(to);
      return;
    }

    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(from + (to - from) * eased));
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [target, duration]);

  return value;
}

function StatCard({
  spec,
  value,
  loading,
}: {
  spec: CardSpec;
  value: number;
  loading?: boolean;
}) {
  const animated = useCountUp(value);
  const Icon = spec.icon;

  return (
    <article className="crystal crystal-specular crystal-reflection group overflow-hidden p-5 sm:p-6">
      <div
        className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full opacity-70 blur-3xl"
        style={{ background: spec.glow }}
        aria-hidden="true"
      />

      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-400">{spec.label}</p>
          <p className="mt-3 text-metric tabular font-semibold text-white">
            {loading ? (
              <span className="inline-block h-8 w-20 animate-pulse rounded-lg bg-white/10" />
            ) : (
              <>
                {animated.toLocaleString()}
                {spec.suffix ? (
                  <span className="ml-0.5 text-xl text-slate-400">{spec.suffix}</span>
                ) : null}
              </>
            )}
          </p>
          <p className="mt-2 text-xs text-slate-500">{spec.hint}</p>
        </div>

        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.07] ${spec.tint}`}
        >
          <Icon size={18} strokeWidth={1.75} />
        </span>
      </div>
    </article>
  );
}

export default function StatsCards({ stats, loading }: StatsCardsProps) {
  return (
    <section
      aria-label="Pipeline summary"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {CARDS.map((spec) => (
        <StatCard
          key={spec.key}
          spec={spec}
          value={Number(stats[spec.key] ?? 0)}
          loading={loading}
        />
      ))}
    </section>
  );
}
