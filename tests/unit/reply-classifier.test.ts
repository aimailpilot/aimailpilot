/**
 * Tests for server/services/reply-classifier.ts
 * --------------------------------------------------
 * Covers the regression classes documented in CLAUDE.md:
 *   - System/bot/CI senders must classify as auto_reply (caused 11k false positives
 *     when GitHub/Jenkins/etc. emails were tagged as 'positive')
 *   - OOO and auto_reply must be excluded from "Need Reply" via isHumanReply()
 *   - Bounce classifier must keep the 5xx/4xx code parsing accurate
 *   - Unsubscribe intent requires ≥2 patterns OR ≥1 in short message
 *
 * These are pure-function tests — no DB, no network. Zero risk of touching
 * production state.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyReply,
  classifyBounce,
  isHumanReply,
} from '../../server/services/reply-classifier';

describe('classifyReply', () => {
  describe('system/bot/CI senders → auto_reply (regression: 11k false positives)', () => {
    it('GitHub Actions success → auto_reply, not positive', () => {
      const res = classifyReply(
        'Successfully built',
        'Your workflow run completed successfully on main branch. Build passed.',
        'noreply@github.com',
        'GitHub'
      );
      expect(res.replyType).toBe('auto_reply');
    });

    it('Jenkins build email → auto_reply', () => {
      const res = classifyReply(
        'BUILD SUCCESS',
        'Tests passed. Deployment completed.',
        'jenkins@buildmaster.example.com',
        ''
      );
      expect(res.replyType).toBe('auto_reply');
    });

    it('GitLab notification → auto_reply', () => {
      const res = classifyReply(
        'Pipeline #123 succeeded',
        'Successful merge request',
        'notifications@gitlab.com',
        'GitLab'
      );
      expect(res.replyType).toBe('auto_reply');
    });

    it('Slack notification → auto_reply', () => {
      const res = classifyReply(
        'New message',
        'You have a new message',
        'notifications@slack.com',
        'Slack'
      );
      expect(res.replyType).toBe('auto_reply');
    });

    it('generic noreply@ → auto_reply', () => {
      const res = classifyReply(
        'Account update',
        'Your account was updated successfully.',
        'noreply@somecompany.com',
        ''
      );
      expect(res.replyType).toBe('auto_reply');
    });

    it('do-not-reply variant → auto_reply', () => {
      const res = classifyReply(
        'Receipt',
        'Thank you for your purchase',
        'do-not-reply@example.com',
        ''
      );
      expect(res.replyType).toBe('auto_reply');
    });
  });

  describe('out of office', () => {
    it('clear OOO message → ooo', () => {
      const res = classifyReply(
        'Out of office',
        'I am currently out of the office and will return on Monday. For urgent matters please contact my colleague.',
        'jane@example.com',
        'Jane Doe'
      );
      expect(res.replyType).toBe('ooo');
    });
  });

  describe('positive replies', () => {
    it('"sounds great, let\'s schedule" → positive', () => {
      const res = classifyReply(
        'RE: Demo',
        'Sounds great, please send me a calendar invite for next week. I am interested.',
        'priya@customer.com',
        'Priya'
      );
      expect(res.replyType).toBe('positive');
    });
  });

  describe('negative replies', () => {
    it('"not interested" short reply → negative', () => {
      const res = classifyReply(
        'RE: Pitch',
        'Not interested. Please remove me from your list.',
        'kiran@example.com',
        'Kiran'
      );
      // "Not interested" is negative pattern; "remove me from your list" is unsubscribe pattern.
      // Either classification (negative or unsubscribe) is correct user behavior — actionable.
      expect(['negative', 'unsubscribe']).toContain(res.replyType);
    });
  });

  describe('unsubscribe intent', () => {
    it('"please unsubscribe me" short → unsubscribe', () => {
      const res = classifyReply('RE: Newsletter', 'unsubscribe me from this list', 'foo@bar.com', '');
      expect(res.replyType).toBe('unsubscribe');
    });
  });

  describe('default fallback', () => {
    it('no pattern match → general', () => {
      // "Acknowledged" / "noted" / etc. don't match positive/negative/OOO patterns
      const res = classifyReply(
        'Subject',
        'Acknowledged.',
        'curious@example.com',
        ''
      );
      expect(res.replyType).toBe('general');
    });
  });
});

describe('isHumanReply (drives "Need Reply" filter)', () => {
  it('positive is human', () => {
    expect(isHumanReply('positive')).toBe(true);
  });
  it('negative is human', () => {
    expect(isHumanReply('negative')).toBe(true);
  });
  it('general is human', () => {
    expect(isHumanReply('general')).toBe(true);
  });
  it('unsubscribe is human (actionable — admin needs to suppress)', () => {
    expect(isHumanReply('unsubscribe')).toBe(true);
  });
  it('ooo is NOT human (regression: bot OOO messages must be excluded)', () => {
    expect(isHumanReply('ooo')).toBe(false);
  });
  it('auto_reply is NOT human', () => {
    expect(isHumanReply('auto_reply')).toBe(false);
  });
  it('bounce is NOT human', () => {
    expect(isHumanReply('bounce')).toBe(false);
  });
});

describe('classifyBounce', () => {
  it('mailbox full → mailbox_full', () => {
    // Pattern requires the literal phrase "mailbox full|quota|exceeded|over"
    expect(classifyBounce('mailbox quota exceeded')).toBe('mailbox_full');
    expect(classifyBounce('user mailbox full, sender deferred')).toBe('mailbox_full');
  });
  it('blocked / spam → blocked', () => {
    expect(classifyBounce('blocked by recipient policy')).toBe('blocked');
    expect(classifyBounce('rejected as spam')).toBe('blocked');
  });
  it('temporary 4xx → soft', () => {
    expect(classifyBounce('temporary failure 421')).toBe('soft');
  });
  it('plain "user unknown" → hard', () => {
    expect(classifyBounce('user unknown 550')).toBe('hard');
  });
});
