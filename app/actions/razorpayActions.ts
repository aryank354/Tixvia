// in app/actions/razorpayActions.ts
"use server";

import Razorpay from "razorpay";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { auth } from "@clerk/nextjs/server";

export async function createRazorpayOrder({ eventId }: { eventId: Id<"events"> }) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const convex = getConvexClient();
  const event = await convex.query(api.events.getById, { eventId });
  if (!event) throw new Error("Event not found");

  const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });

  const options = {
    amount: event.price * 100, // Amount in paise
    currency: "INR", // Or your desired currency
    receipt: `receipt_event_${eventId}_${userId}`,
    notes: {
      // Pass metadata to the webhook
      eventId: eventId,
      userId: userId,
    },
  };

  try {
    const order = await razorpay.orders.create(options);
    return order;
  } catch (error) {
    console.error("Razorpay order creation failed:", error);
    throw new Error("Failed to create payment order.");
  }
}