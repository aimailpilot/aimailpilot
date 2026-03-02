import { useState, useEffect } from "react";
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
  Mail, Target, FileText, Users, TrendingUp, BarChart3, 
  Settings, CreditCard, Shield, Plus, MoreHorizontal, Edit,
  Zap, AlertTriangle, CheckCircle, RefreshCw, Brain, Sparkles,
  ArrowRight, Info
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

export default function AccountSettings() {
  const [location, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("general");
  const [showAddSenderDialog, setShowAddSenderDialog] = useState(false);
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

  const sidebarItems = [
    { key: 'campaigns', label: 'Campaigns', icon: Target, href: '/' },
    { key: 'templates', label: 'Templates', icon: FileText, href: '/templates' },
    { key: 'contacts', label: 'Contacts', icon: Users, href: '/contacts' },
    { key: 'setup', label: 'Email & Import', icon: Mail, href: '/setup' },
  ];

  const sidebarBottomItems = [
    { key: 'analytics', label: 'Analytics', icon: BarChart3 },
    { key: 'verification', label: 'Email verification', icon: Shield },
    { key: 'tracking', label: 'Live tracking', icon: TrendingUp },
    { key: 'account', label: 'Account', icon: Settings, active: true },
    { key: 'billing', label: 'Billing', icon: CreditCard },
  ];

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

  useEffect(() => {
    fetchQuotas();
    fetchUserInfo();
    fetchSenders();
  }, []);

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

  return (
    <div className="flex h-screen bg-gray-50">
      {/* AImailagent Sidebar */}
      <div className="w-64 bg-blue-600 text-white flex flex-col">
        <div className="p-6 border-b border-blue-500">
          <div className="flex items-center">
            <div className="bg-white rounded-lg p-2 mr-3">
              <Mail className="h-6 w-6 text-blue-600" />
            </div>
            <span className="text-xl font-semibold">AImailagent</span>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6">
          <div className="space-y-2">
            {sidebarItems.map((item) => (
              <button
                key={item.key}
                onClick={() => setLocation(item.href)}
                className="w-full flex items-center px-3 py-2 rounded-lg text-left text-blue-100 hover:bg-blue-500 hover:text-white transition-colors"
              >
                <item.icon className="h-5 w-5 mr-3" />
                {item.label}
              </button>
            ))}
          </div>

          <div className="mt-8">
            <div className="text-blue-200 text-xs font-medium uppercase tracking-wide mb-3 px-3">More</div>
            <div className="space-y-2">
              {sidebarBottomItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => item.key === 'account' ? null : setLocation(`/${item.key}`)}
                  className={`w-full flex items-center px-3 py-2 rounded-lg text-left transition-colors ${
                    item.active ? 'bg-blue-500 text-white' : 'text-blue-100 hover:bg-blue-500 hover:text-white'
                  }`}
                >
                  <item.icon className="h-5 w-5 mr-3" />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </nav>

        <div className="p-4 border-t border-blue-500">
          <button 
            onClick={() => setLocation('/')}
            className="w-full flex items-center justify-center px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-400 transition-colors"
          >
            <Mail className="h-4 w-4 mr-2" />
            New campaign
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Account</h1>
              <p className="text-gray-600">Manage your account settings, email quotas, and AI recommendations</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="quotas" className="flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5" />
                Email Quotas
              </TabsTrigger>
              <TabsTrigger value="senders">Senders</TabsTrigger>
              <TabsTrigger value="ai-advisor" className="flex items-center gap-1.5">
                <Brain className="h-3.5 w-3.5" />
                AI Advisor
              </TabsTrigger>
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
              {/* Summary Card */}
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

              {/* Per-Account Quota Cards */}
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

                      {/* Quota Progress Bar */}
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

                    {/* AI Recommendation Result */}
                    {recommendation && (
                      <div className="mt-4 space-y-4">
                        {/* Main Recommendation */}
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
                                {recommendation.strategy === 'single' && '✅ Recommended: Single Account'}
                                {recommendation.strategy === 'split' && '🔀 Recommended: Split Across Accounts'}
                                {recommendation.strategy === 'none' && '❌ No Accounts Available'}
                                {recommendation.strategy === 'insufficient' && '⚠️ Insufficient Quota'}
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

                        {/* Split Plan */}
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

                        {/* Warnings */}
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

                        {/* Tips */}
                        {recommendation.tips && recommendation.tips.length > 0 && (
                          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                            <h4 className="font-medium text-gray-700 mb-2 flex items-center gap-2">
                              <Info className="h-4 w-4" />
                              Tips for Better Deliverability
                            </h4>
                            <ul className="space-y-1">
                              {recommendation.tips.map((t, i) => (
                                <li key={i} className="text-sm text-gray-600 flex items-start gap-2">
                                  <span className="mt-1">💡</span> {t}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Account Quotas in Recommendation Context */}
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
                                placeholder="Best regards,&#10;Your Name&#10;Your Title&#10;Company Name"
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
                          <p className="text-sm text-gray-600">Connect your Gmail account</p>
                        </div>
                      </div>
                      <Button variant="outline">Connect</Button>
                    </div>

                    <div className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                          <Mail className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                          <h3 className="font-medium">Outlook</h3>
                          <p className="text-sm text-gray-600">Connect your Outlook account</p>
                        </div>
                      </div>
                      <Button variant="outline">Connect</Button>
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
      </main>
    </div>
  );
}
