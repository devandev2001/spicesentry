# WhatsApp Auto-Send (10 PM Daily Summary)

This Google Apps Script sends a daily spice purchase summary to WhatsApp at 10 PM IST automatically.

## Setup

1. Go to https://script.google.com
2. Create a new project
3. Paste the code from `Code.gs`
4. Set up a time-driven trigger for `sendDailySummary` at 10 PM IST

## How it works

- Reads today's purchases from your Google Sheet
- Formats a summary message
- Sends it via WhatsApp Business Cloud API to your saved number
- Runs automatically every day at 10 PM — no button clicks needed
