import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Key, CheckCircle2, XCircle, Loader2, Eye, EyeOff,
  RefreshCw, ExternalLink, Info, Zap, Trash2, Database,
  Search, Bookmark, ListPlus, Play, Save, Users, AlertTriangle,
} from "lucide-react";

interface ApolloSettings {
  configured: boolean;
  keyPreview: string | null;
  overwriteMode: 'fill_blanks_only' | 'apollo_wins';
  credits: any;
  creditsError: string | null;
}

interface ApolloJob {
  id: string;
  status: string;
  totalFound: number;
  processed: number;
  alreadyCurrent: number;
  enriched: number;
  imported: number;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
  listNames?: any;
}

interface SearchFilters {
  keywords?: string;
  titles?: string[];
  industries?: string[];
  locations?: string[];
  companyNames?: string[];
  companyDomains?: string[];
  seniorities?: string[];
  employeeRanges?: string[];
  page?: number;
  perPage?: number;
}

interface SearchPerson {
  id: string;
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  industry: string;
  city: string;
  state: string;
  country: string;
  linkedinUrl: string;
  hasEmail: boolean;
  inSystem: boolean;
  inSystemStatus: string | null;
  inSystemLastReply: string | null;
  inSystemLastActivity: string | null;
  inSavedApolloData: boolean;
}

interface SearchPreview {
  total: number;
  page: number;
  perPage: number;
  people: SearchPerson[];
  summary: {
    alreadyInSystem: number;
    inSavedApolloData: number;
    newProspects: number;
    estimatedRevealCredits: number;
  };
}

