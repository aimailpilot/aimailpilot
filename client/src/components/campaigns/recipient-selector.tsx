import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileSpreadsheet, Upload, Users, Copy, CheckCircle, AlertCircle } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface RecipientSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecipientsSelected: (recipients: any[]) => void;
  emailAccounts: any[];
}

interface SheetsInfo {
  title: string;
  sheets: Array<{ name: string; id: number; gridProperties: any }>;
}

interface PreviewData {
  headers: string[];
  preview: any[][];
  totalRows: number;
}

export function RecipientSelector({ 
  open, 
  onOpenChange, 
  onRecipientsSelected,
  emailAccounts 
}: RecipientSelectorProps) {
  const [activeTab, setActiveTab] = useState("sheets");
  const [selectedAccount, setSelectedAccount] = useState("");
  const [sheetsUrl, setSheetsUrl] = useState("");
  const [selectedSheet, setSelectedSheet] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [googleSheetsConnected, setGoogleSheetsConnected] = useState(false);
  const { toast } = useToast();

  // Check Google Sheets connection status
  useEffect(() => {
    const checkGoogleSheetsAuth = async () => {
      try {
        console.log('🔍 RECIPIENT SELECTOR: Checking Google Sheets connection...');
        
        // FORCE FRESH REQUEST - no cache
        const response = await fetch('/api/auth/google/status?' + new Date().getTime(), {
          method: 'GET',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        });
        
        console.log('📡 RECIPIENT SELECTOR: Response status:', response.status);
        
        if (response.ok) {
          const data = await response.json();
          console.log('📊 RECIPIENT SELECTOR: Server says connected =', data.connected);
          
          // FORCE the state to match server response
          setGoogleSheetsConnected(data.connected);
          
          // Clear any stale cache data
          if (!data.connected) {
            console.log('🗑️ CLEARING ALL GOOGLE SHEETS CACHE');
            localStorage.removeItem('googleSheetsConnected');
            localStorage.removeItem('googleSheetsToken');
            localStorage.removeItem('googleTokens');
          }
          
          // Update global state
          window.dispatchEvent(new CustomEvent('googleSheetsConnectionChange', { detail: { connected: data.connected } }));
        } else {
          console.log('❌ RECIPIENT SELECTOR: Server request failed, assuming not connected');
          setGoogleSheetsConnected(false);
          localStorage.removeItem('googleSheetsConnected');
          localStorage.removeItem('googleSheetsToken');
          localStorage.removeItem('googleTokens');
        }
      } catch (error) {
        console.error('💥 RECIPIENT SELECTOR: Error checking connection:', error);
        setGoogleSheetsConnected(false);
        localStorage.removeItem('googleSheetsConnected');
        localStorage.removeItem('googleSheetsToken');
        localStorage.removeItem('googleTokens');
      }
    };

    if (open) {
      console.log('🚪 RECIPIENT SELECTOR: Modal opened, forcing fresh auth check...');
      
      // FORCE clear state first
      setGoogleSheetsConnected(false);
      
      // Clear all possible stale indicators
      localStorage.removeItem('googleSheetsConnected');
      localStorage.removeItem('googleSheetsToken');
      localStorage.removeItem('googleTokens');
      localStorage.removeItem('user_data');
      
      // Verify with server immediately
      checkGoogleSheetsAuth();
      
      // Check URL parameter for successful connection
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('connected') === 'true') {
        console.log('🔗 RECIPIENT SELECTOR: Found connected=true in URL, rechecking...');
        setTimeout(() => {
          checkGoogleSheetsAuth();
        }, 1000); // Give server more time
        // Clean up URL
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }

    // Listen for connection changes from other components
    const handleConnectionChange = (event: any) => {
      console.log('RecipientSelector: Received connection change event:', event.detail);
      setGoogleSheetsConnected(event.detail.connected);
    };

    window.addEventListener('googleSheetsConnectionChange', handleConnectionChange);

    return () => {
      window.removeEventListener('googleSheetsConnectionChange', handleConnectionChange);
    };
  }, [open]);

  // Extract spreadsheet ID from Google Sheets URL
  const extractSpreadsheetId = (url: string) => {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
  };

  const spreadsheetId = extractSpreadsheetId(sheetsUrl);

  // Fetch available sheets when spreadsheet URL is provided
  const { data: sheetsInfo, isLoading: sheetsLoading, error: sheetsError } = useQuery<SheetsInfo>({
    queryKey: ['/api/sheets/info', spreadsheetId],
    queryFn: async () => {
      const response = await apiRequest('GET', `/api/sheets/${spreadsheetId}/info`);
      if (!response.ok) {
        throw new Error('Failed to fetch spreadsheet info');
      }
      return response.json();
    },
    enabled: googleSheetsConnected && !!spreadsheetId,
    retry: false
  });

  // Preview sheet data
  const { data: previewData, isLoading: previewLoading } = useQuery<PreviewData>({
    queryKey: ['/api/sheets/preview', spreadsheetId, selectedSheet],
    queryFn: async () => {
      const response = await apiRequest('POST', `/api/sheets/preview`, {
        spreadsheetId,
        sheetName: selectedSheet
      });
      return response.json();
    },
    enabled: googleSheetsConnected && !!spreadsheetId && !!selectedSheet,
    retry: false
  });

  // Import from Google Sheets
  const importMutation = useMutation({
    mutationFn: async (data: { source: string; spreadsheetId?: string; sheetName?: string }) => {
      if (data.source === 'sheets') {
        const response = await apiRequest('POST', `/api/oauth/import/googlesheets`, {
          spreadsheetId: data.spreadsheetId,
          range: `${data.sheetName}!A:Z`,
          organizationId: '550e8400-e29b-41d4-a716-446655440001' // Mock org ID
        });
        return response.json();
      }
      // Handle other import types here
      return null;
    },
    onSuccess: (result: any) => {
      if (result?.contacts) {
        onRecipientsSelected(result.contacts);
        toast({ title: "Success", description: `Imported ${result.importedCount} contacts successfully` });
        onOpenChange(false);
      }
    },
    onError: (error) => {
      toast({ 
        title: "Import Failed", 
        description: "Failed to import contacts from Google Sheets",
        variant: "destructive" 
      });
    }
  });

  const handleImportSheets = () => {
    if (!googleSheetsConnected || !spreadsheetId || !selectedSheet) {
      toast({ 
        title: "Missing Information", 
        description: "Please connect Google Sheets, enter a URL, and choose a sheet",
        variant: "destructive" 
      });
      return;
    }

    importMutation.mutate({
      source: 'sheets',
      spreadsheetId,
      sheetName: selectedSheet
    });
  };

  // Filter to only Gmail accounts (needed for Sheets access)
  const gmailAccounts = emailAccounts.filter(account => account.provider === 'gmail');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Select recipients</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="sheets" className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Google Sheets
            </TabsTrigger>
            <TabsTrigger value="csv" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Import a CSV
            </TabsTrigger>
            <TabsTrigger value="contacts" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Contact list
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex items-center gap-2">
              <Copy className="h-4 w-4" />
              Copy / paste
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sheets" className="space-y-4">
            <div className="space-y-4">
              {/* Always show connection status and button at the top */}
              <div className="flex items-center justify-between p-3 border rounded-md">
                {googleSheetsConnected ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="text-sm text-green-800">Google Sheets connected</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-orange-500" />
                    <span className="text-sm text-orange-800">Google Sheets not connected</span>
                  </div>
                )}
                
                <Button
                  onClick={() => window.location.href = '/api/auth/google'}
                  variant={googleSheetsConnected ? "outline" : "default"}
                  size="sm"
                  className={googleSheetsConnected ? "" : "bg-blue-600 hover:bg-blue-700"}
                  data-testid="button-connect-google-sheets"
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  {googleSheetsConnected ? 'Reconnect' : 'Connect Google Sheets'}
                </Button>
              </div>

              {/* Show URL input and functionality only when connected */}
              {googleSheetsConnected ? (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="sheets-url">Spreadsheet URL</Label>
                    <div className="relative">
                      <Input
                        id="sheets-url"
                        placeholder="Copy/paste spreadsheet URL"
                        value={sheetsUrl}
                        onChange={(e) => setSheetsUrl(e.target.value)}
                        data-testid="input-sheets-url"
                        className={spreadsheetId && sheetsInfo ? "pr-10 border-green-500" : ""}
                      />
                      {spreadsheetId && sheetsInfo && (
                        <CheckCircle className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-green-600" />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Paste the URL from your browser's address bar
                    </p>
                    {spreadsheetId && sheetsLoading && (
                      <p className="text-xs text-blue-600 mt-1">Loading spreadsheet...</p>
                    )}
                    {spreadsheetId && !sheetsLoading && !sheetsInfo && googleSheetsConnected && (
                      <p className="text-xs text-red-600 mt-1">Failed to load spreadsheet. Please check the URL and try again.</p>
                    )}
                  </div>

                  {sheetsInfo && (
                    <div>
                      <Label htmlFor="sheet-select">Sheet</Label>
                      <Select value={selectedSheet} onValueChange={setSelectedSheet}>
                        <SelectTrigger data-testid="select-sheet">
                          <SelectValue placeholder="Select a sheet" />
                        </SelectTrigger>
                        <SelectContent>
                          {sheetsInfo.sheets.map((sheet) => (
                            <SelectItem key={sheet.id} value={sheet.name}>
                              {sheet.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {previewData && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm">Preview</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-xs">
                            <thead>
                              <tr className="border-b">
                                {previewData.headers.map((header, index) => (
                                  <th key={index} className="text-left p-2 font-medium">
                                    {header}
                                  </th>
                                ))}
                                </tr>
                            </thead>
                            <tbody>
                              {previewData.preview.map((row, rowIndex) => (
                                <tr key={rowIndex} className="border-b">
                                  {row.map((cell, cellIndex) => (
                                    <td key={cellIndex} className="p-2">
                                      {cell || '-'}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          Showing first 5 rows of {previewData.totalRows} total rows
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 text-slate-400" />
                  <h3 className="text-lg font-semibold mb-2 text-slate-700">Ready to import from Google Sheets?</h3>
                  <p className="text-slate-500 mb-4">
                    Click "Connect Google Sheets" above to authenticate with your Google account and access your spreadsheets.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="csv" className="space-y-4">
            <div className="space-y-4">
              <div>
                <Label htmlFor="csv-upload">Upload CSV File</Label>
                <Input
                  id="csv-upload"
                  type="file"
                  accept=".csv"
                  onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                  data-testid="input-csv-file"
                />
              </div>
              {csvFile && (
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{csvFile.name}</p>
                        <p className="text-xs text-slate-500">{(csvFile.size / 1024).toFixed(1)} KB</p>
                      </div>
                      <Badge>Ready to import</Badge>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="contacts" className="space-y-4">
            <div className="text-center py-8 text-slate-500">
              <Users className="h-12 w-12 mx-auto mb-4 text-slate-300" />
              <p>Select from your existing contact lists</p>
              <p className="text-xs">Feature coming soon</p>
            </div>
          </TabsContent>

          <TabsContent value="manual" className="space-y-4">
            <div className="space-y-4">
              <Label htmlFor="manual-emails">Email Addresses</Label>
              <textarea
                id="manual-emails"
                className="w-full h-32 p-3 border rounded-md text-sm"
                placeholder="Enter email addresses, one per line or separated by commas"
                data-testid="textarea-manual-emails"
              />
              <p className="text-xs text-slate-500">
                You can paste emails separated by commas or new lines
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-between pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close">
            Close
          </Button>
          <Button 
            onClick={handleImportSheets}
            disabled={activeTab === 'sheets' && (!googleSheetsConnected || !spreadsheetId || !selectedSheet || importMutation.isPending)}
            data-testid="button-next"
          >
            {importMutation.isPending ? 'Importing...' : 'Next'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}