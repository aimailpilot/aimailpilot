import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { 
  BarChart3, TrendingUp, Mail, MousePointerClick, Reply, 
  AlertTriangle, UserMinus, Send, Loader2, ArrowUp, ArrowDown 
} from "lucide-react";

interface AnalyticsData {
  totalSent: number;
  totalOpened: number;
  totalClicked: number;
  totalReplied: number;
  totalBounced: number;
  totalUnsubscribed: number;
  openRate: string;
  clickRate: string;
  replyRate: string;
  bounceRate: string;
  deliveryRate: string;
  unsubscribeRate: string;
  timeline: Array<{ date: string; opens: number; clicks: number; replies: number }>;
  campaignCount: number;
  contactCount: number;
}

export default function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30');

  useEffect(() => { fetchAnalytics(); }, [period]);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics/overview?days=${period}`, { credentials: 'include' });
      if (res.ok) setData(await res.json());
    } catch (e) { console.error('Failed to fetch analytics:', e); }
    setLoading(false);
  };

  if (loading || !data) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>;
  }

  const statCards = [
    { label: 'Emails Sent', value: data.totalSent, icon: Send, color: 'text-blue-600', bgColor: 'bg-blue-50' },
    { label: 'Opens', value: data.totalOpened, rate: `${data.openRate}%`, icon: Mail, color: 'text-green-600', bgColor: 'bg-green-50' },
    { label: 'Clicks', value: data.totalClicked, rate: `${data.clickRate}%`, icon: MousePointerClick, color: 'text-purple-600', bgColor: 'bg-purple-50' },
    { label: 'Replies', value: data.totalReplied, rate: `${data.replyRate}%`, icon: Reply, color: 'text-orange-600', bgColor: 'bg-orange-50' },
    { label: 'Bounced', value: data.totalBounced, rate: `${data.bounceRate}%`, icon: AlertTriangle, color: 'text-red-600', bgColor: 'bg-red-50' },
    { label: 'Unsubscribed', value: data.totalUnsubscribed, rate: `${data.unsubscribeRate}%`, icon: UserMinus, color: 'text-gray-600', bgColor: 'bg-gray-50' },
  ];

  const performanceCards = [
    { label: 'Open Rate', value: `${data.openRate}%`, good: parseFloat(data.openRate) >= 20 },
    { label: 'Click Rate', value: `${data.clickRate}%`, good: parseFloat(data.clickRate) >= 5 },
    { label: 'Click-to-Open', value: data.totalOpened > 0 ? `${((data.totalClicked / data.totalOpened) * 100).toFixed(1)}%` : '0%', good: true },
    { label: 'Reply Rate', value: `${data.replyRate}%`, good: parseFloat(data.replyRate) >= 2 },
    { label: 'Delivery Rate', value: `${data.deliveryRate}%`, good: parseFloat(data.deliveryRate) >= 95 },
    { label: 'Unsubscribe Rate', value: `${data.unsubscribeRate}%`, good: parseFloat(data.unsubscribeRate) < 2 },
  ];

  // Calculate max values for the chart
  const maxValue = Math.max(...data.timeline.map(d => Math.max(d.opens, d.clicks, d.replies)), 1);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Analytics</h2>
          <p className="text-sm text-gray-500">
            {data.campaignCount} campaigns • {data.contactCount} contacts • Last {period} days
          </p>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {statCards.map((card) => (
          <Card key={card.label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500">{card.label}</span>
                <div className={`p-1.5 rounded ${card.bgColor}`}>
                  <card.icon className={`h-3.5 w-3.5 ${card.color}`} />
                </div>
              </div>
              <div className="text-xl font-bold text-gray-900">{card.value.toLocaleString()}</div>
              {card.rate && <div className="text-xs text-gray-500 mt-0.5">{card.rate} rate</div>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart */}
      <Card>
        <CardContent className="p-6">
          <h3 className="font-medium text-gray-900 mb-4">Activity Timeline</h3>
          <div className="flex items-end space-x-1 h-40">
            {data.timeline.slice(-30).map((day, i) => (
              <div key={i} className="flex-1 flex flex-col items-center space-y-0.5" title={`${day.date}: ${day.opens} opens, ${day.clicks} clicks`}>
                <div className="w-full flex flex-col items-center space-y-0.5">
                  <div 
                    className="w-full bg-blue-200 rounded-t" 
                    style={{ height: `${Math.max(2, (day.opens / maxValue) * 120)}px` }}
                  />
                  <div 
                    className="w-full bg-purple-300 rounded-t" 
                    style={{ height: `${Math.max(1, (day.clicks / maxValue) * 120)}px` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center space-x-6 mt-4 text-xs">
            <div className="flex items-center"><div className="w-3 h-3 bg-blue-200 rounded mr-1" /> Opens</div>
            <div className="flex items-center"><div className="w-3 h-3 bg-purple-300 rounded mr-1" /> Clicks</div>
          </div>
        </CardContent>
      </Card>

      {/* Performance Grid */}
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Performance Metrics</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {performanceCards.map((card) => (
            <Card key={card.label}>
              <CardContent className="p-4 text-center">
                <div className="text-sm text-gray-600 mb-1">{card.label}</div>
                <div className="text-2xl font-bold text-gray-900">{card.value}</div>
                <div className="mt-1">
                  {card.good ? (
                    <Badge className="bg-green-50 text-green-700 border-green-200 text-xs">
                      <ArrowUp className="h-3 w-3 mr-0.5" /> Good
                    </Badge>
                  ) : (
                    <Badge className="bg-yellow-50 text-yellow-700 border-yellow-200 text-xs">
                      <ArrowDown className="h-3 w-3 mr-0.5" /> Needs improvement
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
