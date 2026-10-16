# WOW Quick Bites — API contracts (frontend ↔ backend)

Status: **integrated against the OpenAPI contract** · Owner: frontend team · Audience: frontend and backend teams

`WOW Quick Bites API.yaml` is the source of truth for endpoint paths and payloads. This document retains
contract details and historical examples; the runtime UI now reads business data from the backend instead of
the former fixture arrays. The local audit covers all 66 method/path operations across 53 paths with a client
wrapper or a server-side call.
The production frontend build passes, but the deployed backend has not yet been smoke-tested from the UI.

Questions marked **❓** are historical contract questions and should be reconfirmed before treating them as blockers.

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Base URL | `/api/v1` (e.g. `https://api.wowquickbites.rw/api/v1`) |
| Format | JSON, `camelCase` keys, UTF-8 |
| Dates | ISO 8601 **with offset**, Kigali time: `"2026-10-06T12:18:00+02:00"` |
| Money | Integers in **RWF**, no decimals: `6000` (UI shows `RWF 6,000`) |
| Bilingual text | Content objects carry both languages: `{ "en": "Burger", "fr": "Burger" }` (type `Localized`). UI strings are **not** sent by the API. |
| IDs | Strings. Menu items use a URL slug (`"wow-toasted-burger"`); orders `"ORD-1042"`; client codes `"WQB001A"` |
| Auth | Session cookie (see §2). Every non-public endpoint returns `401` without a valid session, `403` when the role/permission is missing. |
| Lists | `{ "items": [...], "nextCursor": "…" \| null }` when paginated; plain arrays otherwise (noted per endpoint). |
| Errors | See §11. |

**Client code vs order ID** — a client code (`WQB001A`) is permanent and identifies a *person* across all
purchases; an order ID (`ORD-1042`) identifies *one purchase*. The UI groups orders by client code.

### Shared types

```ts
type Localized = { en: string; fr: string };
type Role = "client" | "manager" | "superadmin";
type OrderStage = "new" | "accepted" | "preparing" | "ready" | "completed" | "cancelled";
type PaymentMethod = "pay-on-pickup" | "mtn-momo" | "airtel-money";
type PaymentStatus = "pending" | "paid" | "not-charged";
type Fulfilment = "pickup" | "delivery";
```

---

## 2. Authentication & session

Replaces: `lib/auth/directory.ts` (`authenticate`, `register`). The frontend keeps its own flow
(Server Actions → session cookie → `proxy.ts` → `lib/auth/dal.ts`), so two integration options exist:

- **Option A (recommended)** — the backend issues the session cookie itself (HttpOnly, Secure, SameSite=Lax,
  same parent domain). The frontend forwards it and calls `GET /auth/me` to know the viewer.
- **Option B** — the backend only validates credentials and returns the user; the frontend signs its own JWT
  (current behaviour, `SESSION_SECRET`).



### `POST /auth/sign-in` — public
```json
// request
{ "email": "eric@wowquickbites.rw", "password": "…" }
// 200
{ "user": SessionUser }
```
Errors: `401 invalid_credentials`, `403 account_suspended`, `429 too_many_attempts`.

### `POST /auth/sign-up` — public (clients only)
```json
// request
{ "name": "Aline", "email": "aline@example.com", "phone": "078 123 4567", "password": "min 6 chars" }
// 202 — nothing is created yet: a 6-digit code is emailed
{ "pendingVerification": true, "email": "aline@example.com" }
```
Errors: `409 email_taken`, `422 validation_failed` (phone: Rwandan mobile, `07X XXX XXXX` / `+250 7XX XXX XXX`).

### `POST /auth/verify-email` — public
```json
// request
{ "email": "aline@example.com", "code": "123456" }
// 201 — the account exists from here on, and the session starts
{ "user": SessionUser }
```
The backend **assigns the permanent client code** (`WQB` + 3 digits + letter). Codes are valid 10 minutes, 5 attempts
max. Errors: `400 invalid_code`, `410 code_expired`, `429 too_many_attempts`.

### `POST /auth/verify-email/resend` — public
`{ "email" }` → `202`. At most one code every 30 seconds (`429` otherwise); a new code invalidates the previous one.

Frontend today (mock): `lib/auth/flows.ts` keeps the pending sign-up in a signed HttpOnly cookie and logs the code
in the dev console (also shown on `/verify-email` in development only).

### `POST /auth/sign-out` — any session → `204`

