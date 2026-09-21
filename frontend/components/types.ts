export type Quality = 'High Quality' | 'Medium' | 'Low Quality';

export type MxStatus = 'verified' | 'unverified' | 'error' | 'skipped';

export interface ScoreBreakdownItem {
  label: string;
  points: number;
}

export interface Lead {
  id: string;
  company: string;
  domain: string;
  email: string;
  industry?: string;
  website?: string;
  syntaxValid: boolean;
  mxVerified: boolean;
  mxStatus: MxStatus;
  mxRecords: string[];
  disposable: boolean;
  freeProvider: boolean;
  roleBased: boolean;
  verificationNotes: string[];
  score: number;
  quality: Quality;
  scoreBreakdown: ScoreBreakdownItem[];
  source: 'manual' | 'csv';
  createdAt?: string;
  updatedAt?: string;
}

export interface LeadStats {
  totalLeads: number;
  mxVerifiedCount: number;
  mxVerifiedRate: number;
  averageScore: number;
  highQualityCount: number;
}
