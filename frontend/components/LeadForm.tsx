'use client';

import { useCallback, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Radar,
  Search,
  ShieldQuestion,
  Type as TypeIcon,
  UploadCloud,
  X,
} from 'lucide-react';
import type { EmailCandidate, FindEmailResult } from './types';

export interface ProcessPayload {
  company?: string;
  domain?: string;
  email?: string;
  industry?: string;
  website?: string;
  firstName?: string;
  lastName?: string;
  csv?: string;
}

export interface ProcessResult {
  success: boolean;
  message: string;
  processed?: number;
}

interface LeadFormProps {
  onProcess: (payload: ProcessPayload) => Promise<ProcessResult>;
  onFindEmail: (payload: {
    company?: string;
    domain?: string;
    firstName?: string;
    lastName?: string;
  }) => Promise<FindEmailResult>;
}

type Mode = 'single' | 'batch';

const EMPTY_SINGLE = {
  company: '',
  domain: '',
  email: '',
  industry: '',
  firstName: '',
  lastName: '',
};

const SAMPLE_CSV =
  'company,domain,email\nNorthwind Logistics,northwind.com,dana.mercer@northwind.com\nHalcyon Foods,halcyonfoods.co,ops@halcyonfoods.co';

function confidenceLabel(status: string | null) {
  if (status === 'confirmed') return 'Confirmed';
  if (status === 'catch-all') return 'Domain accepts anything';
  return 'Best guess';
}

function confidencePillClass(status: string | null) {
  if (status === 'confirmed') return 'pill pill-high';
  if (status === 'catch-all') return 'pill pill-medium';
  return 'pill pill-neutral';
}