interface SavedSearch {
  id: string;
  name: string;
  filters: SearchFilters;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ContactList { id: string; name: string; }

function parseCsvList(s: string): string[] {
  return s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
}

export default function ApolloSettingsPage() {
  const [settings, setSettings] = useState<ApolloSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [overwriteMode, setOverwriteMode] = useState<'fill_blanks_only' | 'apollo_wins'>('fill_blanks_only');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<ApolloJob[]>([]);

  const [tab, setTab] = useState<'search' | 'lists' | 'saved' | 'settings'>('search');

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/apollo/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setOverwriteMode(data.overwriteMode || 'fill_blanks_only');
      }
    } catch (e) { /* ignore */ } finally { setLoading(false); }
  };

  const loadJobs = async () => {
    try {
      const res = await fetch('/api/apollo/sync/jobs');
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch (e) { /* ignore */ }
  };

  useEffect(() => { loadSettings(); loadJobs(); }, []);

  const handleSave = async () => {
    setSaving(true); setSaveResult(null);
    try {
      const body: any = { overwriteMode };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const res = await fetch('/api/apollo/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setSaveResult({ success: true, message: 'Settings saved' });
        setApiKey(''); await loadSettings();
      } else {
        setSaveResult({ success: false, message: data.error || data.message || 'Save failed' });
      }
    } catch (e: any) {
      setSaveResult({ success: false, message: e?.message || 'Save failed' });
    } finally { setSaving(false); }
  };

  const handleRemove = async () => {
    if (!confirm('Remove Apollo API key? Sync will be disabled until you add a new key.')) return;
    try {
      const res = await fetch('/api/apollo/settings', { method: 'DELETE' });
      if (res.ok) { setSaveResult({ success: true, message: 'API key removed' }); await loadSettings(); }
    } catch (e) { /* ignore */ }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>;
  }

  const credits = settings?.credits || {};
  const notConfigured = !settings?.configured;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-purple-100 flex items-center justify-center">
          <Zap className="h-5 w-5 text-purple-600" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">Apollo.io</h1>
          <p className="text-sm text-muted-foreground">
            Search Apollo, import saved lists, and enrich contacts without wasting credits
          </p>
        </div>
        {settings?.configured && (
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
            <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
          </Badge>
        )}
      </div>

      {notConfigured && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="flex-1 text-sm">
              <strong>Apollo is not connected.</strong> Add your organization's Apollo Master API key in Settings to start searching.
            </div>
            <Button size="sm" onClick={() => setTab('settings')}>Go to Settings</Button>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="search"><Search className="h-4 w-4 mr-1.5" />Search Apollo</TabsTrigger>
          <TabsTrigger value="lists"><ListPlus className="h-4 w-4 mr-1.5" />Import Saved Lists</TabsTrigger>
          <TabsTrigger value="saved"><Bookmark className="h-4 w-4 mr-1.5" />Saved Searches</TabsTrigger>
          <TabsTrigger value="settings"><Key className="h-4 w-4 mr-1.5" />Settings & Jobs</TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="mt-4">
          <SearchTab disabled={notConfigured} credits={credits} />
        </TabsContent>

        <TabsContent value="lists" className="mt-4">
          <SavedListsTab disabled={notConfigured} />
        </TabsContent>

        <TabsContent value="saved" className="mt-4">
          <SavedSearchesTab disabled={notConfigured} />
        </TabsContent>

        <TabsContent value="settings" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-4 w-4" /> API Key
              </CardTitle>
              <CardDescription>
                Each org uses its own Apollo Master API key. Find yours at{' '}
                <a href="https://app.apollo.io/#/settings/integrations/api" target="_blank" rel="noopener noreferrer"
                   className="text-blue-600 hover:underline inline-flex items-center gap-0.5">
                  Apollo → Settings → Integrations <ExternalLink className="h-3 w-3" />
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {settings?.configured && (
                <div className="text-sm text-muted-foreground">
                  Current key: <code className="bg-gray-100 px-1.5 py-0.5 rounded">{settings.keyPreview}</code>
                </div>
              )}
              <div>
                <Label htmlFor="apollo-key">{settings?.configured ? 'Replace key' : 'API key'}</Label>
                <div className="flex gap-2 mt-1">
                  <div className="relative flex-1">
                    <Input id="apollo-key" type={showKey ? 'text' : 'password'}
                      placeholder={settings?.configured ? 'Enter new key to replace…' : 'Paste Apollo Master API key'}
                      value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                    <button type="button" onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700">
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <Label>When enriching existing contacts</Label>
                <div className="flex flex-col gap-2 mt-1">
                  <label className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-gray-50">
                    <input type="radio" name="overwriteMode" value="fill_blanks_only"
                      checked={overwriteMode === 'fill_blanks_only'}
                      onChange={() => setOverwriteMode('fill_blanks_only')} className="mt-0.5" />
                    <span>
                      <span className="font-medium text-sm">Fill blanks only (recommended)</span>
                      <span className="block text-xs text-muted-foreground">Never overwrite data you already have. Safe default.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-gray-50">
                    <input type="radio" name="overwriteMode" value="apollo_wins"
                      checked={overwriteMode === 'apollo_wins'}
                      onChange={() => setOverwriteMode('apollo_wins')} className="mt-0.5" />
                    <span>
                      <span className="font-medium text-sm">Apollo wins</span>
                      <span className="block text-xs text-muted-foreground">Overwrite existing fields with Apollo's data when they differ.</span>
                    </span>
                  </label>
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Save
                </Button>
                {settings?.configured && (
                  <Button variant="outline" onClick={handleRemove} disabled={saving}>
                    <Trash2 className="h-4 w-4 mr-2" />Remove key
                  </Button>
                )}
              </div>

              {saveResult && (
                <div className={`text-sm flex items-center gap-2 ${saveResult.success ? 'text-green-700' : 'text-red-700'}`}>
                  {saveResult.success ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  {saveResult.message}
                </div>
              )}
            </CardContent>
          </Card>

          {settings?.configured && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-4 w-4" /> Credit Balance
                  <Button variant="ghost" size="sm" onClick={loadSettings} className="ml-auto h-7">
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {settings.creditsError ? (
                  <div className="text-sm text-red-600 flex items-center gap-2">
                    <XCircle className="h-4 w-4" />{settings.creditsError}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {Object.entries(credits)
                      .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
                      .slice(0, 8)
                      .map(([k, v]) => (
                        <div key={k} className="border rounded p-3">
                          <div className="text-xs text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</div>
                          <div className="text-lg font-semibold">{String(v)}</div>
                        </div>
                      ))}
                  </div>
                )}
                <div className="text-xs text-muted-foreground mt-3 flex items-start gap-1.5">
                  <Info className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>
                    Syncing saved lists and searching Apollo (masked view) does NOT consume credits.
                    Credits are only spent when you reveal a new prospect's email from search results.
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4" /> Recent Sync Jobs
                <Button variant="ghost" size="sm" onClick={loadJobs} className="ml-auto h-7">
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </CardTitle>
              <CardDescription>Last 20 sync jobs for this organization</CardDescription>
            </CardHeader>
            <CardContent>
              {jobs.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">
                  No sync jobs yet. Start one from Search Apollo or Import Saved Lists.
                </div>
              ) : (
                <div className="space-y-2">
                  {jobs.map((job) => {
                    const names = Array.isArray(job.listNames) ? job.listNames :
                      typeof job.listNames === 'string' ? (() => { try { return JSON.parse(job.listNames as any); } catch { return []; } })() : [];
                    const statusColor =
                      job.status === 'completed' ? 'text-green-700' :
                      job.status === 'failed' ? 'text-red-700' :
                      job.status === 'cancelled' ? 'text-gray-500' : 'text-blue-700';
                    return (
                      <div key={job.id} className="border rounded p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={statusColor}>{job.status}</Badge>
                            <span className="text-muted-foreground">{new Date(job.createdAt).toLocaleString()}</span>
                          </div>
                          {job.totalFound > 0 && (
                            <span className="text-xs text-muted-foreground">{job.processed}/{job.totalFound} processed</span>
                          )}
                        </div>
                        {names.length > 0 && (
                          <div className="text-xs text-muted-foreground mt-1">Lists: {names.join(', ')}</div>
                        )}
                        <div className="flex gap-3 text-xs mt-2">
                          <span>Imported: <strong>{job.imported}</strong></span>
                          <span>Enriched: <strong>{job.enriched}</strong></span>
                          <span>Already current: <strong>{job.alreadyCurrent}</strong></span>
                        </div>
                        {job.errorMessage && <div className="text-xs text-red-600 mt-1">{job.errorMessage}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================================
// Search Apollo tab
// ============================================================================
function SearchTab({ disabled, credits }: { disabled: boolean; credits: any }) {
  const [filters, setFilters] = useState<SearchFilters>({ page: 1, perPage: 25 });
  const [preview, setPreview] = useState<SearchPreview | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showImportDialog, setShowImportDialog] = useState(false);

  const runSearch = async (page = 1) => {
    setSearching(true); setError(null);
    try {
      const res = await fetch('/api/apollo/search/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: { ...filters, page, perPage: 25 } }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Search failed'); return; }
      setPreview(data);
      setSelected(new Set());
    } catch (e: any) { setError(e?.message || 'Search failed'); } finally { setSearching(false); }
  };

  const handleSaveSearch = async () => {
    if (!saveName.trim()) return;
    try {
      const res = await fetch('/api/apollo/saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saveName.trim(), filters }),
      });
      if (res.ok) { setShowSaveDialog(false); setSaveName(''); }
    } catch (e) { /* ignore */ }
  };

  const toggleAll = () => {
    if (!preview) return;
    if (selected.size === preview.people.length) setSelected(new Set());
    else setSelected(new Set(preview.people.map((p) => p.id)));
  };

  const selectedCount = selected.size;
  const selectedNew = useMemo(() => {
    if (!preview) return 0;
    return preview.people.filter((p) => selected.has(p.id) && !p.inSystem && !p.inSavedApolloData).length;
  }, [preview, selected]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search filters</CardTitle>
          <CardDescription>Any combination — all fields optional. Masked preview is free.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Keywords</Label>
              <Input placeholder="e.g. SaaS, fintech" value={filters.keywords || ''}
                onChange={(e) => setFilters({ ...filters, keywords: e.target.value })} />
            </div>
            <div>
              <Label>Job titles (comma or newline separated)</Label>
              <Input placeholder="CTO, VP Engineering, Head of Sales"
                value={(filters.titles || []).join(', ')}
                onChange={(e) => setFilters({ ...filters, titles: parseCsvList(e.target.value) })} />
            </div>
            <div>
              <Label>Industries</Label>
              <Input placeholder="software, healthcare, education"
                value={(filters.industries || []).join(', ')}
                onChange={(e) => setFilters({ ...filters, industries: parseCsvList(e.target.value) })} />
            </div>
            <div>
              <Label>Locations</Label>
              <Input placeholder="India, Bangalore, United States"
                value={(filters.locations || []).join(', ')}
                onChange={(e) => setFilters({ ...filters, locations: parseCsvList(e.target.value) })} />
            </div>
            <div>
              <Label>Company names</Label>
              <Input placeholder="Google, Microsoft, OpenAI"
                value={(filters.companyNames || []).join(', ')}
                onChange={(e) => setFilters({ ...filters, companyNames: parseCsvList(e.target.value) })} />
            </div>
            <div>
              <Label>Company domains</Label>
              <Input placeholder="google.com, microsoft.com"
                value={(filters.companyDomains || []).join(', ')}
                onChange={(e) => setFilters({ ...filters, companyDomains: parseCsvList(e.target.value) })} />
            </div>
            <div>
              <Label>Seniorities</Label>
              <Input placeholder="c_suite, vp, director, manager"
                value={(filters.seniorities || []).join(', ')}
                onChange={(e) => setFilters({ ...filters, seniorities: parseCsvList(e.target.value) })} />
            </div>
            <div>
              <Label>Employee count ranges</Label>
              <Input placeholder="1,10 | 11,50 | 51,200"
                value={(filters.employeeRanges || []).join(' | ')}
                onChange={(e) => setFilters({ ...filters, employeeRanges: e.target.value.split('|').map((s) => s.trim()).filter(Boolean) })} />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => runSearch(1)} disabled={disabled || searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
              Preview results
            </Button>
            <Button variant="outline" onClick={() => setShowSaveDialog(true)} disabled={disabled}>
              <Save className="h-4 w-4 mr-2" />Save search
            </Button>
          </div>

          {error && <div className="text-sm text-red-600 flex items-center gap-2"><XCircle className="h-4 w-4" />{error}</div>}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base">
                {preview.total.toLocaleString()} matches in Apollo
              </CardTitle>
              <div className="flex gap-2 text-xs">
                <Badge variant="outline" className="text-green-700">
                  Already in aimailpilot: {preview.summary.alreadyInSystem}
                </Badge>
                <Badge variant="outline" className="text-blue-700">
                  In saved Apollo data: {preview.summary.inSavedApolloData}
                </Badge>
                <Badge variant="outline" className="text-amber-700">
                  New prospects: {preview.summary.newProspects}
                </Badge>
              </div>
            </div>
            <CardDescription>
              Importing new prospects requires revealing their email (≈1 credit each). Already-imported and
              previously-synced contacts are free.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 mb-3 text-sm">
              <Checkbox
                checked={selected.size === preview.people.length && preview.people.length > 0}
                onCheckedChange={toggleAll}
              />
              <span className="text-muted-foreground">
                {selectedCount > 0 ? `${selectedCount} selected (${selectedNew} need reveal)` : 'Select all on this page'}
              </span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" disabled={selectedCount === 0} onClick={() => setShowImportDialog(true)}>
                  <Users className="h-4 w-4 mr-1.5" />Import {selectedCount} selected
                </Button>
              </div>
            </div>

            <div className="space-y-2 max-h-[500px] overflow-auto">
              {preview.people.map((p) => (
                <div key={p.id} className="flex items-start gap-3 border rounded p-2 text-sm">
                  <Checkbox
                    checked={selected.has(p.id)}
                    onCheckedChange={(c) => {
                      const next = new Set(selected);
                      if (c) next.add(p.id); else next.delete(p.id);
                      setSelected(next);
                    }}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{p.firstName} {p.lastName}</span>
                      {p.title && <span className="text-muted-foreground">· {p.title}</span>}
                      {p.company && <span className="text-muted-foreground">@ {p.company}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[p.industry, [p.city, p.state, p.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                    </div>
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      {p.inSystem && (
                        <Badge variant="outline" className="text-green-700 text-xs">
                          In aimailpilot · {p.inSystemStatus}
                          {p.inSystemLastReply ? ` · replied (${p.inSystemLastReply})` : ''}
                        </Badge>
                      )}
                      {!p.inSystem && p.inSavedApolloData && (
                        <Badge variant="outline" className="text-blue-700 text-xs">In saved Apollo data (free)</Badge>
                      )}
                      {!p.inSystem && !p.inSavedApolloData && (
                        <Badge variant="outline" className="text-amber-700 text-xs">New · 1 credit to reveal</Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center mt-3">
              <Button variant="ghost" size="sm" disabled={preview.page <= 1 || searching}
                onClick={() => runSearch(preview.page - 1)}>Previous</Button>
              <span className="text-xs text-muted-foreground">Page {preview.page}</span>
              <Button variant="ghost" size="sm" disabled={preview.people.length < preview.perPage || searching}
                onClick={() => runSearch(preview.page + 1)}>Next</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save this search</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g. Q2 SaaS CTOs India" />
            <p className="text-xs text-muted-foreground">
              You can re-run this search later and see only contacts added to Apollo since last run.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveSearch} disabled={!saveName.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        peopleIds={Array.from(selected)}
        needRevealCount={selectedNew}
        availableCredits={Number(credits?.email_credits_remaining ?? credits?.credits_used ?? 0)}
      />
    </div>
  );
}

// ============================================================================
// Import confirm + progress dialog
// ============================================================================
function ImportDialog({
  open, onOpenChange, peopleIds, needRevealCount, availableCredits,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  peopleIds: string[]; needRevealCount: number; availableCredits: number;
}) {
  const [lists, setLists] = useState<ContactList[]>([]);
  const [listSearch, setListSearch] = useState('');
  const [targetListId, setTargetListId] = useState<string>('');
  const [allowReveal, setAllowReveal] = useState(true);
  const [saveToApolloListName, setSaveToApolloListName] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<any>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch('/api/contact-lists').then((r) => r.ok ? r.json() : { lists: [] })
      .then((d) => setLists(d.lists || d || []))
      .catch(() => { });
  }, [open]);

  useEffect(() => {
    if (!jobId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/apollo/search/import/${jobId}`);
        if (res.ok) {
          const p = await res.json();
          setProgress(p);
          if (p.status === 'completed' || p.status === 'failed') clearInterval(interval);
        }
      } catch (e) { /* ignore */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [jobId]);

  const filteredLists = lists.filter((l) => l.name.toLowerCase().includes(listSearch.toLowerCase()));

  const tierLabel = needRevealCount <= 25 ? 'Small'
    : needRevealCount <= 200 ? 'Medium' : 'Large';
  const tierWarn = needRevealCount > 200;

  const handleStart = async () => {
    setStarting(true);
    try {
      const res = await fetch('/api/apollo/search/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          peopleIds,
          allowReveal,
          revealBudgetCredits: allowReveal ? needRevealCount : 0,
          targetListId: targetListId || null,
          saveToApolloListName: saveToApolloListName.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.jobId) setJobId(data.jobId);
    } catch (e) { /* ignore */ } finally { setStarting(false); }
  };

  const reset = () => {
    onOpenChange(false);
    setJobId(null); setProgress(null); setTargetListId(''); setSaveToApolloListName(''); setListSearch('');
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); else onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {jobId ? 'Import in progress' : `Import ${peopleIds.length} contacts`}
          </DialogTitle>
        </DialogHeader>

        {!jobId && (
          <div className="space-y-4">
            <div className="border rounded p-3 bg-gray-50 text-sm space-y-1">
              <div className="flex justify-between">
                <span>Total selected</span><strong>{peopleIds.length}</strong>
              </div>
              <div className="flex justify-between">
                <span>Already in aimailpilot (skipped)</span>
                <strong>{peopleIds.length - needRevealCount}</strong>
              </div>
              <div className="flex justify-between">
                <span>Need reveal</span>
                <strong>{needRevealCount} <span className="text-muted-foreground">(~{needRevealCount} credits)</span></strong>
              </div>
              {availableCredits > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Available balance</span><span>{availableCredits}</span>
                </div>
              )}
            </div>

            {tierWarn && (
              <div className="border border-amber-300 bg-amber-50 rounded p-3 text-sm flex gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <strong>{tierLabel} import:</strong> this will spend roughly {needRevealCount} credits.
                  Please confirm before proceeding.
                </div>
              </div>
            )}

            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox checked={allowReveal} onCheckedChange={(c) => setAllowReveal(Boolean(c))} className="mt-0.5" />
              <span>
                <strong>Spend credits to reveal new prospects</strong>
                <span className="block text-xs text-muted-foreground">
                  Uncheck to import only contacts that are already in your saved Apollo data (free).
                </span>
              </span>
            </label>

            <div>
              <Label>Add to aimailpilot list (optional)</Label>
              <Input placeholder="Search your lists…" value={listSearch} onChange={(e) => setListSearch(e.target.value)} className="mt-1" />
              <div className="border rounded mt-1 max-h-40 overflow-auto text-sm">
                <div
                  onClick={() => setTargetListId('')}
                  className={`px-2 py-1.5 cursor-pointer hover:bg-gray-50 ${!targetListId ? 'bg-blue-50 font-medium' : ''}`}
                >
                  — No list (add to All contacts only) —
                </div>
                {filteredLists.map((l) => (
                  <div
                    key={l.id}
                    onClick={() => setTargetListId(l.id)}
                    className={`px-2 py-1.5 cursor-pointer hover:bg-gray-50 ${targetListId === l.id ? 'bg-blue-50 font-medium' : ''}`}
                  >
                    {l.name}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Label>Also save as Apollo list (optional)</Label>
              <Input placeholder="e.g. aimailpilot – SaaS CTOs Q2"
                value={saveToApolloListName} onChange={(e) => setSaveToApolloListName(e.target.value)} className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">
                Creates a list in Apollo with the revealed contacts so you can reuse it there. Best-effort; requires list-write permission.
              </p>
            </div>
          </div>
        )}

        {jobId && progress && (
          <div className="space-y-3">
            <div className="text-sm">
              Status: <Badge variant="outline">{progress.status}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="border rounded p-2"><div className="text-xs text-muted-foreground">Processed</div><strong>{progress.processed} / {progress.totalSelected}</strong></div>
              <div className="border rounded p-2"><div className="text-xs text-muted-foreground">Imported</div><strong>{progress.imported}</strong></div>
              <div className="border rounded p-2"><div className="text-xs text-muted-foreground">Enriched</div><strong>{progress.enriched}</strong></div>
              <div className="border rounded p-2"><div className="text-xs text-muted-foreground">Credits spent</div><strong>{progress.creditsSpent}</strong></div>
            </div>
            {progress.errorMessage && <div className="text-sm text-red-600">{progress.errorMessage}</div>}
          </div>
        )}

        <DialogFooter>
          {!jobId && (
            <>
              <Button variant="outline" onClick={reset}>Cancel</Button>
              <Button onClick={handleStart} disabled={starting || !peopleIds.length}>
                {starting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                Start import
              </Button>
            </>
          )}
          {jobId && (
            <Button onClick={reset}>
              {progress?.status === 'completed' || progress?.status === 'failed' ? 'Close' : 'Close (runs in background)'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Import Saved Lists tab — reuses the existing ApolloSyncDialog flow
// ============================================================================
function SavedListsTab({ disabled }: { disabled: boolean }) {
  const [apolloLists, setApolloLists] = useState<{ id: string; name: string; count: number }[]>([]);
  const [listSearch, setListSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncStarted, setSyncStarted] = useState<string | null>(null);

  useEffect(() => {
    if (disabled) return;
    setLoading(true);
    fetch('/api/apollo/lists').then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((d) => setApolloLists(d.lists || []))
      .catch(() => setError('Failed to load Apollo lists'))
      .finally(() => setLoading(false));
  }, [disabled]);

  const filtered = apolloLists.filter((l) => l.name.toLowerCase().includes(listSearch.toLowerCase()));

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((l) => l.id)));
  };

  const handleSync = async () => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const names = apolloLists.filter((l) => ids.includes(l.id)).map((l) => l.name);
    try {
      const res = await fetch('/api/apollo/sync/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listIds: ids, listNames: names }),
      });
      const data = await res.json();
      if (res.ok) setSyncStarted(data.jobId);
      else setError(data.message || 'Failed to start sync');
    } catch (e: any) { setError(e?.message || 'Sync failed'); }
  };

  if (disabled) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground">Connect Apollo to import saved lists.</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your Apollo saved lists</CardTitle>
        <CardDescription>
          Pick one or more lists to sync into aimailpilot. Syncing saved data is free — no credits consumed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input placeholder="Search lists…" value={listSearch} onChange={(e) => setListSearch(e.target.value)} />
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm border-b pb-2">
              <Checkbox checked={selected.size === filtered.length && filtered.length > 0} onCheckedChange={toggleAll} />
              <span className="text-muted-foreground">
                {selected.size > 0 ? `${selected.size} selected` : `${filtered.length} lists`}
              </span>
              <Button size="sm" className="ml-auto" disabled={selected.size === 0} onClick={handleSync}>
                <Play className="h-4 w-4 mr-1.5" />Sync {selected.size} {selected.size === 1 ? 'list' : 'lists'}
              </Button>
            </div>
            <div className="max-h-[500px] overflow-auto">
              {filtered.map((l) => (
                <label key={l.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 cursor-pointer text-sm">
                  <Checkbox
                    checked={selected.has(l.id)}
                    onCheckedChange={(c) => {
                      const next = new Set(selected);
                      if (c) next.add(l.id); else next.delete(l.id);
                      setSelected(next);
                    }}
                  />
                  <span className="flex-1">{l.name}</span>
                  <span className="text-xs text-muted-foreground">{l.count} contacts</span>
                </label>
              ))}
            </div>
          </>
        )}
        {error && <div className="text-sm text-red-600">{error}</div>}
        {syncStarted && (
          <div className="text-sm text-green-700 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Sync started. Track progress in Settings & Jobs.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Saved Searches tab
// ============================================================================
function SavedSearchesTab({ disabled }: { disabled: boolean }) {
  const [rows, setRows] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(false);
  const [runResult, setRunResult] = useState<Record<string, any>>({});
  const [running, setRunning] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/apollo/saved-searches');
      if (res.ok) { const d = await res.json(); setRows(d.searches || []); }
    } finally { setLoading(false); }
  };

  useEffect(() => { if (!disabled) load(); }, [disabled]);

  const handleRun = async (id: string) => {
    setRunning(id);
    try {
      const res = await fetch(`/api/apollo/saved-searches/${id}/run`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) setRunResult({ ...runResult, [id]: data });
    } finally { setRunning(null); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this saved search?')) return;
    await fetch(`/api/apollo/saved-searches/${id}`, { method: 'DELETE' });
    load();
  };

  if (disabled) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground">Connect Apollo to use saved searches.</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Saved searches</CardTitle>
        <CardDescription>Re-run a saved filter combo to see only contacts added to Apollo since last run.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No saved searches yet. Save one from the Search Apollo tab.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const result = runResult[r.id];
              return (
                <div key={r.id} className="border rounded p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.lastRunAt ? `Last run ${new Date(r.lastRunAt).toLocaleString()}` : 'Never run'}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => handleRun(r.id)} disabled={running === r.id}>
                      {running === r.id ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
                      Run
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(r.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {result && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Total: <strong>{result.total}</strong> ·
                      New since last run: <strong className="text-amber-700">{result.newSinceLastRun}</strong> ·
                      Already in aimailpilot: <strong>{result.summary?.alreadyInSystem ?? 0}</strong>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
