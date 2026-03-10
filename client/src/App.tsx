import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";
import LandingPage from "@/pages/landing-page";
import SetupPage from "@/pages/setup-page";
import MailMeteorDashboard from "@/pages/mailmeteor-dashboard";
import NotFound from "@/pages/not-found";

interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  provider: 'google' | 'microsoft';
  accessToken: string;
  refreshToken?: string;
}

interface SetupStatus {
  needsSetup: boolean;
  hasUsers: boolean;
  hasSuperAdmin: boolean;
  googleConfigured: boolean;
  microsoftConfigured: boolean;
}

function Router() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);

  useEffect(() => {
    let mounted = true;
    
    // Check setup status and auth in parallel
    Promise.all([
      fetch('/api/setup/status').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/auth/user', { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([setup, userData]) => {
      if (mounted) {
        setSetupStatus(setup);
        setUser(userData);
        setIsLoading(false);
      }
    });

    return () => { mounted = false; };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3"></div>
          <div className="text-gray-600">Loading AImailPilot...</div>
        </div>
      </div>
    );
  }

  // Show setup page if OAuth is not configured
  if (setupStatus?.needsSetup) {
    return <SetupPage onComplete={() => window.location.reload()} />;
  }

  // Check URL for OAuth errors
  const urlParams = new URLSearchParams(window.location.search);
  const oauthError = urlParams.get('error');

  if (!user) {
    return <LandingPage onLogin={() => window.location.reload()} oauthError={oauthError} />;
  }

  // All views are handled by the dashboard component with internal routing
  return (
    <Switch>
      <Route path="/" component={MailMeteorDashboard} />
      <Route path="/:rest*" component={MailMeteorDashboard} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
