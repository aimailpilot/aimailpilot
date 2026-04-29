/**
 * Tests for server/lib/lead-agent-merge.ts
 *
 * Covers:
 *   - normalizeLeads: bad input shapes, dedup, email validation, trimming
 *   - applyApolloEnrichment: fill rules + emailSource tagging
 *   - leadsNeedingEnrichment: filter logic
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeLeads,
  applyApolloEnrichment,
  leadsNeedingEnrichment,
  leadToContactInsert,
  type Lead,
} from '../../server/lib/lead-agent-merge';

describe('normalizeLeads — defensive parsing', () => {
  it('returns empty array for null/undefined/non-objects', () => {
    expect(normalizeLeads(null)).toEqual([]);
    expect(normalizeLeads(undefined)).toEqual([]);
    expect(normalizeLeads('not an object')).toEqual([]);
    expect(normalizeLeads(42 as any)).toEqual([]);
  });

  it('returns empty array when leads is missing or not an array', () => {
    expect(normalizeLeads({})).toEqual([]);
    expect(normalizeLeads({ leads: 'oops' })).toEqual([]);
    expect(normalizeLeads({ leads: { name: 'A', company: 'B' } })).toEqual([]);
  });

  it('drops items missing name or company', () => {
    const r = normalizeLeads({
      leads: [
        { name: 'Alice', company: 'A Co' },
        { name: '', company: 'B Co' },
        { name: 'Bob', company: '' },
        { company: 'C Co' },
        { name: 'D' },
        null,
        'not-an-object',
      ],
    });
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('Alice');
  });

  it('trims whitespace on name + company', () => {
    const r = normalizeLeads({ leads: [{ name: '  Carol  ', company: ' C-Inc ' }] });
    expect(r[0].name).toBe('Carol');
    expect(r[0].company).toBe('C-Inc');
  });

  it('deduplicates by name+company case-insensitively', () => {
    const r = normalizeLeads({
      leads: [
        { name: 'Alice', company: 'Acme' },
        { name: 'alice', company: 'ACME' },
        { name: 'Alice', company: 'Acme' },
        { name: 'Alice', company: 'Different Co' },
      ],
    });
    expect(r).toHaveLength(2);
  });

  it('rejects malformed emails (TBD, n/a, junk)', () => {
    const r = normalizeLeads({
      leads: [
        { name: 'A', company: 'X', email: 'TBD' },
        { name: 'B', company: 'X', email: 'n/a' },
        { name: 'C', company: 'X', email: 'unknown@' },
        { name: 'D', company: 'X', email: '@domain.com' },
        { name: 'E', company: 'X', email: 'real@example.com' },
      ],
    });
    expect(r[0].email).toBeUndefined();
    expect(r[1].email).toBeUndefined();
    expect(r[2].email).toBeUndefined();
    expect(r[3].email).toBeUndefined();
    expect(r[4].email).toBe('real@example.com');
  });

  it('lowercases valid emails', () => {
    const r = normalizeLeads({ leads: [{ name: 'A', company: 'X', email: 'Mixed@Example.COM' }] });
    expect(r[0].email).toBe('mixed@example.com');
  });

  it('tags emailSource=agent when LLM provided a valid email', () => {
    const r = normalizeLeads({ leads: [{ name: 'A', company: 'X', email: 'a@x.com' }] });
    expect(r[0].emailSource).toBe('agent');
  });

  it('leaves emailSource undefined when no email', () => {
    const r = normalizeLeads({ leads: [{ name: 'A', company: 'X' }] });
    expect(r[0].emailSource).toBeUndefined();
  });

  it('preserves all optional fields when present', () => {
    const r = normalizeLeads({
      leads: [{
        name: 'Alice',
        title: 'CEO',
        company: 'Acme',
        companyUrl: 'https://acme.com',
        linkedinUrl: 'https://linkedin.com/in/alice',
        email: 'alice@acme.com',
        location: 'NYC',
        industry: 'SaaS',
        signal: 'Just raised Series B',
        sourceUrl: 'https://techcrunch.com/x',
        outreachHook: 'congrats on the round',
      }],
    });
    expect(r[0].title).toBe('CEO');
    expect(r[0].sourceUrl).toBe('https://techcrunch.com/x');
    expect(r[0].outreachHook).toBe('congrats on the round');
  });
});

describe('applyApolloEnrichment — fill rules', () => {
  const base: Lead = { name: 'Alice', company: 'Acme' };

  it('fills missing email and tags emailSource=apollo', () => {
    const r = applyApolloEnrichment(base, { email: 'alice@acme.com', apolloId: 'apl_1' });
    expect(r.email).toBe('alice@acme.com');
    expect(r.emailSource).toBe('apollo');
    expect(r.apolloId).toBe('apl_1');
  });

  it('does NOT overwrite an existing email — agent wins', () => {
    const lead: Lead = { ...base, email: 'agent@acme.com', emailSource: 'agent' };
    const r = applyApolloEnrichment(lead, { email: 'apollo@acme.com', apolloId: 'apl_1' });
    expect(r.email).toBe('agent@acme.com');
    expect(r.emailSource).toBe('agent');
    expect(r.apolloId).toBe('apl_1'); // apolloId still set even if email wasn't taken
  });

  it('fills missing optional fields (title, linkedinUrl, location)', () => {
    const r = applyApolloEnrichment(base, {
      title: 'CEO',
      linkedinUrl: 'https://linkedin.com/in/alice',
      location: 'NYC',
    });
    expect(r.title).toBe('CEO');
    expect(r.linkedinUrl).toBe('https://linkedin.com/in/alice');
    expect(r.location).toBe('NYC');
  });

  it('does not overwrite already-set optional fields', () => {
    const lead: Lead = { ...base, title: 'Founder', linkedinUrl: 'https://l.in/orig' };
    const r = applyApolloEnrichment(lead, { title: 'CEO', linkedinUrl: 'https://l.in/new' });
    expect(r.title).toBe('Founder');
    expect(r.linkedinUrl).toBe('https://l.in/orig');
  });

  it('does not mutate the input lead', () => {
    const lead: Lead = { ...base };
    const r = applyApolloEnrichment(lead, { email: 'x@y.com' });
    expect(lead.email).toBeUndefined();
    expect(r.email).toBe('x@y.com');
  });
});

describe('leadsNeedingEnrichment', () => {
  it('returns leads without an email', () => {
    const leads: Lead[] = [
      { name: 'A', company: 'X' },
      { name: 'B', company: 'Y', email: 'b@y.com' },
      { name: 'C', company: 'Z' },
    ];
    const r = leadsNeedingEnrichment(leads);
    expect(r).toHaveLength(2);
    expect(r[0].name).toBe('A');
    expect(r[1].name).toBe('C');
  });

  it('returns empty when every lead has an email', () => {
    const leads: Lead[] = [
      { name: 'A', company: 'X', email: 'a@x.com' },
      { name: 'B', company: 'Y', email: 'b@y.com' },
    ];
    expect(leadsNeedingEnrichment(leads)).toEqual([]);
  });
});

describe('leadToContactInsert — maps lead → contacts table shape', () => {
  it('uses LLM-provided firstName/lastName when present', () => {
    const lead: Lead = { name: 'Alice Singh', firstName: 'Alice', lastName: 'Singh', company: 'Acme' };
    const r = leadToContactInsert(lead);
    expect(r.firstName).toBe('Alice');
    expect(r.lastName).toBe('Singh');
  });

  it('splits name when firstName/lastName missing', () => {
    const r = leadToContactInsert({ name: 'Alice Marie Singh', company: 'Acme' });
    expect(r.firstName).toBe('Alice');
    expect(r.lastName).toBe('Marie Singh');
  });

  it('handles single-word name', () => {
    const r = leadToContactInsert({ name: 'Madonna', company: 'Acme' });
    expect(r.firstName).toBe('Madonna');
    expect(r.lastName).toBe('');
  });

  it('puts signal + hook + source on customFields', () => {
    const lead: Lead = {
      name: 'A', company: 'X',
      signal: 'Raised Series B 2026-04-01',
      outreachHook: 'Congrats on the round',
      sourceUrl: 'https://techcrunch.com/article',
    };
    const r = leadToContactInsert(lead, 'funded');
    expect(r.customFields.lead_agent_signal).toBe('Raised Series B 2026-04-01');
    expect(r.customFields.lead_agent_hook).toBe('Congrats on the round');
    expect(r.customFields.lead_agent_source).toBe('https://techcrunch.com/article');
    expect(r.customFields.lead_agent_mode).toBe('funded');
  });

  it('records emailSource (apollo vs agent) on customFields', () => {
    const apolloLead = leadToContactInsert({ name: 'A', company: 'X', email: 'a@x.com', emailSource: 'apollo' });
    expect(apolloLead.customFields.lead_agent_email_source).toBe('apollo');

    const agentLead = leadToContactInsert({ name: 'B', company: 'Y', email: 'b@y.com', emailSource: 'agent' });
    expect(agentLead.customFields.lead_agent_email_source).toBe('agent');
  });

  it('sets source to "lead_agent" for tracking imports', () => {
    expect(leadToContactInsert({ name: 'A', company: 'X' }).source).toBe('lead_agent');
  });

  it('returns null for empty optional fields (so DB inserts NULL not empty string)', () => {
    const r = leadToContactInsert({ name: 'A', company: 'X' });
    expect(r.email).toBeNull();
    expect(r.phone).toBeNull();
    expect(r.jobTitle).toBeNull();
    expect(r.linkedinUrl).toBeNull();
  });

  it('returns empty customFields object when no agent metadata present', () => {
    const r = leadToContactInsert({ name: 'A', company: 'X' });
    expect(r.customFields).toEqual({});
  });

  it('maps title to jobTitle and companyUrl to website', () => {
    const r = leadToContactInsert({
      name: 'A', company: 'Acme', title: 'CEO', companyUrl: 'https://acme.com',
    });
    expect(r.jobTitle).toBe('CEO');
    expect(r.website).toBe('https://acme.com');
  });

  it('passes through phone, location fields, industry, department', () => {
    const r = leadToContactInsert({
      name: 'A', company: 'X',
      phone: '+91-99-1234',
      mobilePhone: '+91-88-5678',
      city: 'Mumbai', state: 'Maharashtra', country: 'India',
      industry: 'SaaS', department: 'Engineering', seniority: 'C-Level',
    });
    expect(r.phone).toBe('+91-99-1234');
    expect(r.mobilePhone).toBe('+91-88-5678');
    expect(r.city).toBe('Mumbai');
    expect(r.state).toBe('Maharashtra');
    expect(r.country).toBe('India');
    expect(r.industry).toBe('SaaS');
    expect(r.department).toBe('Engineering');
    expect(r.seniority).toBe('C-Level');
  });

  it('falls back to "(unknown)" first name when nothing parseable', () => {
    const r = leadToContactInsert({ name: '   ', company: 'X' } as any);
    expect(r.firstName).toBe('(unknown)');
  });
});

describe('normalizeLeads — preserves new contact-mapping fields', () => {
  it('keeps firstName, lastName, phone, mobilePhone, city/state/country, department, seniority', () => {
    const r = normalizeLeads({
      leads: [{
        name: 'Priya Sharma',
        firstName: 'Priya',
        lastName: 'Sharma',
        company: 'BigBank',
        phone: '+91-99-9999',
        mobilePhone: '+91-88-8888',
        city: 'Mumbai',
        state: 'MH',
        country: 'India',
        department: 'Risk',
        seniority: 'Director',
      }],
    });
    expect(r[0].firstName).toBe('Priya');
    expect(r[0].lastName).toBe('Sharma');
    expect(r[0].phone).toBe('+91-99-9999');
    expect(r[0].mobilePhone).toBe('+91-88-8888');
    expect(r[0].city).toBe('Mumbai');
    expect(r[0].country).toBe('India');
    expect(r[0].department).toBe('Risk');
    expect(r[0].seniority).toBe('Director');
  });
});
