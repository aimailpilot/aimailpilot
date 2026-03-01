import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { 
  BarChart3, TrendingUp, Mail, MousePointerClick, Reply, 
  AlertTriangle, UserMinus, Send, Loader2, ArrowUp, ArrowDown,
  Eye, Activity, Zap
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
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-400">Loading analytics...</span>
        </div>
      </div>
    );
  }

  const mainStats = [
    { label: 'Emails Sent', value: data.totalSent, icon: Send, gradient: 'from-blue-500 to-blue-600', bg: 'bg-blue-50', text: 'text-blue-600' },
    { label: 'Opens', value: data.totalOpened, rate: `${data.openRate}%`, icon: Eye, gradient: 'from-emerald-500 to-emerald-600', bg: 'bg-emerald-50', text: 'text-emerald-600' },
    { label: 'Clicks', value: data.totalClicked, rate: `${data.clickRate}%`, icon: MousePointerClick, gradient: 'from-purple-500 to-purple-600', bg: 'bg-purple-50', text: 'text-purple-600' },
    { label: 'Replies', value: data.totalReplied, rate: `${data.replyRate}%`, icon: Reply, gradient: 'from-amber-500 to-amber-600', bg: 'bg-amber-50', text: 'text-amber-600' },
  ];

  const secondaryStats = [
    { label: 'Bounced', value: data.totalBounced, rate: `${data.bounceRate}%`, icon: AlertTriangle, good: parseFloat(data.bounceRate) < 5, bg: 'bg-red-50', text: 'text-red-600' },
    { label: 'Unsubscribed', value: data.totalUnsubscribed, rate: `${data.unsubscribeRate}%`, icon: UserMinus, good: parseFloat(data.unsubscribeRate) < 2, bg: 'bg-gray-50', text: 'text-gray-600' },
  ];

  const performanceCards = [
    { label: 'Open Rate', value: `${data.openRate}%`, good: parseFloat(data.openRate) >= 20, benchmark: '20%+' },
    { label: 'Click Rate', value: `${data.clickRate}%`, good: parseFloat(data.clickRate) >= 5, benchmark: '5%+' },
    { label: 'Click-to-Open', value: data.totalOpened > 0 ? `${((data.totalClicked / data.totalOpened) * 100).toFixed(1)}%` : '0%', good: true, benchmark: '10%+' },
    { label: 'Reply Rate', value: `${data.replyRate}%`, good: parseFloat(data.replyRate) >= 2, benchmark: '2%+' },
    { label: 'Delivery Rate', value: `${data.deliveryRate}%`, good: parseFloat(data.deliveryRate) >= 95, benchmark: '95%+' },
    { label: 'Unsubscribe', value: `${data.unsubscribeRate}%`, good: parseFloat(data.unsubscribeRate) < 2, benchmark: '<2%' },
  ];

  const maxValue = Math.max(...data.timeline.map(d => Math.max(d.opens, d.clicks, d.replies)), 1);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 text-sm text-gray-400">
            <span className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              {data.campaignCount} campaigns
            </span>
            <span className="text-gray-200">|</span>
            <span>{data.contactCount} contacts</span>
            <span className="text-gray-200">|</span>
            <span>Last {period} days</span>
          </div>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-36 h-9 text-sm bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Main Stats - Gradient Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {mainStats.map((card) => (
          <Card key={card.label} className="border-gray-200/60 shadow-sm overflow-hidden group hover:shadow-md transition-all">
            <CardContent className="p-5 relative">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{card.label}</span>
                <div className={`p-2 rounded-xl ${card.bg} group-hover:scale-110 transition-transform`}>
                  <card.icon className={`h-4 w-4 ${card.text}`} />
                </div>
              </div>
              <div className="text-3xl font-bold text-gray-900">{card.value.toLocaleString()}</div>
              {card.rate && (
                <div className={`text-sm font-medium ${card.text} mt-1`}>{card.rate} rate</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Secondary stats (bounced + unsubscribed) */}
      <div className="grid grid-cols-2 gap-4">
        {secondaryStats.map((card) => (
          <Card key={card.label} className="border-gray-200/60 shadow-sm">
            <CardContent className="p-4 flex items-center gap-4">
              <div className={`p-2.5 rounded-xl ${card.bg}`}>
                <card.icon className={`h-5 w-5 ${card.text}`} />
              </div>
              <div className="flex-1">
                <div className="text-xs text-gray-400 font-medium">{card.label}</div>
                <div className="text-xl font-bold text-gray-900">{card.value.toLocaleString()}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium text-gray-600">{card.rate}</div>
                <Badge variant="outline" className={`text-[10px] mt-1 ${card.good ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                  {card.good ? 'Normal' : 'High'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Activity Timeline Chart */}
      <Card className="border-gray-200/60 shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-600" />
              Activity Timeline
            </h3>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 bg-blue-400 rounded-sm" /> Opens</div>
              <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 bg-purple-400 rounded-sm" /> Clicks</div>
              <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 bg-amber-400 rounded-sm" /> Replies</div>
            </div>
          </div>
          
          <div className="flex items-end gap-[3px] h-44">
            {data.timeline.slice(-30).map((day, i) => {
              const opensH = Math.max(4, (day.opens / maxValue) * 140);
              const clicksH = Math.max(2, (day.clicks / maxValue) * 140);
              const repliesH = Math.max(1, (day.replies / maxValue) * 140);
              return (
                <div key={i} className="flex-1 group relative" title={`${day.date}\nOpens: ${day.opens}\nClicks: ${day.clicks}\nReplies: ${day.replies}`}>
                  <div className="flex flex-col items-center gap-[2px]">
                    <div className="w-full bg-blue-300 rounded-t-sm group-hover:bg-blue-500 transition-colors" style={{ height: `${opensH}px` }} />
                    <div className="w-full bg-purple-300 rounded-sm group-hover:bg-purple-500 transition-colors" style={{ height: `${clicksH}px` }} />
                    <div className="w-full bg-amber-300 rounded-b-sm group-hover:bg-amber-500 transition-colors" style={{ height: `${repliesH}px` }} />
                  </div>
                  {/* Show date label every 5 bars */}
                  {(i % 5 === 0) && (
                    <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] text-gray-300 whitespace-nowrap">
                      {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="h-5" /> {/* Spacer for date labels */}
        </CardContent>
      </Card>

      {/* Performance Metrics */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Zap className="h-4 w-4 text-blue-600" />
          Performance Benchmarks
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {performanceCards.map((card) => (
            <Card key={card.label} className="border-gray-200/60 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-5 text-center">
                <div className="text-xs text-gray-400 font-medium mb-2 uppercase tracking-wide">{card.label}</div>
                <div className="text-3xl font-bold text-gray-900 mb-2">{card.value}</div>
                <div className="flex items-center justify-center gap-2">
                  <Badge variant="outline" className={`text-[10px] ${card.good ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                    {card.good ? (
                      <><ArrowUp className="h-3 w-3 mr-0.5" /> Good</>
                    ) : (
                      <><ArrowDown className="h-3 w-3 mr-0.5" /> Improve</>
                    )}
                  </Badge>
                  <span className="text-[10px] text-gray-300">Goal: {card.benchmark}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
