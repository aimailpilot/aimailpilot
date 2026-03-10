import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Mail, Shield, CheckCircle, AlertCircle, ArrowRight, 
  Eye, EyeOff, ExternalLink, Loader2, Settings
} from "lucide-react";
import { FaGoogle, FaMicrosoft } from "react-icons/fa";

interface SetupPageProps {
  onComplete: () => void;
}

export default function SetupPage({ onComplete }: SetupPageProps) {
  const [activeProvider, setActiveProvider] = useState("google");
  const [googleConfig, setGoogleConfig] = useState({ clientId: '', clientSecret: '' });
  const [microsoftConfig, setMicrosoftConfig] = useState({ clientId: '', clientSecret: '' });
  const [showGoogleSecret, setShowGoogleSecret] = useState(false);
  const [showMicrosoftSecret, setShowMicrosoftSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSave = async (provider: 'google' | 'microsoft') => {
    const config = provider === 'google' ? googleConfig : microsoftConfig;
    
    if (!config.clientId || !config.clientSecret) {
      setError('Both Client ID and Client Secret are required.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/setup/oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          clientId: config.clientId.trim(),
          clientSecret: config.clientSecret.trim(),
        }),
      });

      const data = await res.json();
      
      if (!res.ok) {
        setError(data.error || 'Failed to save credentials');
        return;
      }

      setSuccess(`${provider === 'google' ? 'Google' : 'Microsoft'} OAuth configured! You can now sign in.`);
      setTimeout(() => onComplete(), 2000);
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Header */}
      <div className="border-b border-gray-100 bg-white/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center gap-2.5">
          <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-2 rounded-xl shadow-lg shadow-blue-200">
            <Mail className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            AImailPilot
          </span>
          <Badge className="bg-amber-50 text-amber-700 border-amber-200 ml-2">
            <Settings className="h-3 w-3 mr-1" />
            Initial Setup
          </Badge>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Welcome */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 mb-4">
            <Shield className="h-8 w-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome to AImailPilot</h1>
          <p className="text-gray-500 text-lg max-w-lg mx-auto">
            Let's get your platform configured. Set up OAuth authentication so you and your team can sign in securely.
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-full px-4 py-2">
            <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">1</div>
            <span className="text-sm font-medium text-blue-700">Configure OAuth</span>
          </div>
          <ArrowRight className="h-4 w-4 text-gray-300" />
          <div className="flex items-center gap-2 text-gray-400 rounded-full px-4 py-2">
            <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 text-xs font-bold flex items-center justify-center">2</div>
            <span className="text-sm font-medium">Sign In</span>
          </div>
          <ArrowRight className="h-4 w-4 text-gray-300" />
          <div className="flex items-center gap-2 text-gray-400 rounded-full px-4 py-2">
            <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-500 text-xs font-bold flex items-center justify-center">3</div>
            <span className="text-sm font-medium">SuperAdmin</span>
          </div>
        </div>

        {/* Info card */}
        <Card className="mb-8 border-blue-100 bg-blue-50/30">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-semibold mb-1">How it works:</p>
                <ul className="space-y-1 text-blue-700">
                  <li>• Configure at least one OAuth provider (Google or Microsoft)</li>
                  <li>• The <strong>first person to sign in</strong> automatically becomes the <strong>SuperAdmin</strong></li>
                  <li>• SuperAdmin can configure additional settings, manage users, and set up API keys</li>
                  <li>• Additional OAuth providers can be configured later in Settings</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Error / Success messages */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2 text-red-700 text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2 text-green-700 text-sm">
            <CheckCircle className="h-4 w-4 flex-shrink-0" />
            {success}
          </div>
        )}

        {/* OAuth Provider Tabs */}
        <Tabs value={activeProvider} onValueChange={setActiveProvider}>
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="google" className="flex items-center gap-2">
              <FaGoogle className="h-4 w-4" />
              Google OAuth
            </TabsTrigger>
            <TabsTrigger value="microsoft" className="flex items-center gap-2">
              <FaMicrosoft className="h-4 w-4" />
              Microsoft OAuth
            </TabsTrigger>
          </TabsList>

          {/* Google OAuth Setup */}
          <TabsContent value="google">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FaGoogle className="h-5 w-5 text-[#4285F4]" />
                  Google OAuth 2.0 Setup
                </CardTitle>
                <CardDescription>
                  Configure Google OAuth to allow sign-in with Google accounts. This also enables Gmail integration for sending and tracking.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Instructions */}
                <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600 space-y-2">
                  <p className="font-semibold text-gray-800">Setup instructions:</p>
                  <ol className="list-decimal pl-4 space-y-1">
                    <li>Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">Google Cloud Console <ExternalLink className="h-3 w-3" /></a></li>
                    <li>Create a new OAuth 2.0 Client ID (Web application)</li>
                    <li>Add authorized redirect URI: <code className="bg-gray-200 px-1.5 py-0.5 rounded text-xs">{window.location.origin}/api/auth/google/callback</code></li>
                    <li>Copy the Client ID and Client Secret below</li>
                  </ol>
                </div>

                <div className="space-y-3">
                  <div>
                    <Label htmlFor="google-client-id">Client ID</Label>
                    <Input
                      id="google-client-id"
                      placeholder="xxxx.apps.googleusercontent.com"
                      value={googleConfig.clientId}
                      onChange={(e) => setGoogleConfig(prev => ({ ...prev, clientId: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="google-client-secret">Client Secret</Label>
                    <div className="relative">
                      <Input
                        id="google-client-secret"
                        type={showGoogleSecret ? "text" : "password"}
                        placeholder="GOCSPX-xxxx"
                        value={googleConfig.clientSecret}
                        onChange={(e) => setGoogleConfig(prev => ({ ...prev, clientSecret: e.target.value }))}
                      />
                      <button 
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() => setShowGoogleSecret(!showGoogleSecret)}
                      >
                        {showGoogleSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                  <strong>Required redirect URI:</strong>
                  <code className="block mt-1 bg-amber-100 px-2 py-1 rounded text-xs break-all">
                    {window.location.origin}/api/auth/google/callback
                  </code>
                </div>

                <Button
                  onClick={() => handleSave('google')}
                  disabled={saving || !googleConfig.clientId || !googleConfig.clientSecret}
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
                >
                  {saving ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
                  ) : (
                    <><CheckCircle className="h-4 w-4 mr-2" /> Save Google OAuth Configuration</>
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Microsoft OAuth Setup */}
          <TabsContent value="microsoft">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FaMicrosoft className="h-5 w-5 text-[#00A4EF]" />
                  Microsoft OAuth 2.0 Setup
                </CardTitle>
                <CardDescription>
                  Configure Microsoft OAuth to allow sign-in with Microsoft/Outlook accounts. This also enables Outlook integration.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Instructions */}
                <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600 space-y-2">
                  <p className="font-semibold text-gray-800">Setup instructions:</p>
                  <ol className="list-decimal pl-4 space-y-1">
                    <li>Go to <a href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">Azure App Registrations <ExternalLink className="h-3 w-3" /></a></li>
                    <li>Register a new application (multi-tenant)</li>
                    <li>Add redirect URI: <code className="bg-gray-200 px-1.5 py-0.5 rounded text-xs">{window.location.origin}/api/auth/microsoft/callback</code></li>
                    <li>Create a client secret and copy both IDs below</li>
                  </ol>
                </div>

                <div className="space-y-3">
                  <div>
                    <Label htmlFor="ms-client-id">Application (client) ID</Label>
                    <Input
                      id="ms-client-id"
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      value={microsoftConfig.clientId}
                      onChange={(e) => setMicrosoftConfig(prev => ({ ...prev, clientId: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="ms-client-secret">Client Secret Value</Label>
                    <div className="relative">
                      <Input
                        id="ms-client-secret"
                        type={showMicrosoftSecret ? "text" : "password"}
                        placeholder="xxxx~xxxx"
                        value={microsoftConfig.clientSecret}
                        onChange={(e) => setMicrosoftConfig(prev => ({ ...prev, clientSecret: e.target.value }))}
                      />
                      <button 
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() => setShowMicrosoftSecret(!showMicrosoftSecret)}
                      >
                        {showMicrosoftSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                  <strong>Required redirect URI:</strong>
                  <code className="block mt-1 bg-amber-100 px-2 py-1 rounded text-xs break-all">
                    {window.location.origin}/api/auth/microsoft/callback
                  </code>
                </div>

                <Button
                  onClick={() => handleSave('microsoft')}
                  disabled={saving || !microsoftConfig.clientId || !microsoftConfig.clientSecret}
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
                >
                  {saving ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
                  ) : (
                    <><CheckCircle className="h-4 w-4 mr-2" /> Save Microsoft OAuth Configuration</>
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Environment variables note */}
        <Card className="mt-8 border-gray-200">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <Settings className="h-5 w-5 text-gray-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-gray-600">
                <p className="font-semibold text-gray-800 mb-1">Alternative: Environment Variables</p>
                <p>You can also configure OAuth via environment variables on your hosting platform:</p>
                <div className="mt-2 bg-gray-50 rounded-lg p-3 font-mono text-xs space-y-1">
                  <div>GOOGLE_CLIENT_ID=your-client-id</div>
                  <div>GOOGLE_CLIENT_SECRET=your-client-secret</div>
                  <div>MICROSOFT_CLIENT_ID=your-client-id</div>
                  <div>MICROSOFT_CLIENT_SECRET=your-client-secret</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
