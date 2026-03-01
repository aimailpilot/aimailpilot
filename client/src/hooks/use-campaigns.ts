import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Campaign } from "@/types";

interface UseCampaignsOptions {
  limit?: number;
  offset?: number;
}

export function useCampaigns(options: UseCampaignsOptions = {}) {
  const queryClient = useQueryClient();

  const campaignsQuery = useQuery<Campaign[]>({
    queryKey: ["/api/campaigns", options.limit, options.offset],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options.limit) params.set('limit', options.limit.toString());
      if (options.offset) params.set('offset', options.offset.toString());
      
      const response = await fetch(`/api/campaigns?${params}`);
      if (!response.ok) throw new Error('Failed to fetch campaigns');
      return response.json();
    },
    staleTime: 30000,
  });

  const createCampaignMutation = useMutation({
    mutationFn: async (campaignData: any) => {
      const response = await apiRequest("POST", "/api/campaigns", campaignData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  const updateCampaignMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const response = await apiRequest("PUT", `/api/campaigns/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  const deleteCampaignMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/campaigns/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  return {
    campaigns: campaignsQuery.data,
    isLoading: campaignsQuery.isLoading,
    error: campaignsQuery.error,
    createCampaign: createCampaignMutation.mutateAsync,
    updateCampaign: updateCampaignMutation.mutateAsync,
    deleteCampaign: deleteCampaignMutation.mutateAsync,
    isCreating: createCampaignMutation.isPending,
    isUpdating: updateCampaignMutation.isPending,
    isDeleting: deleteCampaignMutation.isPending,
  };
}

export function useCampaign(id: string) {
  return useQuery<Campaign>({
    queryKey: ["/api/campaigns", id],
    queryFn: async () => {
      const response = await fetch(`/api/campaigns/${id}`);
      if (!response.ok) throw new Error('Failed to fetch campaign');
      return response.json();
    },
    enabled: !!id,
  });
}
