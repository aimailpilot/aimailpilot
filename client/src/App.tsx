import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useState, useEffect } from "react";
import LandingPage from "@/pages/landing-page";
import MailMeteorDashboard from "@/pages/mailmeteor-dashboard";
import NewTemplate from "@/pages/new-template";
import Templates from "@/pages/templates";
import AccountSettings from "@/pages/account-settings";
import EmailImportSetup from "@/pages/email-import-setup";
import ContactsPage from "@/pages/contacts-page";
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

function Router() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check authentication on mount only
  useEffect(() => {
    let mounted = true;
    
    fetch('/api/auth/user', { credentials: 'include' })
      .then(res => res.ok ? res.json() : null)
      .then(userData => {
        if (mounted) {
          setUser(userData);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setUser(null);
          setIsLoading(false);
        }
      });

    return () => { mounted = false; };
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <LandingPage onLogin={() => window.location.reload()} />;
  }

  return (
    <Switch>
      <Route path="/" component={MailMeteorDashboard} />
      <Route path="/templates" component={Templates} />
      <Route path="/templates/new" component={NewTemplate} />
      <Route path="/contacts" component={ContactsPage} />
      <Route path="/account" component={AccountSettings} />
      <Route path="/setup" component={EmailImportSetup} />
      <Route component={NotFound} />
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