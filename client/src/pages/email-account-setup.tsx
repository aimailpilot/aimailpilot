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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  Mail, Plus, Trash2, TestTube, CheckCircle, XCircle, 
  Loader2, Shield, Eye, EyeOff, AlertCircle, Inbox, Server,
  ExternalLink, Zap, Globe, Lock, Send, RefreshCw, Copy,
  ChevronRight, Wifi, WifiOff, Clock, Settings
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
  const [testResults, setTestResults] = useState<Map<string, { success: boolean; error?: string; timestamp?: string }>>(new Map());
  const [showPassword, setShowPassword] = useState(false);
  const [gmailUseSmtp, setGmailUseSmtp] = useState(false); // false = OAuth, true = SMTP manual

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

  // Gmail OAuth quick-connect state
  const [gmailOAuthStatus, setGmailOAuthStatus] = useState<{ available: boolean; email: string | null; hasToken: boolean }>({ available: false, email: null, hasToken: false });
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [gmailConnectError, setGmailConnectError] = useState('');
  const [gmailConnectSuccess, setGmailConnectSuccess] = useState('');

  useEffect(() => {
    fetchAccounts();
    fetchPresets();
    fetchGmailOAuthStatus();
  }, []);

  // Handle redirect from Gmail OAuth connect flow
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectedEmail = params.get('gmail_connected');
    const error = params.get('error');
    if (connectedEmail) {
      setGmailConnectSuccess(`Gmail account ${connectedEmail} connected successfully via OAuth!`);
      fetchAccounts();
      fetchGmailOAuthStatus();
      // Clean the URL
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => setGmailConnectSuccess(''), 8000);
    }
    if (error) {
      const errorMessages: Record<string, string> = {
        'oauth_not_configured': 'Google OAuth is not configured. Set up Client ID and Secret in Advanced Settings.',
        'gmail_connect_failed': 'Failed to start Gmail connection. Please try again.',
        'gmail_connect_denied': 'Gmail connection was cancelled.',
        'gmail_userinfo_failed': 'Could not retrieve Gmail account info. Please try again.',
        'gmail_connect_callback_failed': 'Gmail connection failed during callback. Please try again.',
      };
      setGmailConnectError(errorMessages[error] || `Connection error: ${error}`);
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => setGmailConnectError(''), 10000);
    }
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

  const fetchGmailOAuthStatus = async () => {
    try {
      const res = await fetch('/api/email-accounts/gmail-oauth-status', { credentials: 'include' });
      if (res.ok) setGmailOAuthStatus(await res.json());
    } catch (e) { /* ignore */ }
  };

  const handleGmailOAuthConnect = async (displayName?: string) => {
    setGmailConnecting(true);
    setGmailConnectError('');
    setGmailConnectSuccess('');
    try {
      const res = await fetch('/api/email-accounts/connect-gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ displayName }),
      });
      const data = await res.json();
      if (res.ok) {
        setGmailConnectSuccess(data.message || 'Gmail connected!');
        await fetchAccounts();
        await fetchGmailOAuthStatus();
        onAccountAdded?.();
        setTimeout(() => setGmailConnectSuccess(''), 5000);
      } else {
        setGmailConnectError(data.message || 'Failed to connect Gmail');
      }
    } catch (e) {
      setGmailConnectError('Network error. Please try again.');
    }
    setGmailConnecting(false);
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
    if (!formEmail) {
      setFormError('Email address is required');
      return;
    }
    if (!formSmtpUser) {
      setFormError('SMTP username is required');
      return;
    }
    if (!formSmtpPass) {
      setFormError('App password / SMTP password is required');
      return;
    }
    if (!formEmail.includes('@')) {
      setFormError('Please enter a valid email address');
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
        setFormError(err.message || 'Failed to add account. Please check your credentials.');
      }
    } catch (e) {
      setFormError('Network error. Please check your connection and try again.');
    }
    setFormLoading(false);
  };

  const handleTestAccount = async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch(`/api/email-accounts/${id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const data = await res.json();
      
      // Parse and improve error messages
      let error = data.error;
      if (error) {
        error = parseSmtpError(error);
      }
      
      setTestResults(prev => {
        const next = new Map(prev);
        next.set(id, { 
          success: data.success, 
          error,
          timestamp: new Date().toLocaleTimeString()
        });
        return next;
      });
    } catch (e) {
      setTestResults(prev => {
        const next = new Map(prev);
        next.set(id, { 
          success: false, 
          error: 'Network error - could not reach server',
          timestamp: new Date().toLocaleTimeString()
        });
        return next;
      });
    }
    setTestingId(null);
  };

  const parseSmtpError = (error: string): string => {
    if (error.includes('BadCredentials') || error.includes('Username and Password not accepted')) {
      return 'Invalid credentials. For Gmail, use an App Password (not your regular password). Enable 2-Step Verification first.';
    }
    if (error.includes('ECONNREFUSED')) {
      return 'Connection refused. Check your SMTP host and port settings.';
    }
    if (error.includes('ETIMEDOUT') || error.includes('timeout')) {
      return 'Connection timed out. The SMTP server may be unreachable.';
    }
    if (error.includes('ENOTFOUND')) {
      return 'SMTP host not found. Please verify the hostname.';
    }
    if (error.includes('self signed certificate')) {
      return 'SSL certificate error. Try toggling the SSL/TLS setting.';
    }
    if (error.includes('wrong version number') || error.includes('ssl3_get_record') || error.includes('SSL routines') || error.includes('EPROTO')) {
      return 'SSL/TLS mismatch. Port 587 requires STARTTLS (SSL off), port 465 requires SSL (SSL on). Check your port and SSL settings.';
    }
    if (error.includes('SSL/TLS configuration error')) {
      return error; // Already a friendly message from the backend
    }
    if (error.includes('Too many connections') || error.includes('rate limit')) {
      return 'Too many attempts. Please wait a moment and try again.';
    }
    // Strip long SMTP protocol messages
    const short = error.split('\n')[0];
    return short.length > 120 ? short.substring(0, 120) + '...' : short;
  };

  const handleDeleteAccount = async (id: string) => {
    if (!confirm('Are you sure you want to delete this email account? Any campaigns using this account will stop sending.')) return;
    try {
      await fetch(`/api/email-accounts/${id}`, { method: 'DELETE', credentials: 'include' });
      setTestResults(prev => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
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
    setGmailUseSmtp(false);
  };

  const getProviderConfig = (provider: string) => {
    const configs: Record<string, { label: string; color: string; bgGradient: string; bg: string; text: string; limit: number; icon: React.ReactNode }> = {
      gmail: { label: 'Gmail', color: 'from-red-500 to-red-600', bgGradient: 'from-red-50 to-red-100', bg: 'bg-red-50', text: 'text-red-700', limit: 2000, icon: <Mail className="h-5 w-5 text-red-500" /> },
      outlook: { label: 'Outlook', color: 'from-blue-500 to-blue-600', bgGradient: 'from-blue-50 to-blue-100', bg: 'bg-blue-50', text: 'text-blue-700', limit: 300, icon: <Mail className="h-5 w-5 text-blue-500" /> },
      office365: { label: 'Office 365', color: 'from-blue-600 to-indigo-600', bgGradient: 'from-indigo-50 to-indigo-100', bg: 'bg-indigo-50', text: 'text-indigo-700', limit: 10000, icon: <Mail className="h-5 w-5 text-indigo-500" /> },
      elasticemail: { label: 'Elastic Email', color: 'from-orange-500 to-red-500', bgGradient: 'from-orange-50 to-orange-100', bg: 'bg-orange-50', text: 'text-orange-700', limit: 100000, icon: <Mail className="h-5 w-5 text-orange-500" /> },
      custom: { label: 'Custom', color: 'from-gray-500 to-gray-600', bgGradient: 'from-gray-50 to-gray-100', bg: 'bg-gray-50', text: 'text-gray-700', limit: 500, icon: <Server className="h-5 w-5 text-gray-500" /> },
    };
    return configs[provider] || configs.custom;
  };

  const totalCapacity = accounts.reduce((sum, a) => sum + (a.dailyLimit || 500), 0);
  const totalSent = accounts.reduce((sum, a) => sum + (a.dailySent || 0), 0);
  const activeCount = accounts.filter(a => a.isActive).length;

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-gray-200/60 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-blue-50 p-2.5 rounded-xl">
              <Inbox className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{accounts.length}</div>
              <div className="text-[11px] text-gray-400 font-medium">Connected</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/60 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-emerald-50 p-2.5 rounded-xl">
              <Wifi className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{activeCount}</div>
              <div className="text-[11px] text-gray-400 font-medium">Active & Verified</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/60 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-purple-50 p-2.5 rounded-xl">
              <Send className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{totalCapacity.toLocaleString()}</div>
              <div className="text-[11px] text-gray-400 font-medium">Daily Capacity</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-gray-200/60 shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="bg-amber-50 p-2.5 rounded-xl">
              <Zap className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{totalSent}</div>
              <div className="text-[11px] text-gray-400 font-medium">Sent Today</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Global success/error messages (from OAuth redirect) */}
      {gmailConnectSuccess && !showAddDialog && (
        <Alert className="border-emerald-200 bg-emerald-50">
          <CheckCircle className="h-4 w-4 text-emerald-600" />
          <AlertDescription className="text-sm text-emerald-700">{gmailConnectSuccess}</AlertDescription>
        </Alert>
      )}
      {gmailConnectError && !showAddDialog && (
        <Alert variant="destructive" className="py-3">
          <XCircle className="h-4 w-4" />
          <AlertDescription className="text-sm">{gmailConnectError}</AlertDescription>
        </Alert>
      )}

      {/* Quick Gmail Connect (Mailmeteor-style) */}
      {gmailOAuthStatus.available && !accounts.find(a => a.email === gmailOAuthStatus.email && a.provider === 'gmail') && (
        <Card className="border-emerald-200 bg-gradient-to-r from-emerald-50/80 via-green-50/50 to-teal-50/30 shadow-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="bg-white p-3 rounded-xl shadow-sm border border-emerald-100 flex-shrink-0">
                <svg className="h-8 w-8" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-gray-900 text-sm mb-0.5">Connect Gmail Instantly</h4>
                <p className="text-xs text-gray-500">Your Google account <strong>{gmailOAuthStatus.email}</strong> is ready. Connect it with one click — no app password needed!</p>
              </div>
              <Button
                onClick={() => handleGmailOAuthConnect()}
                disabled={gmailConnecting}
                className="bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 shadow-sm flex-shrink-0"
                size="sm"
              >
                {gmailConnecting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Zap className="h-4 w-4 mr-1.5" />}
                Enable
              </Button>
            </div>
            {gmailConnectError && (
              <Alert variant="destructive" className="mt-3 py-2">
                <XCircle className="h-3.5 w-3.5" />
                <AlertDescription className="text-xs">{gmailConnectError}</AlertDescription>
              </Alert>
            )}
            {gmailConnectSuccess && (
              <Alert className="mt-3 py-2 border-emerald-200 bg-emerald-50">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                <AlertDescription className="text-xs text-emerald-700">{gmailConnectSuccess}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-400">
          Configure email accounts to send campaigns via Gmail, Outlook, or custom SMTP
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
            Connect your Gmail via Google OAuth (easy) or add any email via SMTP
          </p>
          <div className="flex items-center gap-3">
            {gmailOAuthStatus.available && (
              <Button
                className="bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 shadow-sm"
                onClick={() => handleGmailOAuthConnect()}
                disabled={gmailConnecting}
              >
                {gmailConnecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
                Connect Gmail ({gmailOAuthStatus.email})
              </Button>
            )}
            <Button 
              variant={gmailOAuthStatus.available ? 'outline' : 'default'}
              className={gmailOAuthStatus.available ? '' : 'bg-gradient-to-r from-blue-600 to-indigo-600 shadow-sm'}
              onClick={() => { resetForm(); setShowAddDialog(true); }}
            >
              <Plus className="h-4 w-4 mr-2" /> {gmailOAuthStatus.available ? 'Add via SMTP' : 'Add Your First Account'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => {
            const providerConfig = getProviderConfig(account.provider);
            const quota = account.dailyLimit || 500;
            const sent = account.dailySent || 0;
            const quotaPercent = Math.min((sent / quota) * 100, 100);
            const isTestingThis = testingId === account.id;
            const thisTestResult = testResults.get(account.id);

            return (
              <Card key={account.id} className="border-gray-200/60 shadow-sm hover:shadow-md transition-all group overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex items-center gap-4 p-4">
                    {/* Provider Icon */}
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${providerConfig.bgGradient} flex items-center justify-center flex-shrink-0 shadow-sm border border-gray-100/60`}>
                      {providerConfig.icon}
                    </div>

                    {/* Account Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-semibold text-gray-900 text-sm">{account.displayName || account.email}</span>
                        <Badge variant="outline" className={`text-[10px] font-semibold capitalize ${providerConfig.bg} ${providerConfig.text} border-0`}>
                          {providerConfig.label}
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
                          {account.smtpConfig?.auth?.pass === 'OAUTH_TOKEN' ? (
                            <><Shield className="h-3 w-3 text-emerald-500" /> <span className="text-emerald-600 font-medium">OAuth (Gmail API)</span></>
                          ) : (
                            <><Server className="h-3 w-3" /> {account.smtpConfig?.host}:{account.smtpConfig?.port}</>
                          )}
                        </span>
                        {account.smtpConfig?.auth?.pass !== 'OAUTH_TOKEN' && (
                          <span className="flex items-center gap-1">
                            <Lock className="h-3 w-3" />
                            {account.smtpConfig?.secure ? 'SSL/TLS' : 'STARTTLS'}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Zap className="h-3 w-3" />
                          {quota.toLocaleString()} emails/day
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Test result */}
                      {thisTestResult && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="mr-1">
                              {thisTestResult.success ? (
                                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 border text-xs cursor-help">
                                  <CheckCircle className="h-3 w-3 mr-1" /> Connected
                                </Badge>
                              ) : (
                                <Badge className="bg-red-50 text-red-700 border-red-200 border text-xs max-w-[240px] cursor-help">
                                  <XCircle className="h-3 w-3 mr-1 flex-shrink-0" />
                                  <span className="truncate">{thisTestResult.error || 'Failed'}</span>
                                </Badge>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-sm">
                            <div className="space-y-1">
                              <div className="font-medium">{thisTestResult.success ? 'Connection successful' : 'Connection failed'}</div>
                              {thisTestResult.error && <div className="text-xs opacity-80">{thisTestResult.error}</div>}
                              {thisTestResult.timestamp && <div className="text-xs opacity-60">Tested at {thisTestResult.timestamp}</div>}
                            </div>
                          </TooltipContent>
                        </Tooltip>
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
                        className={`h-full rounded-full transition-all duration-500 ${
                          quotaPercent > 95 ? 'bg-red-500' : 
                          quotaPercent > 80 ? 'bg-amber-500' : 
                          'bg-gradient-to-r from-blue-400 to-blue-500'
                        }`} 
                        style={{ width: `${Math.max(quotaPercent, 1)}%` }} 
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-blue-100 bg-gradient-to-br from-blue-50/80 to-indigo-50/50 hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="bg-gradient-to-br from-red-100 to-red-50 p-2.5 rounded-xl flex-shrink-0 border border-red-100">
                <Mail className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <h4 className="font-semibold text-gray-900 mb-1.5 text-sm">Gmail Setup</h4>
                <ol className="text-sm text-gray-600 space-y-1.5 list-decimal list-inside">
                  <li>Enable <strong>2-Step Verification</strong> on your Google Account</li>
                  <li>Go to <a href="https://myaccount.google.com/apppasswords" target="_blank" className="underline font-medium text-blue-700 hover:text-blue-900 inline-flex items-center gap-0.5">
                    App Passwords <ExternalLink className="h-3 w-3" />
                  </a></li>
                  <li>Generate a password for <strong>"Mail"</strong></li>
                  <li>Use that 16-character code as your SMTP password</li>
                </ol>
                <div className="mt-3 flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200">
                    <Zap className="h-3 w-3 mr-0.5" /> 2,000 emails/day
                  </Badge>
                  <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-600 border-gray-200">
                    Port 587 (STARTTLS)
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-blue-100 bg-gradient-to-br from-blue-50/50 to-indigo-50/30 hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="bg-gradient-to-br from-blue-100 to-blue-50 p-2.5 rounded-xl flex-shrink-0 border border-blue-100">
                <Mail className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <h4 className="font-semibold text-gray-900 mb-1.5 text-sm">Outlook / Office 365</h4>
                <ol className="text-sm text-gray-600 space-y-1.5 list-decimal list-inside">
                  <li>Go to <strong>Settings &gt; Mail &gt; Sync email</strong></li>
                  <li>Enable <strong>POP/IMAP/SMTP</strong></li>
                  <li>Use your regular password (or app password with 2FA)</li>
                  <li>SMTP host: <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">smtp-mail.outlook.com</code></li>
                </ol>
                <div className="mt-3 flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
                    <Zap className="h-3 w-3 mr-0.5" /> 300 emails/day
                  </Badge>
                  <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-600 border-gray-200">
                    Port 587 (STARTTLS)
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add Account Dialog */}
      <Dialog open={showAddDialog} onOpenChange={(open) => { setShowAddDialog(open); if (!open) resetForm(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-2 rounded-lg border border-blue-100">
                <Mail className="h-4 w-4 text-blue-600" />
              </div>
              Add Email Account
            </DialogTitle>
            <DialogDescription>
              Connect your email account via SMTP to send campaigns. For Gmail, you can also use the one-click OAuth connect above.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Provider Selection */}
            <div>
              <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Email Provider</Label>
              <div className="grid grid-cols-5 gap-2 mt-1.5">
                {[
                  { id: 'gmail', label: 'Gmail', icon: <Mail className="h-4 w-4 text-red-500" /> },
                  { id: 'outlook', label: 'Outlook', icon: <Mail className="h-4 w-4 text-blue-500" /> },
                  { id: 'office365', label: 'Office 365', icon: <Mail className="h-4 w-4 text-indigo-500" /> },
                  { id: 'elasticemail', label: 'Elastic Email', icon: <Mail className="h-4 w-4 text-orange-500" /> },
                  { id: 'custom', label: 'Custom', icon: <Server className="h-4 w-4 text-gray-500" /> },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleProviderChange(p.id)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all text-center ${
                      formProvider === p.id 
                        ? 'border-blue-500 bg-blue-50/50 shadow-sm' 
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    {p.icon}
                    <span className={`text-xs font-medium ${formProvider === p.id ? 'text-blue-700' : 'text-gray-600'}`}>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Provider-specific alerts */}
            {formProvider === 'gmail' && (
              <div className="space-y-3">
                {/* Gmail OAuth - Primary Option */}
                <div className={`border-2 rounded-xl p-4 transition-all ${!gmailUseSmtp ? 'border-emerald-300 bg-emerald-50/50' : 'border-gray-200 bg-white'}`}>
                  <div className="flex items-center gap-3">
                    <div className="bg-white p-2 rounded-lg shadow-sm border border-emerald-100 flex-shrink-0">
                      <svg className="h-6 w-6" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    </div>
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-gray-900">Connect with Google</h4>
                      <p className="text-xs text-gray-500">Sign in with Google to connect your Gmail. No app password needed.</p>
                    </div>
                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 flex-shrink-0"
                      onClick={() => {
                        // Redirect to Gmail OAuth connect flow
                        window.location.href = '/api/auth/gmail-connect';
                      }}
                    >
                      <Zap className="h-3.5 w-3.5 mr-1.5" /> Connect Gmail
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 mt-2.5">
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                      <Shield className="h-3 w-3 mr-0.5" /> OAuth 2.0
                    </Badge>
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                      <Zap className="h-3 w-3 mr-0.5" /> 2,000 emails/day
                    </Badge>
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                      No password required
                    </Badge>
                  </div>
                </div>

                {/* Divider with SMTP fallback toggle */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-gray-200" />
                  <button
                    type="button"
                    onClick={() => setGmailUseSmtp(!gmailUseSmtp)}
                    className="text-[11px] text-gray-400 hover:text-gray-600 font-medium flex items-center gap-1"
                  >
                    {gmailUseSmtp ? 'Hide' : 'Or use'} SMTP with App Password
                    <ChevronRight className={`h-3 w-3 transition-transform ${gmailUseSmtp ? 'rotate-90' : ''}`} />
                  </button>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
              </div>
            )}
            {(formProvider === 'outlook' || formProvider === 'office365') && (
              <Alert className="border-blue-200 bg-blue-50/50">
                <AlertCircle className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-sm text-blue-800">
                  <strong>Enable SMTP auth</strong> in Outlook settings: Settings &gt; Mail &gt; Sync email &gt; enable POP/IMAP/SMTP.
                </AlertDescription>
              </Alert>
            )}
            {formProvider === 'elasticemail' && (
              <Alert className="border-orange-200 bg-orange-50/50">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <AlertDescription className="text-sm text-orange-800">
                  <strong>Elastic Email:</strong> Use your Elastic Email address as the SMTP username and your <strong>API key</strong> as the password.
                  SMTP host: <code className="bg-orange-100 px-1 rounded text-xs">smtp.elasticemail.com</code>, Port: <code className="bg-orange-100 px-1 rounded text-xs">2525</code>.
                  Configure your API key in <strong>Advanced Settings</strong>.
                </AlertDescription>
              </Alert>
            )}

            {/* Email & Display Name + SMTP (hidden for Gmail OAuth mode) */}
            {(formProvider !== 'gmail' || gmailUseSmtp) && (
            <>
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
                    placeholder={formProvider === 'gmail' ? "16-character app password" : "Your SMTP password"}
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
                  <Switch checked={formSmtpSecure} onCheckedChange={(checked) => {
                    setFormSmtpSecure(checked);
                    // Auto-adjust port when toggling SSL
                    if (checked && formSmtpPort === 587) setFormSmtpPort(465);
                    if (!checked && formSmtpPort === 465) setFormSmtpPort(587);
                  }} />
                  <Label className="text-xs text-gray-600">
                    {formSmtpSecure ? 'SSL/TLS (implicit, port 465)' : 'STARTTLS (port 587)'}
                  </Label>
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

            {formProvider === 'gmail' && gmailUseSmtp && (
              <Alert className="border-amber-200 bg-amber-50/50">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-sm text-amber-800">
                  <strong>Gmail requires an App Password</strong> (not your regular password). You must have 2-Step Verification enabled.{' '}
                  <a href="https://myaccount.google.com/apppasswords" target="_blank" className="underline font-medium inline-flex items-center gap-0.5">
                    Generate one here <ExternalLink className="h-3 w-3" />
                  </a>
                </AlertDescription>
              </Alert>
            )}
            </>
            )}

            {formError && (
              <Alert variant="destructive" className="py-3">
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
