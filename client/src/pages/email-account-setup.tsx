import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { 
  Mail, Plus, Trash2, TestTube, CheckCircle, XCircle, 
  Loader2, Shield, Eye, EyeOff, AlertCircle, Inbox, Server,
  ExternalLink, Zap, Globe, Lock, Send
} from "lucide-react";

interface EmailAccount {
  id: string;
  email: string;
  displayName: string;
  provider: string;
  isActive: boolean;
  dailyLimit: number;
  dailySent: number;
  smtpConfig?: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
    fromName: string;
    fromEmail: string;
    replyTo: string;
  };
  createdAt: string;
}

interface SmtpPreset {
  id: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
}

export default function EmailAccountSetup({ onAccountAdded }: { onAccountAdded?: () => void }) {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [presets, setPresets] = useState<SmtpPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; error?: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [formProvider, setFormProvider] = useState('gmail');
  const [formEmail, setFormEmail] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formSmtpHost, setFormSmtpHost] = useState('smtp.gmail.com');
  const [formSmtpPort, setFormSmtpPort] = useState(587);
  const [formSmtpSecure, setFormSmtpSecure] = useState(false);
  const [formSmtpUser, setFormSmtpUser] = useState('');
  const [formSmtpPass, setFormSmtpPass] = useState('');
  const [formReplyTo, setFormReplyTo] = useState('');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  useEffect(() => {
    fetchAccounts();
    fetchPresets();
  }, []);

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/email-accounts', { credentials: 'include' });
      if (res.ok) setAccounts(await res.json());
    } catch (e) { console.error('Failed to fetch accounts:', e); }
    setLoading(false);
  };

  const fetchPresets = async () => {
    try {
      const res = await fetch('/api/smtp-presets', { credentials: 'include' });
      if (res.ok) setPresets(await res.json());
    } catch (e) { /* ignore */ }
  };

  const handleProviderChange = (provider: string) => {
    setFormProvider(provider);
    const preset = presets.find(p => p.id === provider);
    if (preset) {
      setFormSmtpHost(preset.host);
      setFormSmtpPort(preset.port);
      setFormSmtpSecure(preset.secure);
    }
  };

  const handleAddAccount = async () => {
    setFormError('');
    if (!formEmail || !formSmtpUser || !formSmtpPass) {
      setFormError('Email, SMTP username, and app password are required');
      return;
    }
    setFormLoading(true);
    try {
      const res = await fetch('/api/email-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          provider: formProvider,
          email: formEmail,
          displayName: formDisplayName || formEmail,
          smtpHost: formSmtpHost,
          smtpPort: formSmtpPort,
          smtpSecure: formSmtpSecure,
          smtpUser: formSmtpUser,
          smtpPass: formSmtpPass,
          replyTo: formReplyTo,
        }),
      });
      if (res.ok) {
        setShowAddDialog(false);
        resetForm();
        await fetchAccounts();
        onAccountAdded?.();
      } else {
        const err = await res.json();
        setFormError(err.message || 'Failed to add account');
      }
    } catch (e) {
      setFormError('Network error. Please try again.');
    }
    setFormLoading(false);
  };

  const handleTestAccount = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const res = await fetch(`/api/email-accounts/${id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setTestResult({ id, success: data.success, error: data.error });
    } catch (e) {
      setTestResult({ id, success: false, error: 'Network error' });
    }
    setTestingId(null);
  };

  const handleDeleteAccount = async (id: string) => {
    if (!confirm('Are you sure you want to delete this email account?')) return;
    try {
      await fetch(`/api/email-accounts/${id}`, { method: 'DELETE', credentials: 'include' });
      await fetchAccounts();
    } catch (e) { console.error('Delete failed:', e); }
  };

  const resetForm = () => {
    setFormProvider('gmail');
    setFormEmail('');
    setFormDisplayName('');
    setFormSmtpHost('smtp.gmail.com');
    setFormSmtpPort(587);
    setFormSmtpSecure(false);
    setFormSmtpUser('');
    setFormSmtpPass('');
    setFormReplyTo('');
    setFormError('');
    setShowPassword(false);
  };

  const getProviderConfig = (provider: string) => {
    const configs: Record<string, { icon: string; color: string; bg: string; text: string; limit: number }> = {
      gmail: { icon: '📧', color: 'from-red-500 to-red-600', bg: 'bg-red-50', text: 'text-red-700', limit: 2000 },
      outlook: { icon: '📨', color: 'from-blue-500 to-blue-600', bg: 'bg-blue-50', text: 'text-blue-700', limit: 300 },
      office365: { icon: '📨', color: 'from-blue-600 to-indigo-600', bg: 'bg-indigo-50', text: 'text-indigo-700', limit: 10000 },
      custom: { icon: '✉️', color: 'from-gray-500 to-gray-600', bg: 'bg-gray-50', text: 'text-gray-700', limit: 500 },
    };
    return configs[provider] || configs.custom;
  };

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-gray-200/60 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-blue-50 p-2.5 rounded-xl">
              <Inbox className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{accounts.length}</div>
              <div className="text-[11px] text-gray-400 font-medium">Connected Accounts</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/60 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-emerald-50 p-2.5 rounded-xl">
              <Shield className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{accounts.filter(a => a.isActive).length}</div>
              <div className="text-[11px] text-gray-400 font-medium">Active & Verified</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/60 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-purple-50 p-2.5 rounded-xl">
              <Send className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">
                {accounts.reduce((sum, a) => sum + (a.dailyLimit || 500), 0).toLocaleString()}
              </div>
              <div className="text-[11px] text-gray-400 font-medium">Total Daily Capacity</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-400">
          Configure SMTP accounts to send campaigns via Gmail, Outlook, or custom SMTP
        </div>
        <Button 
          className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-sm shadow-blue-200/50" 
          size="sm"
          onClick={() => { resetForm(); setShowAddDialog(true); }}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Account
        </Button>
      </div>

      {/* Accounts List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-gray-400">Loading accounts...</span>
          </div>
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 w-20 h-20 rounded-2xl flex items-center justify-center mb-5 shadow-sm">
            <Mail className="h-10 w-10 text-blue-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1.5">No email accounts configured</h3>
          <p className="text-sm text-gray-400 mb-6 max-w-md text-center">
            Add your Gmail or Outlook account using SMTP to start sending personalized email campaigns
          </p>
          <Button 
            className="bg-gradient-to-r from-blue-600 to-indigo-600 shadow-sm" 
            onClick={() => { resetForm(); setShowAddDialog(true); }}
          >
            <Plus className="h-4 w-4 mr-2" /> Add Your First Account
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => {
            const providerConfig = getProviderConfig(account.provider);
            const quota = account.dailyLimit || 500;
            const sent = account.dailySent || 0;
            const quotaPercent = Math.min((sent / quota) * 100, 100);
            const isTestingThis = testingId === account.id;
            const thisTestResult = testResult?.id === account.id ? testResult : null;

            return (
              <Card key={account.id} className="border-gray-200/60 shadow-sm hover:shadow-md transition-all group overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex items-center gap-4 p-4">
                    {/* Provider Icon */}
                    <div className={`w-12 h-12 rounded-xl ${providerConfig.bg} flex items-center justify-center text-2xl flex-shrink-0 shadow-sm`}>
                      {providerConfig.icon}
                    </div>

                    {/* Account Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-semibold text-gray-900 text-sm">{account.displayName || account.email}</span>
                        <Badge variant="outline" className={`text-[10px] font-semibold capitalize ${providerConfig.bg} ${providerConfig.text} border-0`}>
                          {account.provider}
                        </Badge>
                        {account.isActive ? (
                          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 border text-[10px]">
                            <CheckCircle className="h-3 w-3 mr-0.5" /> Active
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">Inactive</Badge>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mb-2">{account.email}</div>

                      {/* SMTP & Quota Info */}
                      <div className="flex items-center gap-4 text-[11px] text-gray-400">
                        <span className="flex items-center gap-1">
                          <Server className="h-3 w-3" />
                          {account.smtpConfig?.host}:{account.smtpConfig?.port}
                        </span>
                        <span className="flex items-center gap-1">
                          <Lock className="h-3 w-3" />
                          {account.smtpConfig?.secure ? 'SSL/TLS' : 'STARTTLS'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Zap className="h-3 w-3" />
                          {quota.toLocaleString()} emails/day
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Test result inline */}
                      {thisTestResult && (
                        <div className="mr-1">
                          {thisTestResult.success ? (
                            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 border text-xs">
                              <CheckCircle className="h-3 w-3 mr-1" /> Connected
                            </Badge>
                          ) : (
                            <Badge className="bg-red-50 text-red-700 border-red-200 border text-xs max-w-[200px] truncate" title={thisTestResult.error}>
                              <XCircle className="h-3 w-3 mr-1 flex-shrink-0" /> {thisTestResult.error || 'Failed'}
                            </Badge>
                          )}
                        </div>
                      )}

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestAccount(account.id)}
                        disabled={isTestingThis}
                        className="h-8 text-xs"
                      >
                        {isTestingThis ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <><TestTube className="h-3.5 w-3.5 mr-1" /> Test</>
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteAccount(account.id)}
                        className="h-8 w-8 p-0 text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Quota Progress Bar */}
                  <div className="px-4 pb-3">
                    <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                      <span>Daily quota used</span>
                      <span>{sent} / {quota.toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all ${quotaPercent > 80 ? 'bg-amber-500' : quotaPercent > 95 ? 'bg-red-500' : 'bg-blue-500'}`} 
                        style={{ width: `${quotaPercent}%` }} 
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Help Section */}
      <Card className="border-blue-100 bg-gradient-to-br from-blue-50/80 to-indigo-50/50">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <div className="bg-blue-100 p-2 rounded-xl flex-shrink-0">
              <Shield className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h4 className="font-semibold text-blue-900 mb-2 text-sm">How to set up SMTP</h4>
              <div className="text-sm text-blue-800/80 space-y-2">
                <div className="flex items-start gap-2">
                  <span className="bg-blue-200 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5">Gmail</span>
                  <span>Enable 2-Step Verification, then go to{' '}
                    <a href="https://myaccount.google.com/apppasswords" target="_blank" className="underline font-medium text-blue-700 hover:text-blue-900 inline-flex items-center gap-0.5">
                      App Passwords <ExternalLink className="h-3 w-3" />
                    </a> and generate a password for "Mail". Daily limit: 2,000 emails.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="bg-blue-200 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5">Outlook</span>
                  <span>Go to Settings, then Mail, then Sync email and enable POP/IMAP/SMTP. Use your password or an app password if 2FA is enabled. Daily limit: 300 emails.</span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add Account Dialog */}
      <Dialog open={showAddDialog} onOpenChange={(open) => { setShowAddDialog(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-blue-50 p-2 rounded-lg">
                <Mail className="h-4 w-4 text-blue-600" />
              </div>
              Add Email Account
            </DialogTitle>
            <DialogDescription>
              Connect your email account via SMTP to send campaigns
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Provider Selection */}
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Email Provider</Label>
              <Select value={formProvider} onValueChange={handleProviderChange}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gmail">
                    <span className="flex items-center gap-2">📧 Gmail (Google)</span>
                  </SelectItem>
                  <SelectItem value="outlook">
                    <span className="flex items-center gap-2">📨 Outlook / Hotmail</span>
                  </SelectItem>
                  <SelectItem value="office365">
                    <span className="flex items-center gap-2">📨 Office 365</span>
                  </SelectItem>
                  <SelectItem value="custom">
                    <span className="flex items-center gap-2">✉️ Custom SMTP</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Provider-specific alerts */}
            {formProvider === 'gmail' && (
              <Alert className="border-blue-200 bg-blue-50/50">
                <AlertCircle className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-sm text-blue-800">
                  <strong>Gmail requires an App Password.</strong> Go to{' '}
                  <a href="https://myaccount.google.com/apppasswords" target="_blank" className="underline font-medium inline-flex items-center gap-0.5">
                    Google App Passwords <ExternalLink className="h-3 w-3" />
                  </a>{' '}
                  and generate one for "Mail". 2-Step Verification must be enabled first.
                </AlertDescription>
              </Alert>
            )}
            {(formProvider === 'outlook' || formProvider === 'office365') && (
              <Alert className="border-blue-200 bg-blue-50/50">
                <AlertCircle className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-sm text-blue-800">
                  <strong>Enable SMTP auth in Outlook.</strong> Go to Settings, then Mail, then Sync email and enable POP/IMAP/SMTP. Use your regular password or app password if 2FA is enabled.
                </AlertDescription>
              </Alert>
            )}

            {/* Email & Display Name */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Email Address *</Label>
                <Input
                  type="email"
                  placeholder="you@gmail.com"
                  value={formEmail}
                  onChange={(e) => {
                    setFormEmail(e.target.value);
                    if (!formSmtpUser) setFormSmtpUser(e.target.value);
                  }}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Display Name</Label>
                <Input
                  placeholder="Your Name"
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  className="mt-1.5"
                />
              </div>
            </div>

            {/* SMTP Settings */}
            <div className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50/50">
              <div className="flex items-center gap-2 mb-1">
                <Server className="h-4 w-4 text-gray-500" />
                <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">SMTP Configuration</h4>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs text-gray-500">Host</Label>
                  <Input value={formSmtpHost} onChange={(e) => setFormSmtpHost(e.target.value)} placeholder="smtp.gmail.com" className="mt-1 bg-white" />
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Port</Label>
                  <Input type="number" value={formSmtpPort} onChange={(e) => setFormSmtpPort(parseInt(e.target.value))} className="mt-1 bg-white" />
                </div>
              </div>
              <div>
                <Label className="text-xs text-gray-500">SMTP Username *</Label>
                <Input value={formSmtpUser} onChange={(e) => setFormSmtpUser(e.target.value)} placeholder="your-email@gmail.com" className="mt-1 bg-white" />
              </div>
              <div>
                <Label className="text-xs text-gray-500">App Password / SMTP Password *</Label>
                <div className="relative mt-1">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={formSmtpPass}
                    onChange={(e) => setFormSmtpPass(e.target.value)}
                    placeholder="Your app password"
                    className="pr-10 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2">
                  <Switch checked={formSmtpSecure} onCheckedChange={setFormSmtpSecure} />
                  <Label className="text-xs text-gray-600">Use SSL/TLS (port 465)</Label>
                </div>
                <Lock className="h-3.5 w-3.5 text-gray-300" />
              </div>
            </div>

            {/* Reply-To */}
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Reply-To Address <span className="text-gray-400 normal-case font-normal">(optional)</span></Label>
              <Input
                type="email"
                placeholder="replies@yourdomain.com"
                value={formReplyTo}
                onChange={(e) => setFormReplyTo(e.target.value)}
                className="mt-1.5"
              />
            </div>

            {formError && (
              <Alert variant="destructive" className="py-2">
                <XCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">{formError}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
            <Button
              onClick={handleAddAccount}
              disabled={formLoading}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
            >
              {formLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Add Account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
