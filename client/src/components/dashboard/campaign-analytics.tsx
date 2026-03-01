import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import type { AnalyticsData } from "@/types";

export function CampaignAnalytics() {
  const { data: analytics, isLoading } = useQuery<AnalyticsData>({
    queryKey: ["/api/analytics/performance"],
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl shadow-sm border border-slate-200">
            <div className="p-6">
              <Skeleton className="h-64 w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const leadScoringData = analytics?.leadScoring ? [
    { name: 'Hot', value: analytics.leadScoring.hot, color: '#EF4444' },
    { name: 'Warm', value: analytics.leadScoring.warm, color: '#F59E0B' },
    { name: 'Cold', value: analytics.leadScoring.cold, color: '#6B7280' },
  ] : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="p-6 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">Email Performance Trends</h3>
        </div>
        <div className="p-6">
          {analytics?.timeline ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={analytics.timeline}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(value) => new Date(value).toLocaleDateString()}
                />
                <YAxis />
                <Tooltip 
                  labelFormatter={(value) => new Date(value).toLocaleDateString()}
                />
                <Line type="monotone" dataKey="opens" stroke="#2563EB" strokeWidth={2} name="Opens" />
                <Line type="monotone" dataKey="clicks" stroke="#10B981" strokeWidth={2} name="Clicks" />
                <Line type="monotone" dataKey="replies" stroke="#8B5CF6" strokeWidth={2} name="Replies" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 bg-slate-50 rounded-lg flex items-center justify-center border border-slate-200">
              <div className="text-center">
                <i className="fas fa-chart-line text-slate-400 text-3xl mb-2"></i>
                <p className="text-slate-600">No performance data available</p>
              </div>
            </div>
          )}
        </div>
      </div>
      
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="p-6 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">Lead Scoring Distribution</h3>
        </div>
        <div className="p-6">
          {leadScoringData.length > 0 ? (
            <div className="flex items-center">
              <ResponsiveContainer width="60%" height={240}>
                <PieChart>
                  <Pie
                    data={leadScoringData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={80}
                    dataKey="value"
                  >
                    {leadScoringData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 pl-4">
                {leadScoringData.map((item) => (
                  <div key={item.name} className="flex items-center justify-between mb-3">
                    <div className="flex items-center">
                      <div 
                        className="w-3 h-3 rounded-full mr-2" 
                        style={{ backgroundColor: item.color }}
                      ></div>
                      <span className="text-sm text-slate-600">{item.name}</span>
                    </div>
                    <span className="text-sm font-medium text-slate-900">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-64 bg-slate-50 rounded-lg flex items-center justify-center border border-slate-200">
              <div className="text-center">
                <i className="fas fa-chart-pie text-slate-400 text-3xl mb-2"></i>
                <p className="text-slate-600">No lead scoring data available</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
