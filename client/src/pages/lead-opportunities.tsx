import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import {
  Brain, Flame, TrendingUp, Users, Target, AlertTriangle,
  Search, RefreshCw, Loader2, ArrowRight, Mail, Clock,
  CheckCircle2, XCircle, MessageSquare, ChevronDown, ChevronUp,
  Zap, BarChart3, Eye, EyeOff, Star, ThumbsUp, ThumbsDown,
  UserPlus, Send, Filter, Calendar, Building2, ExternalLink,
  Settings, Save
} from "lucide-react";

interface Opportunity {
  id: string;
  organizationId: string;
  emailAccountId: string | null;
  accountEmail: string | null;
  contactEmail: string;
  contactName: string | null;
  company: string | null;
  bucket: string;
  confidence: number;
  aiReasoning: string | null;
  suggestedAction: string | null;
  lastEmailDate: string | null;
  totalEmails: number;
  totalSent: number;
  totalReceived: number;
  sampleSubjects: string;
  sampleSnippets: string;
  status: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BucketSummary {
  bucket: string;
  count: number;
  avgConfidence: number;
  newCount: number;
  reviewedCount: number;
  actionedCount: number;
  dismissedCount: number;
}

interface SyncStatus {
  emailAccountId: string;
  accountEmail: string;
  provider: string;
  emailCount: number;
  oldest: string;
  newest: string;
}

interface EmailAccount {
  id: string;
  email: string;
  provider: string;
  displayName?: string;
}

const BUCKET_CONFIG: Record<string, { label: string; icon: any; color: string; bgColor: string; priority: number }> = {
  past_customer: { label: 'Past Customers', icon: Star, color: 'text-amber-700', bgColor: 'bg-amber-50 border-amber-200', priority: 1 },
  hot_lead: { label: 'Hot Leads', icon: Flame, color: 'text-red-700', bgColor: 'bg-red-50 border-red-200', priority: 2 },
  almost_closed: { label: 'Almost Closed', icon: Target, color: 'text-orange-700', bgColor: 'bg-orange-50 border-orange-200', priority: 3 },
  warm_lead: { label: 'Warm Leads', icon: TrendingUp, color: 'text-emerald-700', bgColor: 'bg-emerald-50 border-emerald-200', priority: 4 },
  interested_stalled: { label: 'Interested but Stalled', icon: Clock, color: 'text-blue-700', bgColor: 'bg-blue-50 border-blue-200', priority: 5 },
  meeting_no_deal: { label: 'Meeting — No Deal', icon: Users, color: 'text-indigo-700', bgColor: 'bg-indigo-50 border-indigo-200', priority: 6 },
  went_silent: { label: 'Went Silent', icon: EyeOff, color: 'text-gray-700', bgColor: 'bg-gray-50 border-gray-200', priority: 7 },
  referral_potential: { label: 'Referral Potential', icon: UserPlus, color: 'text-pink-700', bgColor: 'bg-pink-50 border-pink-200', priority: 8 },
  converted: { label: 'Converted', icon: CheckCircle2, color: 'text-green-700', bgColor: 'bg-green-50 border-green-200', priority: 9 },
  no_response: { label: 'No Response', icon: XCircle, color: 'text-slate-600', bgColor: 'bg-slate-50 border-slate-200', priority: 10 },
  not_interested: { label: 'Not Interested', icon: ThumbsDown, color: 'text-red-600', bgColor: 'bg-red-50/50 border-red-100', priority: 11 },
  unknown: { label: 'Unknown', icon: Search, color: 'text-gray-500', bgColor: 'bg-gray-50 border-gray-200', priority: 12 },
};

export default function LeadOpportunities() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'owner' || user?.role === 'admin';
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [summary, setSummary] = useState<BucketSummary[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [runningFull, setRunningFull] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 25;
  const [filterAccountEmail, setFilterAccountEmail] = useState<string>('');
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [savedPrompt, setSavedPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [monthsBack, setMonthsBack] = useState('6');
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [oppsRes, summaryRes, syncRes, accountsRes] = await Promise.all([
        fetch('/api/lead-intelligence/opportunities', { credentials: 'include' }),
        fetch('/api/lead-intelligence/summary', { credentials: 'include' }),
        fetch('/api/lead-intelligence/sync-status', { credentials: 'include' }),
        fetch('/api/email-accounts/lead-intel', { credentials: 'include' }),
      ]);
      if (oppsRes.ok) setOpportunities(await oppsRes.json());
      if (summaryRes.ok) {
        const data = await summaryRes.json();
        setSummary(data.summary || []);
      }
      if (syncRes.ok) {
        const data = await syncRes.json();
        setSyncStatus(data.syncStatus || []);
        setStats(data.stats || null);
      }
      if (accountsRes.ok) {
        const accounts = await accountsRes.json();
        setEmailAccounts(Array.isArray(accounts) ? accounts : []);
      }
      // Fetch custom prompt for admin
      if (isAdmin) {
        try {
          const promptRes = await fetch('/api/lead-intelligence/prompt', { credentials: 'include' });
          if (promptRes.ok) {
            const data = await promptRes.json();
            setCustomPrompt(data.prompt || '');
            setSavedPrompt(data.prompt || '');
            if (data.defaultPrompt) setDefaultPrompt(data.defaultPrompt);
          }
        } catch (e) { /* ignore */ }
      }
    } catch (e) {
      console.error('Failed to load lead intelligence:', e);
    } finally {
      setLoading(false);
    }
  };

