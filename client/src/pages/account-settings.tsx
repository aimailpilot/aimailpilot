import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocation } from "wouter";
import { 
  Mail, Users, BarChart3, CreditCard, Plus, Edit,
  Zap, AlertTriangle, CheckCircle, RefreshCw, Brain, Sparkles,
  ArrowRight, Info, Reply, Inbox, Clock, Search,
  Play, Square, MessageSquare, ExternalLink, Activity
} from "lucide-react";

interface AccountQuota {
  id: string;
  email: string;
  displayName: string;
  provider: string;
  isActive: boolean;
  dailyLimit: number;
  dailySent: number;
  remaining: number;
  usagePercent: number;
  resetTime: string;
}

interface QuotaSummary {
  totalAccounts: number;
  activeAccounts: number;
  totalDailyLimit: number;
  totalDailySent: number;
  totalRemaining: number;
  overallUsagePercent: number;
}

interface AIRecommendation {
  recommendedAccountId: string | null;
  recommendedAccountEmail: string | null;
  reason: string;
  strategy: string;
  splitPlan?: Array<{ accountId: string; email: string; count: number; reason: string }>;
  warnings: string[];
  tips: string[];
  provider: string;
  model?: string;
}

interface ReplyTrackingStatus {
  active: boolean;
  checking: boolean;
  configured: boolean;
  gmailEmail: string | null;
  hasRefreshToken: boolean;
}

interface ReplyCheckResult {
  checked: number;
  newReplies: number;
  errors: string[];
  replies: Array<{
    from: string;
    subject: string;
    snippet: string;
    campaignName: string;
    contactEmail: string;
    receivedAt: string;
  }>;
}

interface ReplyEvent {
  id: string;
  type: string;
  campaignId: string;
  messageId: string;
  contactId: string;
  trackingId: string;
  metadata: any;
  createdAt: string;
  contact: { email: string; firstName: string; lastName: string; company: string } | null;
  campaignName: string;
}

