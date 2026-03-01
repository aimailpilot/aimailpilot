import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { OAuthIntegration } from "@/components/oauth/oauth-integration";
import { SimpleCampaignForm } from "@/components/simple-campaign-form";
import { Mail, Plus, Search, Users, TrendingUp } from "lucide-react";
import { useCampaigns } from "@/hooks/use-campaigns";
import type { Campaign } from "@/types";

export default function SimpleDashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewCampaign, setShowNewCampaign] = useState(false);
  const [activeTab, setActiveTab] = useState<'campaigns' | 'setup'>('campaigns');
  
  const { campaigns, isLoading } = useCampaigns();

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'completed': return 'bg-blue-100 text-blue-800';
      case 'paused': return 'bg-yellow-100 text-yellow-800';
      case 'draft': return 'bg-gray-100 text-gray-800';
      case 'scheduled': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredCampaigns = campaigns?.filter((campaign: Campaign) => {
    return campaign.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
           campaign.description?.toLowerCase().includes(searchQuery.toLowerCase());
  }) || [];

  // Simple stats calculation
  const totalSent = campaigns?.reduce((sum, c) => sum + (c.sentCount || 0), 0) || 0;
  const totalOpened = campaigns?.reduce((sum, c) => sum + (c.openedCount || 0), 0) || 0;
  const openRate = totalSent > 0 ? ((totalOpened / totalSent) * 100).toFixed(1) : '0';

  return (
    <div className="min-h-screen bg-white">
      {/* Simple Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Mail className="h-8 w-8 text-blue-600 mr-3" />
              <h1 className="text-xl font-semibold text-gray-900">MailMaster</h1>
            </div>
            <div className="flex items-center space-x-3">
              <span className="text-sm text-gray-500">
                {totalSent} emails sent • {openRate}% open rate
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)}>
          <div className="flex justify-between items-center mb-6">
            <TabsList className="grid w-auto grid-cols-2">
              <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
              <TabsTrigger value="setup">Email & Import</TabsTrigger>
            </TabsList>
            
            {activeTab === 'campaigns' && (
              <Dialog open={showNewCampaign} onOpenChange={setShowNewCampaign}>
                <DialogTrigger asChild>
                  <Button className="bg-blue-600 hover:bg-blue-700">
                    <Plus className="h-4 w-4 mr-2" />
                    New Campaign
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Create New Campaign</DialogTitle>
                  </DialogHeader>
                  <SimpleCampaignForm onSuccess={() => setShowNewCampaign(false)} />
                </DialogContent>
              </Dialog>
            )}
          </div>

          <TabsContent value="campaigns" className="space-y-6">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search campaigns..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-campaigns"
              />
            </div>

            {/* Campaigns List */}
            {isLoading ? (
              <div className="text-center py-12">
                <div className="text-gray-500">Loading campaigns...</div>
              </div>
            ) : filteredCampaigns.length === 0 ? (
              <Card>
                <CardContent className="text-center py-12">
                  <Mail className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No campaigns yet</h3>
                  <p className="text-gray-500 mb-4">
                    Get started by creating your first email campaign
                  </p>
                  <Button 
                    onClick={() => setShowNewCampaign(true)}
                    className="bg-blue-600 hover:bg-blue-700"
                    data-testid="button-create-first-campaign"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Create Your First Campaign
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredCampaigns.map((campaign: Campaign) => {
                  const metrics = {
                    openRate: campaign.sentCount > 0 ? ((campaign.openedCount || 0) / campaign.sentCount * 100).toFixed(1) : '0',
                    clickRate: (campaign.openedCount || 0) > 0 ? (((campaign.clickedCount || 0) / (campaign.openedCount || 1)) * 100).toFixed(1) : '0'
                  };

                  return (
                    <Card key={campaign.id} className="hover:shadow-sm transition-shadow">
                      <CardContent className="p-6">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center space-x-3 mb-2">
                              <h3 className="text-lg font-medium text-gray-900">{campaign.name}</h3>
                              <Badge className={getStatusColor(campaign.status)}>
                                {campaign.status}
                              </Badge>
                            </div>
                            {campaign.description && (
                              <p className="text-gray-600 mb-3">{campaign.description}</p>
                            )}
                            <div className="flex items-center space-x-6 text-sm text-gray-500">
                              <span className="flex items-center">
                                <Users className="h-4 w-4 mr-1" />
                                {campaign.sentCount || 0} sent
                              </span>
                              <span className="flex items-center">
                                <TrendingUp className="h-4 w-4 mr-1" />
                                {metrics.openRate}% opened
                              </span>
                              <span className="flex items-center">
                                <Mail className="h-4 w-4 mr-1" />
                                {metrics.clickRate}% clicked
                              </span>
                            </div>
                          </div>
                          <Button variant="outline" size="sm" data-testid={`button-view-${campaign.id}`}>
                            View Details
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="setup">
            <Card>
              <CardHeader>
                <CardTitle>Email & Contact Setup</CardTitle>
              </CardHeader>
              <CardContent>
                <OAuthIntegration 
                  organizationId="org1" 
                  onSuccess={(accountId, email) => {
                    console.log('Email account connected:', { accountId, email });
                    setActiveTab('campaigns');
                  }}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}