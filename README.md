# Tenkara Inbox

A custom shared inbox platform replacing Missive, built for Tenkara Labs / Bobber Labs.

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + Tailwind CSS
- **Hosting**: Vercel
- **Database**: Supabase (PostgreSQL)
- **Email**: Gmail API + Google Pub/Sub
- **Auth**: Google OAuth via NextAuth.js
- **AI**: Claude API (Anthropic) — powers "Kara" assistant
- **Notifications**: Slack webhooks
- **Realtime**: Supabase Realtime subscriptions

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/tenkara/tenkara-inbox.git
cd tenkara-inbox
npm install
```

### 2. Set up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run the contents of `supabase/schema.sql`
3. Copy your project URL and keys

### 3. Set up Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project, enable Gmail API + Pub/Sub API
3. Create OAuth 2.0 credentials (Web application)
4. Set redirect URI to `http://localhost:3000/api/auth/callback/google`

### 4. Configure environment

```bash
cp .env.example .env.local
# Fill in all values in .env.local
```

### 5. Run locally

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

### 6. Deploy to Vercel

1. Push to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add all environment variables
4. Update OAuth redirect URI to your Vercel URL
5. Deploy!

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout + auth provider
│   ├── page.tsx                # Main inbox page
│   ├── login/page.tsx          # Login page
│   └── api/
│       ├── auth/[...nextauth]/ # Google OAuth
│       ├── gmail/
│       │   ├── sync/           # Fetch emails from Gmail
│       │   ├── send/           # Send replies
│       │   └── webhook/        # Pub/Sub push notifications
│       ├── ai/                 # Kara (Claude) assistant
│       ├── slack/notify/       # Slack notifications
│       └── conversations/
│           ├── notes/          # Internal team notes CRUD
│           ├── tasks/          # Task management CRUD
│           ├── assign/         # Conversation assignment
│           └── labels/         # Label management
├── components/
│   ├── AuthProvider.tsx        # NextAuth session wrapper
│   ├── Sidebar.tsx             # Navigation sidebar
│   ├── ConversationList.tsx    # Email list with search
│   ├── ConversationDetail.tsx  # Thread view + notes + tasks
│   └── AISidebar.tsx           # Kara AI assistant panel
├── lib/
│   ├── supabase.ts             # Supabase client (browser + server)
│   ├── gmail.ts                # Gmail API helpers
│   ├── ai.ts                   # Claude API for Kara
│   ├── slack.ts                # Slack notification helpers
│   └── hooks.ts                # React hooks for data + realtime
├── types/
│   └── index.ts                # TypeScript interfaces
└── supabase/
    └── schema.sql              # Database schema + seed data
```

## Team Members (Pre-configured)

| Name       | Role       | Department  |
|------------|------------|-------------|
| Rod        | Admin      | Operations  |
| David Z    | Admin      | Management  |
| Ben S      | Admin      | Management  |
| Mary Grace | Member     | Support     |
| CJ Munko   | Member     | Operations  |
| Ryan Walsh | Member     | Sales       |

## Mailboxes

| Mailbox              | Email                 |
|----------------------|-----------------------|
| Bobber Labs          | bobber@tenkara.ai     |
| General Inquiries    | general@tenkara.ai    |
| Order Confirmations  | orders@tenkara.ai     |
| Purchase Orders      | purchasing@tenkara.ai |
| Shipment Tracking    | shipping@tenkara.ai   |

## Features

- **Shared email** — Team sees all emails across mailboxes
- **Assignment** — Assign conversations to specific team members
- **Internal notes** — Discuss within threads, invisible to customers
- **Tasks** — Create actionable tasks tied to conversations
- **AI triage** — Kara auto-classifies and suggests labels/routing
- **AI drafting** — Ask Kara to draft professional replies
- **Real-time** — See updates instantly when teammates act
- **Slack alerts** — Get notified in Slack for new emails, assignments, tasks
- **Labels** — Inquiry, Call Skillset, Security Cleared, Urgent, Junk Email, Follow Up, New
