'use client';

import { Fragment, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Ban,
  ChevronDown,
  Download,
  Inbox,
  Loader2,
  Search,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { Lead, Quality } from './types';

interface LeadTableProps {
  leads: Lead[];
  loading?: boolean;
  onDelete: (id: string) => Promise<void> | void;
  onEnrich: (id: string) => Promise<void> | void;
}

type SortKey = 'score' | 'company' | 'email' | 'createdAt';
type SortDirection = 'asc' | 'desc';

const QUALITY_FILTERS: Array<'All' | Quality> = [
  'All',
  'High Quality',
  'Medium',
  'Low Quality',
];

function qualityPillClass(quality: Quality) {
  if (quality === 'High Quality') return 'pill pill-high';
  if (quality === 'Medium') return 'pill pill-medium';
  return 'pill pill-low';
}

function scoreBarClass(score: number) {
  if (score >= 80) return 'bg-teal-300/80';
  if (score >= 50) return 'bg-amber-300/80';
  return 'bg-rose-400/80';
}

function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function MxBadge({ lead }: { lead: Lead }) {
  if (lead.mxVerified) {
    return (
      <span className="pill pill-high">
        <ShieldCheck size={12} strokeWidth={2} />
        Verified
      </span>
    );
  }

  if (lead.disposable) {
    return (
      <span className="pill pill-low">
        <Ban size={12} strokeWidth={2} />
        Disposable
      </span>
    );
  }

  if (lead.mxStatus === 'error') {
    return (
      <span className="pill pill-medium">
        <TriangleAlert size={12} strokeWidth={2} />
        Check failed
      </span>
    );
  }

  return (
    <span className="pill pill-low">
      <ShieldX size={12} strokeWidth={2} />
      No mail server
    </span>
  );
}

export default function LeadTable({ leads, loading, onDelete, onEnrich }: LeadTableProps) {
  const [query, setQuery] = useState('');
  const [quality, setQuality] = useState<'All' | Quality>('All');
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const filtered = leads.filter((lead) => {
      if (quality !== 'All' && lead.quality !== quality) return false;
      if (!needle) return true;
      return [lead.company, lead.domain, lead.email, lead.industry]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });

    const direction = sortDirection === 'asc' ? 1 : -1;

    return [...filtered].sort((a, b) => {
      if (sortKey === 'score') return (a.score - b.score) * direction;
      if (sortKey === 'createdAt') {
        return (
          (new Date(a.createdAt || 0).getTime() -
            new Date(b.createdAt || 0).getTime()) *
          direction
        );
      }
      return (
        String(a[sortKey] || '').localeCompare(String(b[sortKey] || '')) * direction
      );
    });
  }, [leads, query, quality, sortKey, sortDirection]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection(key === 'score' || key === 'createdAt' ? 'desc' : 'asc');
    }
  };

  const exportCsv = () => {
    const headers = [
      'Company',
      'Contact',
      'Domain',
      'Email',
      'Email source',
      'Industry',
      'Detected industry',
      'Syntax valid',
      'MX status',
      'Mail servers',
      'Disposable',
      'Score',
      'Quality',
      'Source',
      'Added',
    ];

    const rows = visible.map((lead) => [
      lead.company,
      [lead.contactFirstName, lead.contactLastName].filter(Boolean).join(' '),
      lead.domain,
      lead.email,
      lead.emailSource === 'pattern-guess'
        ? 'Discovered (' + (lead.emailConfidence || 'unconfirmed') + ')'
        : 'Provided',
      lead.industry || '',
      lead.enrichment?.detectedIndustry || '',
      lead.syntaxValid ? 'yes' : 'no',
      lead.mxStatus,
      (lead.mxRecords || []).join(' | '),
      lead.disposable ? 'yes' : 'no',
      lead.score,
      lead.quality,
      lead.source,
      lead.createdAt ? new Date(lead.createdAt).toISOString() : '',
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map(csvEscape).join(','))
      .join('\r\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download =
      'caprae-leads-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      await onDelete(id);
      if (expanded === id) setExpanded(null);
    } finally {
      setDeletingId(null);
    }
  };

  const enrich = async (id: string) => {
    setEnrichingId(id);
    try {
      await onEnrich(id);
    } finally {
      setEnrichingId(null);
    }
  };

  const SortArrow = sortDirection === 'asc' ? ArrowUp : ArrowDown;

  return (
    <section className="crystal-lg crystal-specular overflow-hidden">
      <header className="flex flex-col gap-4 p-6 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-white">
            Verified leads
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {visible.length} of {leads.length} shown
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search
              size={15}
              strokeWidth={1.9}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <input
              className="crystal-input pl-10"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search company, domain or email"
              aria-label="Search leads"
            />
          </div>

          <div className="flex rounded-2xl border border-white/10 bg-white/[0.04] p-1 backdrop-blur-xl">
            {QUALITY_FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setQuality(option)}
                className={`rounded-xl px-3 py-2 text-xs transition-colors duration-200 ease-crystal ${
                  quality === option
                    ? 'border border-white/[0.15] bg-white/10 text-white'
                    : 'border border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {option === 'All' ? 'All' : option.replace(' Quality', '')}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={exportCsv}
            disabled={visible.length === 0}
            className="crystal-button px-4 py-2.5"
          >
            <Download size={15} strokeWidth={1.9} />
            Export CSV
          </button>
        </div>
      </header>

      <div className="divider-soft" />

      {loading ? (
        <div className="flex items-center justify-center gap-3 px-6 py-20 text-sm text-slate-400">
          <Loader2 size={16} strokeWidth={2} className="animate-spin" />
          Loading leads
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-slate-400">
            <Inbox size={20} strokeWidth={1.75} />
          </span>
          <p className="text-sm text-slate-300">
            {leads.length === 0
              ? 'No leads yet. Add one above to start the pipeline.'
              : 'Nothing matches that search.'}
          </p>
          {leads.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setQuality('All');
              }}
              className="text-sm text-indigo-300 underline decoration-indigo-400/40 underline-offset-4 hover:text-indigo-200"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-left">
            <thead>
              <tr className="bg-white/[0.03] text-xs text-slate-400">
                <th className="px-6 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort('company')}
                    className="inline-flex items-center gap-1.5 hover:text-slate-200"
                  >
                    Company
                    {sortKey === 'company' ? <SortArrow size={12} /> : null}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">Domain</th>
                <th className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort('email')}
                    className="inline-flex items-center gap-1.5 hover:text-slate-200"
                  >
                    Email
                    {sortKey === 'email' ? <SortArrow size={12} /> : null}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">Mail server</th>
                <th className="px-4 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort('score')}
                    className="inline-flex items-center gap-1.5 hover:text-slate-200"
                  >
                    Score
                    {sortKey === 'score' ? <SortArrow size={12} /> : null}
                  </button>
                </th>
                <th className="px-4 py-3 font-medium">Quality</th>
                <th className="px-6 py-3 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>

            <tbody>
              {visible.map((lead) => {
                const isOpen = expanded === lead.id;

                return (
                  <Fragment key={lead.id}>
                    <tr
                      className="border-t border-white/[0.06] align-middle transition-colors duration-200 ease-crystal hover:bg-white/[0.035]"
                    >
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium text-slate-100">
                          {lead.company || 'Not supplied'}
                        </p>
                        {lead.industry ? (
                          <p className="mt-0.5 text-xs text-slate-500">
                            {lead.industry}
                          </p>
                        ) : null}
                      </td>

                      <td className="px-4 py-4 text-sm text-slate-400">
                        {lead.domain || '—'}
                      </td>

                      <td className="px-4 py-4">
                        <p className="text-sm text-slate-200">{lead.email}</p>
                        {!lead.syntaxValid ? (
                          <p className="mt-0.5 text-xs text-rose-300">
                            Syntax check failed
                          </p>
                        ) : lead.emailSource === 'pattern-guess' ? (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                            <ShieldQuestion size={11} strokeWidth={2} />
                            {lead.emailConfidence === 'confirmed'
                              ? 'Discovered, confirmed'
                              : 'Discovered, unconfirmed'}
                          </p>
                        ) : null}
                      </td>

                      <td className="px-4 py-4">
                        <MxBadge lead={lead} />
                      </td>

                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <span className="tabular w-8 text-sm font-semibold text-white">
                            {lead.score}
                          </span>
                          <span
                            className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10"
                            role="img"
                            aria-label={'Score ' + lead.score + ' out of 100'}
                          >
                            <span
                              className={
                                'block h-full rounded-full transition-[width] duration-500 ease-crystal ' +
                                scoreBarClass(lead.score)
                              }
                              style={{ width: Math.max(lead.score, 3) + '%' }}
                            />
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <span className={qualityPillClass(lead.quality)}>
                          {lead.quality}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => enrich(lead.id)}
                            disabled={enrichingId === lead.id}
                            aria-label={'Enrich ' + (lead.company || lead.email)}
                            title="Fetch company details from their website"
                            className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-400 transition-colors hover:border-fuchsia-300/30 hover:text-fuchsia-200 disabled:opacity-40"
                          >
                            {enrichingId === lead.id ? (
                              <Loader2 size={14} strokeWidth={2} className="animate-spin" />
                            ) : (
                              <Sparkles size={14} strokeWidth={2} />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : lead.id)}
                            aria-expanded={isOpen}
                            aria-label={
                              isOpen
                                ? 'Hide details for ' + lead.email
                                : 'Show details for ' + lead.email
                            }
                            className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-400 transition-colors hover:text-slate-100"
                          >
                            <ChevronDown
                              size={14}
                              strokeWidth={2}
                              className={
                                'transition-transform duration-300 ease-crystal ' +
                                (isOpen ? 'rotate-180' : '')
                              }
                            />
                          </button>

                          <button
                            type="button"
                            onClick={() => remove(lead.id)}
                            disabled={deletingId === lead.id}
                            aria-label={'Delete ' + lead.email}
                            className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-400 transition-colors hover:border-rose-400/30 hover:text-rose-300 disabled:opacity-40"
                          >
                            {deletingId === lead.id ? (
                              <Loader2
                                size={14}
                                strokeWidth={2}
                                className="animate-spin"
                              />
                            ) : (
                              <Trash2 size={14} strokeWidth={2} />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isOpen ? (
                      <tr
                        className="border-t border-white/[0.06] bg-white/[0.025]"
                      >
                        <td colSpan={7} className="px-6 py-5">
                          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                            <div>
                              <h3 className="text-sm font-medium text-slate-200">
                                How this score was built
                              </h3>
                              <ul className="mt-3 space-y-1.5">
                                {lead.scoreBreakdown?.length ? (
                                  lead.scoreBreakdown.map((item, index) => (
                                    <li
                                      key={index}
                                      className="flex items-center justify-between gap-4 text-sm"
                                    >
                                      <span className="text-slate-400">
                                        {item.label}
                                      </span>
                                      <span
                                        className={
                                          'tabular font-medium ' +
                                          (item.points > 0
                                            ? 'text-teal-200'
                                            : item.points < 0
                                              ? 'text-rose-300'
                                              : 'text-slate-500')
                                        }
                                      >
                                        {item.points > 0 ? '+' : ''}
                                        {item.points}
                                      </span>
                                    </li>
                                  ))
                                ) : (
                                  <li className="text-sm text-slate-500">
                                    No scoring signals recorded.
                                  </li>
                                )}
                              </ul>
                            </div>

                            <div>
                              <h3 className="text-sm font-medium text-slate-200">
                                Verification notes
                              </h3>
                              <ul className="mt-3 space-y-1.5 text-sm text-slate-400">
                                {(lead.verificationNotes || []).map((note, index) => (
                                  <li key={index}>{note}</li>
                                ))}
                              </ul>

                              {lead.mxRecords?.length ? (
                                <p className="mt-3 break-all font-mono text-xs text-slate-500">
                                  {lead.mxRecords.join(', ')}
                                </p>
                              ) : null}
                            </div>
                          </div>

                          {lead.enrichment?.fetchedAt ? (
                            <div className="mt-5 border-t border-white/[0.06] pt-4">
                              <h3 className="flex items-center gap-1.5 text-sm font-medium text-slate-200">
                                <Sparkles size={13} strokeWidth={2} className="text-fuchsia-200" />
                                Company enrichment
                              </h3>
                              {lead.enrichment.siteTitle || lead.enrichment.siteDescription ? (
                                <div className="mt-2 space-y-1 text-sm">
                                  {lead.enrichment.siteTitle ? (
                                    <p className="text-slate-200">{lead.enrichment.siteTitle}</p>
                                  ) : null}
                                  {lead.enrichment.siteDescription ? (
                                    <p className="text-slate-400">{lead.enrichment.siteDescription}</p>
                                  ) : null}
                                  {lead.enrichment.detectedIndustry ? (
                                    <span className="pill pill-neutral mt-1 inline-flex">
                                      {lead.enrichment.detectedIndustry}
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <p className="mt-2 text-sm text-slate-500">{lead.enrichment.note}</p>
                              )}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
