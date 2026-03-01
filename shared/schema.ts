import { sql } from "drizzle-orm";
import { 
  pgTable, 
  text, 
  varchar, 
  integer, 
  boolean, 
  timestamp, 
  jsonb, 
  decimal,
  uuid,
  pgEnum,
  index
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const userRoleEnum = pgEnum("user_role", ["admin", "manager", "operator", "viewer"]);
export const campaignStatusEnum = pgEnum("campaign_status", ["draft", "scheduled", "active", "paused", "completed"]);
export const contactStatusEnum = pgEnum("contact_status", ["cold", "warm", "hot", "replied", "unsubscribed"]);
export const emailProviderEnum = pgEnum("email_provider", ["gmail", "outlook", "sendgrid", "elasticemail"]);
export const llmProviderEnum = pgEnum("llm_provider", ["openai", "gemini", "anthropic", "llama"]);
export const followupTriggerEnum = pgEnum("followup_trigger", ["no_reply", "no_open", "no_click", "opened", "clicked", "replied", "bounced", "time_delay"]);
export const followupStatusEnum = pgEnum("followup_status", ["pending", "scheduled", "sent", "skipped", "failed"]);

// Organizations
export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  domain: varchar("domain", { length: 255 }).unique(),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Users
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  firstName: varchar("first_name", { length: 255 }),
  lastName: varchar("last_name", { length: 255 }),
  role: userRoleEnum("role").default("viewer"),
  organizationId: uuid("organization_id").references(() => organizations.id),
  profileImageUrl: varchar("profile_image_url", { length: 500 }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Email Accounts
export const emailAccounts = pgTable("email_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  provider: emailProviderEnum("provider").notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }),
  
  // OAuth tokens (stored encrypted)
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  scope: text("scope"), // OAuth scopes granted
  
  credentials: jsonb("credentials").notNull(),
  dailyLimit: integer("daily_limit").default(1000),
  dailySent: integer("daily_sent").default(0),
  isActive: boolean("is_active").default(true),
  isVerified: boolean("is_verified").default(false),
  lastUsed: timestamp("last_used"),
  lastSyncAt: timestamp("last_sync_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// LLM Configurations
export const llmConfigurations = pgTable("llm_configurations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  provider: llmProviderEnum("provider").notNull(),
  apiKey: text("api_key").notNull(),
  model: varchar("model", { length: 255 }).notNull(),
  isPrimary: boolean("is_primary").default(false),
  settings: jsonb("settings").default({}),
  monthlyCost: decimal("monthly_cost", { precision: 10, scale: 2 }).default('0'),
  monthlyLimit: decimal("monthly_limit", { precision: 10, scale: 2 }).default('1000'),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Contacts
export const contacts = pgTable("contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  email: varchar("email", { length: 255 }).notNull(),
  firstName: varchar("first_name", { length: 255 }),
  lastName: varchar("last_name", { length: 255 }),
  company: varchar("company", { length: 255 }),
  jobTitle: varchar("job_title", { length: 255 }),
  linkedinUrl: varchar("linkedin_url", { length: 500 }),
  phoneNumber: varchar("phone_number", { length: 50 }),
  status: contactStatusEnum("status").default("cold"),
  score: integer("score").default(0),
  tags: text("tags").array(),
  customFields: jsonb("custom_fields").default({}),
  lastContactedAt: timestamp("last_contacted_at"),
  source: varchar("source", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  emailIdx: index("contacts_email_idx").on(table.email),
  orgIdx: index("contacts_org_idx").on(table.organizationId),
}));

// Contact Segments
export const contactSegments = pgTable("contact_segments", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  filters: jsonb("filters").notNull(),
  contactCount: integer("contact_count").default(0),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Email Templates
export const emailTemplates = pgTable("email_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }),
  subject: varchar("subject", { length: 500 }).notNull(),
  content: text("content").notNull(),
  variables: text("variables").array(),
  isPublic: boolean("is_public").default(false),
  usageCount: integer("usage_count").default(0),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Campaigns
export const campaigns = pgTable("campaigns", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  status: campaignStatusEnum("status").default("draft"),
  templateId: uuid("template_id").references(() => emailTemplates.id),
  segmentId: uuid("segment_id").references(() => contactSegments.id),
  emailAccountId: uuid("email_account_id").references(() => emailAccounts.id),
  llmConfigId: uuid("llm_config_id").references(() => llmConfigurations.id),
  scheduledAt: timestamp("scheduled_at"),
  
  // Advanced Scheduling Features
  startTime: varchar("start_time", { length: 5 }), // HH:MM format
  endTime: varchar("end_time", { length: 5 }), // HH:MM format
  timeZone: varchar("time_zone", { length: 50 }).default("UTC"),
  sendDays: text("send_days").array().default(sql`'{"monday","tuesday","wednesday","thursday","friday"}'::text[]`),
  emailDelaySeconds: integer("email_delay_seconds").default(30), // Delay between emails
  maxEmailsPerHour: integer("max_emails_per_hour").default(100),
  
  settings: jsonb("settings").default({}),
  totalRecipients: integer("total_recipients").default(0),
  sentCount: integer("sent_count").default(0),
  openedCount: integer("opened_count").default(0),
  clickedCount: integer("clicked_count").default(0),
  repliedCount: integer("replied_count").default(0),
  bouncedCount: integer("bounced_count").default(0),
  unsubscribedCount: integer("unsubscribed_count").default(0),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => ({
  statusIdx: index("campaigns_status_idx").on(table.status),
  orgIdx: index("campaigns_org_idx").on(table.organizationId),
}));

// Campaign Messages
export const campaignMessages = pgTable("campaign_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  subject: varchar("subject", { length: 500 }).notNull(),
  content: text("content").notNull(),
  personalizedContent: text("personalized_content"),
  status: varchar("status", { length: 50 }).default("pending"),
  sentAt: timestamp("sent_at"),
  openedAt: timestamp("opened_at"),
  clickedAt: timestamp("clicked_at"),
  repliedAt: timestamp("replied_at"),
  bouncedAt: timestamp("bounced_at"),
  errorMessage: text("error_message"),
  trackingId: varchar("tracking_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  campaignIdx: index("campaign_messages_campaign_idx").on(table.campaignId),
  statusIdx: index("campaign_messages_status_idx").on(table.status),
}));

// Follow-up Sequences
export const followupSequences = pgTable("followup_sequences", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Follow-up Steps  
export const followupSteps = pgTable("followup_steps", {
  id: uuid("id").defaultRandom().primaryKey(),
  sequenceId: uuid("sequence_id").references(() => followupSequences.id),
  stepNumber: integer("step_number").notNull(),
  trigger: followupTriggerEnum("trigger").notNull(),
  delayDays: integer("delay_days").default(1),
  delayHours: integer("delay_hours").default(0),
  templateId: uuid("template_id").references(() => emailTemplates.id),
  subject: varchar("subject", { length: 500 }),
  content: text("content"),
  conditions: jsonb("conditions").default({}), // Additional trigger conditions
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  sequenceStepIdx: index("followup_steps_sequence_step_idx").on(table.sequenceId, table.stepNumber),
}));

// Campaign Follow-up Assignments
export const campaignFollowups = pgTable("campaign_followups", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignId: uuid("campaign_id").references(() => campaigns.id),
  sequenceId: uuid("sequence_id").references(() => followupSequences.id),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  campaignSequenceIdx: index("campaign_followups_campaign_sequence_idx").on(table.campaignId, table.sequenceId),
}));

// Follow-up Executions (tracks individual follow-up sends)
export const followupExecutions = pgTable("followup_executions", {
  id: uuid("id").defaultRandom().primaryKey(),
  campaignMessageId: uuid("campaign_message_id").references(() => campaignMessages.id),
  stepId: uuid("step_id").references(() => followupSteps.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  status: followupStatusEnum("status").default("pending"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  sentAt: timestamp("sent_at"),
  subject: varchar("subject", { length: 500 }),
  content: text("content"),
  errorMessage: text("error_message"),
  triggerData: jsonb("trigger_data").default({}),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  statusScheduledIdx: index("followup_executions_status_scheduled_idx").on(table.status, table.scheduledAt),
  contactStepIdx: index("followup_executions_contact_step_idx").on(table.contactId, table.stepId),
}));

// Integrations
export const integrations = pgTable("integrations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").references(() => organizations.id),
  type: varchar("type", { length: 100 }).notNull(), // apollo, zoominfo, linkedin, whatsapp
  name: varchar("name", { length: 255 }).notNull(),
  credentials: jsonb("credentials").notNull(),
  settings: jsonb("settings").default({}),
  isActive: boolean("is_active").default(true),
  lastSyncAt: timestamp("last_sync_at"),
  syncCount: integer("sync_count").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Relations
export const organizationRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  emailAccounts: many(emailAccounts),
  llmConfigurations: many(llmConfigurations),
  contacts: many(contacts),
  segments: many(contactSegments),
  templates: many(emailTemplates),
  campaigns: many(campaigns),
  integrations: many(integrations),
  followupSequences: many(followupSequences),
}));

export const userRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  createdSegments: many(contactSegments),
  createdTemplates: many(emailTemplates),
  createdCampaigns: many(campaigns),
}));

