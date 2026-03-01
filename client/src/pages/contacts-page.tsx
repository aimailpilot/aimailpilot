import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  Plus, 
  Search, 
  Upload, 
  Mail, 
  Users, 
  Filter,
  MoreHorizontal,
  Edit,
  Trash2
} from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
// Navigation will be handled by the main layout

interface Contact {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  status: 'active' | 'unsubscribed' | 'bounced';
  tags?: string[];
  createdAt: string;
}

export default function ContactsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newContact, setNewContact] = useState({
    email: "",
    firstName: "",
    lastName: "",
    company: "",
    jobTitle: ""
  });
  const { toast } = useToast();

  // Fetch contacts
  const { data: contacts = [], isLoading } = useQuery<Contact[]>({
    queryKey: ['/api/contacts'],
    retry: false,
  });

  // Add contact mutation
  const addContactMutation = useMutation({
    mutationFn: async (contactData: typeof newContact) => {
      const response = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(contactData)
      });
      
      if (!response.ok) {
        throw new Error('Failed to add contact');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contacts'] });
      setShowAddDialog(false);
      setNewContact({ email: "", firstName: "", lastName: "", company: "", jobTitle: "" });
      toast({ title: "Contact added successfully" });
    },
    onError: () => {
      toast({ 
        title: "Error", 
        description: "Failed to add contact",
        variant: "destructive" 
      });
    }
  });

  const handleAddContact = () => {
    if (!newContact.email.trim()) {
      toast({ 
        title: "Error", 
        description: "Email is required",
        variant: "destructive" 
      });
      return;
    }
    addContactMutation.mutate(newContact);
  };

  const filteredContacts = contacts.filter(contact =>
    contact.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.firstName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.lastName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.company?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusBadge = (status: Contact['status']) => {
    const variants = {
      active: { variant: "default" as const, text: "Active" },
      unsubscribed: { variant: "secondary" as const, text: "Unsubscribed" },
      bounced: { variant: "destructive" as const, text: "Bounced" }
    };
    
    const config = variants[status];
    return <Badge variant={config.variant}>{config.text}</Badge>;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                Contacts
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-2">
                Manage your email contacts and mailing lists
              </p>
            </div>
            
            <div className="flex gap-3">
              <Button variant="outline" size="sm">
                <Upload className="h-4 w-4 mr-2" />
                Import
              </Button>
              
              <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogTrigger asChild>
                  <Button data-testid="button-add-contact">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Contact
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add New Contact</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="email">Email *</Label>
                      <Input
                        id="email"
                        type="email"
                        value={newContact.email}
                        onChange={(e) => setNewContact(prev => ({ ...prev, email: e.target.value }))}
                        placeholder="contact@example.com"
                        data-testid="input-contact-email"
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="firstName">First Name</Label>
                        <Input
                          id="firstName"
                          value={newContact.firstName}
                          onChange={(e) => setNewContact(prev => ({ ...prev, firstName: e.target.value }))}
                          placeholder="John"
                          data-testid="input-contact-firstname"
                        />
                      </div>
                      <div>
                        <Label htmlFor="lastName">Last Name</Label>
                        <Input
                          id="lastName"
                          value={newContact.lastName}
                          onChange={(e) => setNewContact(prev => ({ ...prev, lastName: e.target.value }))}
                          placeholder="Doe"
                          data-testid="input-contact-lastname"
                        />
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="company">Company</Label>
                      <Input
                        id="company"
                        value={newContact.company}
                        onChange={(e) => setNewContact(prev => ({ ...prev, company: e.target.value }))}
                        placeholder="Acme Corp"
                        data-testid="input-contact-company"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="jobTitle">Job Title</Label>
                      <Input
                        id="jobTitle"
                        value={newContact.jobTitle}
                        onChange={(e) => setNewContact(prev => ({ ...prev, jobTitle: e.target.value }))}
                        placeholder="Marketing Manager"
                        data-testid="input-contact-jobtitle"
                      />
                    </div>
                    
                    <div className="flex justify-end gap-3 pt-4">
                      <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                        Cancel
                      </Button>
                      <Button 
                        onClick={handleAddContact}
                        disabled={addContactMutation.isPending}
                        data-testid="button-save-contact"
                      >
                        {addContactMutation.isPending ? "Adding..." : "Add Contact"}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <Users className="h-8 w-8 text-blue-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Total Contacts
                  </p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {contacts.length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <Mail className="h-8 w-8 text-green-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Active
                  </p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {contacts.filter(c => c.status === 'active').length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <Filter className="h-8 w-8 text-yellow-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Unsubscribed
                  </p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {contacts.filter(c => c.status === 'unsubscribed').length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <Trash2 className="h-8 w-8 text-red-600" />
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Bounced
                  </p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {contacts.filter(c => c.status === 'bounced').length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filters */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search contacts by email, name, or company..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search-contacts"
                />
              </div>
              <Button variant="outline">
                <Filter className="h-4 w-4 mr-2" />
                Filters
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Contacts Table */}
        <Card>
          <CardHeader>
            <CardTitle>All Contacts</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">
                <div className="text-gray-600 dark:text-gray-400">Loading contacts...</div>
              </div>
            ) : filteredContacts.length === 0 ? (
              <div className="text-center py-8">
                <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  No contacts found
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  {searchQuery ? "No contacts match your search." : "Get started by adding your first contact."}
                </p>
                {!searchQuery && (
                  <Button onClick={() => setShowAddDialog(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Your First Contact
                  </Button>
                )}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredContacts.map((contact) => (
                    <TableRow key={contact.id} data-testid={`row-contact-${contact.id}`}>
                      <TableCell>
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">
                            {contact.firstName || contact.lastName 
                              ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
                              : contact.email
                            }
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">
                            {contact.email}
                          </div>
                          {contact.jobTitle && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {contact.jobTitle}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-900 dark:text-white">
                          {contact.company || '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(contact.status)}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {new Date(contact.createdAt).toLocaleDateString()}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}