export default function AccountSettings() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("general");
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);

  // Live data states
  const [accountQuotas, setAccountQuotas] = useState<AccountQuota[]>([]);
  const [quotaSummary, setQuotaSummary] = useState<QuotaSummary | null>(null);
  const [loadingQuotas, setLoadingQuotas] = useState(false);
  const [senders, setSenders] = useState<any[]>([]);
  const [userInfo, setUserInfo] = useState<any>(null);
  
  // AI recommendation states
  const [recommendation, setRecommendation] = useState<AIRecommendation | null>(null);
  const [loadingRec, setLoadingRec] = useState(false);
  const [recRecipientCount, setRecRecipientCount] = useState('100');
  const [recCampaignType, setRecCampaignType] = useState('marketing');

  // Reply tracking states
  const [replyStatus, setReplyStatus] = useState<ReplyTrackingStatus | null>(null);
  const [replyCheckResult, setReplyCheckResult] = useState<ReplyCheckResult | null>(null);
  const [replyEvents, setReplyEvents] = useState<ReplyEvent[]>([]);
  const [loadingReplyCheck, setLoadingReplyCheck] = useState(false);
  const [loadingReplyEvents, setLoadingReplyEvents] = useState(false);
  const [replyLookbackMinutes, setReplyLookbackMinutes] = useState('120');

  // Microsoft/Outlook status
  const [outlookStatus, setOutlookStatus] = useState<{ connected: boolean; email: string; demo: boolean } | null>(null);

  // Fetch quota data
  const fetchQuotas = async () => {
    setLoadingQuotas(true);
    try {
      const res = await fetch('/api/email-accounts/quota-summary', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setAccountQuotas(data.accounts || []);
        setQuotaSummary(data.summary || null);
      }
    } catch (e) {
      console.error('Failed to fetch quotas:', e);
    }
    setLoadingQuotas(false);
  };

  // Fetch user info
  const fetchUserInfo = async () => {
    try {
      const res = await fetch('/api/account/info', { credentials: 'include' });
      if (res.ok) setUserInfo(await res.json());
    } catch (e) {}
  };

  // Fetch senders
  const fetchSenders = async () => {
    try {
      const res = await fetch('/api/account/senders', { credentials: 'include' });
      if (res.ok) setSenders(await res.json());
    } catch (e) {}
  };

  // Get AI recommendation
  const getRecommendation = async () => {
    setLoadingRec(true);
    setRecommendation(null);
    try {
      const res = await fetch('/api/email-accounts/recommend', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientCount: parseInt(recRecipientCount) || 100,
          campaignType: recCampaignType,
          campaignName: 'Campaign Analysis',
        }),
      });
      if (res.ok) setRecommendation(await res.json());
    } catch (e) {
      console.error('Failed to get recommendation:', e);
    }
    setLoadingRec(false);
  };

  // Reply tracking functions
  const fetchReplyStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/reply-tracking/status', { credentials: 'include' });
      if (res.ok) setReplyStatus(await res.json());
    } catch (e) {}
  }, []);

  const fetchReplyEvents = useCallback(async () => {
    setLoadingReplyEvents(true);
    try {
      const res = await fetch('/api/reply-tracking/recent?limit=50', { credentials: 'include' });
      if (res.ok) setReplyEvents(await res.json());
    } catch (e) {}
    setLoadingReplyEvents(false);
  }, []);

  const checkForReplies = async () => {
    setLoadingReplyCheck(true);
    setReplyCheckResult(null);
    try {
      const res = await fetch('/api/reply-tracking/check', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookbackMinutes: parseInt(replyLookbackMinutes) || 120 }),
      });
      if (res.ok) {
        const data = await res.json();
        setReplyCheckResult(data);
        // Refresh events after check
        fetchReplyEvents();
      }
    } catch (e) {
      console.error('Failed to check replies:', e);
    }
    setLoadingReplyCheck(false);
  };

  const startAutoTracking = async () => {
    try {
      await fetch('/api/reply-tracking/start', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalMinutes: 5 }),
      });
      fetchReplyStatus();
    } catch (e) {}
  };

  const stopAutoTracking = async () => {
    try {
      await fetch('/api/reply-tracking/stop', {
        method: 'POST',
        credentials: 'include',
      });
      fetchReplyStatus();
    } catch (e) {}
  };

  // Fetch Outlook status
  const fetchOutlookStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/microsoft/status', { credentials: 'include' });
      if (res.ok) setOutlookStatus(await res.json());
    } catch (e) {}
  }, []);

  useEffect(() => {
    fetchQuotas();
    fetchUserInfo();
    fetchSenders();
    fetchReplyStatus();
    fetchReplyEvents();
    fetchOutlookStatus();
  }, [fetchReplyStatus, fetchReplyEvents, fetchOutlookStatus]);

  // Auto-refresh reply events every 30 seconds when on reply tracking tab
  useEffect(() => {
    if (activeTab !== 'reply-tracking') return;
    const interval = setInterval(() => {
      fetchReplyStatus();
      fetchReplyEvents();
    }, 30000);
    return () => clearInterval(interval);
  }, [activeTab, fetchReplyStatus, fetchReplyEvents]);

  // Helper: quota bar color
  const getQuotaColor = (percent: number) => {
    if (percent >= 90) return 'bg-red-500';
    if (percent >= 70) return 'bg-amber-500';
    if (percent >= 40) return 'bg-blue-500';
    return 'bg-green-500';
  };

  const getQuotaBgColor = (percent: number) => {
    if (percent >= 90) return 'bg-red-50 border-red-200';
    if (percent >= 70) return 'bg-amber-50 border-amber-200';
    return 'bg-white border-gray-200';
  };

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'gmail': return '📧';
      case 'outlook': return '📬';
      case 'elasticemail': return '⚡';
      default: return '✉️';
    }
  };

  const getProviderLabel = (provider: string) => {
    switch (provider) {
      case 'gmail': return 'Gmail';
      case 'outlook': return 'Outlook';
      case 'elasticemail': return 'Elastic Email';
      default: return 'Custom SMTP';
    }
  };

  const formatTimeAgo = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Account</h1>
            <p className="text-gray-600">Email quotas, AI advisor, reply tracking, and account settings</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="quotas" className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5" />
              Quotas
            </TabsTrigger>
            <TabsTrigger value="ai-advisor" className="flex items-center gap-1.5">
              <Brain className="h-3.5 w-3.5" />
              AI Advisor
            </TabsTrigger>
            <TabsTrigger value="reply-tracking" className="flex items-center gap-1.5">
              <Reply className="h-3.5 w-3.5" />
              Reply Tracking
            </TabsTrigger>
            <TabsTrigger value="senders">Senders</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          {/* ========== GENERAL TAB ========== */}
          <TabsContent value="general" className="space-y-6">
            <Card>
              <CardHeader><CardTitle>Information</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <Users className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <Label>Name</Label>
                    <div className="flex items-center space-x-2">
                      <span className="text-lg font-medium">{userInfo?.name || 'MailFlow User'}</span>
                      <Button variant="ghost" size="sm"><Edit className="h-4 w-4" /></Button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <Mail className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <Label>Email</Label>
                    <div className="text-lg font-medium">{userInfo?.email || 'user@mailflow.app'}</div>
                  </div>
                </div>

                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <BarChart3 className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <Label>Total Available Quota</Label>
                    <div className="text-lg font-medium">
                      {quotaSummary ? (
                        <>
                          {quotaSummary.totalDailySent} / {quotaSummary.totalDailyLimit} emails
                          <span className="text-sm text-gray-500 ml-2">
                            ({quotaSummary.totalRemaining} remaining across {quotaSummary.totalAccounts} account{quotaSummary.totalAccounts !== 1 ? 's' : ''})
                          </span>
                        </>
                      ) : (
                        <span className="text-gray-400">Loading...</span>
                      )}
                    </div>
                    {quotaSummary && quotaSummary.totalAccounts > 0 && (
                      <div className="mt-2 w-full max-w-md">
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all ${getQuotaColor(quotaSummary.overallUsagePercent)}`}
                            style={{ width: `${quotaSummary.overallUsagePercent}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-gray-500 mt-1">
                          <span>{quotaSummary.overallUsagePercent}% used</span>
                          <span>Resets at Midnight UTC</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Billing</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                    <CreditCard className="h-5 w-5 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <Label>Plan</Label>
                    <div className="flex items-center space-x-2">
                      <span className="text-lg font-medium">{userInfo?.billing?.plan || 'MailFlow Pro'}</span>
                      <Badge className="bg-red-500 text-white">Upgrade to Pro</Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ========== EMAIL QUOTAS TAB ========== */}
          <TabsContent value="quotas" className="space-y-6">
            <Card className="border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <Zap className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Email Sending Quota Overview</CardTitle>
                      <p className="text-sm text-gray-600 mt-0.5">
                        Monitor your daily sending limits across all accounts
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={fetchQuotas} disabled={loadingQuotas}>
                    <RefreshCw className={`h-4 w-4 mr-1.5 ${loadingQuotas ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {quotaSummary && (
                  <div className="grid grid-cols-4 gap-4">
                    <div className="bg-white rounded-lg p-4 border">
                      <div className="text-2xl font-bold text-gray-900">{quotaSummary.totalAccounts}</div>
                      <div className="text-sm text-gray-500">Total Accounts</div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border">
                      <div className="text-2xl font-bold text-green-600">{quotaSummary.totalRemaining.toLocaleString()}</div>
                      <div className="text-sm text-gray-500">Emails Available Today</div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border">
                      <div className="text-2xl font-bold text-blue-600">{quotaSummary.totalDailySent.toLocaleString()}</div>
                      <div className="text-sm text-gray-500">Sent Today</div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border">
                      <div className="text-2xl font-bold text-gray-900">{quotaSummary.totalDailyLimit.toLocaleString()}</div>
                      <div className="text-sm text-gray-500">Total Daily Limit</div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {accountQuotas.length === 0 && !loadingQuotas && (
              <Card className="border-dashed border-2">
                <CardContent className="py-12 text-center">
                  <Mail className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <h3 className="text-lg font-medium text-gray-700 mb-1">No Email Accounts</h3>
                  <p className="text-gray-500 mb-4">Add email accounts to see quota information</p>
                  <Button onClick={() => setLocation('/setup')}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Email Account
                  </Button>
                </CardContent>
              </Card>
            )}

            <div className="space-y-4">
              {accountQuotas.map((account) => (
                <Card key={account.id} className={`transition-all hover:shadow-md ${getQuotaBgColor(account.usagePercent)}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{getProviderIcon(account.provider)}</span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-900">{account.displayName}</span>
                            <Badge variant="outline" className="text-xs">
                              {getProviderLabel(account.provider)}
                            </Badge>
                            {account.isActive ? (
                              <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">Active</Badge>
                            ) : (
                              <Badge className="bg-gray-100 text-gray-500 border-gray-200 text-xs">Inactive</Badge>
                            )}
                          </div>
                          <div className="text-sm text-gray-500 mt-0.5">{account.email}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-gray-900">{account.remaining.toLocaleString()}</div>
                        <div className="text-xs text-gray-500">remaining today</div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-gray-600">
                          {account.dailySent.toLocaleString()} sent of {account.dailyLimit.toLocaleString()} daily limit
                        </span>
                        <span className={`font-medium ${
                          account.usagePercent >= 90 ? 'text-red-600' : 
                          account.usagePercent >= 70 ? 'text-amber-600' : 'text-gray-600'
                        }`}>
                          {account.usagePercent}%
                        </span>
                      </div>
                      <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full transition-all duration-500 ${getQuotaColor(account.usagePercent)}`}
                          style={{ width: `${Math.max(account.usagePercent, 1)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <RefreshCw className="h-3 w-3" />
                          Resets at {account.resetTime}
                        </div>
                        {account.usagePercent >= 90 && (
                          <div className="flex items-center gap-1 text-xs text-red-600 font-medium">
                            <AlertTriangle className="h-3 w-3" />
                            Near limit!
                          </div>
                        )}
                        {account.usagePercent === 0 && (
                          <div className="flex items-center gap-1 text-xs text-green-600 font-medium">
                            <CheckCircle className="h-3 w-3" />
                            Full capacity available
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* ========== AI ADVISOR TAB ========== */}
          <TabsContent value="ai-advisor" className="space-y-6">
            <Card className="border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <Brain className="h-5 w-5 text-purple-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      AI Campaign Advisor
                      <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-xs">
                        <Sparkles className="h-3 w-3 mr-1" />
                        Azure OpenAI
                      </Badge>
                    </CardTitle>
                    <p className="text-sm text-gray-600 mt-0.5">
                      Get AI-powered recommendations on which email account to use for your campaign
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="bg-white rounded-xl p-5 border border-purple-100">
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Number of Recipients</Label>
                      <Input 
                        type="number" 
                        value={recRecipientCount}
                        onChange={(e) => setRecRecipientCount(e.target.value)}
                        placeholder="e.g. 500"
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Campaign Type</Label>
                      <select 
                        value={recCampaignType} 
                        onChange={(e) => setRecCampaignType(e.target.value)}
                        className="mt-1.5 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="marketing">Marketing</option>
                        <option value="transactional">Transactional</option>
                        <option value="newsletter">Newsletter</option>
                        <option value="cold-outreach">Cold Outreach</option>
                        <option value="follow-up">Follow-up</option>
                      </select>
                    </div>
                    <div className="flex items-end">
                      <Button 
                        onClick={getRecommendation}
                        disabled={loadingRec}
                        className="w-full bg-purple-600 hover:bg-purple-700"
                      >
                        {loadingRec ? (
                          <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Analyzing...</>
                        ) : (
                          <><Sparkles className="h-4 w-4 mr-2" /> Get Recommendation</>
                        )}
                      </Button>
                    </div>
                  </div>

                  {recommendation && (
                    <div className="mt-4 space-y-4">
                      <div className={`p-4 rounded-lg border ${
                        recommendation.strategy === 'none' || recommendation.strategy === 'insufficient'
                          ? 'bg-red-50 border-red-200' 
                          : 'bg-green-50 border-green-200'
                      }`}>
                        <div className="flex items-start gap-3">
                          {recommendation.strategy === 'none' || recommendation.strategy === 'insufficient' ? (
                            <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                          ) : (
                            <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                          )}
                          <div className="flex-1">
                            <div className="font-semibold text-gray-900 mb-1">
                              {recommendation.strategy === 'single' && 'Recommended: Single Account'}
                              {recommendation.strategy === 'split' && 'Recommended: Split Across Accounts'}
                              {recommendation.strategy === 'none' && 'No Accounts Available'}
                              {recommendation.strategy === 'insufficient' && 'Insufficient Quota'}
                            </div>
                            <p className="text-sm text-gray-700">{recommendation.reason}</p>
                            
                            {recommendation.recommendedAccountEmail && (
                              <div className="mt-2 flex items-center gap-2">
                                <ArrowRight className="h-4 w-4 text-blue-500" />
                                <span className="text-sm font-medium text-blue-700">
                                  Use: {recommendation.recommendedAccountEmail}
                                </span>
                              </div>
                            )}

                            {recommendation.provider && (
                              <div className="mt-2 flex items-center gap-1.5">
                                <Badge variant="outline" className="text-xs">
                                  <Brain className="h-3 w-3 mr-1" />
                                  {recommendation.provider === 'azure-openai' ? `Azure OpenAI (${recommendation.model || 'GPT'})` : 'Rule-based Analysis'}
                                </Badge>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {recommendation.splitPlan && recommendation.splitPlan.length > 0 && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                          <h4 className="font-medium text-blue-800 mb-2 flex items-center gap-2">
                            <Zap className="h-4 w-4" />
                            Sending Split Plan
                          </h4>
                          <div className="space-y-2">
                            {recommendation.splitPlan.map((plan, i) => (
                              <div key={i} className="flex items-center justify-between bg-white rounded-lg p-3 border border-blue-100">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium">{plan.email}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-sm text-gray-500">{plan.reason}</span>
                                  <Badge className="bg-blue-100 text-blue-700">{plan.count} emails</Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {recommendation.warnings && recommendation.warnings.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                          <h4 className="font-medium text-amber-800 mb-2 flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4" />
                            Warnings
                          </h4>
                          <ul className="space-y-1">
                            {recommendation.warnings.map((w, i) => (
                              <li key={i} className="text-sm text-amber-700 flex items-start gap-2">
                                <span className="mt-1">•</span> {w}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {recommendation.tips && recommendation.tips.length > 0 && (
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                          <h4 className="font-medium text-gray-700 mb-2 flex items-center gap-2">
                            <Info className="h-4 w-4" />
                            Tips for Better Deliverability
                          </h4>
                          <ul className="space-y-1">
                            {recommendation.tips.map((t, i) => (
                              <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                                <span className="mt-1">*</span> {t}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {recommendation.accounts && (recommendation.accounts as AccountQuota[]).length > 0 && (
                        <div className="border rounded-lg overflow-hidden">
                          <div className="bg-gray-50 px-4 py-2.5 border-b">
                            <h4 className="text-sm font-medium text-gray-700">Account Quota Status</h4>
                          </div>
                          <div className="divide-y">
                            {(recommendation.accounts as AccountQuota[]).map((acct) => (
                              <div key={acct.id} className="flex items-center justify-between px-4 py-3">
                                <div className="flex items-center gap-3">
                                  <span>{getProviderIcon(acct.provider)}</span>
                                  <div>
                                    <div className="text-sm font-medium">{acct.email}</div>
                                    <div className="text-xs text-gray-500">{getProviderLabel(acct.provider)}</div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-4">
                                  <div className="w-32">
                                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                      <div 
                                        className={`h-full rounded-full ${getQuotaColor(acct.usagePercent)}`}
                                        style={{ width: `${Math.max(acct.usagePercent, 2)}%` }}
                                      />
                                    </div>
                                  </div>
                                  <div className="text-sm text-right min-w-[100px]">
                                    <span className="font-medium">{acct.remaining}</span>
                                    <span className="text-gray-500"> / {acct.dailyLimit}</span>
                                  </div>
                                  {recommendation.recommendedAccountId === acct.id && (
                                    <Badge className="bg-green-100 text-green-700 text-xs">
                                      <CheckCircle className="h-3 w-3 mr-1" />
                                      Recommended
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ========== REPLY TRACKING TAB ========== */}
          <TabsContent value="reply-tracking" className="space-y-6">
            {/* Status Card */}
            <Card className="border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-100 rounded-lg">
                      <Reply className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        Gmail Reply Tracking
                        {replyStatus?.active && (
                          <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">
                            <Activity className="h-3 w-3 mr-1 animate-pulse" />
                            Auto-polling Active
                          </Badge>
                        )}
                      </CardTitle>
                      <p className="text-sm text-gray-600 mt-0.5">
                        Automatically detect replies to your campaign emails via Gmail API
                      </p>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Connection Status */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <div className="bg-white rounded-lg p-4 border">
                    <div className="flex items-center gap-2 mb-2">
                      {replyStatus?.configured ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                      )}
                      <span className="text-sm font-medium text-gray-700">Gmail Connection</span>
                    </div>
                    <div className="text-sm text-gray-600">
                      {replyStatus?.configured ? (
                        <>
                          <span className="text-green-600 font-medium">Connected</span>
                          {replyStatus.gmailEmail && (
                            <div className="text-xs text-gray-500 mt-1">{replyStatus.gmailEmail}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-red-600">Not connected - Sign in with Google to enable</span>
                      )}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-4 border">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="h-4 w-4 text-blue-500" />
                      <span className="text-sm font-medium text-gray-700">Auto-Polling</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {replyStatus?.active ? (
                        <>
                          <Badge className="bg-green-100 text-green-700 text-xs">Running every 5 min</Badge>
                          <Button variant="ghost" size="sm" onClick={stopAutoTracking} className="h-7 px-2">
                            <Square className="h-3 w-3 mr-1 text-red-500" />
                            Stop
                          </Button>
                        </>
                      ) : (
                        <>
                          <Badge className="bg-gray-100 text-gray-500 text-xs">Stopped</Badge>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={startAutoTracking} 
                            disabled={!replyStatus?.configured}
                            className="h-7 px-2"
                          >
                            <Play className="h-3 w-3 mr-1 text-green-500" />
                            Start
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-4 border">
                    <div className="flex items-center gap-2 mb-2">
                      <MessageSquare className="h-4 w-4 text-purple-500" />
                      <span className="text-sm font-medium text-gray-700">Total Replies Tracked</span>
                    </div>
                    <div className="text-2xl font-bold text-purple-600">{replyEvents.length}</div>
                  </div>
                </div>

                {/* Manual Check */}
                <div className="bg-white rounded-xl p-5 border border-amber-100">
                  <h4 className="font-medium text-gray-800 mb-3 flex items-center gap-2">
                    <Search className="h-4 w-4" />
                    Manual Reply Check
                  </h4>
                  <div className="flex items-end gap-4">
                    <div className="flex-1">
                      <Label className="text-sm text-gray-600">Look back period (minutes)</Label>
                      <Input 
                        type="number" 
                        value={replyLookbackMinutes}
                        onChange={(e) => setReplyLookbackMinutes(e.target.value)}
                        placeholder="120"
                        className="mt-1.5"
                        min="5"
                        max="10080"
                      />
                    </div>
                    <Button 
                      onClick={checkForReplies}
                      disabled={loadingReplyCheck || !replyStatus?.configured}
                      className="bg-amber-600 hover:bg-amber-700"
                    >
                      {loadingReplyCheck ? (
                        <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Checking...</>
                      ) : (
                        <><Inbox className="h-4 w-4 mr-2" /> Check for Replies</>
                      )}
                    </Button>
                  </div>

                  {/* Check Result */}
                  {replyCheckResult && (
                    <div className="mt-4">
                      <div className={`p-4 rounded-lg border ${
                        replyCheckResult.newReplies > 0 
                          ? 'bg-green-50 border-green-200' 
                          : replyCheckResult.errors.length > 0
                            ? 'bg-red-50 border-red-200'
                            : 'bg-blue-50 border-blue-200'
                      }`}>
                        <div className="flex items-center gap-2">
                          {replyCheckResult.newReplies > 0 ? (
                            <CheckCircle className="h-5 w-5 text-green-500" />
                          ) : replyCheckResult.errors.length > 0 ? (
                            <AlertTriangle className="h-5 w-5 text-red-500" />
                          ) : (
                            <Info className="h-5 w-5 text-blue-500" />
                          )}
                          <div>
                            <div className="font-medium text-gray-900">
                              {replyCheckResult.newReplies > 0 
                                ? `Found ${replyCheckResult.newReplies} new reply(ies)!`
                                : replyCheckResult.errors.length > 0
                                  ? 'Error checking replies'
                                  : `Checked ${replyCheckResult.checked} messages - no new replies found`
                              }
                            </div>
                            {replyCheckResult.errors.map((err, i) => (
                              <div key={i} className="text-sm text-red-600 mt-1">{err}</div>
                            ))}
                          </div>
                        </div>

                        {/* Show newly found replies */}
                        {replyCheckResult.replies.length > 0 && (
                          <div className="mt-3 space-y-2">
                            {replyCheckResult.replies.map((reply, i) => (
                              <div key={i} className="bg-white rounded-lg p-3 border border-green-100">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Reply className="h-4 w-4 text-amber-500" />
                                    <span className="text-sm font-medium">{reply.from}</span>
                                  </div>
                                  <Badge variant="outline" className="text-xs">{reply.campaignName}</Badge>
                                </div>
                                <div className="text-sm text-gray-600 mt-1">{reply.subject}</div>
                                <div className="text-xs text-gray-400 mt-1 line-clamp-2">{reply.snippet}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Recent Reply Events */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Reply History</CardTitle>
                    <p className="text-sm text-gray-600 mt-0.5">
                      All detected replies to your campaign emails
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={fetchReplyEvents} disabled={loadingReplyEvents}>
                    <RefreshCw className={`h-4 w-4 mr-1.5 ${loadingReplyEvents ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {replyEvents.length === 0 && !loadingReplyEvents && (
                  <div className="text-center py-12">
                    <Reply className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                    <h3 className="text-lg font-medium text-gray-700 mb-1">No Replies Detected Yet</h3>
                    <p className="text-gray-500 mb-4">
                      {replyStatus?.configured 
                        ? 'Replies will appear here as they are detected. Try running a manual check above.'
                        : 'Connect your Gmail account to start tracking replies automatically.'}
                    </p>
                  </div>
                )}

                {replyEvents.length > 0 && (
                  <div className="space-y-3">
                    {replyEvents.map((event) => (
                      <div key={event.id} className="flex items-start gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                        <div className="p-2 bg-amber-50 rounded-lg flex-shrink-0">
                          <Reply className="h-5 w-5 text-amber-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-gray-900">
                              {event.contact 
                                ? `${event.contact.firstName || ''} ${event.contact.lastName || ''}`.trim() || event.contact.email
                                : event.metadata?.fromEmail || 'Unknown'
                              }
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {event.campaignName}
                            </Badge>
                            {event.metadata?.detectedVia === 'gmail-api' && (
                              <Badge className="bg-blue-50 text-blue-600 border-blue-200 text-xs">
                                Gmail API
                              </Badge>
                            )}
                          </div>
                          {event.contact?.email && (
                            <div className="text-sm text-gray-500">{event.contact.email}</div>
                          )}
                          {event.contact?.company && (
                            <div className="text-xs text-gray-400">{event.contact.company}</div>
                          )}
                          {event.metadata?.subject && (
                            <div className="text-sm text-gray-600 mt-1">Re: {event.metadata.subject}</div>
                          )}
                          {event.metadata?.snippet && (
                            <div className="text-xs text-gray-400 mt-1 line-clamp-2">{event.metadata.snippet}</div>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-xs text-gray-500 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatTimeAgo(event.createdAt)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ========== SENDERS TAB ========== */}
          <TabsContent value="senders" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Email addresses</CardTitle>
                    <p className="text-sm text-gray-600 mt-1">
                      Configure the email addresses you can send emails from.
                    </p>
                  </div>
                  <Button onClick={() => setLocation('/setup')} className="bg-blue-600 hover:bg-blue-700">
                    <Plus className="h-4 w-4 mr-2" />
                    Add sender
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-4 gap-4 pb-3 border-b text-sm font-medium text-gray-600">
                    <div>Name</div>
                    <div>Email</div>
                    <div>Provider</div>
                    <div>Status / Quota</div>
                  </div>

                  {senders.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      No sender accounts configured. Add one to start sending campaigns.
                    </div>
                  )}

                  {senders.map((sender: any) => {
                    const quota = accountQuotas.find(q => q.id === sender.id);
                    return (
                      <div key={sender.id} className="grid grid-cols-4 gap-4 py-3 border-b items-center">
                        <div className="font-medium">{sender.name}</div>
                        <div className="text-gray-600 text-sm">{sender.email}</div>
                        <div>
                          <Badge variant="outline" className="text-xs">
                            {getProviderIcon(sender.provider)} {getProviderLabel(sender.provider)}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge className={sender.status === 'Active' ? 'bg-green-100 text-green-800 border-green-200' : 'bg-gray-100 text-gray-600'}>
                            {sender.status}
                          </Badge>
                          {quota && (
                            <div className="flex items-center gap-2 flex-1">
                              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden max-w-[80px]">
                                <div 
                                  className={`h-full rounded-full ${getQuotaColor(quota.usagePercent)}`}
                                  style={{ width: `${Math.max(quota.usagePercent, 2)}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500">{quota.remaining}/{quota.dailyLimit}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>More settings</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h3 className="font-medium text-gray-900">Email signature</h3>
                    <p className="text-sm text-gray-600 mb-3">Create and manage your email signature</p>
                    <Dialog open={showSignatureDialog} onOpenChange={setShowSignatureDialog}>
                      <DialogTrigger asChild>
                        <Button variant="outline">Configure signature</Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Email Signature</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="signature">Signature</Label>
                            <Textarea 
                              id="signature" 
                              placeholder={"Best regards,\nYour Name\nYour Title\nCompany Name"}
                              className="min-h-[150px]"
                            />
                          </div>
                          <div className="flex justify-end space-x-2">
                            <Button variant="outline" onClick={() => setShowSignatureDialog(false)}>Cancel</Button>
                            <Button onClick={() => setShowSignatureDialog(false)}>Save signature</Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ========== INTEGRATIONS TAB ========== */}
          <TabsContent value="integrations" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Email Integrations</CardTitle>
                <p className="text-sm text-gray-600">Connect your email accounts to send campaigns</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                        <Mail className="h-5 w-5 text-red-600" />
                      </div>
                      <div>
                        <h3 className="font-medium">Gmail</h3>
                        <p className="text-sm text-gray-600">Connect your Gmail account for reply tracking</p>
                      </div>
                    </div>
                    {replyStatus?.configured ? (
                      <div className="flex items-center gap-2">
                        <Badge className="bg-green-100 text-green-700 border-green-200">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Connected
                        </Badge>
                        {replyStatus.gmailEmail && (
                          <span className="text-sm text-gray-500">{replyStatus.gmailEmail}</span>
                        )}
                      </div>
                    ) : (
                      <Button variant="outline" onClick={() => window.location.href = '/api/auth/google'}>Connect</Button>
                    )}
                  </div>

                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Mail className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-medium">Outlook / Microsoft</h3>
                        <p className="text-sm text-gray-600">Connect your Outlook account for email & mail read</p>
                      </div>
                    </div>
                    {outlookStatus?.connected ? (
                      <div className="flex items-center gap-2">
                        <Badge className="bg-green-100 text-green-700 border-green-200">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Connected
                        </Badge>
                        {outlookStatus.email && (
                          <span className="text-sm text-gray-500">{outlookStatus.email}</span>
                        )}
                      </div>
                    ) : (
                      <Button variant="outline" onClick={() => window.location.href = '/api/auth/microsoft'}>Connect</Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ========== ADVANCED TAB ========== */}
          <TabsContent value="advanced" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Advanced Settings</CardTitle>
                <p className="text-sm text-gray-600">Advanced configuration options for power users</p>
              </CardHeader>
              <CardContent>
                <div className="text-center py-12">
                  <p className="text-gray-500">Advanced settings coming soon.</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
