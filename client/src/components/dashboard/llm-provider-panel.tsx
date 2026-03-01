import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { LlmConfiguration } from "@/types";

export function LLMProviderPanel() {
  const { data: configs, isLoading } = useQuery<LlmConfiguration[]>({
    queryKey: ["/api/llm-configs"],
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
        <div className="p-6">
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  const primaryConfig = configs?.find(c => c.isPrimary);
  const fallbackConfig = configs?.find(c => !c.isPrimary && c.isActive);

  const getProviderStatus = (provider: string) => {
    const config = configs?.find(c => c.provider === provider);
    if (!config || !config.isActive) return { status: 'offline', color: 'text-red-600' };
    
    // Mock status logic
    if (provider === 'anthropic') return { status: 'Rate Limited', color: 'text-yellow-600' };
    return { status: 'Online', color: 'text-green-600' };
  };

  const totalMonthlyCost = configs?.reduce((sum, config) => sum + Number(config.monthlyCost), 0) || 0;
  const monthlyLimit = configs?.find(c => c.isPrimary)?.monthlyLimit || 1000;
  const usagePercentage = (totalMonthlyCost / Number(monthlyLimit)) * 100;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      <div className="p-6 border-b border-slate-200">
        <h3 className="text-lg font-semibold text-slate-900">AI Provider Settings</h3>
      </div>
      
      <div className="p-6 space-y-4">
        <div>
          <label className="text-sm font-medium text-slate-700">Primary LLM Provider</label>
          <Select defaultValue={primaryConfig?.provider || "openai"}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Select primary provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="openai">OpenAI GPT-4</SelectItem>
              <SelectItem value="gemini">Google Gemini Pro</SelectItem>
              <SelectItem value="anthropic">Anthropic Claude 3</SelectItem>
              <SelectItem value="llama">Meta LLaMA 2</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div>
          <label className="text-sm font-medium text-slate-700">Fallback Provider</label>
          <Select defaultValue={fallbackConfig?.provider || "gemini"}>
            <SelectTrigger className="mt-1">
              <SelectValue placeholder="Select fallback provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gemini">Google Gemini Pro</SelectItem>
              <SelectItem value="openai">OpenAI GPT-4</SelectItem>
              <SelectItem value="anthropic">Anthropic Claude 3</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <div className="pt-4 border-t border-slate-200">
          <h4 className="text-sm font-medium text-slate-900 mb-3">Provider Status</h4>
          <div className="space-y-2">
            {['openai', 'gemini', 'anthropic'].map((provider) => {
              const { status, color } = getProviderStatus(provider);
              return (
                <div key={provider} className="flex items-center justify-between">
                  <span className="text-sm text-slate-600 capitalize">{provider}</span>
                  <span className={`flex items-center text-sm ${color}`}>
                    <i className="fas fa-circle text-xs mr-2"></i>
                    {status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        
        <div className="pt-4 border-t border-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">Monthly Cost</span>
            <span className="text-sm font-medium text-slate-900">${totalMonthlyCost.toFixed(2)}</span>
          </div>
          <div className="mt-2 w-full bg-slate-200 rounded-full h-2">
            <div 
              className="bg-primary h-2 rounded-full" 
              style={{ width: `${Math.min(usagePercentage, 100)}%` }}
            ></div>
          </div>
          <p className="text-xs text-slate-500 mt-1">${monthlyLimit} monthly limit</p>
        </div>
      </div>
    </div>
  );
}