export const campaignRelations = relations(campaigns, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [campaigns.organizationId],
    references: [organizations.id],
  }),
  template: one(emailTemplates, {
    fields: [campaigns.templateId],
    references: [emailTemplates.id],
  }),
  segment: one(contactSegments, {
    fields: [campaigns.segmentId],
    references: [contactSegments.id],
  }),
  emailAccount: one(emailAccounts, {
    fields: [campaigns.emailAccountId],
    references: [emailAccounts.id],
  }),
  llmConfig: one(llmConfigurations, {
    fields: [campaigns.llmConfigId],
    references: [llmConfigurations.id],
  }),
  createdBy: one(users, {
    fields: [campaigns.createdBy],
    references: [users.id],
  }),
  messages: many(campaignMessages),
  followups: many(campaignFollowups),
}));

export const contactRelations = relations(contacts, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [contacts.organizationId],
    references: [organizations.id],
  }),
  messages: many(campaignMessages),
  followupExecutions: many(followupExecutions),
}));

// Follow-up Relations
export const followupSequenceRelations = relations(followupSequences, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [followupSequences.organizationId],
    references: [organizations.id],
  }),
  createdBy: one(users, {
    fields: [followupSequences.createdBy],
    references: [users.id],
  }),
  steps: many(followupSteps),
  campaignAssignments: many(campaignFollowups),
}));

