-- Inspect one post-fix Step 2 message content to verify pixel+wrap are really there
SELECT id, "stepNumber", "sentAt", "trackingId",
       POSITION('/api/track/open/' IN content) as open_pos,
       POSITION('/api/track/click/' IN content) as click_pos,
       POSITION('href=' IN content) as href_pos,
       LENGTH(content) as len,
       SUBSTRING(content FROM GREATEST(1, POSITION('/api/track/open/' IN content) - 20) FOR 200) as open_snippet
FROM messages
WHERE "campaignId" = 'e8f0da45-7d94-4273-aa5d-550ab8dc871c'
  AND "stepNumber" = 1
  AND "sentAt" >= '2026-04-18T03:52:54Z'
ORDER BY "sentAt" DESC
LIMIT 2;

-- How many Step 2 messages have ANY href link at all?
SELECT "stepNumber",
       COUNT(*) as total,
       SUM(CASE WHEN content LIKE '%href=%' THEN 1 ELSE 0 END) as has_any_href,
       SUM(CASE WHEN content LIKE '%href="http%' THEN 1 ELSE 0 END) as has_http_href,
       SUM(CASE WHEN content LIKE '%/api/track/click/%' THEN 1 ELSE 0 END) as has_click_wrap
FROM messages
WHERE "campaignId" = 'e8f0da45-7d94-4273-aa5d-550ab8dc871c'
  AND "stepNumber" IN (0, 1)
  AND "sentAt" >= '2026-04-18T03:52:54Z'
GROUP BY "stepNumber";

-- Tracking events for this campaign: any opens/clicks logged at all?
SELECT type, "stepNumber", COUNT(*) as n
FROM tracking_events
WHERE "campaignId" = 'e8f0da45-7d94-4273-aa5d-550ab8dc871c'
GROUP BY type, "stepNumber"
ORDER BY "stepNumber", type;
