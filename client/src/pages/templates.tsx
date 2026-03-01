import { useState } from "react";
import { TemplateGallery } from "@/components/templates/template-gallery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { 
  Mail, Target, FileText, Users, TrendingUp, BarChart3, 
  Settings, CreditCard, Shield, Search 
} from "lucide-react";
import type { EmailTemplate } from "@/types";

export default function Templates() {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [location, setLocation] = useLocation();
  
  const { data: templates, isLoading } = useQuery<EmailTemplate[]>({
    queryKey: ["/api/templates"],
  });


  const filteredTemplates = templates?.filter((template) => {
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         template.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         template.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || template.category === categoryFilter;
    return matchesSearch && matchesCategory;
  }) || [];

  const categories = Array.from(new Set(templates?.map(t => t.category).filter(Boolean))) || [];

  const sidebarItems = [
    { key: 'campaigns', label: 'Campaigns', icon: Target, href: '/' },
    { key: 'templates', label: 'Templates', icon: FileText, href: '/templates', active: true },
    { key: 'contacts', label: 'Contacts', icon: Users, href: '/contacts' },
    { key: 'setup', label: 'Email & Import', icon: Mail, href: '/setup' },
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
          <button className="w-full flex items-center justify-center px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-400 transition-colors">
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
              <h1 className="text-2xl font-bold text-gray-900">Email Templates</h1>
              <p className="text-gray-600">Create and manage your email templates</p>
            </div>
            <Button 
              className="bg-blue-600 hover:bg-blue-700 text-white"
              onClick={() => {
                console.log("New Template button clicked - navigating to /templates/new");
                console.log("Current location:", location);
                setLocation("/templates/new");
                console.log("Navigation attempted");
              }}
              data-testid="button-new-template"
            >
              New template
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            {/* Search and Filter */}
            <div className="flex items-center space-x-4 mb-6">
              <div className="flex-1 max-w-md relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search templates..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <Tabs value={categoryFilter} onValueChange={setCategoryFilter}>
              <TabsList className="flex flex-wrap h-auto p-1">
                <TabsTrigger value="all">All Templates</TabsTrigger>
                {categories.map((category) => (
                  <TabsTrigger key={category || 'unknown'} value={category || 'unknown'} className="capitalize">
                    {category || 'Other'}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <TemplateGallery templates={filteredTemplates} isLoading={isLoading} />
        </div>
      </main>
    </div>
  );
}
