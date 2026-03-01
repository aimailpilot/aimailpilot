import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Contact } from "@/types";

interface ContactListProps {
  contacts: Contact[];
  isLoading: boolean;
}

export function ContactList({ contacts, isLoading }: ContactListProps) {
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'hot': return 'bg-red-100 text-red-800';
      case 'warm': return 'bg-yellow-100 text-yellow-800';
      case 'cold': return 'bg-gray-100 text-gray-800';
      case 'replied': return 'bg-green-100 text-green-800';
      case 'unsubscribed': return 'bg-slate-100 text-slate-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-red-600';
    if (score >= 60) return 'text-yellow-600';
    if (score >= 40) return 'text-green-600';
    return 'text-gray-600';
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedContacts(contacts.map(c => c.id));
    } else {
      setSelectedContacts([]);
    }
  };

  const handleSelectContact = (contactId: string, checked: boolean) => {
    if (checked) {
      setSelectedContacts([...selectedContacts, contactId]);
    } else {
      setSelectedContacts(selectedContacts.filter(id => id !== contactId));
    }
  };

  const getInitials = (firstName?: string, lastName?: string) => {
    return `${firstName?.charAt(0) || ''}${lastName?.charAt(0) || ''}`.toUpperCase() || '?';
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(10)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!contacts || contacts.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-12">
          <i className="fas fa-users text-slate-300 text-6xl mb-4"></i>
          <h3 className="text-lg font-medium text-slate-900 mb-2">No contacts found</h3>
          <p className="text-slate-600 mb-4">
            Import your contacts or add them manually to get started
          </p>
          <Button className="bg-primary hover:bg-blue-700">
            <i className="fas fa-plus mr-2"></i>
            Add Your First Contact
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bulk Actions */}
      {selectedContacts.length > 0 && (
        <Card className="border-primary">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <Checkbox
                  checked={selectedContacts.length === contacts.length}
                  onCheckedChange={handleSelectAll}
                />
                <span className="text-sm font-medium">
                  {selectedContacts.length} contacts selected
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <Button variant="outline" size="sm">
                  <i className="fas fa-tag mr-2"></i>
                  Add Tags
                </Button>
                <Button variant="outline" size="sm">
                  <i className="fas fa-user-tag mr-2"></i>
                  Change Status
                </Button>
                <Button variant="outline" size="sm">
                  <i className="fas fa-envelope mr-2"></i>
                  Add to Campaign
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <i className="fas fa-ellipsis-h"></i>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem>
                      <i className="fas fa-download mr-2"></i>
                      Export Selected
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-red-600">
                      <i className="fas fa-trash mr-2"></i>
                      Delete Selected
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Contact List Header */}
      <div className="flex items-center justify-between text-sm text-slate-600 px-4">
        <div className="flex items-center space-x-4">
          <Checkbox
            checked={selectedContacts.length === contacts.length}
            onCheckedChange={handleSelectAll}
          />
          <span>Select all</span>
        </div>
        <span>{contacts.length} contacts</span>
      </div>

      {/* Contact Cards */}
      {contacts.map((contact) => (
        <Card key={contact.id} className="hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <Checkbox
                  checked={selectedContacts.includes(contact.id)}
                  onCheckedChange={(checked) => handleSelectContact(contact.id, checked as boolean)}
                />
                <Avatar className="w-10 h-10">
                  <AvatarFallback className="bg-primary text-white">
                    {getInitials(contact.firstName, contact.lastName)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center space-x-2">
                    <h4 className="font-medium text-slate-900">
                      {contact.firstName || contact.lastName 
                        ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
                        : 'Unknown Name'
                      }
                    </h4>
                    <Badge className={getStatusColor(contact.status)}>
                      {contact.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-600">{contact.email}</p>
                  {(contact.company || contact.jobTitle) && (
                    <p className="text-sm text-slate-500">
                      {contact.jobTitle && contact.company 
                        ? `${contact.jobTitle} at ${contact.company}`
                        : contact.jobTitle || contact.company
                      }
                    </p>
                  )}
                </div>
              </div>
              
              <div className="flex items-center space-x-4">
                <div className="text-right">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-slate-600">Score:</span>
                    <span className={`text-sm font-semibold ${getScoreColor(contact.score)}`}>
                      {contact.score}/100
                    </span>
                  </div>
                  {contact.tags && contact.tags.length > 0 && (
                    <div className="flex items-center space-x-1 mt-1">
                      {contact.tags.slice(0, 2).map((tag, index) => (
                        <Badge key={index} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                      {contact.tags.length > 2 && (
                        <Badge variant="outline" className="text-xs">
                          +{contact.tags.length - 2}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="text-right text-xs text-slate-500">
                  <p>Added {new Date(contact.createdAt).toLocaleDateString()}</p>
                  {contact.lastContactedAt && (
                    <p>Last contacted {new Date(contact.lastContactedAt).toLocaleDateString()}</p>
                  )}
                </div>
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <i className="fas fa-ellipsis-v"></i>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem>
                      <i className="fas fa-edit mr-2"></i>
                      Edit Contact
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <i className="fas fa-envelope mr-2"></i>
                      Send Email
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <i className="fas fa-user-tag mr-2"></i>
                      Change Status
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <i className="fas fa-tag mr-2"></i>
                      Manage Tags
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-red-600">
                      <i className="fas fa-trash mr-2"></i>
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