export default function LeadForm({ onProcess, onFindEmail }: LeadFormProps) {
  const [mode, setMode] = useState<Mode>('single');
  const [single, setSingle] = useState(EMPTY_SINGLE);
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<ProcessResult | null>(null);
  const [finding, setFinding] = useState(false);
  const [findResult, setFindResult] = useState<FindEmailResult | null>(null);
  const [emailSource, setEmailSource] = useState<'provided' | 'pattern-guess'>('provided');
  const fileInput = useRef<HTMLInputElement>(null);

  const canFindEmail =
    (single.firstName.trim() || single.lastName.trim()) && single.domain.trim() && !single.email.trim();

  const runFindEmail = async () => {
    setFinding(true);
    setFindResult(null);
    try {
      const result = await onFindEmail({
        company: single.company,
        domain: single.domain,
        firstName: single.firstName,
        lastName: single.lastName,
      });
      setFindResult(result);
      if (!result.success) {
        setFeedback({ success: false, message: result.message || 'Could not search for an email.' });
      }
    } finally {
      setFinding(false);
    }
  };

  const pickCandidate = (candidate: EmailCandidate) => {
    setSingle({ ...single, email: candidate.email });
    setEmailSource('pattern-guess');
    setFindResult(null);
  };

  const rowCount = csvText.trim()
    ? Math.max(csvText.trim().split(/\r?\n/).length - 1, 0)
    : 0;

  const readFile = useCallback((file: File) => {
    setFeedback(null);

    const isCsv =
      file.type === 'text/csv' ||
      file.type === 'application/vnd.ms-excel' ||
      /\.(csv|tsv|txt)$/i.test(file.name);

    if (!isCsv) {
      setFeedback({
        success: false,
        message: 'That file is not a CSV. Export your list as .csv and try again.',
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setFeedback({
        success: false,
        message: 'That file is over 5 MB. Split it into smaller batches.',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result || ''));
      setFileName(file.name);
    };
    reader.onerror = () => {
      setFeedback({
        success: false,
        message: 'The file could not be read. Check that it is not open elsewhere.',
      });
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) readFile(file);
  };

  const clearFile = () => {
    setCsvText('');
    setFileName('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setFeedback(null);

    const hasName = single.firstName.trim() || single.lastName.trim();
    if (mode === 'single' && !single.email.trim() && !(hasName && single.domain.trim())) {
      setFeedback({
        success: false,
        message: 'Enter an email address, or a name plus a domain so one can be found.',
      });
      return;
    }

    if (mode === 'batch' && !csvText.trim()) {
      setFeedback({
        success: false,
        message: 'Drop a CSV file or paste rows before running the pipeline.',
      });
      return;
    }

    setBusy(true);
    try {
      const payload: ProcessPayload =
        mode === 'single'
          ? {
              company: single.company.trim(),
              domain: single.domain.trim(),
              email: single.email.trim(),
              industry: single.industry.trim(),
              firstName: single.firstName.trim(),
              lastName: single.lastName.trim(),
            }
          : { csv: csvText };

      const result = await onProcess(payload);
      setFeedback(result);

      if (result.success) {
        if (mode === 'single') {
          setSingle(EMPTY_SINGLE);
          setFindResult(null);
          setEmailSource('provided');
        } else {
          clearFile();
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="crystal-lg crystal-specular crystal-reflection overflow-hidden p-6 sm:p-7"
    >
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-white">
            Add leads
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Every lead is checked for syntax, live mail servers and throwaway
            domains, then scored.
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Input method"
          className="flex rounded-2xl border border-white/10 bg-white/[0.04] p-1 backdrop-blur-xl"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'single'}
            onClick={() => setMode('single')}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm transition-colors duration-200 ease-crystal ${
              mode === 'single'
                ? 'border border-white/[0.15] bg-white/10 text-white'
                : 'border border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <TypeIcon size={15} strokeWidth={1.75} />
            One lead
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'batch'}
            onClick={() => setMode('batch')}
            className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm transition-colors duration-200 ease-crystal ${
              mode === 'batch'
                ? 'border border-white/[0.15] bg-white/10 text-white'
                : 'border border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileSpreadsheet size={15} strokeWidth={1.75} />
            CSV batch
          </button>
        </div>
      </div>

      <div className="divider-soft my-6" />

      {mode === 'single' ? (
        <div className="relative grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm text-slate-400">Company</span>
            <input
              className="crystal-input"
              value={single.company}
              onChange={(e) => setSingle({ ...single, company: e.target.value })}
              placeholder="Northwind Logistics"
              autoComplete="organization"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-slate-400">Domain</span>
            <input
              className="crystal-input"
              value={single.domain}
              onChange={(e) => setSingle({ ...single, domain: e.target.value })}
              placeholder="northwind.com"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-slate-400">First name</span>
            <input
              className="crystal-input"
              value={single.firstName}
              onChange={(e) => {
                setSingle({ ...single, firstName: e.target.value });
                setFindResult(null);
              }}
              placeholder="Dana"
              autoComplete="given-name"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-slate-400">Last name</span>
            <input
              className="crystal-input"
              value={single.lastName}
              onChange={(e) => {
                setSingle({ ...single, lastName: e.target.value });
                setFindResult(null);
              }}
              placeholder="Mercer"
              autoComplete="family-name"
            />
          </label>

          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-slate-400">
                Work email
                {!single.email.trim() ? (
                  <span className="ml-1.5 text-slate-600">or find one from a name</span>
                ) : null}
              </span>

              {canFindEmail ? (
                <button
                  type="button"
                  onClick={runFindEmail}
                  disabled={finding}
                  className="inline-flex items-center gap-1.5 text-xs text-indigo-300 hover:text-indigo-200 disabled:opacity-50"
                >
                  {finding ? (
                    <Loader2 size={12} strokeWidth={2} className="animate-spin" />
                  ) : (
                    <Search size={12} strokeWidth={2} />
                  )}
                  Find email
                </button>
              ) : null}
            </div>

            <input
              className="crystal-input"
              type="email"
              value={single.email}
              onChange={(e) => {
                setSingle({ ...single, email: e.target.value });
                setEmailSource('provided');
                setFindResult(null);
              }}
              placeholder="dana.mercer@northwind.com"
              autoComplete="email"
            />

            {emailSource === 'pattern-guess' && single.email.trim() ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                <ShieldQuestion size={12} strokeWidth={2} />
                Discovered, not confirmed as deliverable, this will score lower until verified.
              </p>
            ) : null}

            {findResult && findResult.success ? (
              <div className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur-xl">
                <p className="text-xs text-slate-500">{findResult.note}</p>
                {findResult.candidates.slice(0, 5).map((candidate) => (
                  <button
                    key={candidate.email}
                    type="button"
                    onClick={() => pickCandidate(candidate)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-sm text-slate-200 transition-colors duration-200 ease-crystal hover:border-white/20 hover:bg-white/[0.07]"
                  >
                    <span className="truncate">{candidate.email}</span>
                    <span className={confidencePillClass(candidate.status)}>
                      {confidenceLabel(candidate.status)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <label className="block sm:col-span-2">
            <span className="mb-2 block text-sm text-slate-400">Industry</span>
            <input
              className="crystal-input"
              value={single.industry}
              onChange={(e) => setSingle({ ...single, industry: e.target.value })}
              placeholder="Freight and logistics"
            />
          </label>
        </div>
      ) : (
        <div className="relative space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`drop-zone ${dragging ? 'drop-zone-active' : ''}`}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.07] text-indigo-200">
              <UploadCloud size={20} strokeWidth={1.75} />
            </span>

            <div>
              <p className="text-sm font-medium text-slate-200">
                Drop a CSV here, or{' '}
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="text-indigo-300 underline decoration-indigo-400/40 underline-offset-4 hover:text-indigo-200"
                >
                  choose a file
                </button>
              </p>
              <p className="mt-1.5 text-xs text-slate-500">
                Columns recognised: company, domain, email, firstName, lastName,
                industry, website. No email column? First/last name plus domain
                works too. Up to
                5 MB.
              </p>
            </div>

            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile(file);
              }}
            />
          </div>

          {fileName ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl">
              <div className="flex min-w-0 items-center gap-3">
                <FileSpreadsheet
                  size={17}
                  strokeWidth={1.75}
                  className="shrink-0 text-teal-200"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-200">{fileName}</p>
                  <p className="text-xs text-slate-500">
                    {rowCount} row{rowCount === 1 ? '' : 's'} ready
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={clearFile}
                aria-label="Remove file"
                className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-400 transition-colors hover:text-slate-100"
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-sm text-slate-400">
              Or paste rows directly
            </span>
            <textarea
              className="crystal-input h-36 resize-y font-mono text-xs leading-relaxed"
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                if (fileName) setFileName('');
              }}
              placeholder={SAMPLE_CSV}
              spellCheck={false}
            />
          </label>
        </div>
      )}

      {feedback ? (
        <div
          role="status"
          className={`mt-5 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm backdrop-blur-xl ${
            feedback.success
              ? 'border-teal-300/25 bg-teal-300/[0.08] text-teal-100'
              : 'border-rose-400/25 bg-rose-400/[0.08] text-rose-100'
          }`}
        >
          {feedback.success ? (
            <CheckCircle2 size={16} strokeWidth={1.9} className="mt-0.5 shrink-0" />
          ) : (
            <AlertCircle size={16} strokeWidth={1.9} className="mt-0.5 shrink-0" />
          )}
          <p>{feedback.message}</p>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Mail server lookups run live, so a large batch takes a few seconds.
        </p>

        <button
          type="submit"
          disabled={busy}
          className="crystal-button crystal-button-primary"
        >
          {busy ? (
            <>
              <Loader2 size={16} strokeWidth={2} className="animate-spin" />
              Verifying
            </>
          ) : (
            <>
              <Radar size={16} strokeWidth={1.9} />
              {mode === 'single' ? 'Verify and score' : 'Run the batch'}
            </>
          )}
        </button>
      </div>
    </form>
  );
}
