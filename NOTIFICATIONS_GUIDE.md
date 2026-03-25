# VaultProof Notifications & Maintenance Guide

## How Notifications Work

The bell icon in the dashboard fetches `/notifications.json` from Cloudflare Pages.
Users see unread notifications (red dot) until they click "Mark all read".
Read state is stored in `localStorage` per browser.

## Adding a Notification

Edit `apps/site/notifications.json` and add a new entry at the **top** of the array:

```json
[
  {
    "id": "unique-id-here",
    "type": "update",
    "title": "Short title",
    "message": "Longer description of the update.",
    "date": "2026-03-25",
    "link": "/docs"
  }
]
```

### Fields

| Field     | Required | Description                                              |
|-----------|----------|----------------------------------------------------------|
| `id`      | Yes      | Unique string (e.g. `update-002`). Never reuse IDs.      |
| `type`    | Yes      | `update`, `maintenance`, `alert`, or `info`              |
| `title`   | Yes      | Short headline                                           |
| `message` | Yes      | One-line description                                     |
| `date`    | Yes      | Date string (YYYY-MM-DD)                                 |
| `link`    | No       | Optional URL for "Learn more" link                       |

### Types and When to Use

- **update** (indigo) — New features, improvements, releases
- **maintenance** (yellow) — Scheduled downtime, migrations
- **alert** (red) — Urgent issues, security notices
- **info** (cyan) — General announcements, tips

## Deploying a Notification

1. Edit `apps/site/notifications.json`
2. Commit and push to GitHub
3. Cloudflare Pages auto-deploys — notification appears within minutes

## Scheduling Maintenance

Add a maintenance notification **before** the window:

```json
{
  "id": "maint-001",
  "type": "maintenance",
  "title": "Scheduled Maintenance: March 30",
  "message": "API will be briefly unavailable from 2-4am UTC for database upgrades.",
  "date": "2026-03-28",
  "link": null
}
```

After maintenance, replace with an update notification confirming it's done.

## Removing Old Notifications

Delete old entries from the array. Keep the file under ~20 entries for fast loading.
Old IDs stay in users' localStorage (harmless, tiny footprint).
