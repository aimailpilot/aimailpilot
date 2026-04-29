import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  Sparkles, Loader2, Search, ExternalLink, Save, X,
  TrendingUp, UserCheck, GraduationCap, Wand2, AlertTriangle, CheckCircle2, Info,
} from "lucide-react";

type LeadAgentMode = 'funded' | 'cxo_changes' | 'academics' | 'custom';

interface Lead {
  name: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company: string;
  companyUrl?: string;
  linkedinUrl?: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  location?: string;
  city?: string;
  state?: string;
  country?: string;
  industry?: string;
  department?: string;
  seniority?: string;
  signal?: string;
  sourceUrl?: string;
  outreachHook?: string;
  emailSource?: 'agent' | 'apollo';
  apolloId?: string;
}

interface SearchResult {
  mode: LeadAgentMode;
  llmUsage: { provider: string; model: string; promptTokens: number; completionTokens: number; estCostUsd: number };
  apollo: { matchesAttempted: number; matchesSucceeded: number; creditsSpent: number };
  summary?: string;
  leads: Lead[];
  parseFailed?: boolean;
}

interface Job {
  id: string;
  organizationId: string;
  mode: LeadAgentMode;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt: string | null;
  result: SearchResult | null;
  error: string | null;
  cancelRequested: boolean;
}

interface SearchParams {
  region: string;
  daysBack: number;
  industry: string;
  titles: string;
  maxResults: number;
  customPrompt: string;
  customWebSearch: boolean;
}

const MODE_INFO: Record<LeadAgentMode, { label: string; icon: any; description: string; }> = {
  funded:      { label: 'Funded Companies', icon: TrendingUp,   description: 'Founders + CXOs at companies that recently raised funding' },
  cxo_changes: { label: 'CXO Changes',      icon: UserCheck,    description: 'Executives who recently took new roles' },
  academics:   { label: 'Academics',        icon: GraduationCap, description: 'Faculty with publicly listed contact details on university pages' },
  custom:      { label: 'Custom',           icon: Wand2,        description: 'Free-text search with your own criteria' },
};

const DEFAULT_PARAMS: SearchParams = {
  region: 'India',
  daysBack: 30,
  industry: '',
  titles: '',
  maxResults: 25,
  customPrompt: '',
  customWebSearch: true,
};

