"use server";

import { razorpay } from "@/lib/razorpay";
import { getConvexClient } from "@/lib/convex";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export async function refundEventTicketsWithRazorpay(eventId: Id<"events">) {
  const convex = getConvexClient();
  
  // Get all valid (purchased) tickets for this event
  const tickets = await convex.query(api.tickets.getValidTicketsForEvent, {
    eventId,
  });

  if (tickets.length === 0) {
    // If no tickets were sold, just cancel the event
    await convex.mutation(api.events.cancelEvent, { eventId });
    return { success: true, message: "Event cancelled. No tickets to refund." };
  }

  const results = await Promise.allSettled(
    tickets.map(async (ticket) => {
      try {
        if (!ticket.paymentIntentId) {
          throw new Error(`Payment ID not found for ticket ${ticket._id}`);
        }
        
        // Issue a full refund for the payment
        await razorpay.payments.refund(ticket.paymentIntentId, {});

        // Update the ticket status in Convex to 'refunded'
        await convex.mutation(api.tickets.updateTicketStatus, {
          ticketId: ticket._id,
          status: "refunded",
        });
        
        return { success: true, ticketId: ticket._id };
      } catch (error) {
        console.error(`Failed to refund ticket ${ticket._id}:`, error);
        // Even if refund fails, you might want to log this and handle manually.
        return { success: false, ticketId: ticket._id, error };
      }
    })
  );

  const allSuccessful = results.every(
    (result) => result.status === "fulfilled" && result.value.success
  );

  if (!allSuccessful) {
    // You could implement more robust error handling here, like retries or notifications.
    throw new Error(
      "Some refunds failed. Please check the Razorpay dashboard and server logs."
    );
  }

  // After all refunds are processed successfully, cancel the event in Convex.
  await convex.mutation(api.events.cancelEvent, { eventId });
  return { success: true };
}