import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Mail, Upload, FileSpreadsheet, CheckCircle, AlertCircle, Users } from "lucide-react";

interface OAuthIntegrationProps {
  organizationId: string;
  onSuccess?: (accountId: string, email: string) => void;
}

export function OAuthIntegration({ organizationId, onSuccess }: OAuthIntegrationProps) {
  const [activeTab, setActiveTab] = useState<'connect' | 'import'>('connect');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Import states
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importType, setImportType] = useState<'csv' | 'excel'>('csv');
  const [googleSheetsUrl, setGoogleSheetsUrl] = useState('');
  const [importProgress, setImportProgress] = useState<any>(null);

  const handleGmailAuth = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/oauth/gmail/auth/${organizationId}`);
      const data = await response.json();
      
      if (data.success) {
        // Demo mode - direct success
        setSuccess(data.message);
        onSuccess?.(data.accountId, data.email);
      } else if (data.authUrl) {
        // Real OAuth mode - redirect to Google
        window.location.href = data.authUrl;
      } else {
        setError('Failed to initialize Gmail authentication');
      }
    } catch (err) {
      setError('Failed to connect to Gmail. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleOutlookAuth = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/oauth/outlook/auth/${organizationId}`);
      const data = await response.json();
      
      if (data.success) {
        // Demo mode - direct success
        setSuccess(data.message);
        onSuccess?.(data.accountId, data.email);
      } else if (data.authUrl) {
        // Real OAuth mode - redirect to Microsoft
        window.location.href = data.authUrl;
      } else {
        setError('Failed to initialize Outlook authentication');
      }
    } catch (err) {
      setError('Failed to connect to Outlook. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setImportFile(file);
      setError(null);
    }
  };

  const handleImportContacts = async () => {
    if (!importFile && !googleSheetsUrl) {
      setError('Please select a file or provide a Google Sheets URL');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let response;
      
      if (googleSheetsUrl) {
        // Extract spreadsheet ID from URL
        const match = googleSheetsUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (!match) {
          setError('Invalid Google Sheets URL');
          return;
        }
        
        const spreadsheetId = match[1];
        response = await fetch('/api/oauth/import/googlesheets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spreadsheetId,
            organizationId,
            // Would need to get accountId from authenticated Gmail account
            accountId: 'gmail-account-id'
          })
        });
      } else if (importFile) {
        const formData = new FormData();
        formData.append('file', importFile);
        formData.append('organizationId', organizationId);
        
        const endpoint = importType === 'csv' ? '/api/oauth/import/csv' : '/api/oauth/import/excel';
        response = await fetch(endpoint, {
          method: 'POST',
          body: formData
        });
      }

      if (response) {
        const result = await response.json();
        
        if (result.success) {
          setImportProgress(result);
          setSuccess(`Successfully imported ${result.importedCount} contacts!`);
          setImportFile(null);
          setGoogleSheetsUrl('');
        } else {
          setError(`Import failed: ${result.errors?.[0]?.error || 'Unknown error'}`);
        }
      }
    } catch (err) {
      setError('Failed to import contacts. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Check for OAuth callback results
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const gmailConnected = urlParams.get('gmail_connected');
    const outlookConnected = urlParams.get('outlook_connected');
    const email = urlParams.get('email');
    const errorParam = urlParams.get('error');

    if (gmailConnected && email) {
      setSuccess(`Gmail account connected successfully: ${decodeURIComponent(email)}`);
      onSuccess?.(gmailConnected, decodeURIComponent(email));
      
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (outlookConnected && email) {
      setSuccess(`Outlook account connected successfully: ${decodeURIComponent(email)}`);
      onSuccess?.(outlookConnected, decodeURIComponent(email));
      
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (errorParam) {
      setError(`Authentication failed: ${decodeURIComponent(errorParam)}`);
      
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [onSuccess]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Mail className="h-5 w-5" />
            <span>Email Integration & Contact Import</span>
          </CardTitle>
          <CardDescription>
            Connect your Gmail or Outlook account and import contacts from spreadsheets
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'connect' | 'import')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="connect">Connect Email</TabsTrigger>
              <TabsTrigger value="import">Import Contacts</TabsTrigger>
            </TabsList>

            <TabsContent value="connect" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-4">
                  <div className="flex items-center space-x-3 mb-4">
                    <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                      <Mail className="h-4 w-4 text-red-600" />
                    </div>
                    <div>
                      <h3 className="font-medium">Gmail Integration</h3>
                      <p className="text-sm text-slate-500">Send emails through Gmail</p>
                    </div>
                  </div>
                  <Button 
                    onClick={handleGmailAuth} 
                    disabled={loading} 
                    className="w-full bg-red-600 hover:bg-red-700"
                    data-testid="button-gmail-auth"
                  >
                    {loading ? 'Connecting...' : 'Connect Gmail'}
                  </Button>
                </Card>

                <Card className="p-4">
                  <div className="flex items-center space-x-3 mb-4">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <Mail className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-medium">Outlook Integration</h3>
                      <p className="text-sm text-slate-500">Send emails through Outlook</p>
                    </div>
                  </div>
                  <Button 
                    onClick={handleOutlookAuth} 
                    disabled={loading} 
                    className="w-full bg-blue-600 hover:bg-blue-700"
                    data-testid="button-outlook-auth"
                  >
                    {loading ? 'Connecting...' : 'Connect Outlook'}
                  </Button>
                </Card>
              </div>

              <div className="bg-slate-50 rounded-lg p-4">
                <h4 className="font-medium mb-2">Why connect your email?</h4>
                <ul className="text-sm text-slate-600 space-y-1">
                  <li>• Send emails directly through your existing account</li>
                  <li>• Maintain your sender reputation and deliverability</li>
                  <li>• Access your contacts and email history</li>
                  <li>• Import contacts from Google Sheets or Excel files</li>
                </ul>
              </div>
            </TabsContent>

            <TabsContent value="import" className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <FileSpreadsheet className="h-4 w-4" />
                      <span>Google Sheets</span>
                    </CardTitle>
                    <CardDescription>
                      Import contacts from Google Sheets (requires Gmail connection)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="sheets-url">Google Sheets URL</Label>
                      <Input
                        id="sheets-url"
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                        value={googleSheetsUrl}
                        onChange={(e) => setGoogleSheetsUrl(e.target.value)}
                        data-testid="input-sheets-url"
                      />
                    </div>
                    <Button 
                      onClick={handleImportContacts}
                      disabled={!googleSheetsUrl || loading}
                      className="w-full"
                      data-testid="button-import-sheets"
                    >
                      {loading ? 'Importing...' : 'Import from Sheets'}
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <Upload className="h-4 w-4" />
                      <span>File Upload</span>
                    </CardTitle>
                    <CardDescription>
                      Upload CSV or Excel files with contact data
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label>File Type</Label>
                      <div className="flex space-x-4 mt-2">
                        <label className="flex items-center space-x-2">
                          <input
                            type="radio"
                            name="importType"
                            value="csv"
                            checked={importType === 'csv'}
                            onChange={(e) => setImportType(e.target.value as 'csv' | 'excel')}
                          />
                          <span>CSV</span>
                        </label>
                        <label className="flex items-center space-x-2">
                          <input
                            type="radio"
                            name="importType"
                            value="excel"
                            checked={importType === 'excel'}
                            onChange={(e) => setImportType(e.target.value as 'csv' | 'excel')}
                          />
                          <span>Excel</span>
                        </label>
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="file-upload">Choose File</Label>
                      <Input
                        id="file-upload"
                        type="file"
                        accept={importType === 'csv' ? '.csv' : '.xlsx,.xls'}
                        onChange={handleFileUpload}
                        data-testid="input-file-upload"
                      />
                    </div>
                    {importFile && (
                      <div className="text-sm text-slate-600">
                        Selected: {importFile.name} ({Math.round(importFile.size / 1024)} KB)
                      </div>
                    )}
                    <Button 
                      onClick={handleImportContacts}
                      disabled={!importFile || loading}
                      className="w-full"
                      data-testid="button-import-file"
                    >
                      {loading ? 'Importing...' : 'Import Contacts'}
                    </Button>
                  </CardContent>
                </Card>
              </div>

              <div className="bg-slate-50 rounded-lg p-4">
                <h4 className="font-medium mb-2">Expected file format:</h4>
                <div className="text-sm text-slate-600 space-y-1">
                  <p>First row should contain headers like:</p>
                  <code className="bg-white px-2 py-1 rounded text-xs">
                    Email, First Name, Last Name, Company, Job Title
                  </code>
                  <p className="mt-2">Additional columns will be imported as custom fields.</p>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {error && (
            <Alert className="mt-4" data-testid="alert-error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="mt-4 bg-green-50 border-green-200" data-testid="alert-success">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-700">{success}</AlertDescription>
            </Alert>
          )}

          {importProgress && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Users className="h-4 w-4" />
                  <span>Import Results</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {importProgress.importedCount}
                    </div>
                    <div className="text-sm text-slate-500">Imported</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-yellow-600">
                      {importProgress.skippedCount}
                    </div>
                    <div className="text-sm text-slate-500">Skipped</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-slate-600">
                      {importProgress.totalRows}
                    </div>
                    <div className="text-sm text-slate-500">Total</div>
                  </div>
                </div>
                
                {importProgress.errors.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Import Warnings:</h4>
                    <div className="max-h-32 overflow-y-auto text-sm text-slate-600 space-y-1">
                      {importProgress.errors.slice(0, 5).map((error: any, index: number) => (
                        <div key={index}>
                          Row {error.row}: {error.error}
                        </div>
                      ))}
                      {importProgress.errors.length > 5 && (
                        <div className="text-slate-500">
                          ...and {importProgress.errors.length - 5} more warnings
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}