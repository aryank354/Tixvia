import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, httpAction } from "./_generated/server";
import Razorpay from "razorpay";
import type { Webhook } from "razorpay/dist/types/webhook";
import crypto from "crypto";

// This action creates the payment order for the frontend
export const createOrder = action({
  args: { 
    eventId: v.id("events"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!,
      key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });

    const event = await ctx.runQuery(internal.events.getEvent, { id: args.eventId });
    if (!event) {
      throw new Error("Event not found");
    }

    const options = {
      amount: event.price * 100, // Amount in paise
      currency: "INR",
      receipt: `receipt_event_${args.eventId}_user_${args.userId}`,
      notes: {
        // IMPORTANT: Pass metadata to the webhook
        userId: args.userId,
        eventId: args.eventId,
      },
    };

    try {
      const order = await razorpay.orders.create(options);
      return order; // Return the full order object to the client
    } catch (error) {
      console.error("Razorpay order creation failed:", error);
      throw new Error("Failed to create payment order.");
    }
  },
});

// This is the webhook handler for receiving payment confirmation
export const fulfillWebhook = httpAction(async (ctx, request) => {
  const signature = request.headers.get("x-razorpay-signature");
  const body = await request.text();

  if (!signature) {
    return new Response("Webhook Error: No signature", { status: 400 });
  }

  // 1. Validate the webhook signature for security
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
    .update(body)
    .digest("hex");

  if (signature !== expectedSignature) {
    return new Response("Webhook Error: Invalid signature", { status: 400 });
  }

  const event = JSON.parse(body) as Webhook;

  // 2. Handle the 'payment.captured' event
  if (event.event === 'payment.captured' && event.payload.payment) {
    const payment = event.payload.payment.entity;
    const orderId = payment.order_id;
    const { userId, eventId } = payment.notes; // Get metadata from notes

    // 3. Fulfill the order using your existing internal mutation
    await ctx.runMutation(internal.tickets.createTicket, {
      orderId: orderId,
      userId,
      eventId,
    });
  }

  return new Response(null, { status: 200 });
});
