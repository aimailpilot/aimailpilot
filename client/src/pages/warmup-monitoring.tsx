import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Flame, Snowflake, TrendingUp, Mail, AlertTriangle, Check,
  Plus, Trash2, RefreshCw, Loader2, BarChart3, Shield,
  ArrowUp, ArrowDown, Minus, Target, Inbox, XCircle, ThumbsUp,
  ChevronDown, ChevronUp, Zap, Activity
} from "lucide-react";

interface WarmupAccount {
  id: string;
  organizationId: string;
  emailAccountId: string;
  accountEmail?: string;
  provider?: string;
  status: string;
  dailyTarget: number;
  currentDaily: number;
  totalSent: number;
  totalReceived: number;
  inboxRate: number;
  spamRate: number;
  reputationScore: number;
  startDate: string;
  lastWarmupAt: string | null;
  settings: any;
  createdAt: string;
}

interface WarmupLog {
  id: string;
  warmupAccountId: string;
  date: string;
  sent: number;
  received: number;
  inboxCount: number;
  spamCount: number;
  bounceCount: number;
  openCount: number;
  replyCount: number;
}

export default function WarmupMonitoring() {
  const [warmupAccounts, setWarmupAccounts] = useState<WarmupAccount[]>([]);
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newAccountId, setNewAccountId] = useState('');
  const [newTarget, setNewTarget] = useState('5');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, WarmupLog[]>>({});
  const [runningNow, setRunningNow] = useState(false);
  const [lastRunResult, setLastRunResult] = useState<any>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [warmupRes, accountsRes] = await Promise.all([
        fetch('/api/warmup', { credentials: 'include' }),
        fetch('/api/email-accounts', { credentials: 'include' }),
      ]);
      if (warmupRes.ok) setWarmupAccounts(await warmupRes.json());
      if (accountsRes.ok) setEmailAccounts(await accountsRes.json());
    } catch (e) {
      console.error('Failed to load warmup data:', e);
    } finally {
      setLoading(false);
    }
  };

  const addWarmupAccount = async () => {
    if (!newAccountId) return;
    try {
      const resp = await fetch('/api/warmup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ emailAccountId: newAccountId, dailyTarget: parseInt(newTarget) || 5 }),
      });
      if (resp.ok) {
        fetchData();
        setShowAddDialog(false);
        setNewAccountId('');
        setNewTarget('5');
      }
    } catch (e) {
      console.error('Failed to add warmup account:', e);
    }
  };

  const deleteWarmupAccount = async (id: string) => {
    if (!confirm('Remove this account from warmup monitoring?')) return;
    try {
      await fetch(`/api/warmup/${id}`, { method: 'DELETE', credentials: 'include' });
      setWarmupAccounts(prev => prev.filter(a => a.id !== id));
    } catch (e) {
      console.error('Failed to delete warmup account:', e);
    }
  };

  const runNow = async () => {
    setRunningNow(true);
    setLastRunResult(null);
    try {
      const resp = await fetch('/api/warmup/run-now', {
        method: 'POST',
        credentials: 'include',
      });
      if (resp.ok) {
        const data = await resp.json();
        setLastRunResult(data.result);
        fetchData(); // refresh accounts to show updated stats
      }
    } catch (e) {
      console.error('Failed to run warmup:', e);
    } finally {
      setRunningNow(false);
    }
  };

  const toggleExpanded = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!logs[id]) {
      try {
        const resp = await fetch(`/api/warmup/${id}/logs`, { credentials: 'include' });
        if (resp.ok) {
          const data = await resp.json();
          setLogs(prev => ({ ...prev, [id]: data }));
        }
      } catch (e) { /* ignore */ }
    }
  };

  const updateWarmup = async (id: string, data: any) => {
    try {
      const resp = await fetch(`/api/warmup/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (resp.ok) {
        const updated = await resp.json();
        setWarmupAccounts(prev => prev.map(a => a.id === id ? updated : a));
      }
    } catch (e) { /* ignore */ }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-600 bg-emerald-50';
    if (score >= 60) return 'text-amber-600 bg-amber-50';
    return 'text-red-600 bg-red-50';
  };

  const getScoreLabel = (score: number) => {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Poor';
  };

  const getWarmupPhase = (account: WarmupAccount) => {
    const daysSinceStart = Math.floor((Date.now() - new Date(account.startDate).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSinceStart < 7) return { phase: 'Phase 1', label: 'Initial Ramp-up', color: 'text-blue-600 bg-blue-50', days: daysSinceStart };
    if (daysSinceStart < 21) return { phase: 'Phase 2', label: 'Building Reputation', color: 'text-amber-600 bg-amber-50', days: daysSinceStart };
    if (daysSinceStart < 45) return { phase: 'Phase 3', label: 'Scaling Volume', color: 'text-emerald-600 bg-emerald-50', days: daysSinceStart };
    return { phase: 'Phase 4', label: 'Fully Warmed', color: 'text-green-600 bg-green-50', days: daysSinceStart };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const existingAccountIds = new Set(warmupAccounts.map(a => a.emailAccountId));
  const availableAccounts = emailAccounts.filter(a => !existingAccountIds.has(a.id));

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
                <Flame className="h-5 w-5 text-white" />
              </div>
              Email Warmup Monitoring
            </h2>
            <p className="text-sm text-gray-500 mt-1">Track email warmup progress, inbox placement, and sender reputation</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={runNow} disabled={runningNow || warmupAccounts.length < 2} className="gap-1.5">
              {runningNow ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              {runningNow ? 'Running...' : 'Run Now'}
            </Button>
            <Button size="sm" onClick={() => setShowAddDialog(true)} className="gap-1.5 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700">
              <Plus className="h-3.5 w-3.5" /> Add Account
            </Button>
          </div>
        </div>

        {/* Add Account Dialog */}
        {showAddDialog && (
          <Card className="mb-6 border-orange-200 bg-orange-50/30">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Add Email Account to Warmup</h3>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-xs text-gray-600 mb-1 block">Email Account</label>
                  <Select value={newAccountId} onValueChange={setNewAccountId}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select account" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableAccounts.length === 0 ? (
                        <SelectItem value="none" disabled>All accounts already monitored</SelectItem>
                      ) : (
                        availableAccounts.map((a: any) => (
                          <SelectItem key={a.id} value={a.id}>{a.email} ({a.provider})</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-32">
                  <label className="text-xs text-gray-600 mb-1 block">Daily Target</label>
                  <Input type="number" min="1" max="100" value={newTarget} onChange={e => setNewTarget(e.target.value)} className="h-9 text-sm" />
                </div>
                <Button size="sm" onClick={addWarmupAccount} disabled={!newAccountId} className="h-9">Add</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAddDialog(false)} className="h-9">Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary Cards */}
        {warmupAccounts.length > 0 && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Mail className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">{warmupAccounts.length}</div>
                  <div className="text-xs text-gray-500">Accounts</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <Inbox className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">
                    {warmupAccounts.length > 0 ? Math.round(warmupAccounts.reduce((sum, a) => sum + a.inboxRate, 0) / warmupAccounts.length) : 0}%
                  </div>
                  <div className="text-xs text-gray-500">Avg Inbox Rate</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">
                    {warmupAccounts.length > 0 ? Math.round(warmupAccounts.reduce((sum, a) => sum + a.spamRate, 0) / warmupAccounts.length) : 0}%
                  </div>
                  <div className="text-xs text-gray-500">Avg Spam Rate</div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                  <Shield className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-gray-900">
                    {warmupAccounts.length > 0 ? Math.round(warmupAccounts.reduce((sum, a) => sum + a.reputationScore, 0) / warmupAccounts.length) : 0}
                  </div>
                  <div className="text-xs text-gray-500">Avg Reputation</div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Run Result Banner */}
        {lastRunResult && (
          <Alert className="mb-6 bg-blue-50 border-blue-200">
            <Zap className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-xs text-blue-800">
              <strong>Warmup cycle completed:</strong> {lastRunResult.sent} sent, {lastRunResult.received} received, {lastRunResult.opened} opened, {lastRunResult.replied} replied
              {lastRunResult.errors?.length > 0 && <span className="text-red-600 ml-2">({lastRunResult.errors.length} errors)</span>}
              <button className="ml-2 underline" onClick={() => setLastRunResult(null)}>dismiss</button>
            </AlertDescription>
          </Alert>
        )}

        {/* Account List */}
        {warmupAccounts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-100 to-red-100 flex items-center justify-center mb-4">
                <Flame className="h-8 w-8 text-orange-400" />
              </div>
              <h3 className="text-base font-semibold text-gray-700 mb-1">No Warmup Accounts</h3>
              <p className="text-sm text-gray-400 text-center max-w-sm mb-4">
                Start warming up your email accounts to improve deliverability and inbox placement rates.
              </p>
              <Button size="sm" onClick={() => setShowAddDialog(true)} className="gap-1.5 bg-gradient-to-r from-orange-500 to-red-600">
                <Plus className="h-3.5 w-3.5" /> Add Your First Account
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {warmupAccounts.map(account => {
              const phase = getWarmupPhase(account);
              const isExpanded = expandedId === account.id;
              const accountLogs = logs[account.id] || [];

              return (
                <Card key={account.id} className="overflow-hidden">
                  <CardContent className="p-0">
                    {/* Account header */}
                    <div className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50/50" onClick={() => toggleExpanded(account.id)}>
                      {/* Reputation gauge */}
                      <div className={`w-14 h-14 rounded-xl flex flex-col items-center justify-center ${getScoreColor(account.reputationScore)}`}>
                        <span className="text-lg font-bold">{Math.round(account.reputationScore)}</span>
                        <span className="text-[8px] font-medium uppercase">{getScoreLabel(account.reputationScore)}</span>
                      </div>

                      {/* Account info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-gray-900 text-sm">{account.accountEmail || 'Unknown Account'}</span>
                          <Badge variant="outline" className={`text-[9px] ${phase.color}`}>{phase.phase}: {phase.label}</Badge>
                          <Badge variant="outline" className={`text-[9px] ${account.status === 'active' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                            {account.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>Day {phase.days} of warmup</span>
                          <span>Daily: {account.currentDaily}/{account.dailyTarget}</span>
                          <span>Total: {account.totalSent} sent / {account.totalReceived} received</span>
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <div className="text-sm font-bold text-emerald-600">{account.inboxRate}%</div>
                          <div className="text-[10px] text-gray-500">Inbox</div>
                        </div>
                        <div className="text-center">
                          <div className="text-sm font-bold text-red-600">{account.spamRate}%</div>
                          <div className="text-[10px] text-gray-500">Spam</div>
                        </div>
                        <div className="flex items-center gap-1">
                          {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => {
                          e.stopPropagation();
                          updateWarmup(account.id, { status: account.status === 'active' ? 'paused' : 'active' });
                        }}>
                          {account.status === 'active' ? <Minus className="h-4 w-4 text-amber-500" /> : <Zap className="h-4 w-4 text-green-500" />}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-400 hover:text-red-600" onClick={(e) => {
                          e.stopPropagation();
                          deleteWarmupAccount(account.id);
                        }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Expanded: Daily Logs */}
                    {isExpanded && (
                      <div className="border-t bg-gray-50/50 p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Activity className="h-4 w-4 text-indigo-500" />
                          <h4 className="text-sm font-semibold text-gray-700">Daily Warmup Logs</h4>
                        </div>

                        {/* Warmup settings */}
                        <div className="grid grid-cols-3 gap-3 mb-4">
                          <div className="bg-white rounded-lg border p-3">
                            <label className="text-[10px] text-gray-500 uppercase font-medium">Daily Target</label>
                            <div className="flex items-center gap-2 mt-1">
                              <Input type="number" min="1" max="200" value={account.dailyTarget} className="h-8 text-sm w-20"
                                onChange={(e) => updateWarmup(account.id, { dailyTarget: parseInt(e.target.value) || 5 })} />
                              <span className="text-xs text-gray-500">emails/day</span>
                            </div>
                          </div>
                          <div className="bg-white rounded-lg border p-3">
                            <label className="text-[10px] text-gray-500 uppercase font-medium">Inbox Placement</label>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 bg-gray-200 rounded-full h-2.5">
                                <div className="bg-emerald-500 rounded-full h-2.5 transition-all" style={{ width: `${account.inboxRate}%` }} />
                              </div>
                              <span className="text-sm font-semibold text-emerald-600">{account.inboxRate}%</span>
                            </div>
                          </div>
                          <div className="bg-white rounded-lg border p-3">
                            <label className="text-[10px] text-gray-500 uppercase font-medium">Spam Rate</label>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 bg-gray-200 rounded-full h-2.5">
                                <div className="bg-red-500 rounded-full h-2.5 transition-all" style={{ width: `${account.spamRate}%` }} />
                              </div>
                              <span className="text-sm font-semibold text-red-600">{account.spamRate}%</span>
                            </div>
                          </div>
                        </div>

                        {/* Logs table */}
                        {accountLogs.length > 0 ? (
                          <div className="bg-white rounded-lg border overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-gray-50 border-b">
                                  <th className="px-3 py-2 text-left text-gray-500 font-medium">Date</th>
                                  <th className="px-3 py-2 text-right text-gray-500 font-medium">Sent</th>
                                  <th className="px-3 py-2 text-right text-gray-500 font-medium">Received</th>
                                  <th className="px-3 py-2 text-right text-emerald-600 font-medium">Inbox</th>
                                  <th className="px-3 py-2 text-right text-red-600 font-medium">Spam</th>
                                  <th className="px-3 py-2 text-right text-amber-600 font-medium">Bounce</th>
                                  <th className="px-3 py-2 text-right text-blue-600 font-medium">Opens</th>
                                  <th className="px-3 py-2 text-right text-green-600 font-medium">Replies</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {accountLogs.map(log => (
                                  <tr key={log.id} className="hover:bg-gray-50">
                                    <td className="px-3 py-2 font-medium text-gray-700">{new Date(log.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                                    <td className="px-3 py-2 text-right">{log.sent}</td>
                                    <td className="px-3 py-2 text-right">{log.received}</td>
                                    <td className="px-3 py-2 text-right text-emerald-600 font-medium">{log.inboxCount}</td>
                                    <td className="px-3 py-2 text-right text-red-600 font-medium">{log.spamCount}</td>
                                    <td className="px-3 py-2 text-right text-amber-600">{log.bounceCount}</td>
                                    <td className="px-3 py-2 text-right text-blue-600">{log.openCount}</td>
                                    <td className="px-3 py-2 text-right text-green-600">{log.replyCount}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="text-center py-8 text-sm text-gray-400">
                            No warmup logs yet. Logs will appear as warmup emails are sent and received.
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Info section */}
        <div className="mt-6">
          <Alert className="bg-orange-50 border-orange-200">
            <Flame className="h-4 w-4 text-orange-600" />
            <AlertDescription className="text-xs text-orange-800">
              <strong>Email Warmup Best Practices:</strong> Start with 5 emails/day, gradually increase by 5-10% daily. 
              Maintain inbox placement above 80%. If spam rate exceeds 5%, reduce volume immediately. 
              Full warmup typically takes 4-6 weeks for new domains.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </div>
  );
}
