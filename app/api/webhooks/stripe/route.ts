// in app/api/webhooks/razorpay/route.ts
import { headers } from "next/headers";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import crypto from "crypto";
import type { Webhook } from "razorpay/dist/types/webhook";

export async function POST(req: Request) {
  const body = await req.text();
  const headersList = headers();
  const signature = headersList.get("x-razorpay-signature") as string;

  // 1. Validate the webhook signature for security
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
    .update(body)
    .digest("hex");

  if (signature !== expectedSignature) {
    return new Response("Webhook Error: Invalid signature", { status: 400 });
  }

  const convex = getConvexClient();
  const event = JSON.parse(body) as Webhook;

  // 2. Handle the 'payment.captured' event
  if (event.event === 'payment.captured' && event.payload.payment) {
    const payment = event.payload.payment.entity;
    const { eventId, userId } = payment.notes;

    try {
      // 3. Call your Convex mutation to create the ticket
      // NOTE: You will need to create a `purchaseTicketWithRazorpay` mutation in Convex
      // that is similar to your old `purchaseTicket` but adapted for Razorpay's data.
      // For now, we will log that the webhook was successful.
      console.log("Webhook successful. Ready to create ticket for user:", userId, "and event:", eventId);
      
      // Example of what the call would look like:
      /*
      await convex.mutation(api.events.purchaseTicketWithRazorpay, {
        eventId: eventId,
        userId: userId,
        paymentInfo: {
          paymentId: payment.id,
          orderId: payment.order_id,
          amount: payment.amount,
        },
      });
      */

    } catch (error) {
      console.error("Error processing Razorpay webhook in Convex:", error);
      return new Response("Error processing webhook", { status: 500 });
    }
  }

  return new Response(null, { status: 200 });
}