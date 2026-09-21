'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Activity, RefreshCw, WifiOff } from 'lucide-react';
import StatsCards from '@/components/StatsCards';
import LeadForm, { ProcessPayload, ProcessResult } from '@/components/LeadForm';
import LeadTable from '@/components/LeadTable';
import AnalyticsCharts from '@/components/AnalyticsCharts';
import type { FindEmailResult, Lead, LeadStats } from '@/components/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

const api = axios.create({
  baseURL: API_URL,
  timeout: 120000,
  headers: { 'Content-Type': 'application/json' },
});

const EMPTY_STATS: LeadStats = {
  totalLeads: 0,
  mxVerifiedCount: 0,
  mxVerifiedRate: 0,
  averageScore: 0,
  highQualityCount: 0,
};

/** Turn any axios failure into a sentence a person can act on. */
function describeError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;
    if (typeof message === 'string' && message) return message;
    if (error.code === 'ECONNABORTED') {
      return 'The request timed out. Try a smaller batch.';
    }
    if (!error.response) {
      return (
        'Cannot reach the API at ' +
        API_URL +
        '. Start the backend with npm run dev in the backend folder.'
      );
    }
  }
  return fallback;
}

export default function DashboardPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<LeadStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const loadLeads = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const { data } = await api.get('/api/leads');
      setLeads(Array.isArray(data.leads) ? data.leads : []);
      setStats(data.stats || EMPTY_STATS);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(describeError(error, 'Could not load leads.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const handleProcess = useCallback(
    async (payload: ProcessPayload): Promise<ProcessResult> => {
      try {
        const { data } = await api.post('/api/leads/process', payload);
        await loadLeads(true);
        return {
          success: true,
          message: data.message || 'Leads processed.',
          processed: data.processed,
        };
      } catch (error) {
        return {
          success: false,
          message: describeError(error, 'The leads could not be processed.'),
        };
      }
    },
    [loadLeads]
  );

  const handleFindEmail = useCallback(
    async (payload: {
      company?: string;
      domain?: string;
      firstName?: string;
      lastName?: string;
    }): Promise<FindEmailResult> => {
      try {
        const { data } = await api.post('/api/leads/find-email', payload);
        return data as FindEmailResult;
      } catch (error) {
        return {
          success: false,
          domain: payload.domain || '',
          mxVerified: false,
          catchAll: false,
          candidates: [],
          bestGuess: null,
          note: '',
          message: describeError(error, 'Could not search for an email.'),
        };
      }
    },
    []
  );

  const handleEnrich = useCallback(
    async (id: string) => {
      try {
        const { data } = await api.post('/api/leads/' + id + '/enrich');
        if (data?.lead) {
          setLeads((current) =>
            current.map((lead) => (lead.id === id ? { ...lead, ...data.lead } : lead))
          );
        }
      } catch (error) {
        setConnectionError(describeError(error, 'Could not enrich that lead.'));
      }
    },
    []
  );

  const handleDelete = useCallback(async (id: string) => {
    const snapshot = leads;
    setLeads((current) => current.filter((lead) => lead.id !== id));

    try {
      await api.delete('/api/leads/' + id);
      await loadLeads(true);
    } catch (error) {
      setLeads(snapshot);
      setConnectionError(describeError(error, 'That lead could not be removed.'));
    }
  }, [leads, loadLeads]);

  return (
    <main className="mx-auto w-full max-w-7xl px-5 pb-20 pt-12 sm:px-8 lg:pt-16">
      <header className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <span className="pill pill-neutral">
            <Activity size={12} strokeWidth={2} />
            Caprae LeadGen Enhancement Pipeline
          </span>

          <h1 className="mt-5 text-display font-semibold text-white">
            Know which leads are worth a call
          </h1>

          <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-400">
            Drop in a list and the pipeline checks each address for valid syntax,
            live mail servers and throwaway domains, then scores it out of 100 so
            your reps work the top of the list first.
          </p>
        </div>

        <button
          type="button"
          onClick={() => loadLeads(true)}
          disabled={refreshing}
          className="crystal-button self-start px-4 py-2.5 lg:self-auto"
        >
          <RefreshCw
            size={15}
            strokeWidth={1.9}
            className={refreshing ? 'animate-spin' : ''}
          />
          Refresh
        </button>
      </header>

      {connectionError ? (
        <div
          role="alert"
          className="mb-8 flex items-start gap-3 rounded-3xl border border-rose-400/25 bg-rose-400/[0.07] px-5 py-4 text-sm text-rose-100 backdrop-blur-xl"
        >
          <WifiOff size={16} strokeWidth={1.9} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">The dashboard is not connected</p>
            <p className="mt-1 text-rose-200/80">{connectionError}</p>
          </div>
        </div>
      ) : null}

      <StatsCards stats={stats} loading={loading} />

      <AnalyticsCharts leads={leads} />

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <LeadForm onProcess={handleProcess} onFindEmail={handleFindEmail} />
        <LeadTable leads={leads} loading={loading} onDelete={handleDelete} onEnrich={handleEnrich} />
      </div>

      <footer className="mt-12 text-center text-xs text-slate-600">
        Scores are heuristics, not guarantees. Re-run a batch to refresh
        verification results.
      </footer>
    </main>
  );
}
