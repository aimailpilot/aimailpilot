import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OAuthIntegration } from "@/components/oauth/oauth-integration";
import { MailMeteorCampaignForm } from "@/components/mailmeteor-campaign-form";
import { useLocation } from "wouter";
import { 
  Mail, Plus, Search, Users, TrendingUp, BarChart3, 
  FileText, Target, Settings, CreditCard, Shield, LogOut, ChevronDown
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useQuery } from "@tanstack/react-query";
import { useCampaigns } from "@/hooks/use-campaigns";
import type { Campaign } from "@/types";

export default function MailMeteorDashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("All");
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [viewMode, setViewMode] = useState<'dashboard' | 'campaign'>('dashboard');
  const [currentView, setCurrentView] = useState<'campaigns' | 'templates' | 'contacts' | 'setup'>('campaigns');
  const [location, setLocation] = useLocation();
  
  const { campaigns, isLoading } = useCampaigns();

  // Fetch user data for profile dropdown
  const { data: user } = useQuery({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  const handleLogout = async () => {
    try {
      console.log('🚪 STARTING LOGOUT PROCESS...');
      
      // Clear all localStorage data first
      localStorage.clear();
      console.log('🗑️ CLEARED ALL LOCALSTORAGE');
      
      // Call logout endpoint
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      
      if (response.ok) {
        console.log('✅ LOGOUT SUCCESSFUL - REDIRECTING TO LANDING');
        // Force reload to clear any cached state and go to landing page
        window.location.href = '/?logout=true';
      } else {
        console.error('Logout failed:', response.status);
        // Still redirect even if logout fails
        window.location.href = '/?logout=true';
      }
    } catch (error) {
      console.error('Logout failed:', error);
      // Still redirect even if logout fails
      window.location.href = '/?logout=true';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800 border-green-200">active</Badge>;
      case 'ended':
        return <Badge className="bg-gray-100 text-gray-800 border-gray-200">ended</Badge>;
      case 'draft':
        return <Badge className="bg-gray-100 text-gray-600 border-gray-200">draft</Badge>;
      case 'scheduled':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">scheduled</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-600 border-gray-200">{status}</Badge>;
    }
  };

  const filters = ["All", "Active", "Scheduled", "Drafts", "Ended"];
  
  const filteredCampaigns = campaigns?.filter((campaign: Campaign) => {
    const matchesSearch = campaign.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = activeFilter === "All" || 
                         (activeFilter === "Active" && campaign.status === "active") ||
                         (activeFilter === "Scheduled" && campaign.status === "scheduled") ||
                         (activeFilter === "Drafts" && campaign.status === "draft") ||
                         (activeFilter === "Ended" && campaign.status === "ended");
    return matchesSearch && matchesFilter;
  }) || [];

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  const formatPercentage = (numerator: number, denominator: number) => {
    if (denominator === 0) return '0%';
    return `${((numerator / denominator) * 100).toFixed(1)}%`;
  };

  const sidebarItems = [
    { key: 'campaigns', label: 'Campaigns', icon: Target, active: currentView === 'campaigns' },
    { key: 'templates', label: 'Templates', icon: FileText, active: currentView === 'templates' },
    { key: 'contacts', label: 'Contacts', icon: Users, active: currentView === 'contacts' },
    { key: 'setup', label: 'Email & Import', icon: Mail, active: currentView === 'setup' },
  ];

  const sidebarBottomItems = [
    { key: 'analytics', label: 'Analytics', icon: BarChart3 },
    { key: 'verification', label: 'Email verification', icon: Shield },
    { key: 'tracking', label: 'Live tracking', icon: TrendingUp },
    { key: 'account', label: 'Account', icon: Settings },
    { key: 'billing', label: 'Billing', icon: CreditCard },
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* MailMeteor-style Sidebar */}
      <div className="w-64 bg-blue-600 text-white flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-blue-500">
          <div className="flex items-center">
            <div className="bg-white rounded-lg p-2 mr-3">
              <Mail className="h-6 w-6 text-blue-600" />
            </div>
            <span className="text-xl font-semibold">AImailagent</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6">
          <div className="space-y-2">
            {sidebarItems.map((item) => (
              <button
                key={item.key}
                onClick={() => {
                  if (item.key === 'setup') {
                    setLocation('/setup');
                  } else {
                    setCurrentView(item.key as any);
                  }
                }}
                className={`w-full flex items-center px-3 py-2 rounded-lg text-left transition-colors ${
                  item.active 
                    ? 'bg-blue-500 text-white' 
                    : 'text-blue-100 hover:bg-blue-500 hover:text-white'
                }`}
                data-testid={`nav-${item.key}`}
              >
                <item.icon className="h-5 w-5 mr-3" />
                {item.label}
                {item.key === 'contacts' && (
                  <span className="ml-auto text-xs bg-blue-500 px-2 py-1 rounded">2.4k</span>
                )}
              </button>
            ))}
          </div>

          {/* More Section */}
          <div className="mt-8">
            <div className="text-blue-200 text-xs font-medium uppercase tracking-wide mb-3 px-3">
              More
            </div>
            <div className="space-y-2">
              {sidebarBottomItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => {
                    if (item.key === 'account') {
                      setLocation('/account');
                    }
                  }}
                  className="w-full flex items-center px-3 py-2 rounded-lg text-left text-blue-100 hover:bg-blue-500 hover:text-white transition-colors"
                  data-testid={`nav-${item.key}`}
                >
                  <item.icon className="h-5 w-5 mr-3" />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </nav>

        {/* Bottom Section */}
        <div className="p-4 border-t border-blue-500">
          <Button 
            variant="ghost" 
            className="w-full text-blue-100 hover:bg-blue-500 hover:text-white justify-start"
            onClick={() => setViewMode('campaign')}
          >
            <Plus className="h-4 w-4 mr-2" />
            New campaign
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h1 className="text-2xl font-bold text-gray-900">
                {viewMode === 'campaign' && 'New campaign'}
                {viewMode === 'dashboard' && currentView === 'campaigns' && 'Campaigns'}
                {viewMode === 'dashboard' && currentView === 'templates' && 'Templates'}
                {viewMode === 'dashboard' && currentView === 'contacts' && 'Contacts'}
                {viewMode === 'dashboard' && currentView === 'setup' && 'Email & Import'}
              </h1>
              
              {viewMode === 'dashboard' && currentView === 'campaigns' && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                  <Input
                    placeholder="Search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 w-80"
                    data-testid="input-search"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center space-x-3">
              {viewMode === 'campaign' ? (
                <Button 
                  variant="outline" 
                  onClick={() => setViewMode('dashboard')}
                  data-testid="button-back"
                >
                  ← Back
                </Button>
              ) : currentView === 'campaigns' && (
                <>
                  <Button variant="outline" size="sm">
                    <Target className="h-4 w-4 mr-2" />
                    Filter
                  </Button>
                  <Button 
                    className="bg-blue-600 hover:bg-blue-700" 
                    onClick={() => setViewMode('campaign')}
                    data-testid="button-new-campaign"
                  >
                    New campaign
                  </Button>
                </>
              )}
              
              {/* User Profile Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="flex items-center space-x-2 p-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user?.picture} alt={user?.name || 'User'} />
                      <AvatarFallback className="bg-blue-100 text-blue-600">
                        {user?.name?.[0] || user?.email?.[0] || 'U'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="text-left hidden sm:block">
                      <div className="text-sm font-medium text-gray-900">{user?.name}</div>
                      <div className="text-xs text-gray-500">{user?.email}</div>
                    </div>
                    <ChevronDown className="h-4 w-4 text-gray-500" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => setLocation('/account')} data-testid="menu-account">
                    <Settings className="h-4 w-4 mr-2" />
                    Account
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLocation('/billing')} data-testid="menu-billing">
                    <CreditCard className="h-4 w-4 mr-2" />
                    Billing
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} data-testid="menu-logout" className="text-red-600 focus:text-red-600">
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          {viewMode === 'campaign' ? (
            <div className="h-full">
              <MailMeteorCampaignForm onSuccess={() => setViewMode('dashboard')} />
            </div>
          ) : currentView === 'campaigns' && (
            <div className="p-6">
              {/* Filter Tabs */}
              <div className="flex space-x-1 mb-6 border-b border-gray-200">
                {filters.map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setActiveFilter(filter)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeFilter === filter
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                    data-testid={`filter-${filter.toLowerCase()}`}
                  >
                    {filter}
                  </button>
                ))}
              </div>

              {/* Campaigns Table */}
              {isLoading ? (
                <div className="text-center py-12">
                  <div className="text-gray-500">Loading campaigns...</div>
                </div>
              ) : filteredCampaigns.length === 0 ? (
                <div className="text-center py-12">
                  <Mail className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No campaigns yet</h3>
                  <p className="text-gray-500 mb-6">
                    Create your first email campaign to get started
                  </p>
                  <Button 
                    onClick={() => setViewMode('campaign')}
                    className="bg-blue-600 hover:bg-blue-700"
                    data-testid="button-create-first"
                  >
                    New campaign
                  </Button>
                </div>
              ) : (
                <div className="bg-white rounded-lg border border-gray-200">
                  {/* Table Header */}
                  <div className="grid grid-cols-7 gap-4 px-6 py-3 border-b border-gray-200 text-sm font-medium text-gray-500">
                    <div>Name</div>
                    <div>Sent</div>
                    <div>Opens</div>
                    <div>Clicks</div>
                    <div>Status</div>
                    <div>Created</div>
                    <div></div>
                  </div>

                  {/* Table Rows */}
                  {filteredCampaigns.map((campaign: Campaign) => (
                    <div 
                      key={campaign.id} 
                      className="grid grid-cols-7 gap-4 px-6 py-4 border-b border-gray-100 hover:bg-gray-50 items-center"
                      data-testid={`campaign-row-${campaign.id}`}
                    >
                      <div className="font-medium text-gray-900">{campaign.name}</div>
                      <div className="text-gray-600">{campaign.sentCount || 0}</div>
                      <div className="text-gray-600">
                        {formatPercentage(campaign.openedCount || 0, campaign.sentCount || 0)}
                      </div>
                      <div className="text-gray-600">
                        {formatPercentage(campaign.clickedCount || 0, campaign.sentCount || 0)}
                      </div>
                      <div>{getStatusBadge(campaign.status)}</div>
                      <div className="text-gray-500 text-sm">
                        {campaign.createdAt ? formatDate(campaign.createdAt) : 'Today'}
                      </div>
                      <div>
                        <Button variant="ghost" size="sm" data-testid={`button-menu-${campaign.id}`}>
                          ⋮
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination */}
              {filteredCampaigns.length > 0 && (
                <div className="flex items-center justify-between mt-6">
                  <div className="text-sm text-gray-500">
                    Viewing 1–{Math.min(filteredCampaigns.length, 8)} over {filteredCampaigns.length} results
                  </div>
                  <div className="flex space-x-2">
                    <Button variant="outline" size="sm" disabled>
                      Previous
                    </Button>
                    <Button variant="outline" size="sm" disabled>
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {currentView === 'setup' && (
            <div className="p-6">
              <Card>
                <CardContent className="p-6">
                  <OAuthIntegration 
                    organizationId="550e8400-e29b-41d4-a716-446655440001" 
                    onSuccess={(accountId, email) => {
                      console.log('Email account connected:', { accountId, email });
                      setCurrentView('campaigns');
                    }}
                  />
                </CardContent>
              </Card>
            </div>
          )}

          {/* Account Page */}
          {currentView === 'account' && (
            <div className="p-6">
              <div className="max-w-4xl">
                {/* Account Tabs */}
                <div className="flex space-x-8 border-b border-gray-200 mb-6">
                  <button className="pb-3 px-1 border-b-2 border-blue-600 text-blue-600 font-medium text-sm">
                    General
                  </button>
                  <button className="pb-3 px-1 text-gray-500 font-medium text-sm">
                    Senders
                  </button>
                  <button className="pb-3 px-1 text-gray-500 font-medium text-sm">
                    Integrations
                  </button>
                  <button className="pb-3 px-1 text-gray-500 font-medium text-sm">
                    Partners
                  </button>
                  <button className="pb-3 px-1 text-gray-500 font-medium text-sm">
                    Advanced
                  </button>
                </div>

                {/* Information Section */}
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Information</h3>
                    <div className="space-y-4">
                      <div className="flex items-center space-x-4">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                          <div className="w-4 h-4 bg-blue-600 rounded-full"></div>
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">Name</div>
                          <div className="font-medium">Demo User</div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                          <Mail className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">Email</div>
                          <div className="font-medium">demo@aiemailagent.com</div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                          <BarChart3 className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">Available quota</div>
                          <div className="font-medium">500 / 500 emails <span className="text-gray-500 text-sm">(resets daily)</span></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Billing Section */}
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Billing</h3>
                    <div className="space-y-4">
                      <div className="flex items-center space-x-4">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                          <Shield className="w-4 h-4 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <div className="text-sm text-gray-500">Plan</div>
                          <div className="flex items-center space-x-2">
                            <span className="font-medium">AImailagent Free Plan</span>
                            <Badge variant="secondary" className="bg-pink-100 text-pink-700">
                              Upgrade to Pro
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                          <Users className="w-4 h-4 text-blue-600" />
                        </div>
                        <div>
                          <div className="text-sm text-gray-500">Members</div>
                          <div className="font-medium">Invite teammates to join</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Analytics Page */}
          {currentView === 'analytics' && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Analytics</h2>
                  <p className="text-sm text-gray-600">Showing data from Aug 3, 2025 to Sep 2, 2025.</p>
                </div>
                <div className="flex items-center space-x-3">
                  <Button variant="outline" size="sm">
                    <Target className="h-4 w-4 mr-2" />
                    Filter
                  </Button>
                  <Select defaultValue="last-30-days">
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="last-30-days">Last 30 days</SelectItem>
                      <SelectItem value="last-7-days">Last 7 days</SelectItem>
                      <SelectItem value="last-90-days">Last 90 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Analytics Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-medium text-gray-600">Emails sent</h3>
                    </div>
                    <div className="text-2xl font-bold text-gray-900">3,163</div>
                    <div className="h-12 mt-4 bg-blue-50 rounded flex items-end justify-center">
                      <div className="text-xs text-blue-600">📈 Trending up</div>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-medium text-gray-600">Opens</h3>
                    </div>
                    <div className="text-2xl font-bold text-gray-900">1,939</div>
                    <div className="h-12 mt-4 bg-green-50 rounded flex items-end justify-center">
                      <div className="text-xs text-green-600">61% open rate</div>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-medium text-gray-600">Clicks</h3>
                    </div>
                    <div className="text-2xl font-bold text-gray-900">1,347</div>
                    <div className="h-12 mt-4 bg-purple-50 rounded flex items-end justify-center">
                      <div className="text-xs text-purple-600">43% click rate</div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Performance Section */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Performances</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-sm text-gray-600 mb-1">Open rate</div>
                      <div className="text-xl font-bold text-gray-900">61%</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-sm text-gray-600 mb-1">Click rate</div>
                      <div className="text-xl font-bold text-gray-900">43%</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-sm text-gray-600 mb-1">Click-to-open rate</div>
                      <div className="text-xl font-bold text-gray-900">69%</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-sm text-gray-600 mb-1">Reply rate</div>
                      <div className="text-xl font-bold text-gray-900">12%</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-sm text-gray-600 mb-1">Unsubscribe rate</div>
                      <div className="text-xl font-bold text-gray-900">2%</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-sm text-gray-600 mb-1">Delivery rate</div>
                      <div className="text-xl font-bold text-gray-900">98%</div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          )}

          {/* Templates Page */}
          {currentView === 'templates' && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-gray-900">Templates</h2>
                <div className="flex space-x-3">
                  <Button variant="outline" data-testid="button-new-folder">
                    <Plus className="h-4 w-4 mr-2" />
                    New folder
                  </Button>
                  <Button 
                    className="bg-blue-600 hover:bg-blue-700" 
                    data-testid="button-new-template"
                    onClick={() => {
                      console.log("New template button clicked - navigating to /templates/new");
                      setLocation("/templates/new");
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    New template
                  </Button>
                </div>
              </div>

              {/* Templates Table */}
              <div className="bg-white rounded-lg border border-gray-200">
                <div className="px-6 py-3 border-b border-gray-200 bg-gray-50">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-sm font-medium text-gray-600">Name</div>
                    <div className="text-sm font-medium text-gray-600">Last modified</div>
                  </div>
                </div>
                
                <div className="divide-y divide-gray-200">
                  <div className="px-6 py-4 grid grid-cols-2 gap-4 hover:bg-gray-50">
                    <div className="text-sm text-gray-900">Welcome Email Template</div>
                    <div className="text-sm text-gray-500">Sep 1, 2025</div>
                  </div>
                  <div className="px-6 py-4 grid grid-cols-2 gap-4 hover:bg-gray-50">
                    <div className="text-sm text-gray-900">Follow-up Template</div>
                    <div className="text-sm text-gray-500">Aug 28, 2025</div>
                  </div>
                  <div className="px-6 py-4 grid grid-cols-2 gap-4 hover:bg-gray-50">
                    <div className="text-sm text-gray-900">Product Launch Announcement</div>
                    <div className="text-sm text-gray-500">Aug 25, 2025</div>
                  </div>
                </div>
              </div>

              <div className="text-center mt-6 text-sm text-gray-500">
                Viewing 1 - 3 over 3 results
              </div>
            </div>
          )}

          {/* Placeholder views for other sections */}
          {currentView === 'contacts' && (
            <div className="p-6">
              <div className="text-center py-12">
                <div className="text-gray-500">
                  Contacts coming soon...
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}