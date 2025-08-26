// app/actions/createRazorpayOrder.ts
"use server";

import { razorpay } from "@/lib/razorpay";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { auth } from "@clerk/nextjs/server";
import crypto from "crypto"; // 👈 Import the crypto module

export async function createRazorpayOrder({ eventId }: { eventId: Id<"events"> }) {
  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const convex = getConvexClient();
  
  try {
    const event = await convex.query(api.events.getById, { eventId });

    if (!event) {
      throw new Error("Event not found");
    }

    // Amount in the smallest currency unit (e.g., paise for INR)
    const amountInPaise = Math.round(event.price * 100);
    
    // ✅ Generate a short, unique receipt ID that is under 40 characters
    const uniqueReceiptId = `rcpt_${crypto.randomBytes(8).toString("hex")}`;

    const options = {
      amount: amountInPaise,
      currency: "INR", // Change to your preferred currency if needed
      receipt: uniqueReceiptId, // ✅ Use the new shorter receipt ID
    };

    const order = await razorpay.orders.create(options);
    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    };
  } catch (error) {
    console.error("Error creating Razorpay order:", error);
    throw new Error("Failed to create Razorpay order");
  }
}