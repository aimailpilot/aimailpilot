import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardStats } from "@/types";

export function KPICards() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-600">Active Campaigns</p>
            <p className="text-2xl font-bold text-slate-900">{stats?.activeCampaigns || 0}</p>
            <p className="text-sm text-accent">+2 this week</p>
          </div>
          <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
            <i className="fas fa-rocket text-primary"></i>
          </div>
        </div>
      </div>
      
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-600">Open Rate</p>
            <p className="text-2xl font-bold text-slate-900">{stats?.openRate?.toFixed(1) || '0.0'}%</p>
            <p className="text-sm text-accent">+5.3% vs avg</p>
          </div>
          <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
            <i className="fas fa-envelope-open text-accent"></i>
          </div>
        </div>
      </div>
      
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-600">Reply Rate</p>
            <p className="text-2xl font-bold text-slate-900">{stats?.replyRate?.toFixed(1) || '0.0'}%</p>
            <p className="text-sm text-accent">+1.2% vs avg</p>
          </div>
          <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
            <i className="fas fa-reply text-purple-600"></i>
          </div>
        </div>
      </div>
      
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-600">Deliverability</p>
            <p className="text-2xl font-bold text-slate-900">{stats?.deliverability?.toFixed(1) || '0.0'}%</p>
            <p className="text-sm text-accent">Excellent</p>
          </div>
          <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center">
            <i className="fas fa-check-circle text-accent"></i>
          </div>
        </div>
      </div>
    </div>
  );
}
