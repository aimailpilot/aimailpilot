import { useQuery, useMutation } from "@tanstack/react-query";

export interface SalesLead {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  status?: string;
  score?: number;
  emailRating?: number;
  emailRatingGrade?: string;
  tags?: string[];
  lastActivityDate?: string | null;
  createdAt?: string;
}

interface UseSalesLeadsOptions {
  status?: string;
  minScore?: number;
  limit?: number;
}

export function useSalesLeads(options: UseSalesLeadsOptions = {}) {
  const query = useQuery<SalesLead[]>({
    queryKey: ["/api/sales/leads", options],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options.status) params.set("status", options.status);
      if (typeof options.minScore === "number") params.set("minScore", String(options.minScore));
      if (options.limit) params.set("limit", String(options.limit));

      const res = await fetch(`/api/sales/leads?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Failed to fetch sales leads");
      }
      const data = await res.json();
      return data.leads || [];
    },
    staleTime: 30000,
  });

  const draftEmailMutation = useMutation({
    mutationFn: async (args: {
      contactId: string;
      productDescription: string;
      tone?: string;
      callToAction?: string;
    }) => {
      const res = await fetch(`/api/sales/leads/${args.contactId}/draft-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          productDescription: args.productDescription,
          tone: args.tone,
          callToAction: args.callToAction,
        }),
      });
      if (!res.ok) {
        throw new Error("Failed to draft email");
      }
      return res.json() as Promise<{ subject: string; body: string }>;
    },
  });

  return {
    leads: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    draftEmail: draftEmailMutation.mutateAsync,
    isDrafting: draftEmailMutation.isPending,
  };
}