### `GET /auth/me` — any session
```ts
type SessionUser = {
  id: string;            // staff id ("eric") or client code ("WQB001A")
  role: Role;
  name: string;
  email: string;
  phone?: string;
  clientCode?: string;   // clients only
  permissions: Permission[];          // effective permissions, grant included
  contentGrant?: ContentGrant;        // managers with an active grant
};
type Permission =
  | "overview:view" | "orders:process"
  | "menu:edit" | "labels:edit" | "ads:manage" | "content:publish"
  | "managers:manage" | "business:edit";
```
Must reflect **current** state: a suspended manager or an expired grant is refused here even if the session is
still valid (the frontend relies on this).

### Password recovery — public
Replaces the stand-in in `components/account/ForgotPasswordFlow.tsx`.

| Endpoint | Body | Response |
|---|---|---|
| `POST /auth/password/forgot` | `{ "email" }` | `202` always (never reveal whether the email exists) |
| `POST /auth/password/reset` | `{ "token", "password" }` | `204` · `400 invalid_or_expired_token` |

The reset email links to `https://<site>/{lang}/forgot-password?token=…` ❓ confirm the link format.

### Google sign-in
Implemented on the frontend as OAuth 2.0 authorization code + PKCE (`app/api/auth/google/` →
`/api/auth/google/callback` → `/{lang}/finish-sign-in`), configured with `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
(see `.env.example`). The account is matched by Google's **verified** email, or created as a client account.
No phone step after Google sign-in: a missing phone is asked at checkout and can be added on the profile page.

The callback calls `POST /auth/google/` server-to-server with `{ "email", "name" }` and the
`X-Frontend-Secret` header. The backend contract documents `200` for an existing account and `201` for a new
client account; both return `{ "access", "refresh", "user": SessionUser }`. The endpoint refuses staff
accounts and requests without the configured frontend secret (`403`).

### `PATCH /me` — client
`{ "name"?, "phone"? }` → `200 { "user": SessionUser }`. Used by the profile page (`/account/profile`). The email
is the sign-in identity and is not editable there.

---

## 3. Roles & permissions (server must enforce)

| Capability | Superadmin | Manager (default) | Manager + content grant | Client |
|---|---|---|---|---|
| Store overview | ✓ | – | – | – |
| Process orders (accept → complete) | all orders | **assigned** orders | assigned orders | – |
| Edit menu items (`menu:edit`) | ✓ | – | if scope `food`/`drinks` | – |
| NEW labels (`labels:edit`) | ✓ | – | if scope `labels` | – |
| Ads (`ads:manage`) | ✓ | – | if scope `ads` | – |
| Publish content (`content:publish`) | ✓ | – | if scope `publish` | – |
| Managers, grants, business settings | ✓ | – | **never** | – |
| Own orders and notifications | – | – | – | ✓ |

A manager's "assigned" orders = orders whose `managerId` is that manager. Grants are never delegable by a manager.

---

## 4. Catalogue (public)

Replaces: `data/menu.ts`, `data/categories.ts`, `data/product-options.ts`, `data/tags.ts`, `data/promotions.ts`,
`data/contact.ts`. Read at build/request time by Server Components → cacheable (`Cache-Control: public, max-age=60, stale-while-revalidate=600`).

### `GET /menu/items` → `MenuItem[]`
Query: `?group=food|drinks`, `?category=burgers`, `?includeUnavailable=true` (staff only).
```ts
type MenuItem = {
  id: string;                 // slug, also the product URL /menu/[id]
  name: Localized;
  description: Localized;
  cartMeta?: Localized;       // "Beef · Cheese · Toasted bun"
  price: number;              // RWF
  image: string;              // absolute URL (CDN)
  group: "food" | "drinks";
  section?: "smoothies" | "milkshakes" | "ice-cream" | "mojitos" | "spiced-tea"; // drinks only
  categories: CategoryId[];   // "burgers" | "pizza" | "desserts" | "drinks" | "chips" | "chicken"
  tags: string[];             // keys of GET /menu/tags
  isNew?: boolean;
  available: boolean;         // false = shown greyed, cannot be ordered
  optionGroups?: string[];    // ids of GET /menu/option-groups
  pairsWith?: string;         // menu item id suggested on the product page
};
```

### `GET /menu/items/{id}` → `MenuItem` · `404`

### `GET /menu/categories` → `{ id, name: Localized, icon }[]`
### `GET /menu/drink-sections` → `{ id, name: Localized, note?: Localized }[]`
### `GET /menu/tags` → `Record<string, Localized>`

### `GET /menu/option-groups` → `Record<string, OptionGroup>`
```ts
type OptionGroup = {
  id: string; name: Localized; hint?: Localized;
  kind: "add" | "remove";     // add = paid extras, remove = "leave out"
  required: boolean; max?: number;
  choices: { id: string; name: Localized; price: number }[];
};
```

### `GET /promotions` → `Promotion[]` (homepage offers currently **published**)
```ts
type Promotion = {
  id: string; kicker: Localized; title: Localized; text: Localized; cta: Localized;
  image: string; href: string;
  highlight?: { label: Localized; value: Localized; labelFirst: boolean };
  tone: "yellow" | "plain";
};
```

### `GET /business` → business & contact info (footer, contact page, portal settings)
```ts
{ name: Localized; owner: string; location: Localized; hours: Localized; email: string; phone: string;
  socials: { label: string; href: string }[] }