export const followupStepRelations = relations(followupSteps, ({ one, many }) => ({
  sequence: one(followupSequences, {
    fields: [followupSteps.sequenceId],
    references: [followupSequences.id],
  }),
  template: one(emailTemplates, {
    fields: [followupSteps.templateId],
    references: [emailTemplates.id],
  }),
  executions: many(followupExecutions),
}));

export const campaignFollowupRelations = relations(campaignFollowups, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignFollowups.campaignId],
    references: [campaigns.id],
  }),
  sequence: one(followupSequences, {
    fields: [campaignFollowups.sequenceId],
    references: [followupSequences.id],
  }),
}));

export const followupExecutionRelations = relations(followupExecutions, ({ one }) => ({
  campaignMessage: one(campaignMessages, {
    fields: [followupExecutions.campaignMessageId],
    references: [campaignMessages.id],
  }),
  step: one(followupSteps, {
    fields: [followupExecutions.stepId],
    references: [followupSteps.id],
  }),
  contact: one(contacts, {
    fields: [followupExecutions.contactId],
    references: [contacts.id],
  }),
}));

export const campaignMessageRelations = relations(campaignMessages, ({ one, many }) => ({
  campaign: one(campaigns, {
    fields: [campaignMessages.campaignId],
    references: [campaigns.id],
  }),
  contact: one(contacts, {
    fields: [campaignMessages.contactId],
    references: [contacts.id],
  }),
  followupExecutions: many(followupExecutions),
}));

// Insert schemas
export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertEmailAccountSchema = createInsertSchema(emailAccounts).omit({ id: true, createdAt: true });
export const insertLlmConfigurationSchema = createInsertSchema(llmConfigurations).omit({ id: true, createdAt: true });
export const insertContactSchema = createInsertSchema(contacts).omit({ id: true, createdAt: true, updatedAt: true });
export const insertContactSegmentSchema = createInsertSchema(contactSegments).omit({ id: true, createdAt: true, updatedAt: true });
export const insertEmailTemplateSchema = createInsertSchema(emailTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCampaignSchema = createInsertSchema(campaigns).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCampaignMessageSchema = createInsertSchema(campaignMessages).omit({ id: true, createdAt: true });
export const insertIntegrationSchema = createInsertSchema(integrations).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFollowupSequenceSchema = createInsertSchema(followupSequences).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFollowupStepSchema = createInsertSchema(followupSteps).omit({ id: true, createdAt: true });
export const insertCampaignFollowupSchema = createInsertSchema(campaignFollowups).omit({ id: true, createdAt: true });
export const insertFollowupExecutionSchema = createInsertSchema(followupExecutions).omit({ id: true, createdAt: true });

// Types
export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type EmailAccount = typeof emailAccounts.$inferSelect;
export type LlmConfiguration = typeof llmConfigurations.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type ContactSegment = typeof contactSegments.$inferSelect;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type CampaignMessage = typeof campaignMessages.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type FollowupSequence = typeof followupSequences.$inferSelect;
export type FollowupStep = typeof followupSteps.$inferSelect;
export type CampaignFollowup = typeof campaignFollowups.$inferSelect;
export type FollowupExecution = typeof followupExecutions.$inferSelect;

export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertEmailAccount = z.infer<typeof insertEmailAccountSchema>;
export type InsertLlmConfiguration = z.infer<typeof insertLlmConfigurationSchema>;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type InsertContactSegment = z.infer<typeof insertContactSegmentSchema>;
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type InsertCampaignMessage = z.infer<typeof insertCampaignMessageSchema>;
export type InsertIntegration = z.infer<typeof insertIntegrationSchema>;
export type InsertFollowupSequence = z.infer<typeof insertFollowupSequenceSchema>;
export type InsertFollowupStep = z.infer<typeof insertFollowupStepSchema>;
export type InsertCampaignFollowup = z.infer<typeof insertCampaignFollowupSchema>;
export type InsertFollowupExecution = z.infer<typeof insertFollowupExecutionSchema>;
