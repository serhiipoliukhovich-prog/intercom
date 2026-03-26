# iSpeedToLead — Intercom AI Reply Assistant

An AI-powered reply assistant that lives natively in your Intercom Inbox sidebar.
Agents can draft replies, use quick actions, and post drafts as internal notes —
all without leaving the conversation.

---

## How It Works

1. Agent opens a conversation in Intercom Inbox
2. The AI app appears in the right panel (conversation details)
3. Agent selects a quick action or writes a custom instruction
4. Claude generates a draft reply based on the conversation context
5. Agent clicks "Post as internal note" — draft appears in the conversation
6. Agent copies the draft into the reply box, edits if needed, and sends

---

## Setup — 4 Steps

### Step 1 — Deploy the server to Railway (free)

1. Go to [railway.app](https://railway.app) and sign up (free)
2. Click **New Project** → **Deploy from GitHub repo**
   - Or: **New Project** → **Empty project** → drag this folder
3. Railway will auto-detect Node.js and deploy
4. Go to **Variables** and add:
   - `ANTHROPIC_API_KEY` — from console.anthropic.com
   - `INTERCOM_ACCESS_TOKEN` — from Step 2 below
   - `INTERCOM_BOT_ADMIN_ID` — from Step 2 below
5. Copy your Railway app URL (e.g. `https://your-app.railway.app`)

### Step 2 — Create the Intercom App

1. Go to [developers.intercom.com](https://developers.intercom.com) → **Your Apps** → **New App**
2. Name it "AI Reply Assistant", select your workspace
3. Go to **Configure → Canvas Kit**
4. Under **"For teammates"**, check **"Add to conversation details"**
5. Set both endpoints using your Railway URL:
   - **Initialize flow webhook URL**: `https://your-app.railway.app/initialize`
   - **Submit flow webhook URL**: `https://your-app.railway.app/submit`
6. Click **Save**
7. Copy the **Access Token** from **Basic Info** page → paste as `INTERCOM_ACCESS_TOKEN` in Railway

### Step 3 — Find your Bot Admin ID

You need the ID of the admin account that will post internal notes.

Option A — From the Intercom API:
```
GET https://api.intercom.io/me
Authorization: Bearer YOUR_ACCESS_TOKEN
```
The `id` field in the response is your `INTERCOM_BOT_ADMIN_ID`.

Option B — From the Intercom URL:
Open any conversation assigned to your bot/agent. The URL contains the admin ID.

### Step 4 — Pin the App in Intercom Inbox

1. Open any conversation in your Intercom Inbox
2. In the right panel, click **Edit apps** (bottom right)
3. Find "AI Reply Assistant" and click the pin icon
4. The app will now appear in every conversation

---

## Quick Actions Available

| Action | What it generates |
|--------|------------------|
| Lead refund request | Empathetic reply explaining proof optional, 24h / 2-5 day timelines |
| Lead quality concern | Acknowledgement + offer to investigate |
| Duplicate charge | Explains refund-to-card process, next steps |
| Renewal complaint | Explains policy, offers balance/extension/credits |
| Cancellation request | Two cancellation paths with portal link |
| Missing package item | Acknowledges delay, no release date, offers credits |
| Issue resolved | Warm close with CSAT mention |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Claude API key |
| `INTERCOM_ACCESS_TOKEN` | Yes | From Intercom Developer Hub |
| `INTERCOM_BOT_ADMIN_ID` | Yes | Admin ID for posting notes |
| `PORT` | No | Server port (default 3000) |

---

## Cost

- Claude Sonnet 4.6: ~$0.005 per draft generated
- Railway hosting: Free tier covers ~500 hours/month
- At 200 drafts/day: ~$1/day in Claude costs
