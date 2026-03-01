import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useLocation } from "wouter";
import { 
  Mail, Plus, Search, Users, TrendingUp, BarChart3, 
  FileText, Target, Settings, CreditCard, Shield, LogOut, ChevronDown,
  GitBranch, Zap
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useQuery } from "@tanstack/react-query";
import { useCampaigns } from "@/hooks/use-campaigns";
import type { Campaign } from "@/types";

// Import all page components
import EmailAccountSetup from "./email-account-setup";
import CampaignCreator from "./campaign-creator";
import ContactsManager from "./contacts-manager";
import AnalyticsDashboard from "./analytics-dashboard";
import TemplateManager from "./template-manager";
import FollowupSequenceBuilder from "./followup-builder";

type ViewType = 'campaigns' | 'templates' | 'contacts' | 'setup' | 'analytics' | 'verification' | 'tracking' | 'account' | 'billing' | 'followups';

export default function MailMeteorDashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [viewMode, setViewMode] = useState<'dashboard' | 'campaign'>('dashboard');
  const [currentView, setCurrentView] = useState<ViewType>('campaigns');
  const [location, setLocation] = useLocation();
  
  const { campaigns, isLoading } = useCampaigns();

  const { data: user } = useQuery({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  const handleLogout = async () => {
    try {
      localStorage.clear();
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      window.location.href = '/?logout=true';
    } catch (error) {
      window.location.href = '/?logout=true';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge className="bg-green-100 text-green-800 border-green-200">active</Badge>;
      case 'completed': return <Badge className="bg-gray-100 text-gray-800 border-gray-200">completed</Badge>;
      case 'draft': return <Badge className="bg-gray-100 text-gray-600 border-gray-200">draft</Badge>;
      case 'scheduled': return <Badge className="bg-blue-100 text-blue-800 border-blue-200">scheduled</Badge>;
      case 'paused': return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">paused</Badge>;
      default: return <Badge className="bg-gray-100 text-gray-600 border-gray-200">{status}</Badge>;
    }
  };

  const filters = ["All", "Active", "Scheduled", "Drafts", "Completed", "Paused"];
  
  const filteredCampaigns = campaigns?.filter((campaign: Campaign) => {
    const matchesSearch = campaign.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = activeFilter === "All" || 
                         (activeFilter === "Active" && campaign.status === "active") ||
                         (activeFilter === "Scheduled" && campaign.status === "scheduled") ||
                         (activeFilter === "Drafts" && campaign.status === "draft") ||
                         (activeFilter === "Completed" && campaign.status === "completed") ||
                         (activeFilter === "Paused" && campaign.status === "paused");
    return matchesSearch && matchesFilter;
  }) || [];

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const formatPercentage = (num: number, den: number) => den === 0 ? '0%' : `${((num / den) * 100).toFixed(1)}%`;

  // Campaign actions
  const handlePause = async (id: string) => {
    await fetch(`/api/campaigns/${id}/pause`, { method: 'POST', credentials: 'include' });
    window.location.reload();
  };
  const handleResume = async (id: string) => {
    await fetch(`/api/campaigns/${id}/resume`, { method: 'POST', credentials: 'include' });
    window.location.reload();
  };
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this campaign?')) return;
    await fetch(`/api/campaigns/${id}`, { method: 'DELETE', credentials: 'include' });
    window.location.reload();
  };

  const sidebarItems = [
    { key: 'campaigns' as ViewType, label: 'Campaigns', icon: Target },
    { key: 'templates' as ViewType, label: 'Templates', icon: FileText },
    { key: 'contacts' as ViewType, label: 'Contacts', icon: Users },
    { key: 'followups' as ViewType, label: 'Follow-ups', icon: GitBranch },
    { key: 'setup' as ViewType, label: 'Email Accounts', icon: Mail },
  ];

  const sidebarBottomItems = [
    { key: 'analytics' as ViewType, label: 'Analytics', icon: BarChart3 },
    { key: 'tracking' as ViewType, label: 'Live Tracking', icon: TrendingUp },
    { key: 'account' as ViewType, label: 'Account', icon: Settings },
  ];

  const getViewTitle = () => {
    if (viewMode === 'campaign') return 'New Campaign';
    const titles: Record<ViewType, string> = {
      campaigns: 'Campaigns', templates: 'Templates', contacts: 'Contacts',
      setup: 'Email Accounts', analytics: 'Analytics', followups: 'Follow-up Sequences',
      verification: 'Email Verification', tracking: 'Live Tracking',
      account: 'Account', billing: 'Billing',
    };
    return titles[currentView] || 'Dashboard';
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 bg-blue-600 text-white flex flex-col">
        <div className="p-6 border-b border-blue-500">
          <div className="flex items-center">
            <div className="bg-white rounded-lg p-2 mr-3">
              <Mail className="h-6 w-6 text-blue-600" />
            </div>
            <span className="text-xl font-semibold">MailFlow</span>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6">
          <div className="space-y-1">
            {sidebarItems.map((item) => (
              <button
                key={item.key}
                onClick={() => { setCurrentView(item.key); setViewMode('dashboard'); }}
                className={`w-full flex items-center px-3 py-2.5 rounded-lg text-left transition-colors text-sm ${
                  currentView === item.key && viewMode === 'dashboard'
                    ? 'bg-blue-500 text-white font-medium' 
                    : 'text-blue-100 hover:bg-blue-500/50 hover:text-white'
                }`}
              >
                <item.icon className="h-5 w-5 mr-3" />
                {item.label}
              </button>
            ))}
          </div>

          <div className="mt-6">
            <div className="text-blue-200 text-xs font-medium uppercase tracking-wide mb-2 px-3">More</div>
            <div className="space-y-1">
              {sidebarBottomItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => { setCurrentView(item.key); setViewMode('dashboard'); }}
                  className={`w-full flex items-center px-3 py-2.5 rounded-lg text-left transition-colors text-sm ${
                    currentView === item.key && viewMode === 'dashboard'
                      ? 'bg-blue-500 text-white font-medium'
                      : 'text-blue-100 hover:bg-blue-500/50 hover:text-white'
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
          <Button 
            className="w-full bg-white text-blue-600 hover:bg-blue-50 font-medium"
            onClick={() => setViewMode('campaign')}
          >
            <Plus className="h-4 w-4 mr-2" />
            New Campaign
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h1 className="text-xl font-bold text-gray-900">{getViewTitle()}</h1>
              
              {viewMode === 'dashboard' && currentView === 'campaigns' && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                  <Input
                    placeholder="Search campaigns..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 w-72"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center space-x-3">
              {viewMode === 'campaign' && (
                <Button variant="outline" onClick={() => setViewMode('dashboard')}>← Back</Button>
              )}
              {viewMode === 'dashboard' && currentView === 'campaigns' && (
                <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setViewMode('campaign')}>
                  <Plus className="h-4 w-4 mr-2" /> New Campaign
                </Button>
              )}
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center space-x-2 p-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user?.picture} />
                      <AvatarFallback className="bg-blue-100 text-blue-600">
                        {user?.name?.[0] || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="text-left hidden sm:block">
                      <div className="text-sm font-medium">{user?.name}</div>
                      <div className="text-xs text-gray-500">{user?.email}</div>
                    </div>
                    <ChevronDown className="h-4 w-4 text-gray-500" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => { setCurrentView('account'); setViewMode('dashboard'); }}>
                    <Settings className="h-4 w-4 mr-2" /> Account
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                    <LogOut className="h-4 w-4 mr-2" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          {/* Campaign Creator */}
          {viewMode === 'campaign' && (
            <CampaignCreator 
              onSuccess={() => { setViewMode('dashboard'); setCurrentView('campaigns'); }} 
              onBack={() => setViewMode('dashboard')}
            />
          )}

          {/* Campaigns List */}
          {viewMode === 'dashboard' && currentView === 'campaigns' && (
            <div className="p-6">
              <div className="flex space-x-1 mb-6 border-b border-gray-200">
                {filters.map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setActiveFilter(filter)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeFilter === filter
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>

              {isLoading ? (
                <div className="text-center py-12 text-gray-500">Loading campaigns...</div>
              ) : filteredCampaigns.length === 0 ? (
                <div className="text-center py-12">
                  <Mail className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No campaigns yet</h3>
                  <p className="text-gray-500 mb-6">Create your first email campaign to get started</p>
                  <Button onClick={() => setViewMode('campaign')} className="bg-blue-600 hover:bg-blue-700">
                    New Campaign
                  </Button>
                </div>
              ) : (
                <div className="bg-white rounded-lg border border-gray-200">
                  <div className="grid grid-cols-8 gap-3 px-6 py-3 border-b text-sm font-medium text-gray-500">
                    <div className="col-span-2">Name</div>
                    <div>Sent</div>
                    <div>Opens</div>
                    <div>Clicks</div>
                    <div>Status</div>
                    <div>Created</div>
                    <div></div>
                  </div>

                  {filteredCampaigns.map((campaign: Campaign) => (
                    <div key={campaign.id} className="grid grid-cols-8 gap-3 px-6 py-3 border-b border-gray-100 hover:bg-gray-50 items-center text-sm">
                      <div className="col-span-2">
                        <div className="font-medium text-gray-900">{campaign.name}</div>
                        {campaign.description && <div className="text-xs text-gray-400">{campaign.description}</div>}
                      </div>
                      <div className="text-gray-600">{campaign.sentCount || 0}</div>
                      <div className="text-gray-600">{formatPercentage(campaign.openedCount || 0, campaign.sentCount || 0)}</div>
                      <div className="text-gray-600">{formatPercentage(campaign.clickedCount || 0, campaign.sentCount || 0)}</div>
                      <div>{getStatusBadge(campaign.status)}</div>
                      <div className="text-gray-500 text-xs">{campaign.createdAt ? formatDate(campaign.createdAt) : '-'}</div>
                      <div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">⋮</Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {campaign.status === 'active' && (
                              <DropdownMenuItem onClick={() => handlePause(campaign.id)}>Pause</DropdownMenuItem>
                            )}
                            {campaign.status === 'paused' && (
                              <DropdownMenuItem onClick={() => handleResume(campaign.id)}>Resume</DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => handleDelete(campaign.id)} className="text-red-600">Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Templates */}
          {viewMode === 'dashboard' && currentView === 'templates' && <TemplateManager />}

          {/* Contacts */}
          {viewMode === 'dashboard' && currentView === 'contacts' && <ContactsManager />}

          {/* Follow-ups */}
          {viewMode === 'dashboard' && currentView === 'followups' && <FollowupSequenceBuilder />}

          {/* Email Account Setup */}
          {viewMode === 'dashboard' && currentView === 'setup' && (
            <div className="p-6"><EmailAccountSetup /></div>
          )}

          {/* Analytics */}
          {viewMode === 'dashboard' && currentView === 'analytics' && <AnalyticsDashboard />}

          {/* Live Tracking */}
          {viewMode === 'dashboard' && currentView === 'tracking' && (
            <div className="p-6">
              <div className="text-center py-12">
                <TrendingUp className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Live Tracking</h3>
                <p className="text-gray-500">Real-time email open and click tracking will appear here when campaigns are active.</p>
              </div>
            </div>
          )}

          {/* Account */}
          {viewMode === 'dashboard' && currentView === 'account' && (
            <div className="p-6">
              <div className="max-w-2xl space-y-6">
                <Card>
                  <CardContent className="p-6">
                    <h3 className="text-lg font-medium mb-4">Account Information</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between py-2 border-b"><span className="text-gray-500">Name</span><span className="font-medium">{user?.name || 'Demo User'}</span></div>
                      <div className="flex justify-between py-2 border-b"><span className="text-gray-500">Email</span><span className="font-medium">{user?.email || 'demo@mailflow.app'}</span></div>
                      <div className="flex justify-between py-2 border-b"><span className="text-gray-500">Plan</span><span className="font-medium">MailFlow Pro <Badge className="ml-2 bg-blue-100 text-blue-700">Active</Badge></span></div>
                      <div className="flex justify-between py-2"><span className="text-gray-500">Daily Quota</span><span className="font-medium">2,000 emails/day</span></div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
