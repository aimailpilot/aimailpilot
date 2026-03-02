import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { 
  Brain, Key, Zap, CheckCircle2, XCircle, Loader2, 
  Eye, EyeOff, Send, Sparkles, Server, Shield, ExternalLink,
  AlertTriangle, Info, RefreshCw, Copy, Mail
} from "lucide-react";

interface AzureOpenAIConfig {
  azure_openai_endpoint: string;
  azure_openai_api_key: string;
  azure_openai_deployment: string;
  azure_openai_api_version: string;
}

interface ElasticEmailConfig {
  elastic_email_api_key: string;
  elastic_email_default_from: string;
  elastic_email_default_from_name: string;
}

export default function AdvancedSettings() {
  // Azure OpenAI state
  const [azureConfig, setAzureConfig] = useState<AzureOpenAIConfig>({
    azure_openai_endpoint: '',
    azure_openai_api_key: '',
    azure_openai_deployment: '',
    azure_openai_api_version: '2024-08-01-preview',
  });
  const [showAzureKey, setShowAzureKey] = useState(false);
  const [azureTestResult, setAzureTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [azureTesting, setAzureTesting] = useState(false);
  const [azureSaving, setAzureSaving] = useState(false);

  // Elastic Email state
  const [elasticConfig, setElasticConfig] = useState<ElasticEmailConfig>({
    elastic_email_api_key: '',
    elastic_email_default_from: '',
    elastic_email_default_from_name: '',
  });
  const [showElasticKey, setShowElasticKey] = useState(false);
  const [elasticTestResult, setElasticTestResult] = useState<{ success: boolean; message: string; email?: string } | null>(null);
  const [elasticTesting, setElasticTesting] = useState(false);
  const [elasticSaving, setElasticSaving] = useState(false);

  // Loading state
  const [loading, setLoading] = useState(true);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // AI generation test state
  const [aiTestPrompt, setAiTestPrompt] = useState('Write a short follow-up email for a SaaS product demo');
  const [aiTestResult, setAiTestResult] = useState<{ content: string; model: string; provider: string } | null>(null);
  const [aiTesting, setAiTesting] = useState(false);

  // Load settings
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await fetch('/api/settings', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setAzureConfig({
          azure_openai_endpoint: data.azure_openai_endpoint || '',
          azure_openai_api_key: data.azure_openai_api_key || '',
          azure_openai_deployment: data.azure_openai_deployment || '',
          azure_openai_api_version: data.azure_openai_api_version || '2024-08-01-preview',
        });
        setElasticConfig({
          elastic_email_api_key: data.elastic_email_api_key || '',
          elastic_email_default_from: data.elastic_email_default_from || '',
          elastic_email_default_from_name: data.elastic_email_default_from_name || '',
        });
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    } finally {
      setLoading(false);
    }
  };

  const saveAzureSettings = async () => {
    setAzureSaving(true);
    setSaveSuccess(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(azureConfig),
      });
      if (res.ok) {
        setSaveSuccess('azure');
        setTimeout(() => setSaveSuccess(null), 3000);
      }
    } catch (e) {
      console.error('Failed to save Azure settings:', e);
    } finally {
      setAzureSaving(false);
    }
  };

  const saveElasticSettings = async () => {
    setElasticSaving(true);
    setSaveSuccess(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(elasticConfig),
      });
      if (res.ok) {
        setSaveSuccess('elastic');
        setTimeout(() => setSaveSuccess(null), 3000);
      }
    } catch (e) {
      console.error('Failed to save Elastic Email settings:', e);
    } finally {
      setElasticSaving(false);
    }
  };

  const testAzureConnection = async () => {
    setAzureTesting(true);
    setAzureTestResult(null);
    try {
      // Save settings first, then test
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(azureConfig),
      });

      const res = await fetch('/api/settings/test-azure-openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json();
      setAzureTestResult({ success: data.success, message: data.message || data.error || 'Unknown result' });
    } catch (e) {
      setAzureTestResult({ success: false, message: 'Failed to connect to server' });
    } finally {
      setAzureTesting(false);
    }
  };

  const testElasticConnection = async () => {
    setElasticTesting(true);
    setElasticTestResult(null);
    try {
      // Save settings first, then test
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(elasticConfig),
      });

      const res = await fetch('/api/settings/test-elastic-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json();
      setElasticTestResult({ 
        success: data.success, 
        message: data.message || data.error || 'Unknown result',
        email: data.email,
      });
    } catch (e) {
      setElasticTestResult({ success: false, message: 'Failed to connect to server' });
    } finally {
      setElasticTesting(false);
    }
  };

  const testAiGeneration = async () => {
    setAiTesting(true);
    setAiTestResult(null);
    try {
      const res = await fetch('/api/llm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ prompt: aiTestPrompt, type: 'template' }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiTestResult({ content: data.content, model: data.model, provider: data.provider });
      }
    } catch (e) {
      setAiTestResult({ content: 'Failed to generate', model: 'error', provider: 'none' });
    } finally {
      setAiTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Zap className="h-6 w-6 text-blue-600" /> Advanced Settings
        </h2>
        <p className="text-gray-500 mt-1">Configure API integrations for AI-powered features and email delivery</p>
      </div>

      {/* ==================== AZURE OPENAI SECTION ==================== */}
      <Card className="border-gray-200 shadow-sm overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
                <Brain className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">Azure OpenAI Integration</CardTitle>
                <CardDescription>Power templates, campaigns, and personalization with AI</CardDescription>
              </div>
            </div>
            {azureConfig.azure_openai_api_key && !azureConfig.azure_openai_api_key.startsWith('••••') ? (
              <Badge className="bg-green-50 text-green-700 border-green-200">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Configured
              </Badge>
            ) : azureConfig.azure_openai_api_key ? (
              <Badge className="bg-green-50 text-green-700 border-green-200">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Configured
              </Badge>
            ) : (
              <Badge variant="outline" className="text-gray-500">
                Not configured
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-5">
          {/* Info banner */}
          <div className="flex gap-3 p-3 bg-blue-50 rounded-lg text-sm">
            <Info className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-blue-800">
              Azure OpenAI powers AI email generation in <strong>templates</strong>, <strong>campaign content</strong>, and <strong>personalization</strong>. 
              Get your API credentials from the{' '}
              <a href="https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub" target="_blank" rel="noopener noreferrer" className="underline font-medium inline-flex items-center gap-0.5">
                Azure Portal <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Endpoint */}
            <div className="md:col-span-2">
              <Label htmlFor="azure-endpoint" className="text-sm font-medium text-gray-700">
                Endpoint URL <span className="text-red-500">*</span>
              </Label>
              <Input
                id="azure-endpoint"
                placeholder="https://your-resource.openai.azure.com"
                value={azureConfig.azure_openai_endpoint}
                onChange={e => setAzureConfig(prev => ({ ...prev, azure_openai_endpoint: e.target.value }))}
                className="mt-1.5"
              />
              <p className="text-xs text-gray-400 mt-1">Your Azure OpenAI resource endpoint URL</p>
            </div>

            {/* API Key */}
            <div className="md:col-span-2">
              <Label htmlFor="azure-key" className="text-sm font-medium text-gray-700">
                API Key <span className="text-red-500">*</span>
              </Label>
              <div className="relative mt-1.5">
                <Input
                  id="azure-key"
                  type={showAzureKey ? 'text' : 'password'}
                  placeholder="Enter your Azure OpenAI API key"
                  value={azureConfig.azure_openai_api_key}
                  onChange={e => setAzureConfig(prev => ({ ...prev, azure_openai_api_key: e.target.value }))}
                  className="pr-10"
                />
                <button
                  onClick={() => setShowAzureKey(!showAzureKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showAzureKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Deployment Name */}
            <div>
              <Label htmlFor="azure-deployment" className="text-sm font-medium text-gray-700">
                Deployment Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="azure-deployment"
                placeholder="gpt-4o"
                value={azureConfig.azure_openai_deployment}
                onChange={e => setAzureConfig(prev => ({ ...prev, azure_openai_deployment: e.target.value }))}
                className="mt-1.5"
              />
              <p className="text-xs text-gray-400 mt-1">Your model deployment name</p>
            </div>

            {/* API Version */}
            <div>
              <Label htmlFor="azure-version" className="text-sm font-medium text-gray-700">
                API Version
              </Label>
              <Input
                id="azure-version"
                placeholder="2024-08-01-preview"
                value={azureConfig.azure_openai_api_version}
                onChange={e => setAzureConfig(prev => ({ ...prev, azure_openai_api_version: e.target.value }))}
                className="mt-1.5"
              />
              <p className="text-xs text-gray-400 mt-1">Default: 2024-08-01-preview</p>
            </div>
          </div>

          {/* Test result */}
          {azureTestResult && (
            <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
              azureTestResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            }`}>
              {azureTestResult.success ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />}
              <span>{azureTestResult.message}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={saveAzureSettings} disabled={azureSaving} className="bg-blue-600 hover:bg-blue-700">
              {azureSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />}
              Save Settings
            </Button>
            <Button variant="outline" onClick={testAzureConnection} disabled={azureTesting}>
              {azureTesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
              Test Connection
            </Button>
            {saveSuccess === 'azure' && (
              <span className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" /> Saved!
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ==================== AI GENERATION TEST ==================== */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center shadow-sm">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg">Test AI Generation</CardTitle>
              <CardDescription>Try generating email content with your configured Azure OpenAI</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm font-medium text-gray-700">Prompt</Label>
            <Input
              value={aiTestPrompt}
              onChange={e => setAiTestPrompt(e.target.value)}
              placeholder="Describe the email you want to generate..."
              className="mt-1.5"
            />
          </div>
          <Button onClick={testAiGeneration} disabled={aiTesting} variant="outline" className="gap-2">
            {aiTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate
          </Button>
          {aiTestResult && (
            <div className="mt-3 p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-2 mb-2 text-xs text-gray-500">
                <Badge variant="outline" className="text-xs">
                  {aiTestResult.provider === 'azure-openai' ? 'Azure OpenAI' : 'Demo Mode'}
                </Badge>
                <span>Model: {aiTestResult.model}</span>
              </div>
              <div className="whitespace-pre-wrap text-sm text-gray-800 max-h-60 overflow-y-auto">
                {aiTestResult.content}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ==================== ELASTIC EMAIL SECTION ==================== */}
      <Card className="border-gray-200 shadow-sm overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-orange-50 to-amber-50 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center shadow-sm">
                <Mail className="h-5 w-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">Elastic Email API</CardTitle>
                <CardDescription>Use Elastic Email as your email delivery provider</CardDescription>
              </div>
            </div>
            {elasticConfig.elastic_email_api_key && !elasticConfig.elastic_email_api_key.startsWith('••••') ? (
              <Badge className="bg-green-50 text-green-700 border-green-200">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Configured
              </Badge>
            ) : elasticConfig.elastic_email_api_key ? (
              <Badge className="bg-green-50 text-green-700 border-green-200">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Configured
              </Badge>
            ) : (
              <Badge variant="outline" className="text-gray-500">
                Not configured
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-5">
          {/* Info banner */}
          <div className="flex gap-3 p-3 bg-orange-50 rounded-lg text-sm">
            <Info className="h-4 w-4 text-orange-600 flex-shrink-0 mt-0.5" />
            <div className="text-orange-800">
              Elastic Email provides reliable email delivery via SMTP or REST API. Configure your API key to use it as an email sending provider.
              Get your API key from{' '}
              <a href="https://elasticemail.com/account#/settings/new/manage-api" target="_blank" rel="noopener noreferrer" className="underline font-medium inline-flex items-center gap-0.5">
                Elastic Email Settings <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          <div className="space-y-4">
            {/* API Key */}
            <div>
              <Label htmlFor="elastic-key" className="text-sm font-medium text-gray-700">
                API Key <span className="text-red-500">*</span>
              </Label>
              <div className="relative mt-1.5">
                <Input
                  id="elastic-key"
                  type={showElasticKey ? 'text' : 'password'}
                  placeholder="Enter your Elastic Email API key"
                  value={elasticConfig.elastic_email_api_key}
                  onChange={e => setElasticConfig(prev => ({ ...prev, elastic_email_api_key: e.target.value }))}
                  className="pr-10"
                />
                <button
                  onClick={() => setShowElasticKey(!showElasticKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showElasticKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Default From Email */}
              <div>
                <Label htmlFor="elastic-from" className="text-sm font-medium text-gray-700">
                  Default From Email
                </Label>
                <Input
                  id="elastic-from"
                  type="email"
                  placeholder="noreply@yourdomain.com"
                  value={elasticConfig.elastic_email_default_from}
                  onChange={e => setElasticConfig(prev => ({ ...prev, elastic_email_default_from: e.target.value }))}
                  className="mt-1.5"
                />
                <p className="text-xs text-gray-400 mt-1">Must be a verified sender in Elastic Email</p>
              </div>

              {/* Default From Name */}
              <div>
                <Label htmlFor="elastic-from-name" className="text-sm font-medium text-gray-700">
                  Default From Name
                </Label>
                <Input
                  id="elastic-from-name"
                  placeholder="Your Company"
                  value={elasticConfig.elastic_email_default_from_name}
                  onChange={e => setElasticConfig(prev => ({ ...prev, elastic_email_default_from_name: e.target.value }))}
                  className="mt-1.5"
                />
              </div>
            </div>
          </div>

          {/* SMTP Info */}
          <div className="p-3 bg-gray-50 rounded-lg text-sm">
            <h4 className="font-medium text-gray-700 mb-2 flex items-center gap-1.5">
              <Server className="h-4 w-4" /> SMTP Connection Details
            </h4>
            <div className="grid grid-cols-2 gap-2 text-gray-600">
              <div>
                <span className="text-gray-400">Host:</span>{' '}
                <code className="text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded text-xs">smtp.elasticemail.com</code>
              </div>
              <div>
                <span className="text-gray-400">Port:</span>{' '}
                <code className="text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded text-xs">2525</code> or{' '}
                <code className="text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded text-xs">465 (SSL)</code>
              </div>
              <div>
                <span className="text-gray-400">Username:</span>{' '}
                <span className="text-gray-700">Your Elastic Email address</span>
              </div>
              <div>
                <span className="text-gray-400">Password:</span>{' '}
                <span className="text-gray-700">Your API key</span>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Use these when adding an email account in <strong>Email Accounts</strong> section. Select "Elastic Email" as provider.
            </p>
          </div>

          {/* Test result */}
          {elasticTestResult && (
            <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
              elasticTestResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            }`}>
              {elasticTestResult.success ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />}
              <span>{elasticTestResult.message}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={saveElasticSettings} disabled={elasticSaving} className="bg-orange-600 hover:bg-orange-700">
              {elasticSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />}
              Save Settings
            </Button>
            <Button variant="outline" onClick={testElasticConnection} disabled={elasticTesting}>
              {elasticTesting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
              Test Connection
            </Button>
            {saveSuccess === 'elastic' && (
              <span className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" /> Saved!
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ==================== INTEGRATION STATUS ==================== */}
      <Card className="border-gray-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-gray-400" /> Integration Usage
          </CardTitle>
          <CardDescription>Where your integrations are used across MailFlow</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <h4 className="font-medium text-gray-800 flex items-center gap-2">
                <Brain className="h-4 w-4 text-blue-600" /> Azure OpenAI is used in:
              </h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-yellow-500" />
                  <span><strong>Template Creation</strong> - AI-generated email templates</span>
                </li>
                <li className="flex items-center gap-2">
                  <Send className="h-3.5 w-3.5 text-blue-500" />
                  <span><strong>Campaign Content</strong> - Auto-generate campaign emails</span>
                </li>
                <li className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-purple-500" />
                  <span><strong>Personalization</strong> - AI-powered email personalization</span>
                </li>
                <li className="flex items-center gap-2">
                  <Brain className="h-3.5 w-3.5 text-green-500" />
                  <span><strong>Subject Lines</strong> - Smart subject line suggestions</span>
                </li>
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="font-medium text-gray-800 flex items-center gap-2">
                <Mail className="h-4 w-4 text-orange-600" /> Elastic Email is used in:
              </h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-center gap-2">
                  <Send className="h-3.5 w-3.5 text-blue-500" />
                  <span><strong>Email Delivery</strong> - SMTP email sending via campaigns</span>
                </li>
                <li className="flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-green-500" />
                  <span><strong>Email Account</strong> - Add as SMTP provider in Email Accounts</span>
                </li>
                <li className="flex items-center gap-2">
                  <Server className="h-3.5 w-3.5 text-gray-500" />
                  <span><strong>High Volume</strong> - Supports high-volume sending</span>
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
