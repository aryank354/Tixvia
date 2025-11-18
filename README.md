# 🎟️ Tixvia - Event Ticketing Marketplace

Tixvia is a high-performance, real-time event ticketing platform designed to handle high-concurrency ticket sales (the "Taylor Swift problem"). It utilizes a stateful queue system, serverless backend, and robust payment orchestration to ensure fair ticket allocation and prevent overselling.

## 🚀 Key Features
* **Reactive Inventory:** Ticket availability updates in real-time across all clients without page refreshes.
* **Queue System (Waiting Room):** A serialized FIFO queue with rate limiting and temporary ticket locking (30-minute offers).
* **Stripe Connect Integration:** Marketplace model where the platform takes a fee before routing funds to event organizers.
* **Webhook-Driven Fulfillment:** Secure, idempotent ticket generation resistant to client-side failures.
* **Cron-Based Cleanup:** Automated recycling of expired ticket offers.

---

## 🏗️ System Architecture

### 1. High-Level Design (HLD)
![alt text](images/hld.png)

### 2. Low-Level Design (Queue)
![alt text](<images/Low-Level Design (Queue).png>)



### 3. Payment Flow
![alt text](<images/payment flow.png>)

## 🛠️ Tech Stack
**Frontend:** Next.js 15, React 19, Tailwind, Shadcn  
**Backend:** Convex (Functions, DB, Cron Jobs)  
**Auth:** Clerk  
**Payments:** Stripe Connect  
**Tools:** TypeScript, Zod, Graphviz

## 🗄️ Database Schema

The application uses Convex's relational-style document database.

| Table       | Purpose                  | Key Fields                                                |
|-------------|---------------------------|-----------------------------------------------------------|
| **Events**       | Master inventory record | totalTickets, price, userId (owner), is_cancelled        |
| **WaitingList**  | Queue state machine     | status (waiting/offered/purchased), offerExpiresAt       |
| **Tickets**      | Proof of purchase       | paymentIntentId (idempotency), status (valid/refunded)   |
| **Users**        | Mirror of Clerk data    | stripeConnectId (for payouts)                            |

---

## ⚡ Getting Started

### Prerequisites
- Node.js 18+
- Stripe Account (Test mode)
- Clerk Account
- Convex Account

### Installation

Clone the repository  
```bash
git clone https://github.com/aryank354/tixvia.git
cd tixvia
```

Install dependencies  
```bash
npm install
```

### Environment Setup
Create a `.env.local` file based on `.env.example`:

```
NEXT_PUBLIC_CONVEX_URL=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=...
```

### Start Backend (Convex)
```bash
npx convex dev
```

### Start Frontend
```bash
npm run dev
```

### Stripe Webhook Forwarding (Critical for local dev)
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

---

## 🛡️ Security & Best Practices

- **Rate Limiting:** Users are limited to 3 queue join attempts every 30 minutes to prevent bot spam.  
- **Idempotency:** Stripe webhooks check for an existing `paymentIntentId` before creating tickets to prevent duplicates.  
- **Atomic Mutations:** Queue processing runs inside transactional Convex mutations to maintain integrity.  
- **Secure Payouts:** Sellers must complete Stripe Connect onboarding before creating events.  

---

## 👥 Contributing
Contributions are welcome! Please read the `CONTRIBUTING.md` file for details on our code of conduct and submission process.

## 📄 License
This project is licensed under the **MIT License** — see the LICENSE file for details.
