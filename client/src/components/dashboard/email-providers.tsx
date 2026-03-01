import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { EmailAccount } from "@/types";

export function EmailProviders() {
  const { data: emailAccounts, isLoading } = useQuery<EmailAccount[]>({
    queryKey: ["/api/email-accounts"],
  });

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'gmail': return 'fab fa-google';
      case 'outlook': return 'fab fa-microsoft';
      case 'sendgrid': return 'fas fa-paper-plane';
      case 'elasticemail': return 'fas fa-envelope';
      default: return 'fas fa-envelope';
    }
  };

  const getProviderColor = (provider: string) => {
    switch (provider) {
      case 'gmail': return 'bg-red-600';
      case 'outlook': return 'bg-blue-600';
      case 'sendgrid': return 'bg-green-600';
      case 'elasticemail': return 'bg-purple-600';
      default: return 'bg-slate-600';
    }
  };

  const getProviderName = (provider: string) => {
    switch (provider) {
      case 'gmail': return 'Google Workspace';
      case 'outlook': return 'Microsoft Outlook';
      case 'sendgrid': return 'SendGrid';
      case 'elasticemail': return 'Elastic Email';
      default: return provider;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Email Sending Providers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Mock data if no email accounts exist
  const mockAccounts = [
    {
      id: '1',
      provider: 'gmail' as const,
      email: 'sarah@company.com',
      displayName: 'Premium Plan',
      dailyLimit: 3000,
      dailySent: 2450,
      isActive: true,
    },
    {
      id: '2',
      provider: 'outlook' as const,
      email: 'backup@company.com',
      displayName: 'Business Plan',
      dailyLimit: 1500,
      dailySent: 450,
      isActive: true,
    },
    {
      id: '3',
      provider: 'sendgrid' as const,
      email: 'High-volume transactional',
      displayName: '',
      dailyLimit: 50000,
      dailySent: 12340,
      isActive: true,
    },
  ];

  const displayAccounts = emailAccounts && emailAccounts.length > 0 ? emailAccounts : mockAccounts;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Email Sending Providers</CardTitle>
          <Button variant="outline" size="sm">
            Add Provider
          </Button>
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="space-y-4">
          {displayAccounts.map((account) => {
            const usagePercentage = (account.dailySent / account.dailyLimit) * 100;
            
            return (
              <div key={account.id} className="flex items-center justify-between p-4 border border-slate-200 rounded-lg">
                <div className="flex items-center space-x-4">
                  <div className={`w-10 h-10 ${getProviderColor(account.provider)} rounded-lg flex items-center justify-center`}>
                    <i className={`${getProviderIcon(account.provider)} text-white`}></i>
                  </div>
                  <div>
                    <h4 className="font-medium text-slate-900">{getProviderName(account.provider)}</h4>
                    <p className="text-sm text-slate-600">
                      {account.email} {account.displayName && `• ${account.displayName}`}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-slate-900">
                    {account.dailySent.toLocaleString()} / {account.dailyLimit.toLocaleString()} daily
                  </p>
                  <div className="flex items-center mt-1">
                    <div className="w-20 bg-slate-200 rounded-full h-2 mr-2">
                      <div 
                        className={`h-2 rounded-full ${usagePercentage > 80 ? 'bg-red-500' : usagePercentage > 60 ? 'bg-yellow-500' : 'bg-green-500'}`}
                        style={{ width: `${Math.min(usagePercentage, 100)}%` }}
                      ></div>
                    </div>
                    <span className="text-xs text-slate-500">{Math.round(usagePercentage)}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        
        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <div className="flex items-start space-x-3">
            <i className="fas fa-info-circle text-primary mt-0.5"></i>
            <div>
              <h4 className="text-sm font-medium text-slate-900">Intelligent Load Balancing</h4>
              <p className="text-sm text-slate-600 mt-1">
                Our AI automatically distributes emails across providers to optimize deliverability and stay within rate limits.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
