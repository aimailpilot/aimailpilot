import { useQuery } from "@tanstack/react-query";
import type { DashboardStats, AnalyticsData } from "@/types";

export function useAnalytics() {
  const performanceQuery = useQuery<AnalyticsData>({
    queryKey: ["/api/analytics/performance"],
    queryFn: async () => {
      const response = await fetch('/api/analytics/performance');
      if (!response.ok) throw new Error('Failed to fetch performance analytics');
      return response.json();
    },
    staleTime: 60000, // 1 minute
  });

  const statsQuery = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    queryFn: async () => {
      const response = await fetch('/api/dashboard/stats');
      if (!response.ok) throw new Error('Failed to fetch dashboard stats');
      return response.json();
    },
    staleTime: 30000, // 30 seconds
  });

  return {
    performance: performanceQuery.data,
    stats: statsQuery.data,
    isLoadingPerformance: performanceQuery.isLoading,
    isLoadingStats: statsQuery.isLoading,
    performanceError: performanceQuery.error,
    statsError: statsQuery.error,
    refetchPerformance: performanceQuery.refetch,
    refetchStats: statsQuery.refetch,
  };
}

export function useCampaignAnalytics(campaignId?: string) {
  return useQuery({
    queryKey: ["/api/campaigns", campaignId, "analytics"],
    queryFn: async () => {
      const response = await fetch(`/api/campaigns/${campaignId}/analytics`);
      if (!response.ok) throw new Error('Failed to fetch campaign analytics');
      return response.json();
    },
    enabled: !!campaignId,
    staleTime: 30000,
  });
}

export function useEmailProviderStats() {
  return useQuery({
    queryKey: ["/api/email-accounts/stats"],
    queryFn: async () => {
      const response = await fetch('/api/email-accounts/stats');
      if (!response.ok) throw new Error('Failed to fetch email provider stats');
      return response.json();
    },
    staleTime: 60000,
  });
}

export function useLLMProviderStats() {
  return useQuery({
    queryKey: ["/api/llm-configs/stats"],
    queryFn: async () => {
      const response = await fetch('/api/llm-configs/stats');
      if (!response.ok) throw new Error('Failed to fetch LLM provider stats');
      return response.json();
    },
    staleTime: 300000, // 5 minutes
  });
}
