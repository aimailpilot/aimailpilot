import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation } from "wouter";
import { 
  Mail, Target, FileText, Users, TrendingUp, BarChart3, 
  Settings, CreditCard, Shield, Upload, Link2, CheckCircle
} from "lucide-react";

export default function EmailImportSetup() {
  const [location, setLocation] = useLocation();
  const [showGoogleSheetsDialog, setShowGoogleSheetsDialog] = useState(false);
  const [showCSVUploadDialog, setShowCSVUploadDialog] = useState(false);

  const sidebarItems = [
    { key: 'campaigns', label: 'Campaigns', icon: Target, href: '/' },
    { key: 'templates', label: 'Templates', icon: FileText, href: '/templates' },
    { key: 'contacts', label: 'Contacts', icon: Users, href: '/contacts' },
    { key: 'setup', label: 'Email & Import', icon: Mail, href: '/setup', active: true },
  ];

  const sidebarBottomItems = [
    { key: 'analytics', label: 'Analytics', icon: BarChart3 },
    { key: 'verification', label: 'Email verification', icon: Shield },
    { key: 'tracking', label: 'Live tracking', icon: TrendingUp },
    { key: 'account', label: 'Account', icon: Settings },
    { key: 'billing', label: 'Billing', icon: CreditCard },
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* AImailagent Sidebar */}
      <div className="w-64 bg-blue-600 text-white flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-blue-500">
          <div className="flex items-center">
            <div className="bg-white rounded-lg p-2 mr-3">
              <Mail className="h-6 w-6 text-blue-600" />
            </div>
            <span className="text-xl font-semibold">AImailagent</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6">
          <div className="space-y-2">
            {sidebarItems.map((item) => (
              <button
                key={item.key}
                onClick={() => setLocation(item.href)}
                className={`w-full flex items-center px-3 py-2 rounded-lg text-left transition-colors ${
                  item.active 
                    ? 'bg-blue-500 text-white' 
                    : 'text-blue-100 hover:bg-blue-500 hover:text-white'
                }`}
                data-testid={`nav-${item.key}`}
              >
                <item.icon className="h-5 w-5 mr-3" />
                {item.label}
                {item.key === 'contacts' && (
                  <span className="ml-auto text-xs bg-blue-500 px-2 py-1 rounded">2.4k</span>
                )}
              </button>
            ))}
          </div>

          {/* More Section */}
          <div className="mt-8">
            <div className="text-blue-200 text-xs font-medium uppercase tracking-wide mb-3 px-3">
              More
            </div>
            <div className="space-y-2">
              {sidebarBottomItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => {
                    if (item.key === 'account') {
                      setLocation('/account');
                    }
                  }}
                  className="w-full flex items-center px-3 py-2 rounded-lg text-left text-blue-100 hover:bg-blue-500 hover:text-white transition-colors"
                  data-testid={`nav-${item.key}`}
                >
                  <item.icon className="h-5 w-5 mr-3" />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </nav>

        {/* Bottom Action */}
        <div className="p-4 border-t border-blue-500">
          <button 
            onClick={() => setLocation('/')}
            className="w-full flex items-center justify-center px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-400 transition-colors"
          >
            <Mail className="h-4 w-4 mr-2" />
            New campaign
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Email & Import</h1>
              <p className="text-gray-600">Set up your email accounts and import contacts</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-6">
          {/* Email Account Setup */}
          <Card>
            <CardHeader>
              <CardTitle>Email Account Setup</CardTitle>
              <p className="text-sm text-gray-600">
                Connect your email accounts to send campaigns from AImailagent
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center justify-between p-4 border rounded-lg hover:border-blue-300 transition-colors">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                      <Mail className="h-6 w-6 text-red-600" />
                    </div>
                    <div>
                      <h3 className="font-medium">Gmail</h3>
                      <p className="text-sm text-gray-600">Connect your Gmail account</p>
                    </div>
                  </div>
                  <Button className="bg-blue-600 hover:bg-blue-700">
                    <Link2 className="h-4 w-4 mr-2" />
                    Connect
                  </Button>
                </div>

                <div className="flex items-center justify-between p-4 border rounded-lg hover:border-blue-300 transition-colors">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                      <Mail className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="font-medium">Outlook</h3>
                      <p className="text-sm text-gray-600">Connect your Microsoft account</p>
                    </div>
                  </div>
                  <Button className="bg-blue-600 hover:bg-blue-700">
                    <Link2 className="h-4 w-4 mr-2" />
                    Connect
                  </Button>
                </div>
              </div>

              <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                <div className="flex items-start space-x-3">
                  <CheckCircle className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-blue-900">Why connect email accounts?</h4>
                    <p className="text-sm text-blue-700 mt-1">
                      Connecting your email accounts allows you to send campaigns directly from your existing email addresses, 
                      improving deliverability and maintaining your professional identity.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Contact Import */}
          <Card>
            <CardHeader>
              <CardTitle>Import Contacts</CardTitle>
              <p className="text-sm text-gray-600">
                Import your contacts from various sources to start your email campaigns
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Google Sheets Import */}
                <Dialog open={showGoogleSheetsDialog} onOpenChange={setShowGoogleSheetsDialog}>
                  <DialogTrigger asChild>
                    <div className="p-6 border rounded-lg cursor-pointer hover:border-green-300 transition-colors">
                      <div className="text-center space-y-3">
                        <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center mx-auto">
                          <FileText className="h-6 w-6 text-green-600" />
                        </div>
                        <div>
                          <h3 className="font-medium">Google Sheets</h3>
                          <p className="text-sm text-gray-600">Import from Google Sheets</p>
                        </div>
                      </div>
                    </div>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Import from Google Sheets</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="sheets-url">Google Sheets URL</Label>
                        <Input 
                          id="sheets-url" 
                          placeholder="https://docs.google.com/spreadsheets/d/..." 
                        />
                      </div>
                      <div>
                        <Label htmlFor="sheet-name">Sheet Name</Label>
                        <Input id="sheet-name" placeholder="Sheet1" />
                      </div>
                      <div className="flex justify-end space-x-2">
                        <Button variant="outline" onClick={() => setShowGoogleSheetsDialog(false)}>
                          Cancel
                        </Button>
                        <Button onClick={() => setShowGoogleSheetsDialog(false)}>
                          Import Contacts
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>

                {/* CSV Upload */}
                <Dialog open={showCSVUploadDialog} onOpenChange={setShowCSVUploadDialog}>
                  <DialogTrigger asChild>
                    <div className="p-6 border rounded-lg cursor-pointer hover:border-blue-300 transition-colors">
                      <div className="text-center space-y-3">
                        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mx-auto">
                          <Upload className="h-6 w-6 text-blue-600" />
                        </div>
                        <div>
                          <h3 className="font-medium">CSV Upload</h3>
                          <p className="text-sm text-gray-600">Upload a CSV file</p>
                        </div>
                      </div>
                    </div>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Upload CSV File</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="csv-file">CSV File</Label>
                        <Input id="csv-file" type="file" accept=".csv" />
                      </div>
                      <div>
                        <Label htmlFor="delimiter">Delimiter</Label>
                        <Select>
                          <SelectTrigger>
                            <SelectValue placeholder="Select delimiter" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="comma">Comma (,)</SelectItem>
                            <SelectItem value="semicolon">Semicolon (;)</SelectItem>
                            <SelectItem value="tab">Tab</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex justify-end space-x-2">
                        <Button variant="outline" onClick={() => setShowCSVUploadDialog(false)}>
                          Cancel
                        </Button>
                        <Button onClick={() => setShowCSVUploadDialog(false)}>
                          Upload & Import
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>

                {/* Manual Entry */}
                <div className="p-6 border rounded-lg cursor-pointer hover:border-purple-300 transition-colors">
                  <div className="text-center space-y-3">
                    <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mx-auto">
                      <Users className="h-6 w-6 text-purple-600" />
                    </div>
                    <div>
                      <h3 className="font-medium">Manual Entry</h3>
                      <p className="text-sm text-gray-600">Add contacts manually</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 bg-yellow-50 rounded-lg">
                <div className="flex items-start space-x-3">
                  <CheckCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-yellow-900">Import Tips</h4>
                    <ul className="text-sm text-yellow-700 mt-1 space-y-1">
                      <li>• Ensure your data includes email addresses</li>
                      <li>• Include first name, last name for personalization</li>
                      <li>• Clean your data before importing for better results</li>
                    </ul>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Email Verification */}
          <Card>
            <CardHeader>
              <CardTitle>Email Verification</CardTitle>
              <p className="text-sm text-gray-600">
                Verify your email list to improve deliverability and reduce bounces
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                    <Shield className="h-6 w-6 text-orange-600" />
                  </div>
                  <div>
                    <h3 className="font-medium">Email Verification Service</h3>
                    <p className="text-sm text-gray-600">Check email validity before sending</p>
                  </div>
                </div>
                <Button variant="outline">
                  Setup Verification
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}