import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { Campaign } from "@/types";

export function RecentCampaigns() {
  const { data: campaigns, isLoading } = useQuery<Campaign[]>({
    queryKey: ["/api/campaigns"],
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="p-6 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">Recent Campaigns</h3>
        </div>
        <div className="p-6">
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'completed': return 'bg-blue-100 text-blue-800';
      case 'paused': return 'bg-yellow-100 text-yellow-800';
      case 'draft': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getCampaignIcon = (index: number) => {
    const icons = ['fa-envelope', 'fa-users', 'fa-star', 'fa-chart-line'];
    const colors = ['bg-primary', 'bg-purple-600', 'bg-amber-600', 'bg-green-600'];
    return { icon: icons[index % icons.length], color: colors[index % colors.length] };
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      <div className="p-6 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Recent Campaigns</h3>
          <button className="text-sm text-primary hover:text-blue-700 font-medium">View All</button>
        </div>
      </div>
      
      <div className="p-6">
        <div className="space-y-4">
          {campaigns?.slice(0, 3).map((campaign, index) => {
            const { icon, color } = getCampaignIcon(index);
            const openRate = campaign.sentCount > 0 ? (campaign.openedCount / campaign.sentCount * 100).toFixed(1) : '0.0';
            
            return (
              <div key={campaign.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                <div className="flex items-center space-x-4">
                  <div className={`w-10 h-10 ${color} rounded-lg flex items-center justify-center`}>
                    <i className={`fas ${icon} text-white text-sm`}></i>
                  </div>
                  <div>
                    <h4 className="font-medium text-slate-900">{campaign.name}</h4>
                    <p className="text-sm text-slate-600">
                      Sent to {campaign.totalRecipients} prospects • {new Date(campaign.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-slate-900">{openRate}% open rate</p>
                  <Badge className={`${getStatusColor(campaign.status)} capitalize`}>
                    {campaign.status}
                  </Badge>
                </div>
              </div>
            );
          })}
          
          {!campaigns || campaigns.length === 0 && (
            <div className="text-center py-8">
              <i className="fas fa-inbox text-slate-400 text-3xl mb-4"></i>
              <p className="text-slate-600">No campaigns yet</p>
              <p className="text-sm text-slate-500">Create your first campaign to get started</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
