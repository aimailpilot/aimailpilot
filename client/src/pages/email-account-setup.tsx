import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { 
  Mail, Plus, Settings, Trash2, TestTube, CheckCircle, XCircle, 
  Loader2, Shield, Eye, EyeOff, Upload, FileText, AlertCircle
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

  // Form state for adding new account
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
      if (res.ok) {
        const data = await res.json();
        setAccounts(data);
      }
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
      await fetch(`/api/email-accounts/${id}`, {
        method: 'DELETE',
        credentials: 'include',
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
  };

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'gmail': return '📧';
      case 'outlook': case 'office365': return '📨';
      default: return '✉️';
    }
  };

  const getProviderColor = (provider: string) => {
    switch (provider) {
      case 'gmail': return 'bg-red-50 text-red-700 border-red-200';
      case 'outlook': case 'office365': return 'bg-blue-50 text-blue-700 border-blue-200';
      default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Email Accounts</h2>
          <p className="text-sm text-gray-500 mt-1">Configure SMTP accounts to send campaigns via Gmail, Outlook, or custom SMTP</p>
        </div>
        <Dialog open={showAddDialog} onOpenChange={(open) => { setShowAddDialog(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-2" />
              Add Email Account
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Email Account</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              {/* Provider Selection */}
              <div>
                <Label>Email Provider</Label>
                <Select value={formProvider} onValueChange={handleProviderChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gmail">Gmail (Google)</SelectItem>
                    <SelectItem value="outlook">Outlook / Hotmail</SelectItem>
                    <SelectItem value="office365">Office 365</SelectItem>
                    <SelectItem value="custom">Custom SMTP</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Gmail/Outlook info */}
              {formProvider === 'gmail' && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Gmail requires an App Password.</strong><br />
                    Go to <a href="https://myaccount.google.com/apppasswords" target="_blank" className="text-blue-600 underline">Google Account → App Passwords</a> and generate a password for "Mail". You need 2-Step Verification enabled first.
                  </AlertDescription>
                </Alert>
              )}
              {(formProvider === 'outlook' || formProvider === 'office365') && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Outlook requires SMTP auth enabled.</strong><br />
                    Go to Outlook Settings → Mail → Sync email → enable POP/IMAP/SMTP. Use your regular password or an app password if you have 2FA enabled.
                  </AlertDescription>
                </Alert>
              )}

              {/* Email & Display Name */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Email Address *</Label>
                  <Input
                    type="email"
                    placeholder="you@gmail.com"
                    value={formEmail}
                    onChange={(e) => {
                      setFormEmail(e.target.value);
                      if (!formSmtpUser) setFormSmtpUser(e.target.value);
                    }}
                  />
                </div>
                <div>
                  <Label>Display Name</Label>
                  <Input
                    placeholder="Your Name"
                    value={formDisplayName}
                    onChange={(e) => setFormDisplayName(e.target.value)}
                  />
                </div>
              </div>

              {/* SMTP Settings */}
              <div className="border rounded-lg p-3 space-y-3 bg-gray-50">
                <h4 className="text-sm font-medium text-gray-700">SMTP Settings</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <Label className="text-xs">Host</Label>
                    <Input
                      value={formSmtpHost}
                      onChange={(e) => setFormSmtpHost(e.target.value)}
                      placeholder="smtp.gmail.com"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Port</Label>
                    <Input
                      type="number"
                      value={formSmtpPort}
                      onChange={(e) => setFormSmtpPort(parseInt(e.target.value))}
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">SMTP Username *</Label>
                  <Input
                    value={formSmtpUser}
                    onChange={(e) => setFormSmtpUser(e.target.value)}
                    placeholder="your-email@gmail.com"
                  />
                </div>
                <div>
                  <Label className="text-xs">App Password / SMTP Password *</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={formSmtpPass}
                      onChange={(e) => setFormSmtpPass(e.target.value)}
                      placeholder="Your app password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Switch checked={formSmtpSecure} onCheckedChange={setFormSmtpSecure} />
                  <Label className="text-xs">Use SSL/TLS (port 465)</Label>
                </div>
              </div>

              {/* Reply-To */}
              <div>
                <Label>Reply-To Address (optional)</Label>
                <Input
                  type="email"
                  placeholder="replies@yourdomain.com"
                  value={formReplyTo}
                  onChange={(e) => setFormReplyTo(e.target.value)}
                />
              </div>

              {formError && (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button
                onClick={handleAddAccount}
                disabled={formLoading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {formLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                Add Account
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Accounts List */}
      {loading ? (
        <div className="text-center py-12"><Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto" /></div>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Mail className="h-12 w-12 text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No email accounts configured</h3>
            <p className="text-gray-500 mb-4 text-center max-w-md">
              Add your Gmail or Outlook account using SMTP to start sending personalized email campaigns. You'll need an app password (not your regular password).
            </p>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Account
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <Card key={account.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="text-2xl">{getProviderIcon(account.provider)}</div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-gray-900">{account.displayName || account.email}</span>
                        <Badge variant="outline" className={getProviderColor(account.provider)}>
                          {account.provider}
                        </Badge>
                        {account.isActive ? (
                          <Badge className="bg-green-50 text-green-700 border-green-200">Active</Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 mt-0.5">{account.email}</div>
                      <div className="text-xs text-gray-400 mt-1">
                        SMTP: {account.smtpConfig?.host}:{account.smtpConfig?.port} • 
                        Daily limit: {account.dailyLimit || 500} emails
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {/* Test result */}
                    {testResult && testResult.id === account.id && (
                      <div className="flex items-center text-sm mr-2">
                        {testResult.success ? (
                          <span className="flex items-center text-green-600">
                            <CheckCircle className="h-4 w-4 mr-1" /> Test passed
                          </span>
                        ) : (
                          <span className="flex items-center text-red-600 max-w-[200px] truncate" title={testResult.error}>
                            <XCircle className="h-4 w-4 mr-1" /> {testResult.error || 'Test failed'}
                          </span>
                        )}
                      </div>
                    )}
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTestAccount(account.id)}
                      disabled={testingId === account.id}
                    >
                      {testingId === account.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <><TestTube className="h-4 w-4 mr-1" /> Test</>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteAccount(account.id)}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Help Section */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-4">
          <h4 className="font-medium text-blue-900 mb-2">📋 How to set up SMTP</h4>
          <div className="text-sm text-blue-800 space-y-2">
            <div>
              <strong>Gmail:</strong> Enable 2-Step Verification → Go to{' '}
              <a href="https://myaccount.google.com/apppasswords" target="_blank" className="underline">App Passwords</a>
              {' '}→ Generate a password for "Mail" → Use this as your SMTP password.
            </div>
            <div>
              <strong>Outlook:</strong> Go to Settings → Mail → Sync email → Enable POP/IMAP/SMTP → Use your password or app password if 2FA is enabled.
            </div>
            <div>
              <strong>Daily limits:</strong> Gmail allows up to 2,000 emails/day, Outlook 300/day. MailFlow automatically throttles sends to stay within these limits.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
