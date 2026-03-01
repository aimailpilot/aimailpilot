import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocation } from "wouter";
import { 
  Mail, Target, FileText, Users, TrendingUp, BarChart3, 
  Settings, CreditCard, Shield, Plus, MoreHorizontal, Edit
} from "lucide-react";

export default function AccountSettings() {
  const [location, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("general");
  const [showAddSenderDialog, setShowAddSenderDialog] = useState(false);
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);

  const sidebarItems = [
    { key: 'campaigns', label: 'Campaigns', icon: Target, href: '/' },
    { key: 'templates', label: 'Templates', icon: FileText, href: '/templates' },
    { key: 'contacts', label: 'Contacts', icon: Users, href: '/contacts' },
    { key: 'setup', label: 'Email & Import', icon: Mail, href: '/setup' },
  ];

  const sidebarBottomItems = [
    { key: 'analytics', label: 'Analytics', icon: BarChart3 },
    { key: 'verification', label: 'Email verification', icon: Shield },
    { key: 'tracking', label: 'Live tracking', icon: TrendingUp },
    { key: 'account', label: 'Account', icon: Settings, active: true },
    { key: 'billing', label: 'Billing', icon: CreditCard },
  ];

  // Mock data matching MailMeteor screenshots
  const userInfo = {
    name: "Praveen Nair",
    email: "nair_praveen@aegis.edu.in",
    quota: { used: 297, total: 500, resetsAt: "Tomorrow at 05:36 PM" }
  };

  const emailSenders = [
    {
      id: 1,
      name: "Praveen Nair", 
      email: "nair_praveen@aegis.edu.in",
      status: "Active"
    }
  ];

  const billingInfo = {
    plan: "Mailmeteor Education Program",
    isEducation: true,
    members: "Invite teammates to join"
  };

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
                className="w-full flex items-center px-3 py-2 rounded-lg text-left text-blue-100 hover:bg-blue-500 hover:text-white transition-colors"
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
                  onClick={() => item.key === 'account' ? null : setLocation(`/${item.key}`)}
                  className={`w-full flex items-center px-3 py-2 rounded-lg text-left transition-colors ${
                    item.active 
                      ? 'bg-blue-500 text-white' 
                      : 'text-blue-100 hover:bg-blue-500 hover:text-white'
                  }`}
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
              <h1 className="text-2xl font-bold text-gray-900">Account</h1>
              <p className="text-gray-600">Manage your account settings and preferences</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="senders">Senders</TabsTrigger>
              <TabsTrigger value="integrations">Integrations</TabsTrigger>
              <TabsTrigger value="partners">Partners</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>

            {/* General Tab */}
            <TabsContent value="general" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <Users className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <Label>Name</Label>
                      <div className="flex items-center space-x-2">
                        <span className="text-lg font-medium">{userInfo.name}</span>
                        <Button variant="ghost" size="sm">
                          <Edit className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <Mail className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <Label>Email</Label>
                      <div className="text-lg font-medium">{userInfo.email}</div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <BarChart3 className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <Label>Available quota</Label>
                      <div className="text-lg font-medium">
                        {userInfo.quota.used} / {userInfo.quota.total} emails
                        <span className="text-sm text-gray-500 ml-2">
                          (resets {userInfo.quota.resetsAt})
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Billing</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                      <CreditCard className="h-5 w-5 text-green-600" />
                    </div>
                    <div className="flex-1">
                      <Label>Plan</Label>
                      <div className="flex items-center space-x-2">
                        <span className="text-lg font-medium">{billingInfo.plan}</span>
                        <Badge className="bg-red-500 text-white">Upgrade to Pro</Badge>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <Users className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <Label>Members</Label>
                      <div className="text-lg font-medium">{billingInfo.members}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Discover more products section */}
              <Card>
                <CardHeader>
                  <CardTitle>Discover more products</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <h3 className="font-medium text-gray-900">Verify and clean your emails</h3>
                      <p className="text-sm text-gray-600">
                        Let AI help you write emails, remove duplicates and correct typos.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <h3 className="font-medium text-gray-900">Free email tools</h3>
                      <p className="text-sm text-gray-600">
                        Let AI help you write emails, remove duplicates and correct typos.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <h3 className="font-medium text-gray-900">Looking for something else?</h3>
                      <p className="text-sm text-gray-600">
                        Tell us what you would like to build better.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Senders Tab */}
            <TabsContent value="senders" className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Email addresses</CardTitle>
                      <p className="text-sm text-gray-600 mt-1">
                        Configure the email addresses you can send emails from.{" "}
                        <button className="text-blue-600 hover:underline">Learn more</button>
                      </p>
                    </div>
                    <Dialog open={showAddSenderDialog} onOpenChange={setShowAddSenderDialog}>
                      <DialogTrigger asChild>
                        <Button className="bg-blue-600 hover:bg-blue-700">
                          <Plus className="h-4 w-4 mr-2" />
                          Add sender
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Add sender email</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="sender-name">Name</Label>
                            <Input id="sender-name" placeholder="Your name" />
                          </div>
                          <div>
                            <Label htmlFor="sender-email">Email address</Label>
                            <Input id="sender-email" type="email" placeholder="your.email@domain.com" />
                          </div>
                          <div className="flex justify-end space-x-2">
                            <Button variant="outline" onClick={() => setShowAddSenderDialog(false)}>
                              Cancel
                            </Button>
                            <Button onClick={() => setShowAddSenderDialog(false)}>
                              Add sender
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Table Header */}
                    <div className="grid grid-cols-3 gap-4 pb-3 border-b text-sm font-medium text-gray-600">
                      <div>Name</div>
                      <div>Email</div>
                      <div>Status</div>
                    </div>

                    {/* Sender Rows */}
                    {emailSenders.map((sender) => (
                      <div key={sender.id} className="grid grid-cols-3 gap-4 py-3 border-b">
                        <div className="font-medium">{sender.name}</div>
                        <div className="text-gray-600">{sender.email}</div>
                        <div className="flex items-center justify-between">
                          <Badge className="bg-green-100 text-green-800 border-green-200">
                            {sender.status}
                          </Badge>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}

                    <div className="flex items-center justify-between pt-4 text-sm text-gray-500">
                      <span>Viewing 1—1 over 1 results</span>
                      <div className="flex items-center space-x-2">
                        <Button variant="outline" size="sm" disabled>
                          Previous
                        </Button>
                        <Button variant="outline" size="sm" disabled>
                          Next
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>More settings</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-medium text-gray-900">Email signature</h3>
                      <p className="text-sm text-gray-600 mb-3">Create and manage your email signature</p>
                      <div className="flex space-x-2">
                        <Dialog open={showSignatureDialog} onOpenChange={setShowSignatureDialog}>
                          <DialogTrigger asChild>
                            <Button variant="outline">Configure signature</Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl">
                            <DialogHeader>
                              <DialogTitle>Email Signature</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4">
                              <div>
                                <Label htmlFor="signature">Signature</Label>
                                <Textarea 
                                  id="signature" 
                                  placeholder="Best regards,&#10;Your Name&#10;Your Title&#10;Company Name"
                                  className="min-h-[150px]"
                                />
                              </div>
                              <div className="flex justify-end space-x-2">
                                <Button variant="outline" onClick={() => setShowSignatureDialog(false)}>
                                  Cancel
                                </Button>
                                <Button onClick={() => setShowSignatureDialog(false)}>
                                  Save signature
                                </Button>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                        <Button variant="outline">Learn more</Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Integrations Tab */}
            <TabsContent value="integrations" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Email Integrations</CardTitle>
                  <p className="text-sm text-gray-600">
                    Connect your email accounts to send campaigns
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                          <Mail className="h-5 w-5 text-red-600" />
                        </div>
                        <div>
                          <h3 className="font-medium">Gmail</h3>
                          <p className="text-sm text-gray-600">Connect your Gmail account</p>
                        </div>
                      </div>
                      <Button variant="outline">Connect</Button>
                    </div>

                    <div className="flex items-center justify-between p-4 border rounded-lg">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                          <Mail className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                          <h3 className="font-medium">Outlook</h3>
                          <p className="text-sm text-gray-600">Connect your Outlook account</p>
                        </div>
                      </div>
                      <Button variant="outline">Connect</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Partners Tab */}
            <TabsContent value="partners" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Partner Integrations</CardTitle>
                  <p className="text-sm text-gray-600">
                    Connect with partner services to enhance your campaigns
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-12">
                    <p className="text-gray-500">No partner integrations available yet.</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Advanced Tab */}
            <TabsContent value="advanced" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Advanced Settings</CardTitle>
                  <p className="text-sm text-gray-600">
                    Advanced configuration options for power users
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-12">
                    <p className="text-gray-500">Advanced settings coming soon.</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}