  const runScan = async (force: boolean = false) => {
    setScanning(true);
    setLastResult(null);
    try {
      const resp = await fetch('/api/lead-intelligence/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          monthsBack: parseInt(monthsBack) || 6,
          emailAccountIds: selectedAccountIds.length > 0 ? selectedAccountIds : undefined,
          force,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setLastResult({ type: 'scan', force, ...data.result });
        fetchAll();
      } else {
        const errBody = await resp.json().catch(() => ({}));
        setLastResult({ type: 'error', message: errBody.message || `Scan failed (HTTP ${resp.status})`, error: errBody.error });
      }
    } catch (e: any) {
      setLastResult({ type: 'error', message: e?.message || 'Network error during scan', error: String(e) });
    } finally {
      setScanning(false);
    }
  };

  const runAnalysis = async (force: boolean = false) => {
    setAnalyzing(true);
    setLastResult(null);
    try {
      const resp = await fetch('/api/lead-intelligence/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          emailAccountIds: selectedAccountIds.length > 0 ? selectedAccountIds : undefined,
          force,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setLastResult({ type: 'analysis', force, ...data.result });
        fetchAll();
      } else {
        // Surface server errors instead of failing silently
        const errBody = await resp.json().catch(() => ({}));
        setLastResult({ type: 'error', message: errBody.message || `Analysis failed (HTTP ${resp.status})`, error: errBody.error });
      }
    } catch (e: any) {
      // Surface network/exception errors so the user knows something went wrong
      setLastResult({ type: 'error', message: e?.message || 'Network error during analysis', error: String(e) });
    } finally {
      setAnalyzing(false);
    }
  };

  const runFullPipeline = async () => {
    setRunningFull(true);
    setLastResult(null);
    try {
      const resp = await fetch('/api/lead-intelligence/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          monthsBack: parseInt(monthsBack) || 6,
          emailAccountIds: selectedAccountIds.length > 0 ? selectedAccountIds : undefined,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setLastResult({ type: 'full', scan: data.scan, analysis: data.analysis });
        fetchAll();
      }
    } catch (e) {
      console.error('Full pipeline failed:', e);
    } finally {
      setRunningFull(false);
    }
  };

