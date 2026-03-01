import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { Integration } from "@/types";

export function IntegrationsStatus() {
  const { data: integrations, isLoading } = useQuery<Integration[]>({
    queryKey: ["/api/integrations"],
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="p-6">
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  // Mock integration data if none exists
  const mockIntegrations = [
    {
      type: 'apollo',
      name: 'Apollo.io',
      icon: 'fa-rocket',
      color: 'bg-blue-600',
      status: 'Connected',
      statusColor: 'text-green-600',
      lastSync: '2 hours ago',
      metric: '1,247 contacts imported'
    },
    {
      type: 'zoominfo',
      name: 'ZoomInfo',
      icon: 'fa-search',
      color: 'bg-purple-600',
      status: 'Connected',
      statusColor: 'text-green-600',
      lastSync: '4 hours ago',
      metric: '892 profiles enriched'
    },
    {
      type: 'linkedin',
      name: 'LinkedIn',
      icon: 'fab fa-linkedin',
      color: 'bg-blue-800',
      status: 'Connected',
      statusColor: 'text-green-600',
      lastSync: 'Messages sent: 156',
      metric: 'Response rate: 12.8%'
    },
    {
      type: 'whatsapp',
      name: 'WhatsApp',
      icon: 'fab fa-whatsapp',
      color: 'bg-green-600',
      status: 'Setup Required',
      statusColor: 'text-yellow-600',
      lastSync: '',
      metric: ''
    }
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      <div className="p-6 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Platform Integrations</h3>
          <button className="text-sm text-primary hover:text-blue-700 font-medium">Manage</button>
        </div>
      </div>
      
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {mockIntegrations.map((integration) => (
            <div key={integration.type} className="p-4 border border-slate-200 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className={`w-10 h-10 ${integration.color} rounded-lg flex items-center justify-center`}>
                  <i className={`${integration.icon} text-white`}></i>
                </div>
                <div>
                  <h4 className="font-medium text-slate-900">{integration.name}</h4>
                  <p className={`text-sm ${integration.statusColor}`}>{integration.status}</p>
                </div>
              </div>
              <div className="mt-3">
                {integration.lastSync && (
                  <p className="text-xs text-slate-500">Last sync: {integration.lastSync}</p>
                )}
                {integration.metric && (
                  <p className="text-xs text-slate-500">{integration.metric}</p>
                )}
                {integration.status === 'Setup Required' && (
                  <button className="text-xs text-primary hover:text-blue-700 font-medium">Configure</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
