import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Zap, AlertTriangle, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";

interface ApolloList {
  id: string;
  name: string;
  count: number;
}

interface ApolloSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactLists: Array<{ id: string; name: string }>;
  onSyncComplete?: () => void;
}

type Step = 'loading' | 'not_configured' | 'pick_lists' | 'preview' | 'running' | 'done' | 'error';

export default function ApolloSyncDialog({ open, onOpenChange, contactLists, onSyncComplete }: ApolloSyncDialogProps) {
  const [step, setStep] = useState<Step>('loading');
  const [error, setError] = useState<string>('');
  const [apolloLists, setApolloLists] = useState<ApolloList[]>([]);
  const [selectedListIds, setSelectedListIds] = useState<Set<string>>(new Set());
  const [targetListId, setTargetListId] = useState<string>('');
  const [newListName, setNewListName] = useState<string>('');
  const [useNewList, setUseNewList] = useState<boolean>(true);
  const [overwriteMode, setOverwriteMode] = useState<'fill_blanks_only' | 'apollo_wins'>('fill_blanks_only');
  const [preview, setPreview] = useState<any>(null);
  const [previewing, setPreviewing] = useState(false);
  const [jobId, setJobId] = useState<string>('');
  const [job, setJob] = useState<any>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setStep('loading');
      setError('');
      try {
        const s = await fetch('/api/apollo/settings').then((r) => r.json());
        if (!s.configured) {
          setStep('not_configured');
          return;
        }
        setOverwriteMode(s.overwriteMode || 'fill_blanks_only');
        const l = await fetch('/api/apollo/lists').then((r) => r.json());
        if (!l.lists) {
          setError(l.message || 'Failed to load Apollo lists');
          setStep('error');
          return;
        }
        setApolloLists(l.lists);
        setStep('pick_lists');
      } catch (e: any) {
        setError(e?.message || 'Failed to load');
        setStep('error');
      }
    })();
  }, [open]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setSelectedListIds(new Set());
        setPreview(null);
        setJobId('');
        setJob(null);
        setNewListName('');
        setTargetListId('');
      }, 300);
    }
  }, [open]);

  // Poll job while running
  useEffect(() => {
    if (step !== 'running' || !jobId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/apollo/sync/jobs/${jobId}`);
        if (res.ok) {
          const data = await res.json();
          if (stopped) return;
          setJob(data.job);
          if (['completed', 'failed', 'cancelled'].includes(data.job.status)) {
            setStep('done');
            if (data.job.status === 'completed' && onSyncComplete) onSyncComplete();
            return;
          }
        }
      } catch (e) { /* ignore */ }
      if (!stopped) setTimeout(poll, 2500);
    };
    poll();
    return () => { stopped = true; };
  }, [step, jobId, onSyncComplete]);

  const toggleList = (id: string) => {
    const next = new Set(selectedListIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedListIds(next);
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setError('');
    try {
      const res = await fetch('/api/apollo/sync/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listIds: Array.from(selectedListIds) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Preview failed');
        return;
      }
      setPreview(data);
      setStep('preview');
    } catch (e: any) {
      setError(e?.message || 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const handleStart = async () => {
    setError('');
    try {
      let finalTargetListId: string | null = null;
      if (useNewList) {
        if (!newListName.trim()) {
          setError('Please name the new list');
          return;
        }
        const createRes = await fetch('/api/contact-lists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newListName.trim(), description: 'Imported from Apollo', source: 'apollo' }),
        });
        if (createRes.ok) {
          const created = await createRes.json();
          finalTargetListId = created.id || created?.list?.id || null;
        }
      } else if (targetListId) {
        finalTargetListId = targetListId;
      }

      const names = apolloLists
        .filter((l) => selectedListIds.has(l.id))
        .map((l) => l.name);

      const res = await fetch('/api/apollo/sync/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listIds: Array.from(selectedListIds),
          listNames: names,
          targetListId: finalTargetListId,
          overwriteMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Failed to start sync');
        return;
      }
      setJobId(data.jobId);
      setStep('running');
    } catch (e: any) {
      setError(e?.message || 'Failed to start sync');
    }
  };

  const handleCancel = async () => {
    if (!jobId) return;
    await fetch(`/api/apollo/sync/jobs/${jobId}/cancel`, { method: 'POST' });
  };

  const selectedCount = selectedListIds.size;
  const totalSelected = apolloLists.filter((l) => selectedListIds.has(l.id)).reduce((a, b) => a + b.count, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-purple-600" /> Sync from Apollo
          </DialogTitle>
          <DialogDescription>
            Import saved lists and enrich existing contacts using Apollo data you've already paid for. No credits consumed.
          </DialogDescription>
        </DialogHeader>

        {step === 'loading' && (
          <div className="py-10 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
          </div>
        )}

        {step === 'not_configured' && (
          <div className="py-6 space-y-3">
            <div className="flex items-start gap-2 text-sm">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
              <div>
                Apollo API key not configured for this organization.
                <div className="text-xs text-muted-foreground mt-1">
                  An admin needs to add the API key in{' '}
                  <a href="/?view=apollo-settings" className="text-blue-600 hover:underline">
                    Apollo Settings
                  </a>.
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 'error' && (
          <div className="py-6 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}

        {step === 'pick_lists' && (
          <div className="space-y-4">
            <div>
              <Label>Pick Apollo saved lists</Label>
              <div className="text-xs text-muted-foreground mb-2">
                {apolloLists.length} lists available. Only the records already in your Apollo account will be pulled.
              </div>
              <div className="border rounded max-h-72 overflow-y-auto">
                {apolloLists.length === 0 ? (
                  <div className="p-4 text-sm text-muted-foreground text-center">
                    No saved lists found in your Apollo account.
                  </div>
                ) : apolloLists.map((l) => (
                  <label key={l.id} className="flex items-center gap-3 p-2 px-3 hover:bg-gray-50 cursor-pointer border-b last:border-b-0">
                    <Checkbox
                      checked={selectedListIds.has(l.id)}
                      onCheckedChange={() => toggleList(l.id)}
                    />
                    <span className="flex-1 text-sm">{l.name}</span>
                    {l.count > 0 && <Badge variant="outline">{l.count.toLocaleString()}</Badge>}
                  </label>
                ))}
              </div>
              {selectedCount > 0 && (
                <div className="text-xs text-muted-foreground mt-2">
                  {selectedCount} list{selectedCount > 1 ? 's' : ''} selected
                  {totalSelected > 0 ? ` · ~${totalSelected.toLocaleString()} contacts` : ''}
                </div>
              )}
            </div>

            <div>
              <Label>Target list in aimailpilot (for new contacts)</Label>
              <div className="flex flex-col gap-2 mt-1">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={useNewList} onChange={() => setUseNewList(true)} />
                  Create new list
                </label>
                {useNewList && (
                  <Input
                    placeholder="e.g. Apollo Q2 2026 prospects"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                  />
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={!useNewList} onChange={() => setUseNewList(false)} />
                  Add to existing list
                </label>
                {!useNewList && (
                  <select
                    className="border rounded px-2 py-1.5 text-sm"
                    value={targetListId}
                    onChange={(e) => setTargetListId(e.target.value)}
                  >
                    <option value="">— pick a list —</option>
                    {contactLists.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div>
              <Label>Existing contacts (enrichment)</Label>
              <div className="flex flex-col gap-1 mt-1 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={overwriteMode === 'fill_blanks_only'} onChange={() => setOverwriteMode('fill_blanks_only')} />
                  Fill blanks only (recommended)
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={overwriteMode === 'apollo_wins'} onChange={() => setOverwriteMode('apollo_wins')} />
                  Apollo wins — overwrite existing fields
                </label>
              </div>
            </div>

            {error && <div className="text-sm text-red-700">{error}</div>}
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="space-y-3">
            <div className="rounded-lg bg-blue-50 p-4 text-sm">
              <div className="font-medium mb-1">Dry-run summary</div>
              <div>Total found: <strong>{preview.totalFound}</strong> contacts in selected Apollo lists</div>
              <div className="text-xs text-muted-foreground mt-1">
                Actual new/enrich counts are computed per-contact during the sync. These samples are from the first 25.
              </div>
            </div>

            <div>
              <div className="text-sm font-medium mb-1">Sample of new contacts to import ({preview.samples.wouldImport.length})</div>
              {preview.samples.wouldImport.length === 0 ? (
                <div className="text-xs text-muted-foreground">None in first 25 — all already in aimailpilot</div>
              ) : (
                <div className="text-xs border rounded divide-y">
                  {preview.samples.wouldImport.map((c: any) => (
                    <div key={c.email} className="p-2 flex justify-between">
                      <span>{c.name || '(no name)'}</span>
                      <span className="text-muted-foreground">{c.email} · {c.company}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-sm font-medium mb-1">Sample of contacts to enrich ({preview.samples.wouldEnrich.length})</div>
              {preview.samples.wouldEnrich.length === 0 ? (
                <div className="text-xs text-muted-foreground">None in first 25 need enrichment</div>
              ) : (
                <div className="text-xs border rounded divide-y">
                  {preview.samples.wouldEnrich.map((c: any) => (
                    <div key={c.email} className="p-2">
                      <div className="flex justify-between">
                        <span>{c.name || '(no name)'}</span>
                        <span className="text-muted-foreground">{c.email}</span>
                      </div>
                      <div className="text-muted-foreground">Will fill: {c.fieldsToFill.join(', ')}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {preview.samples.alreadyCurrent > 0 && (
              <div className="text-xs text-muted-foreground">
                {preview.samples.alreadyCurrent} / 25 sampled contacts already up to date.
              </div>
            )}

            {error && <div className="text-sm text-red-700">{error}</div>}
          </div>
        )}

        {step === 'running' && (
          <div className="py-6 space-y-3">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-purple-600" />
              <div>
                <div className="font-medium text-sm">Sync in progress…</div>
                <div className="text-xs text-muted-foreground">
                  {job?.processed || 0}/{job?.totalFound || '?'} processed
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="border rounded p-2 text-center">
                <div className="text-muted-foreground">New</div>
                <div className="font-semibold">{job?.imported || 0}</div>
              </div>
              <div className="border rounded p-2 text-center">
                <div className="text-muted-foreground">Enriched</div>
                <div className="font-semibold">{job?.enriched || 0}</div>
              </div>
              <div className="border rounded p-2 text-center">
                <div className="text-muted-foreground">Already current</div>
                <div className="font-semibold">{job?.alreadyCurrent || 0}</div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              You can close this dialog — the sync will keep running. Check progress on the Apollo Settings page.
            </div>
          </div>
        )}

        {step === 'done' && job && (
          <div className="py-6 space-y-3">
            <div className="flex items-center gap-2">
              {job.status === 'completed' ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <div className="font-medium">Sync complete</div>
                </>
              ) : job.status === 'cancelled' ? (
                <>
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  <div className="font-medium">Sync cancelled</div>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                  <div className="font-medium">Sync failed</div>
                </>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="border rounded p-2 text-center">
                <div className="text-muted-foreground">New</div>
                <div className="font-semibold">{job.imported || 0}</div>
              </div>
              <div className="border rounded p-2 text-center">
                <div className="text-muted-foreground">Enriched</div>
                <div className="font-semibold">{job.enriched || 0}</div>
              </div>
              <div className="border rounded p-2 text-center">
                <div className="text-muted-foreground">Already current</div>
                <div className="font-semibold">{job.alreadyCurrent || 0}</div>
              </div>
            </div>
            {job.errorMessage && <div className="text-xs text-red-600">{job.errorMessage}</div>}
          </div>
        )}

        <DialogFooter>
          {step === 'pick_lists' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                onClick={handlePreview}
                disabled={selectedCount === 0 || previewing}
              >
                {previewing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Preview
              </Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setStep('pick_lists')}>Back</Button>
              <Button onClick={handleStart}>
                Start sync
              </Button>
            </>
          )}
          {step === 'running' && (
            <>
              <Button variant="outline" onClick={handleCancel}>Cancel sync</Button>
              <Button onClick={() => onOpenChange(false)}>Close (keep running)</Button>
            </>
          )}
          {(step === 'done' || step === 'error' || step === 'not_configured') && (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