  const updateOpportunityStatus = async (id: string, status: string) => {
    try {
      await fetch(`/api/lead-intelligence/opportunities/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
      setOpportunities(prev => prev.map(o => o.id === id ? { ...o, status } : o));
    } catch (e) { /* ignore */ }
  };

  // Filter & sort
  const filtered = opportunities
    .filter(o => {
      if (selectedBucket && o.bucket !== selectedBucket) return false;
      if (filterAccountEmail && (o.accountEmail || '').toLowerCase() !== filterAccountEmail.toLowerCase()) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return (
          o.contactEmail.toLowerCase().includes(term) ||
          (o.contactName || '').toLowerCase().includes(term) ||
          (o.company || '').toLowerCase().includes(term)
        );
      }
      return true;
    })
    .sort((a, b) => {
      const pa = BUCKET_CONFIG[a.bucket]?.priority || 99;
      const pb = BUCKET_CONFIG[b.bucket]?.priority || 99;
      if (pa !== pb) return pa - pb;
      return b.confidence - a.confidence;
    });

  // Pagination
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginatedOpps = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Reset page when filters change
  useEffect(() => { setCurrentPage(1); }, [selectedBucket, searchTerm, filterAccountEmail]);

  // Top-level counts for summary cards
  const hotCount = opportunities.filter(o => o.bucket === 'hot_lead' || o.bucket === 'almost_closed').length;
  const warmCount = opportunities.filter(o => o.bucket === 'warm_lead' || o.bucket === 'interested_stalled').length;
  const pastCustomerCount = opportunities.filter(o => o.bucket === 'past_customer' || o.bucket === 'converted').length;
  const silentCount = opportunities.filter(o => o.bucket === 'went_silent' || o.bucket === 'no_response').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                <Brain className="h-5 w-5 text-white" />
              </div>
              AI Lead Intelligence
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Deep email analysis — find missed opportunities, past customers, and hot leads
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Input type="number" min="1" max="36" value={monthsBack} onChange={e => setMonthsBack(e.target.value)}
                className="h-8 w-16 text-xs" title="Months to scan back" />
              <span className="text-xs text-gray-400">months</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => runScan(false)} disabled={scanning || runningFull} className="gap-1.5"
              title="Fetch only new emails since last scan (faster, fewer API calls)">
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              {scanning ? 'Scanning...' : 'Scan Emails'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => runScan(true)} disabled={scanning || runningFull} className="gap-1.5 text-xs text-gray-500 hover:text-gray-700"
              title="Re-scan the full lookback window (slower, more API calls — use after extending months back)">
              {scanning ? null : <Mail className="h-3 w-3" />}
              Force re-scan
            </Button>
            <Button variant="outline" size="sm" onClick={() => runAnalysis(false)} disabled={analyzing || runningFull} className="gap-1.5"
              title="Analyze only contacts not yet classified (saves AI tokens)">
              {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
              {analyzing ? 'Analyzing...' : 'Analyze'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => runAnalysis(true)} disabled={analyzing || runningFull} className="gap-1.5 text-xs text-gray-500 hover:text-gray-700"
              title="Re-analyze ALL contacts (deletes existing classifications, uses more AI tokens)">
              {analyzing ? null : <Brain className="h-3 w-3" />}
              Force re-analyze
            </Button>
            <Button size="sm" onClick={runFullPipeline} disabled={runningFull || scanning || analyzing}
              className="gap-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700">
              {runningFull ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              {runningFull ? 'Running...' : 'Full Scan + Analyze'}
            </Button>
          </div>
        </div>

        {/* Email Account Selection */}
        {emailAccounts.length > 0 && (
          <div className="mb-4 p-3 bg-white rounded-lg border">
            <div className="flex items-center gap-2 mb-2">
              <Mail className="h-3.5 w-3.5 text-gray-500" />
              <span className="text-xs font-medium text-gray-700">Select accounts to scan</span>
              <span className="text-[10px] text-gray-400">
                {selectedAccountIds.length === 0 ? '(all accounts)' : `(${selectedAccountIds.length} selected)`}
              </span>
              {selectedAccountIds.length > 0 && (
                <button
                  onClick={() => setSelectedAccountIds([])}
                  className="text-[10px] text-indigo-600 hover:text-indigo-800 underline ml-1"
                >
                  clear selection
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {emailAccounts.map(account => {
                const isSelected = selectedAccountIds.includes(String(account.id));
                const isScanOnly = (account as any).scanOnly === true;
                const providerIcon = (account.provider || '').toLowerCase().includes('gmail') || (account.provider || '').toLowerCase().includes('google')
                  ? '📧' : (account.provider || '').toLowerCase().includes('outlook') || (account.provider || '').toLowerCase().includes('microsoft')
                  ? '📨' : '✉️';
                return (
                  <button
                    key={account.id}
                    onClick={() => {
                      setSelectedAccountIds(prev =>
                        isSelected ? prev.filter(id => id !== String(account.id)) : [...prev, String(account.id)]
                      );
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-all ${
                      isSelected
                        ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-medium ring-1 ring-indigo-200'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <span>{providerIcon}</span>
                    <span>{account.email}</span>
                    {isScanOnly && (
                      <span title="Scan-only — read-only mailbox for Lead Intelligence; not used for sending"
                            className="text-[9px] font-semibold px-1 py-0.5 rounded bg-purple-100 text-purple-700 border border-purple-200">SCAN</span>
                    )}
                    {isSelected && <CheckCircle2 className="h-3 w-3 text-indigo-500" />}
                  </button>
                );
              })}
            </div>

            {/* Connect scan-only mailbox — read-only access for Lead Intelligence,
                hidden from send paths and the Email Accounts UI. */}
            {isAdmin && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] text-gray-500">
                    <strong className="text-gray-700">Add scan-only mailbox</strong> — read-only access for analysis. Won't appear in Email Accounts and can't be used for sending.
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                      onClick={() => { window.location.href = '/api/auth/gmail-scan-connect'; }}>
                      📧 Connect Gmail (scan-only)
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                      onClick={() => { window.location.href = '/api/auth/outlook-scan-connect'; }}>
                      📨 Connect Outlook (scan-only)
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sync Status */}
        {syncStatus.length > 0 && stats && (
          <div className="mb-4 p-3 bg-white rounded-lg border text-xs text-gray-600 flex items-center gap-4 flex-wrap">
            <span className="font-medium text-gray-800">Email History:</span>
            <span>{(stats as any).totalEmails || 0} emails scanned</span>
            <span>{(stats as any).uniqueContacts || 0} unique contacts</span>
            <span>{(stats as any).totalThreads || 0} threads</span>
            {syncStatus.map(s => (
              <Badge key={s.emailAccountId} variant="outline" className="text-[10px]">
                {s.accountEmail} ({s.provider}): {s.emailCount} emails
              </Badge>
            ))}
          </div>
        )}

        {/* Result Banner */}
        {lastResult && (
          <Alert className={`mb-4 ${lastResult.type === 'error' ? 'bg-red-50 border-red-200' : 'bg-indigo-50 border-indigo-200'}`}>
            <Brain className={`h-4 w-4 ${lastResult.type === 'error' ? 'text-red-600' : 'text-indigo-600'}`} />
            <AlertDescription className={`text-xs ${lastResult.type === 'error' ? 'text-red-800' : 'text-indigo-800'}`}>
              {lastResult.type === 'scan' && (
                <span>
                  <strong>{lastResult.force ? 'Full re-scan complete' : 'Incremental scan complete'}:</strong>{' '}
                  {lastResult.accountsScanned} accounts scanned, {lastResult.totalEmailsFetched} new emails fetched
                  {!lastResult.force && lastResult.totalEmailsFetched === 0 && (
                    <span className="text-gray-600"> — no new emails since last scan. Use Force re-scan to refetch the full window.</span>
                  )}
                  {lastResult.errors?.length > 0 && <span className="text-red-600"> | Errors: {lastResult.errors.join(', ')}</span>}
                </span>
              )}
              {lastResult.type === 'analysis' && (
                <span>
                  <strong>{lastResult.force ? 'Full re-analysis complete' : 'Incremental analysis complete'}:</strong>{' '}
                  {lastResult.contactsAnalyzed} contacts analyzed, {lastResult.opportunitiesCreated} new opportunities
                  {!lastResult.force && lastResult.debug?.alreadyClassified > 0 && (
                    <span className="text-gray-500"> · {lastResult.debug.alreadyClassified} previously classified (skipped — use Force re-analyze to re-run)</span>
                  )}
                  {lastResult.contactsAnalyzed === 0 && !lastResult.errors?.length && (
                    <span className="text-gray-600"> — nothing new to classify. Run Scan first to fetch latest emails, or click Force re-analyze.</span>
                  )}
                  {lastResult.errors?.length > 0 && <span className="text-red-600"> | {lastResult.errors.join(', ')}</span>}
                  {lastResult.bucketCounts && Object.entries(lastResult.bucketCounts).map(([k, v]) => (
                    <Badge key={k} variant="outline" className="ml-1 text-[10px]">{BUCKET_CONFIG[k]?.label || k}: {v as number}</Badge>
                  ))}
                </span>
              )}
              {lastResult.type === 'full' && (
                <span>
                  <strong>Full pipeline complete:</strong> {lastResult.scan?.totalEmailsFetched || 0} emails scanned,{' '}
                  {lastResult.analysis?.opportunitiesCreated || 0} opportunities classified
                </span>
              )}
              {lastResult.type === 'error' && (
                <span>
                  <strong>Analysis failed:</strong> {lastResult.message}
                  {lastResult.error && <span className="text-red-600"> — {lastResult.error}</span>}
                </span>
              )}
              <button className="ml-2 underline" onClick={() => setLastResult(null)}>dismiss</button>
            </AlertDescription>
          </Alert>
        )}

        {/* Summary Cards */}
        {opportunities.length > 0 && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedBucket(selectedBucket === 'hot' ? null : 'hot')}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                  <Flame className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">{hotCount}</div>
                  <div className="text-xs text-gray-500">Hot / Almost Closed</div>
                </div>
              </CardContent>
            </Card>
            <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedBucket(selectedBucket === 'warm' ? null : 'warm')}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">{warmCount}</div>
                  <div className="text-xs text-gray-500">Warm / Interested</div>
                </div>
              </CardContent>
            </Card>
            <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedBucket(selectedBucket === 'customer' ? null : 'customer')}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                  <Star className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">{pastCustomerCount}</div>
                  <div className="text-xs text-gray-500">Past Customers</div>
                </div>
              </CardContent>
            </Card>
            <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setSelectedBucket(selectedBucket === 'silent' ? null : 'silent')}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                  <EyeOff className="h-5 w-5 text-gray-600" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">{silentCount}</div>
                  <div className="text-xs text-gray-500">Silent / No Response</div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Bucket Filter Chips + Search */}
        {opportunities.length > 0 && (
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center gap-1.5 flex-wrap flex-1">
              <button
                onClick={() => setSelectedBucket(null)}
                className={`px-3 py-1.5 rounded-full text-xs border transition-all ${
                  !selectedBucket ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-medium' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                All ({opportunities.length})
              </button>
              {summary
                .sort((a, b) => (BUCKET_CONFIG[a.bucket]?.priority || 99) - (BUCKET_CONFIG[b.bucket]?.priority || 99))
                .map(s => {
                  const cfg = BUCKET_CONFIG[s.bucket] || BUCKET_CONFIG.unknown;
                  const Icon = cfg.icon;
                  return (
                    <button
                      key={s.bucket}
                      onClick={() => setSelectedBucket(selectedBucket === s.bucket ? null : s.bucket)}
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs border transition-all ${
                        selectedBucket === s.bucket ? `${cfg.bgColor} ${cfg.color} font-medium` : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      <Icon className="h-3 w-3" />
                      {cfg.label} ({s.count})
                    </button>
                  );
                })}
            </div>
            {/* Account filter dropdown */}
            {emailAccounts.length > 1 && (
              <select
                value={filterAccountEmail}
                onChange={e => setFilterAccountEmail(e.target.value)}
                className="h-8 text-xs border border-gray-200 rounded-md px-2 bg-white text-gray-700 min-w-[160px]"
              >
                <option value="">All Accounts</option>
                {emailAccounts.map(acc => (
                  <option key={acc.id} value={acc.email}>{acc.email}</option>
                ))}
              </select>
            )}
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-gray-400" />
              <Input
                placeholder="Search contacts..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
        )}

        {/* Empty State */}
        {opportunities.length === 0 && !loading && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center mb-4">
                <Brain className="h-8 w-8 text-indigo-400" />
              </div>
              <h3 className="text-base font-semibold text-gray-700 mb-1">No Lead Intelligence Yet</h3>
              <p className="text-sm text-gray-400 text-center max-w-md mb-4">
                Scan your linked email accounts to discover past customers, hot leads, and missed opportunities.
                The AI will analyze your email history and classify every contact.
              </p>
              <Button size="sm" onClick={runFullPipeline} disabled={runningFull}
                className="gap-1.5 bg-gradient-to-r from-indigo-500 to-purple-600">
                {runningFull ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                {runningFull ? 'Running...' : 'Scan & Analyze Now'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Opportunity List */}
        {filtered.length > 0 && (<>
          <div className="space-y-2">
            {paginatedOpps.map(opp => {
              const cfg = BUCKET_CONFIG[opp.bucket] || BUCKET_CONFIG.unknown;
              const Icon = cfg.icon;
              const isExpanded = expandedId === opp.id;
              let subjects: string[] = [];
              let snippets: string[] = [];
              try { subjects = JSON.parse(opp.sampleSubjects || '[]'); } catch (e) {}
              try { snippets = JSON.parse(opp.sampleSnippets || '[]'); } catch (e) {}

              return (
                <Card key={opp.id} className={`overflow-hidden transition-all ${opp.status === 'dismissed' ? 'opacity-50' : ''}`}>
                  <CardContent className="p-0">
                    {/* Main row */}
                    <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50/50"
                      onClick={() => setExpandedId(isExpanded ? null : opp.id)}>
                      {/* Bucket icon */}
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${cfg.bgColor}`}>
                        <Icon className={`h-5 w-5 ${cfg.color}`} />
                      </div>

                      {/* Contact info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-semibold text-sm text-gray-900 truncate">
                            {opp.contactName || opp.contactEmail}
                          </span>
                          {opp.company && (
                            <span className="text-xs text-gray-400 flex items-center gap-0.5">
                              <Building2 className="h-3 w-3" /> {opp.company}
                            </span>
                          )}
                          <Badge variant="outline" className={`text-[9px] ${cfg.bgColor} ${cfg.color}`}>
                            {cfg.label}
                          </Badge>
                          {opp.status !== 'new' && (
                            <Badge variant="outline" className="text-[9px]">
                              {opp.status}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          <span>{opp.contactEmail}</span>
                          {opp.accountEmail && (
                            <span className="text-indigo-500 flex items-center gap-0.5">
                              <ArrowRight className="h-3 w-3" /> {opp.accountEmail}
                            </span>
                          )}
                          <span>{opp.totalEmails} emails ({opp.totalSent} sent, {opp.totalReceived} received)</span>
                          {opp.lastEmailDate && (
                            <span className="flex items-center gap-0.5">
                              <Calendar className="h-3 w-3" />
                              {new Date(opp.lastEmailDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Confidence */}
                      <div className="text-center flex-shrink-0">
                        <div className={`text-lg font-bold ${opp.confidence >= 70 ? 'text-emerald-600' : opp.confidence >= 50 ? 'text-amber-600' : 'text-gray-400'}`}>
                          {opp.confidence}%
                        </div>
                        <div className="text-[9px] text-gray-400 uppercase">confidence</div>
                      </div>

                      {/* Expand toggle */}
                      <div className="flex-shrink-0">
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t bg-gray-50/50 p-4">
                        <div className="grid grid-cols-2 gap-4">
                          {/* AI Reasoning */}
                          <div>
                            <h4 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                              <Brain className="h-3.5 w-3.5 text-indigo-500" /> AI Analysis
                            </h4>
                            <p className="text-xs text-gray-600 bg-white rounded-lg border p-3">
                              {opp.aiReasoning || 'No AI reasoning available'}
                            </p>
                            {opp.suggestedAction && (
                              <div className="mt-2 flex items-start gap-1.5">
                                <ArrowRight className="h-3.5 w-3.5 text-indigo-500 mt-0.5 flex-shrink-0" />
                                <span className="text-xs text-indigo-700 font-medium">{opp.suggestedAction}</span>
                              </div>
                            )}
                          </div>

                          {/* Email samples */}
                          <div>
                            <h4 className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                              <Mail className="h-3.5 w-3.5 text-blue-500" /> Recent Conversations
                            </h4>
                            {subjects.length > 0 ? (
                              <div className="space-y-1.5">
                                {subjects.slice(0, 4).map((sub, i) => (
                                  <div key={i} className="text-xs bg-white rounded border p-2">
                                    <span className="font-medium text-gray-700">{sub}</span>
                                    {snippets[i] && <p className="text-gray-400 mt-0.5 line-clamp-2">{snippets[i]}</p>}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-gray-400 bg-white rounded-lg border p-3">No email samples available</p>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 mt-4 pt-3 border-t">
                          <span className="text-xs text-gray-500">Actions:</span>
                          {opp.status !== 'actioned' && (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                              onClick={(e) => { e.stopPropagation(); updateOpportunityStatus(opp.id, 'actioned'); }}>
                              <CheckCircle2 className="h-3 w-3" /> Mark Actioned
                            </Button>
                          )}
                          {opp.status !== 'reviewed' && opp.status !== 'actioned' && (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                              onClick={(e) => { e.stopPropagation(); updateOpportunityStatus(opp.id, 'reviewed'); }}>
                              <Eye className="h-3 w-3" /> Mark Reviewed
                            </Button>
                          )}
                          {opp.status !== 'dismissed' && (
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-gray-400 hover:text-red-600"
                              onClick={(e) => { e.stopPropagation(); updateOpportunityStatus(opp.id, 'dismissed'); }}>
                              <ThumbsDown className="h-3 w-3" /> Dismiss
                            </Button>
                          )}
                          <a href={`mailto:${opp.contactEmail}`} className="ml-auto" onClick={e => e.stopPropagation()}>
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-blue-700 border-blue-200 hover:bg-blue-50">
                              <Send className="h-3 w-3" /> Email
                            </Button>
                          </a>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t">
              <span className="text-xs text-gray-500">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(1)}>First</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(p => p - 1)}>Prev</Button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  let page: number;
                  if (totalPages <= 5) { page = i + 1; }
                  else if (currentPage <= 3) { page = i + 1; }
                  else if (currentPage >= totalPages - 2) { page = totalPages - 4 + i; }
                  else { page = currentPage - 2 + i; }
                  return (
                    <Button key={page} variant={page === currentPage ? 'default' : 'outline'} size="sm"
                      className={`h-7 w-7 text-xs ${page === currentPage ? 'bg-indigo-600' : ''}`}
                      onClick={() => setCurrentPage(page)}>{page}</Button>
                  );
                })}
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(p => p + 1)}>Next</Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(totalPages)}>Last</Button>
              </div>
            </div>
          )}
        </>)}

        {/* AI Prompt Editor (Admin/Owner only) */}
        {isAdmin && (
          <div className="mt-6">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Settings className="h-4 w-4 text-gray-500" />
                    AI Classification Prompt
                  </h3>
                  <Button variant="ghost" size="sm" className="text-xs h-7"
                    onClick={() => setShowPromptEditor(!showPromptEditor)}>
                    {showPromptEditor ? 'Hide' : 'Edit Prompt'}
                  </Button>
                </div>
                {showPromptEditor && (
                  <div className="space-y-3">
                    <p className="text-[11px] text-gray-500">
                      Customize the AI prompt used to classify contacts. Leave empty to use the default prompt.
                      The contact data is automatically appended. Use bucket names: past_customer, hot_lead, warm_lead, almost_closed,
                      interested_stalled, meeting_no_deal, went_silent, not_interested, referral_potential, converted.
                    </p>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${customPrompt ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                        {customPrompt ? 'Custom Prompt' : 'Default Prompt (edit to customize)'}
                      </span>
                    </div>
                    <textarea
                      value={customPrompt || defaultPrompt}
                      onChange={e => setCustomPrompt(e.target.value)}
                      className="w-full h-48 p-3 text-xs border rounded-lg bg-gray-50 font-mono resize-y focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                    />
                    <div className="flex items-center gap-2">
                      <Button size="sm" className="gap-1.5 text-xs" disabled={savingPrompt || customPrompt === savedPrompt}
                        onClick={async () => {
                          setSavingPrompt(true);
                          try {
                            const resp = await fetch('/api/lead-intelligence/prompt', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              credentials: 'include',
                              body: JSON.stringify({ prompt: customPrompt }),
                            });
                            if (resp.ok) { setSavedPrompt(customPrompt); }
                          } catch (e) { /* ignore */ }
                          finally { setSavingPrompt(false); }
                        }}>
                        {savingPrompt ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        {savingPrompt ? 'Saving...' : 'Save Prompt'}
                      </Button>
                      {customPrompt && (
                        <Button variant="outline" size="sm" className="text-xs" onClick={() => setCustomPrompt('')}>
                          Reset to Default
                        </Button>
                      )}
                      {customPrompt !== savedPrompt && (
                        <span className="text-[10px] text-amber-600">Unsaved changes</span>
                      )}
                      {customPrompt === savedPrompt && savedPrompt && (
                        <span className="text-[10px] text-green-600">Saved — re-run Analyze to apply</span>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Info Section */}
        <div className="mt-6">
          <Alert className="bg-indigo-50 border-indigo-200">
            <Brain className="h-4 w-4 text-indigo-600" />
            <AlertDescription className="text-xs text-indigo-800">
              <strong>How it works:</strong> The AI scans your linked email accounts (Gmail/Outlook) for the past {monthsBack} months,
              groups conversations by contact, and classifies each one using Azure OpenAI into actionable buckets.
              Past customers, hot leads, and stalled deals are surfaced so your team can prioritize follow-ups.
              {!stats?.totalEmails && ' Click "Full Scan + Analyze" to get started.'}
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </div>
  );
}
