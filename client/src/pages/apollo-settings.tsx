import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Key, CheckCircle2, XCircle, Loader2, Eye, EyeOff,
  RefreshCw, ExternalLink, Info, Zap, Trash2, Database,
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

export default function ApolloSettingsPage() {
  const [settings, setSettings] = useState<ApolloSettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [overwriteMode, setOverwriteMode] = useState<'fill_blanks_only' | 'apollo_wins'>('fill_blanks_only');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<ApolloJob[]>([]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/apollo/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        setOverwriteMode(data.overwriteMode || 'fill_blanks_only');
      }
    } catch (e) {
      /* ignore */
    } finally {
      setLoading(false);
    }
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

  useEffect(() => {
    loadSettings();
    loadJobs();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
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
        setApiKey('');
        await loadSettings();
      } else {
        setSaveResult({ success: false, message: data.error || data.message || 'Save failed' });
      }
    } catch (e: any) {
      setSaveResult({ success: false, message: e?.message || 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm('Remove Apollo API key? Sync will be disabled until you add a new key.')) return;
    try {
      const res = await fetch('/api/apollo/settings', { method: 'DELETE' });
      if (res.ok) {
        setSaveResult({ success: true, message: 'API key removed' });
        await loadSettings();
      }
    } catch (e) { /* ignore */ }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const credits = settings?.credits || {};

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-purple-100 flex items-center justify-center">
          <Zap className="h-5 w-5 text-purple-600" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Apollo.io Integration</h1>
          <p className="text-sm text-muted-foreground">
            Connect your organization's Apollo account to sync saved lists and enrich contacts without wasting credits
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            API Key
            {settings?.configured && (
              <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Each org uses its own Apollo API key. Find yours at{' '}
            <a
              href="https://app.apollo.io/#/settings/integrations/api"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline inline-flex items-center gap-0.5"
            >
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
                <Input
                  id="apollo-key"
                  type={showKey ? 'text' : 'password'}
                  placeholder={settings?.configured ? 'Enter new key to replace…' : 'Paste Apollo API key'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <div>
            <Label>When enriching existing contacts</Label>
            <div className="flex flex-col gap-2 mt-1">
              <label className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-gray-50">
                <input
                  type="radio"
                  name="overwriteMode"
                  value="fill_blanks_only"
                  checked={overwriteMode === 'fill_blanks_only'}
                  onChange={() => setOverwriteMode('fill_blanks_only')}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-sm">Fill blanks only (recommended)</span>
                  <span className="block text-xs text-muted-foreground">
                    Never overwrite data you already have. Safe default.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-gray-50">
                <input
                  type="radio"
                  name="overwriteMode"
                  value="apollo_wins"
                  checked={overwriteMode === 'apollo_wins'}
                  onChange={() => setOverwriteMode('apollo_wins')}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-sm">Apollo wins</span>
                  <span className="block text-xs text-muted-foreground">
                    Overwrite existing fields with Apollo's data when they differ.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save
            </Button>
            {settings?.configured && (
              <Button variant="outline" onClick={handleRemove} disabled={saving}>
                <Trash2 className="h-4 w-4 mr-2" />
                Remove key
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
              <Database className="h-4 w-4" />
              Credit Balance
              <Button variant="ghost" size="sm" onClick={loadSettings} className="ml-auto h-7">
                <RefreshCw className="h-3 w-3" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {settings.creditsError ? (
              <div className="text-sm text-red-600 flex items-center gap-2">
                <XCircle className="h-4 w-4" />
                {settings.creditsError}
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(credits)
                  .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
                  .slice(0, 8)
                  .map(([k, v]) => (
                    <div key={k} className="border rounded p-3">
                      <div className="text-xs text-muted-foreground capitalize">
                        {k.replace(/_/g, ' ')}
                      </div>
                      <div className="text-lg font-semibold">{String(v)}</div>
                    </div>
                  ))}
              </div>
            )}
            <div className="text-xs text-muted-foreground mt-3 flex items-start gap-1.5">
              <Info className="h-3 w-3 mt-0.5 shrink-0" />
              <span>
                Syncing saved lists does NOT consume credits. Credits are only used for live Apollo search
                or reveals (not part of Phase 1).
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Recent Sync Jobs
            <Button variant="ghost" size="sm" onClick={loadJobs} className="ml-auto h-7">
              <RefreshCw className="h-3 w-3" />
            </Button>
          </CardTitle>
          <CardDescription>Last 20 sync jobs for this organization</CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              No sync jobs yet. Start one from the Contacts page → Import → Apollo.
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => {
                const names = Array.isArray(job.listNames)
                  ? job.listNames
                  : typeof job.listNames === 'string'
                    ? (() => { try { return JSON.parse(job.listNames as any); } catch { return []; } })()
                    : [];
                const statusColor =
                  job.status === 'completed' ? 'text-green-700' :
                  job.status === 'failed' ? 'text-red-700' :
                  job.status === 'cancelled' ? 'text-gray-500' :
                  'text-blue-700';
                return (
                  <div key={job.id} className="border rounded p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={statusColor}>{job.status}</Badge>
                        <span className="text-muted-foreground">
                          {new Date(job.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {job.totalFound > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {job.processed}/{job.totalFound} processed
                        </span>
                      )}
                    </div>
                    {names.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Lists: {names.join(', ')}
                      </div>
                    )}
                    <div className="flex gap-3 text-xs mt-2">
                      <span>Imported: <strong>{job.imported}</strong></span>
                      <span>Enriched: <strong>{job.enriched}</strong></span>
                      <span>Already current: <strong>{job.alreadyCurrent}</strong></span>
                    </div>
                    {job.errorMessage && (
                      <div className="text-xs text-red-600 mt-1">{job.errorMessage}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
