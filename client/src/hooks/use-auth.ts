import { useQuery } from "@tanstack/react-query";

export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  provider: 'google' | 'microsoft';
  accessToken: string;
  refreshToken?: string;
  role?: string;
  organizationId?: string;
}

export function useAuth() {
  const { data: user, isLoading, error, refetch } = useQuery<User>({
    queryKey: ['/api/auth/user'],
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
    gcTime: 0,
  });

  const login = async () => {
    try {
      const response = await fetch('/api/auth/simple-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      
      if (response.ok) {
        // Force refetch after successful login
        refetch();
        return true;
      }
      return false;
    } catch (err) {
      console.error('Login failed:', err);
      return false;
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      refetch();
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  return {
    user,
    isLoading,
    isAuthenticated: !!user && !error,
    error,
    login,
    logout
  };
}