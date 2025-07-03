// convex/tickets.ts
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getUserTicketForEvent = query({
  args: {
    eventId: v.id("events"),
    userId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("tickets"),
      _creationTime: v.number(),
      eventId: v.id("events"),
      userId: v.string(),
      purchasedAt: v.number(),
      status: v.string(),
      paymentIntentId: v.optional(v.string()),  // ✅ Made optional
      amount: v.optional(v.number()),           // ✅ Made optional
    })
  ),
  handler: async (ctx, { eventId, userId }) => {
    return await ctx.db
      .query("tickets")
      .withIndex("by_user_event", (q) =>
        q.eq("userId", userId).eq("eventId", eventId)
      )
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "valid"),
          q.eq(q.field("status"), "used")
        )
      )
      .first();
  },
});

export const getTicketWithDetails = query({
  args: { ticketId: v.id("tickets") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("tickets"),
      _creationTime: v.number(),
      eventId: v.id("events"),
      userId: v.string(),
      purchasedAt: v.number(),
      status: v.string(),
      paymentIntentId: v.optional(v.string()),  // ✅ Made optional
      amount: v.optional(v.number()),           // ✅ Made optional
      event: v.union(
        v.null(),
        v.object({
          _id: v.id("events"),
          _creationTime: v.number(),
          name: v.string(),
          description: v.string(),
          location: v.string(),
          eventDate: v.number(),
          price: v.number(),
          totalTickets: v.number(),
          userId: v.string(),
          is_cancelled: v.optional(v.boolean()),
          imageStorageId: v.optional(v.id("_storage")),
        })
      ),
    })
  ),
  handler: async (ctx, { ticketId }) => {
    const ticket = await ctx.db.get(ticketId);
    if (!ticket) return null;

    const event = await ctx.db.get(ticket.eventId);
    return { ...ticket, event };
  },
});

export const getValidTicketsForEvent = query({
  args: { eventId: v.id("events") },
  returns: v.array(
    v.object({
      _id: v.id("tickets"),
      _creationTime: v.number(),
      eventId: v.id("events"),
      userId: v.string(),
      purchasedAt: v.number(),
      status: v.string(),
      paymentIntentId: v.optional(v.string()),  // ✅ Made optional
      amount: v.optional(v.number()),           // ✅ Made optional
    })
  ),
  handler: async (ctx, { eventId }) => {
    return await ctx.db
      .query("tickets")
      .withIndex("by_event", (q) => q.eq("eventId", eventId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "valid"),
          q.eq(q.field("status"), "used")
        )
      )
      .collect();
  },
});

export const updateTicketStatus = mutation({
  args: {
    ticketId: v.id("tickets"),
    status: v.union(
      v.literal("valid"),
      v.literal("used"),
      v.literal("refunded"),
      v.literal("cancelled")
    ),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { ticketId, status }) => {
    const ticket = await ctx.db.get(ticketId);
    if (!ticket) throw new Error("Ticket not found");

    await ctx.db.patch(ticketId, { status });
    return { success: true };
  },
});