```

---

## 5. Cart & checkout

Replaces: `lib/cart/cart.ts`, `lib/orders.ts` (`placeOrder`).

❓ Should the cart live on the server? The UI works with a local cart (guests keep it until they sign in). A
server cart is only needed for cross-device carts; if so: `GET/PUT /cart` with the `CartLine[]` below.

```ts
type CartLine = { itemId: string; quantity: number; choices: string[]; note?: string };
```

### `POST /orders` — client **or guest** (no session)
Guests ("Continue without signing in" at checkout) give only `contact.name` and `contact.phone`; their order has
no client code and carries `"guest": true`. Staff see both kinds in the queue (filter + "Guest" badge); guest
orders are grouped by phone number.
```json
// request
{
  "lines": [{ "itemId": "wow-toasted-burger", "quantity": 1, "choices": ["extra-cheese"], "note": "no onions" }],
  "fulfilment": "pickup",
  "address": null,
  "payment": "pay-on-pickup",
  "contact": { "name": "Aline", "phone": "078 123 4567", "email": "aline@example.com" },
  "notes": "optional"
}
// 201
{ "order": Order }
```
**The server recomputes all prices** from the current menu (never trust client totals) and returns `subtotal`,
`fees`, `total`. Errors: `409 item_unavailable` (with `itemIds`), `422 validation_failed`.

❓ Mobile Money (MTN MoMo / Airtel Money): payment initiation + webhook flow and the states to show while
waiting (`paymentStatus: "pending"` until confirmed?). Manually verified by the admin then changes the status?

---

## 6. Orders

Replaces: `data/orders.ts`, `lib/portal/store.ts` (`useOrders`, `moveOrder`).

```ts
type Order = {
  id: string;                    // "ORD-1042"
  clientCode: string;            // "WQB001A" — empty for guest orders
  guest?: boolean;               // ordered without an account
  contact?: { name: string; phone: string }; // given at checkout (always for guests)
  clientName: string;
  managerId: string;             // staff id in charge
  placedAt: string;
  fulfilment: Fulfilment;
  address?: string;
  payment: PaymentMethod;
  paymentStatus: PaymentStatus;
  stage: OrderStage;
  lines: {
    itemId: string; quantity: number; choices: string[]; note?: string;
    name: Localized;             // snapshot at order time
    unitPrice: number;           // snapshot: historical totals never change with menu prices
    total: number;
  }[];
  subtotal: number; fees: number; total: number;
  history: Partial<Record<OrderStage, string>>;  // when each stage was reached
};
```
> The current mock computes line prices from the live menu; the real API must **snapshot** names and prices.

### Client
| Endpoint | Response |
|---|---|
| `GET /me/orders?status=active\|completed\|cancelled&q=ORD-10` | `Order[]` newest first (own orders only) |
| `GET /me/orders/{id}` | `Order` · `404` if not the caller's (same 404 whether it exists or not) |

### Staff
| Endpoint | Who | Notes |
|---|---|---|
| `GET /orders?since=ISO&stage=…&managerId=…&q=…` | manager, superadmin | Register queue. `q` matches order id, client code or name. Default `since` = 3 days ago. |
| `GET /orders/{id}` | manager, superadmin | |
| `POST /orders/{id}/transition` | assigned manager, superadmin | Body `{ "to": OrderStage }` → `200 { order }` |

Allowed transitions (server-enforced, otherwise `409 invalid_transition`):

```
new → accepted → preparing → ready → completed
new | accepted → cancelled
```
- `completed` sets `paymentStatus: "paid"` (pay on pickup); `cancelled` sets `"not-charged"`.
- Each transition **creates a client notification** (§8) and an **audit event** (§10).
- `403 not_assigned` when a manager acts on another manager's order.

### Live updates
❓ The queue and client tracking should update without reload. Proposal: Server-Sent Events
`GET /events` (per session) emitting `order.updated`, `notification.created`. WebSocket is fine too.

---

## 7. Messaging

Chat and internal messaging are not part of the current frontend scope. No client or staff messaging
endpoints are required for the portal. We removed them.

---

## 8. Client notifications

Replaces: `data/notifications.ts`, `lib/portal/store.ts` (`useNotifications`, `markNotificationsRead`).

```ts
type ClientNotification = {
  id: string; clientCode: string; orderId: string; stage: OrderStage;
  title: Localized; text: Localized;   // generated server side in both languages
  at: string; read: boolean;
};
```
| Endpoint | Response |
|---|---|
| `GET /me/notifications?unread=true` | `ClientNotification[]` newest first |
| `POST /me/notifications/read` `{ ids: string[] }` or `{ all: true }` | `204` |

Wording per stage is in `i18n/dictionaries/*/client-area.ts → notifications.templates` (reuse it).
❓ Also send SMS / push for `ready`?

---

## 9. Content management (Menu & Ads)

Replaces: `lib/portal/content-store.ts`. Permissions in §3.

### Menu items
| Endpoint | Permission | Body / response |
|---|---|---|
| `POST /admin/menu/items` | `menu:edit` | `MenuItemInput` → `201 MenuItem` (state `draft`) |
| `PATCH /admin/menu/items/{id}` | `menu:edit` (+ `labels:edit` to change `isNew`) | partial `MenuItemInput` → saves a **draft** |
| `POST /admin/menu/items/{id}/publish` | `content:publish` | `200 MenuItem` — applies photo, price, availability and badge together |
| `GET /admin/menu/items` | `menu:edit` | `(MenuItem & { state: "draft" \| "published", draft?: MenuItemInput })[]` |

```ts
type MenuItemInput = Pick<MenuItem,
  "name" | "description" | "price" | "group" | "section" | "categories" | "tags" | "isNew" | "available"> & { imageId?: string };
```
Price changes never alter past orders (snapshots, §6).

### Uploads
`POST /admin/uploads` (multipart, `file`) → `{ imageId, url }`. ❓ Max size / formats (proposal: 5 MB, JPEG/PNG/WebP, server resizes).

### Campaigns (homepage ads)
```ts
type Campaign = {
  id: string;
  status: "draft" | "scheduled" | "published" | "paused";
  tag: "promotion" | "new" | "offer";
  placement: "home-offers" | "home-hero";
  title: Localized; text: Localized; cta: Localized;
  ctaCategory: CategoryId | null;   // null = whole menu
  imageId: string; image: string;
  startsAt?: string; endsAt?: string;
  schedule?: Localized;             // short line, e.g. "Weekdays"
};
```
| Endpoint | Permission |
|---|---|
| `GET /admin/campaigns` | `ads:manage` |
| `POST /admin/campaigns` · `PATCH /admin/campaigns/{id}` · `DELETE /admin/campaigns/{id}` (drafts only) | `ads:manage` |
| `POST /admin/campaigns/{id}/publish` (→ `scheduled` if `startsAt` is in the future) | `content:publish` |
| `POST /admin/campaigns/{id}/pause` · `/resume` · `/cancel-schedule` | `ads:manage` |

`GET /promotions` (§4) returns only campaigns that are `published` and inside their date window.

### Business settings
`PUT /admin/business` (`business:edit`) — body = `GET /business` shape.

---

## 10. Staff administration (superadmin only)

Replaces: `data/staff.ts`, `lib/portal/staff-store.ts`.

```ts
type StaffMember = {
  id: string; name: string; email: string;
  role: "manager" | "superadmin";
  assignment: "pickup-register" | "backup" | "none";
  duty: "on" | "off";
  status: "active" | "suspended" | "invited";
  contentGrant?: ContentGrant;
  activeOrders: number;        // for the directory "Orders" column
};
type ContentGrant = {
  grantedBy: string;
  scopes: ("food" | "drinks" | "labels" | "ads" | "publish")[];
  startsAt: string;
  expiresAt?: string;          // absent = until revoked
};
```

| Endpoint | Body | Notes |
|---|---|---|
| `GET /admin/managers?status=&q=` | | `StaffMember[]` |
| `PATCH /admin/managers/{id}` | `{ name?, duty?, assignment? }` | |
| `POST /admin/managers/{id}/suspend` | | also removes assignment and grant; ❓ what happens to its active orders (block or reassign?) |
| `POST /admin/managers/{id}/reactivate` | | |
| `PUT /admin/managers/{id}/grant` | `ContentGrant` without `grantedBy` | takes effect immediately for the manager's next request |
| `DELETE /admin/managers/{id}/grant` | | |
| `POST /admin/invitations` | `{ name, email, assignment }` | sends the invitation email; default access = orders + chat only. ❓ invitation acceptance flow / link |

### Overview
`GET /admin/overview` (superadmin) — or the frontend computes it from `GET /orders` + `GET /admin/managers`:
```ts
{ orders: number; ordersToday: number; active: Record<OrderStage, number>;
  completedValue: number; managers: { active: number; total: number; onDuty: number; offDuty: number; suspended: number } }
```

### Audit
Replaces `data/audit.ts`. Every order transition, content change and access change is recorded.
```ts
type AuditEvent = {
  id: string; at: string;
  actorId: string;                 // staff id or "system"
  scope: "orders" | "content" | "access";
  targetId?: string;               // person affected (access events)
  type: string;                    // e.g. "order.transition", "grant.created", "menu.published"
  data: Record<string, unknown>;   // e.g. { orderId, to: "preparing", clientCode }
  text: Localized;                 // ready-to-display sentence (or the frontend formats from type + data ❓)
};
```
`GET /admin/audit?scope=&limit=20&cursor=` (superadmin; managers ❓ none for now).

---

## 11. Errors

```json
{ "error": { "code": "invalid_transition", "message": "Human-readable (English) for logs", "details": {} } }
```
| Status | When | `code` examples |
|---|---|---|
| 400 | malformed request | `bad_request` |
| 401 | no / expired session | `unauthenticated` |
| 403 | role or permission missing | `forbidden`, `not_assigned`, `account_suspended` |
| 404 | not found **or not yours** | `not_found` |
| 409 | state conflict | `invalid_transition`, `email_taken`, `item_unavailable` |
| 422 | validation | `validation_failed` + `details: { field: "reason" }` |
| 429 | rate limit (sign-in, sign-up) | `too_many_attempts` |

The UI translates `code` (EN/FR), so codes must be stable; `message` is not shown to users.

---

## 12. Non-functional

- **CORS / cookies**: if API and site are on different subdomains, cookie `Domain=.wowquickbites.rw`, CORS with credentials for the site origin only.
- **Security**: CSRF protection on cookie-authenticated mutations (SameSite=Lax + origin check or token), password hashing (argon2/bcrypt/scrypt), rate limiting on auth.
- **Time zone**: store UTC, return with `+02:00`; "today" in the register = Kigali calendar day.
- **Performance**: catalogue endpoints cacheable; list endpoints < 300 ms p95; images served from a CDN with width variants (the site uses `next/image`, so absolute URLs on an allowed host ❓ give us the host).
- **Environments**: provide a staging URL and test accounts so auth and role-specific flows can be verified.

---

## 13. Frontend integration coverage

| API area | Covered operations | Integration |
|---|---|
| Auth | Sign-in/up, verification, sign-out, current user, password change/recovery/reset, refresh, invitation acceptance, Google sign-in | RTK Query, server actions, DAL and OAuth callback |
| Customer | Profile read/update, notifications/read, order list/detail | RTK Query and server actions |
| Catalogue | Business, menu bundle/items/detail/categories/drink sections/options/tags, promotions | RTK Query; storefront and contact surfaces |
| Orders | List/create/detail, assignment, payment update, transitions | RTK Query; checkout and staff queue |
| Admin content | Overview, audit, business GET/PUT/PATCH, menu CRUD/draft/publish/restore/upload, campaign CRUD and lifecycle actions | RTK Query; admin screens |
| Admin access | Invitations, managers list/detail/update, grants, suspend/reactivate/resend | RTK Query; manager workspace |

The order-assignment operation is exposed in the superadmin queue. Non-interactive operations such as refresh
and Google OAuth are deliberately performed in the shared base query or server callback rather than in a
browser component. Build success verifies compilation, not the availability or behavior of the deployed API.