export default function LeadAgentPage() {
  const [mode, setMode] = useState<LeadAgentMode>('funded');
  const [params, setParams] = useState<SearchParams>(DEFAULT_PARAMS);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLeadKeys, setSelectedLeadKeys] = useState<Set<string>>(new Set());

  // Save-to-list dialog
  const [saveOpen, setSaveOpen] = useState(false);
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'done'>('idle');
  const [saveResult, setSaveResult] = useState<{ inserted: number; duplicate: number; skipped: number; total: number } | null>(null);
  const [contactLists, setContactLists] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedListId, setSelectedListId] = useState<string>('');

  // Load contact lists once on mount (for save dialog)
  useEffect(() => {
    fetch('/api/contact-lists', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then((lists: any[]) => Array.isArray(lists) && setContactLists(lists.map(l => ({ id: l.id, name: l.name }))))
      .catch(() => {});
  }, []);

  // Poll the job every 4s while it's running
  useEffect(() => {
    if (!activeJobId) return;
    setPolling(true);
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/lead-agent/jobs/${activeJobId}`, { credentials: 'include' });
        if (!res.ok) {
          if (res.status === 404) {
            if (!cancelled) { setError('Job not found (may have been swept). Start a new search.'); setActiveJobId(null); setPolling(false); }
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json() as Job;
        if (cancelled) return;
        setJob(data);
        if (data.status === 'running') {
          setTimeout(tick, 4000);
        } else {
          setPolling(false);
        }
      } catch (e: any) {
        if (!cancelled) { setError(e?.message || 'Polling failed'); setPolling(false); }
      }
    };
    tick();
    return () => { cancelled = true; };
  }, [activeJobId]);

  const startSearch = async () => {
    setError(null);
    setSelectedLeadKeys(new Set());
    setJob(null);
    if (mode === 'custom' && !params.customPrompt.trim()) {
      setError('Custom prompt is required for Custom mode.');
      return;
    }
    try {
      const titlesArr = params.titles.split(',').map(t => t.trim()).filter(Boolean);
      const body = {
        mode,
        params: {
          region: params.region.trim() || undefined,
          daysBack: params.daysBack,
          industry: params.industry.trim() || undefined,
          titles: titlesArr.length ? titlesArr : undefined,
          maxResults: params.maxResults,
          customPrompt: mode === 'custom' ? params.customPrompt : undefined,
          customWebSearch: mode === 'custom' ? params.customWebSearch : undefined,
        },
        enrichWithApollo: true,
        maxApolloMatches: 10,
      };
      const res = await fetch('/api/lead-agent/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
      setActiveJobId(data.jobId);
    } catch (e: any) {
      setError(e?.message || 'Failed to start search');
    }
  };

  const cancelSearch = async () => {
    if (!activeJobId) return;
    try {
      await fetch(`/api/lead-agent/jobs/${activeJobId}/cancel`, { method: 'POST', credentials: 'include' });
    } catch { /* ignore */ }
  };

  const toggleLead = (key: string) => {
    setSelectedLeadKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const leadKey = (l: Lead, i: number) => `${l.name}__${l.company}__${i}`;

  const allSelected = useMemo(() => {
    if (!job?.result?.leads?.length) return false;
    return job.result.leads.every((l, i) => selectedLeadKeys.has(leadKey(l, i)));
  }, [job, selectedLeadKeys]);

  const toggleAll = () => {
    if (!job?.result?.leads) return;
    if (allSelected) {
      setSelectedLeadKeys(new Set());
    } else {
      const all = new Set(job.result.leads.map((l, i) => leadKey(l, i)));
      setSelectedLeadKeys(all);
    }
  };

  const openSaveDialog = () => {
    if (selectedLeadKeys.size === 0) return;
    setSaveResult(null);
    setSavingState('idle');
    setSaveOpen(true);
  };

  const doSave = async () => {
    if (!job?.result?.leads || selectedLeadKeys.size === 0) return;
    setSavingState('saving');
    try {
      const leads = job.result.leads.filter((l, i) => selectedLeadKeys.has(leadKey(l, i)));
      const res = await fetch('/api/lead-agent/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leads, listId: selectedListId || undefined, agentMode: mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
      setSaveResult({ inserted: data.inserted, duplicate: data.duplicate, skipped: data.skipped, total: data.total });
      setSavingState('done');
    } catch (e: any) {
      setError(e?.message || 'Save failed');
      setSavingState('idle');
    }
  };

  const isRunning = job?.status === 'running' || polling;
  const ModeIcon = MODE_INFO[mode].icon;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 p-3 shadow-md">
          <Sparkles className="h-6 w-6 text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">AI Lead Agent</h1>
          <p className="text-sm text-gray-600 mt-1">Find founders, executives, and faculty using Claude with live web search. Apollo fills in missing emails. Save the ones you like into your contact list.</p>
        </div>
      </div>

      {/* Mode tabs */}
      <Card>
        <CardContent className="p-0">
          <Tabs value={mode} onValueChange={(v) => setMode(v as LeadAgentMode)} className="w-full">
            <TabsList className="grid grid-cols-4 w-full rounded-none border-b">
              {(Object.keys(MODE_INFO) as LeadAgentMode[]).map((m) => {
                const Icon = MODE_INFO[m].icon;
                return (
                  <TabsTrigger key={m} value={m} className="data-[state=active]:bg-blue-50 rounded-none">
                    <Icon className="h-4 w-4 mr-2" />
                    {MODE_INFO[m].label}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {(Object.keys(MODE_INFO) as LeadAgentMode[]).map((m) => (
              <TabsContent key={m} value={m} className="p-6 space-y-4">
                <div className="flex gap-2 items-start">
                  <ModeIcon className="h-4 w-4 text-blue-600 mt-0.5" />
                  <div className="text-sm text-gray-600">{MODE_INFO[m].description}</div>
                </div>

                {/* Common params */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="region">Region / Country</Label>
                    <Input id="region" value={params.region} onChange={e => setParams(p => ({ ...p, region: e.target.value }))} placeholder="e.g. India, USA, Bengaluru" />
                  </div>
                  <div>
                    <Label htmlFor="daysBack">How recent (days)</Label>
                    <Input id="daysBack" type="number" min={7} max={365} value={params.daysBack} onChange={e => setParams(p => ({ ...p, daysBack: parseInt(e.target.value) || 30 }))} />
                  </div>
                  <div>
                    <Label htmlFor="industry">Industry / Field {m === 'academics' && <span className="text-gray-400 text-xs">(department)</span>}</Label>
                    <Input id="industry" value={params.industry} onChange={e => setParams(p => ({ ...p, industry: e.target.value }))} placeholder={m === 'academics' ? 'e.g. computer science' : 'e.g. fintech, SaaS'} />
                  </div>
                  <div>
                    <Label htmlFor="maxResults">Max results</Label>
                    <Input id="maxResults" type="number" min={1} max={100} value={params.maxResults} onChange={e => setParams(p => ({ ...p, maxResults: parseInt(e.target.value) || 25 }))} />
                  </div>
                </div>

                {/* CXO-only: titles */}
                {m === 'cxo_changes' && (
                  <div>
                    <Label htmlFor="titles">Roles (optional, comma-separated)</Label>
                    <Input id="titles" value={params.titles} onChange={e => setParams(p => ({ ...p, titles: e.target.value }))} placeholder="CEO, CFO, VP Sales, Head of Engineering" />
                    <p className="text-xs text-gray-500 mt-1">Leave blank for the default executive set.</p>
                  </div>
                )}

                {/* Custom-only: prompt + web search toggle */}
                {m === 'custom' && (
                  <>
                    <div>
                      <Label htmlFor="customPrompt">Your search criteria</Label>
                      <Textarea id="customPrompt" rows={4} value={params.customPrompt} onChange={e => setParams(p => ({ ...p, customPrompt: e.target.value }))} placeholder='e.g. "Find Indian SaaS founders who tweeted about devtools in the last 30 days"' />
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox id="webSearch" checked={params.customWebSearch} onCheckedChange={(v) => setParams(p => ({ ...p, customWebSearch: !!v }))} />
                      <Label htmlFor="webSearch" className="text-sm">Use Claude's web search (recommended)</Label>
                    </div>
                  </>
                )}

                <div className="flex gap-2 pt-2">
                  <Button onClick={startSearch} disabled={isRunning} className="bg-blue-600 hover:bg-blue-700">
                    {isRunning ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Searching...</> : <><Search className="h-4 w-4 mr-2" />Find Leads</>}
                  </Button>
                  {isRunning && (
                    <Button onClick={cancelSearch} variant="outline">
                      <X className="h-4 w-4 mr-2" />Cancel
                    </Button>
                  )}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Errors */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
            <div className="text-sm text-red-700">{error}</div>
          </CardContent>
        </Card>
      )}

      {/* Job state — running */}
      {job?.status === 'running' && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="p-4 flex items-center gap-3">
            <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
            <div className="text-sm">
              <div className="font-medium text-blue-900">Searching with web search…</div>
              <div className="text-blue-700">This usually takes 30–90 seconds for funded/CXO/academics modes.</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Job state — failed/cancelled */}
      {job && (job.status === 'failed' || job.status === 'cancelled') && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium text-red-700 capitalize">Search {job.status}</div>
              {job.error && <div className="text-red-600 mt-1">{job.error}</div>}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {job?.status === 'completed' && job.result && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Results — {job.result.leads.length} {job.result.leads.length === 1 ? 'lead' : 'leads'}</CardTitle>
                <CardDescription className="text-xs mt-1">
                  Provider: <span className="font-mono">{job.result.llmUsage.provider}</span> · Model: <span className="font-mono">{job.result.llmUsage.model}</span> · Cost: ${job.result.llmUsage.estCostUsd.toFixed(4)}
                  {job.result.apollo.creditsSpent > 0 && (
                    <> · Apollo: {job.result.apollo.matchesSucceeded}/{job.result.apollo.matchesAttempted} matched ({job.result.apollo.creditsSpent} credits)</>
                  )}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                {job.result.leads.length > 0 && (
                  <>
                    <Button onClick={toggleAll} variant="outline" size="sm">
                      {allSelected ? 'Clear all' : 'Select all'}
                    </Button>
                    <Button onClick={openSaveDialog} disabled={selectedLeadKeys.size === 0} className="bg-green-600 hover:bg-green-700" size="sm">
                      <Save className="h-4 w-4 mr-2" />
                      Save {selectedLeadKeys.size} {selectedLeadKeys.size === 1 ? 'lead' : 'leads'}
                    </Button>
                  </>
                )}
              </div>
            </div>
            {job.result.summary && (
              <div className="mt-2 text-sm text-gray-600 bg-gray-50 rounded p-3 border">
                <Info className="h-3 w-3 inline mr-1" />
                {job.result.summary}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {job.result.leads.length === 0 ? (
              <div className="text-sm text-gray-500 py-8 text-center">No leads matched the criteria. Try widening the date range or relaxing the industry/region filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b text-xs uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="px-2 py-2 w-8"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></th>
                      <th className="px-2 py-2 text-left">Name</th>
                      <th className="px-2 py-2 text-left">Title / Company</th>
                      <th className="px-2 py-2 text-left">Email</th>
                      <th className="px-2 py-2 text-left">Signal</th>
                      <th className="px-2 py-2 text-left w-20">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {job.result.leads.map((lead, i) => {
                      const key = leadKey(lead, i);
                      const checked = selectedLeadKeys.has(key);
                      return (
                        <tr key={key} className={`border-b hover:bg-gray-50 ${checked ? 'bg-blue-50' : ''}`}>
                          <td className="px-2 py-3"><Checkbox checked={checked} onCheckedChange={() => toggleLead(key)} /></td>
                          <td className="px-2 py-3 font-medium">{lead.name}</td>
                          <td className="px-2 py-3">
                            <div>{lead.title || <span className="text-gray-400">—</span>}</div>
                            <div className="text-xs text-gray-500">{lead.company}</div>
                          </td>
                          <td className="px-2 py-3">
                            {lead.email ? (
                              <div className="flex items-center gap-1">
                                <a href={`mailto:${lead.email}`} className="text-blue-600 hover:underline text-xs">{lead.email}</a>
                                {lead.emailSource === 'apollo' && <Badge variant="outline" className="text-[10px] px-1 py-0">Apollo</Badge>}
                              </div>
                            ) : (
                              <span className="text-xs text-gray-400">no email</span>
                            )}
                          </td>
                          <td className="px-2 py-3">
                            <div className="text-xs text-gray-700">{lead.signal || <span className="text-gray-400">—</span>}</div>
                            {lead.outreachHook && <div className="text-xs text-gray-500 italic mt-0.5">"{lead.outreachHook}"</div>}
                          </td>
                          <td className="px-2 py-3">
                            {lead.sourceUrl ? (
                              <a href={lead.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-blue-600">
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            ) : <span className="text-gray-300">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Save dialog */}
      <Dialog open={saveOpen} onOpenChange={(open) => { if (!open) { setSaveOpen(false); if (savingState === 'done') { setSelectedLeadKeys(new Set()); setSavingState('idle'); } } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save {selectedLeadKeys.size} {selectedLeadKeys.size === 1 ? 'lead' : 'leads'} to Contacts</DialogTitle>
            <DialogDescription>
              Each lead will be added as a contact (source = lead_agent). Duplicates by email are skipped.
            </DialogDescription>
          </DialogHeader>

          {savingState !== 'done' ? (
            <div className="space-y-4">
              <div>
                <Label>Contact list (optional)</Label>
                <select
                  value={selectedListId}
                  onChange={(e) => setSelectedListId(e.target.value)}
                  className="w-full mt-1 border rounded-md px-3 py-2 text-sm"
                  disabled={savingState === 'saving'}
                >
                  <option value="">— No specific list —</option>
                  {contactLists.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">Done</span>
              </div>
              {saveResult && (
                <div className="text-sm space-y-1 text-gray-700">
                  <div>Inserted: <span className="font-semibold text-green-700">{saveResult.inserted}</span></div>
                  <div>Duplicates skipped: <span className="font-semibold text-amber-700">{saveResult.duplicate}</span></div>
                  {saveResult.skipped > 0 && <div>Other skipped: <span className="font-semibold text-gray-600">{saveResult.skipped}</span></div>}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {savingState !== 'done' ? (
              <>
                <Button variant="outline" onClick={() => setSaveOpen(false)} disabled={savingState === 'saving'}>Cancel</Button>
                <Button onClick={doSave} disabled={savingState === 'saving'} className="bg-green-600 hover:bg-green-700">
                  {savingState === 'saving' ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : 'Save'}
                </Button>
              </>
            ) : (
              <Button onClick={() => { setSaveOpen(false); setSelectedLeadKeys(new Set()); setSavingState('idle'); }}>Close</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
