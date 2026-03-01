import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Contact } from "@/types";

interface UseContactsOptions {
  limit?: number;
  offset?: number;
  search?: string;
}

export function useContacts(options: UseContactsOptions = {}) {
  const queryClient = useQueryClient();

  const contactsQuery = useQuery<Contact[]>({
    queryKey: ["/api/contacts", options.limit, options.offset, options.search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options.limit) params.set('limit', options.limit.toString());
      if (options.offset) params.set('offset', options.offset.toString());
      if (options.search) params.set('search', options.search);
      
      const response = await fetch(`/api/contacts?${params}`);
      if (!response.ok) throw new Error('Failed to fetch contacts');
      return response.json();
    },
    staleTime: 30000,
  });

  const createContactMutation = useMutation({
    mutationFn: async (contactData: any) => {
      const response = await apiRequest("POST", "/api/contacts", contactData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
    },
  });

  const updateContactMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const response = await apiRequest("PUT", `/api/contacts/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
    },
  });

  const deleteContactMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/contacts/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
    },
  });

  const importContactsMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/contacts/import', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) throw new Error('Failed to import contacts');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
    },
  });

  return {
    contacts: contactsQuery.data,
    isLoading: contactsQuery.isLoading,
    error: contactsQuery.error,
    createContact: createContactMutation.mutateAsync,
    updateContact: updateContactMutation.mutateAsync,
    deleteContact: deleteContactMutation.mutateAsync,
    importContacts: importContactsMutation.mutateAsync,
    isCreating: createContactMutation.isPending,
    isUpdating: updateContactMutation.isPending,
    isDeleting: deleteContactMutation.isPending,
    isImporting: importContactsMutation.isPending,
  };
}

export function useContact(id: string) {
  return useQuery<Contact>({
    queryKey: ["/api/contacts", id],
    queryFn: async () => {
      const response = await fetch(`/api/contacts/${id}`);
      if (!response.ok) throw new Error('Failed to fetch contact');
      return response.json();
    },
    enabled: !!id,
  });
}

export function useContactSegments() {
  const queryClient = useQueryClient();

  const segmentsQuery = useQuery({
    queryKey: ["/api/segments"],
    queryFn: async () => {
      const response = await fetch('/api/segments');
      if (!response.ok) throw new Error('Failed to fetch segments');
      return response.json();
    },
  });

  const createSegmentMutation = useMutation({
    mutationFn: async (segmentData: any) => {
      const response = await apiRequest("POST", "/api/segments", segmentData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/segments"] });
    },
  });

  return {
    segments: segmentsQuery.data,
    isLoading: segmentsQuery.isLoading,
    createSegment: createSegmentMutation.mutateAsync,
    isCreating: createSegmentMutation.isPending,
  };
}
