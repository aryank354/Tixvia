// events.ts
import { query, mutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import {
  DURATIONS,
  WAITING_LIST_STATUS,
  TICKET_STATUS,
} from "./constants";
import { api, components, internal } from "./_generated/api";
import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";

/* ------------------------------------------------------------------ *
 *  Utility types                                                      *
 * ------------------------------------------------------------------ */

export type Metrics = {
  soldTickets: number;
  refundedTickets: number;
  cancelledTickets: number;
  revenue: number;
};

/* ------------------------------------------------------------------ *
 *  Rate-limiter setup                                                 *
 * ------------------------------------------------------------------ */

const rateLimiter = new RateLimiter(components.rateLimiter, {
  queueJoin: {
    kind: "fixed window",
    rate: 3,                 // max 3 joins
    period: 30 * MINUTE,     // in 30 minutes
  },
});

/* ------------------------------------------------------------------ *
 *  Public queries                                                     *
 * ------------------------------------------------------------------ */

/** All not-cancelled events */
export const get = query({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("events")
      .filter((q) => q.eq(q.field("is_cancelled"), undefined))
      .collect(),
});

/** Single event by id */
export const getById = query({
  args: { eventId: v.id("events") },
  handler: (ctx, { eventId }) => ctx.db.get(eventId),
});

/* ------------------------------------------------------------------ *
 *  Event creation                                                     *
 * ------------------------------------------------------------------ */

export const create = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    location: v.string(),
    eventDate: v.number(),   // timestamp (ms)
    price: v.number(),
    totalTickets: v.number(),
    userId: v.string(),
  },
  handler: (ctx, args) =>
    ctx.db.insert("events", { ...args }),
});

/* ------------------------------------------------------------------ *
 *  Availability helper (public query)                                *
 * ------------------------------------------------------------------ */

export const checkAvailability = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error("Event not found");

    // tickets sold
    const purchasedCount = (
      await ctx.db
        .query("tickets")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect()
    ).filter(
      (t) =>
        t.status === TICKET_STATUS.VALID ||
        t.status === TICKET_STATUS.USED,
    ).length;

    // outstanding offers
    const now = Date.now();
    const activeOffers = (
      await ctx.db
        .query("waitingList")
        .withIndex("by_event_status", (q) =>
          q.eq("eventId", eventId).eq("status", WAITING_LIST_STATUS.OFFERED),
        )
        .collect()
    ).filter((e) => (e.offerExpiresAt ?? 0) > now).length;

    const availableSpots = event.totalTickets - (purchasedCount + activeOffers);

    return {
      available: availableSpots > 0,
      availableSpots,
      totalTickets: event.totalTickets,
      purchasedCount,
      activeOffers,
    };
  },
});

/* ------------------------------------------------------------------ *
 *  Waiting-list join (public mutation)                               *
 * ------------------------------------------------------------------ */

import type { MutationBuilder } from "convex/server";

export const joinWaitingList: ReturnType<typeof mutation> = mutation({
  args: { eventId: v.id("events"), userId: v.string() },
  returns: v.object({
    success: v.boolean(),
    status: v.string(),
    message: v.string(),
  }),
  handler: async (ctx, { eventId, userId }) => {
    /* rate-limit ---------------------------------------------------- */
    const rateStatus = await rateLimiter.limit(ctx, "queueJoin", { key: userId });
    if (!rateStatus.ok) {
      throw new ConvexError(
        `You've joined the waiting list too many times. Please wait ${Math.ceil(
          rateStatus.retryAfter / (60 * 1000),
        )} minutes before trying again.`,
      );
    }

    /* duplicate check ---------------------------------------------- */
    const existing = await ctx.db
      .query("waitingList")
      .withIndex("by_user_event", (q) =>
        q.eq("userId", userId).eq("eventId", eventId),
      )
      .filter((q) =>
        q.neq(q.field("status"), WAITING_LIST_STATUS.EXPIRED),
      )
      .first();
    if (existing) throw new Error("Already in waiting list for this event");

    /* event exists? ------------------------------------------------- */
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error("Event not found");

    /* availability -------------------------------------------------- */
    const { available } = await ctx.runQuery(
      api.events.checkAvailability,
      { eventId },
    );

    /* insert waiting-list entry ------------------------------------ */
    const now = Date.now();
    if (available) {
      // immediately offer a ticket
      const waitingListId = await ctx.db.insert("waitingList", {
        eventId,
        userId,
        status: WAITING_LIST_STATUS.OFFERED,
        offerExpiresAt: now + DURATIONS.TICKET_OFFER,
      });

      // schedule expiry
      await ctx.scheduler.runAfter(
        DURATIONS.TICKET_OFFER,
        internal.waitingList.expireOffer,
        { waitingListId, eventId },
      );
    } else {
      // plain queue entry
      await ctx.db.insert("waitingList", {
        eventId,
        userId,
        status: WAITING_LIST_STATUS.WAITING,
      });
    }

    return {
      success: true,
      status: available
        ? WAITING_LIST_STATUS.OFFERED
        : WAITING_LIST_STATUS.WAITING,
      message: available
        ? "Ticket offered – you have 15 minutes to purchase"
        : "Added to waiting list – you'll be notified when a ticket is available",
    };
  },
});

/* ------------------------------------------------------------------ *
 *  Ticket purchase (public mutation)                                 *
 * ------------------------------------------------------------------ */

export const purchaseTicket = mutation({
  args: {
    eventId: v.id("events"),
    userId: v.string(),
    waitingListId: v.id("waitingList"),
    paymentInfo: v.object({
      paymentIntentId: v.string(),
      amount: v.number(),
    }),
  },
  handler: async (
    ctx,
    { eventId, userId, waitingListId, paymentInfo },
  ) => {
    /* waiting-list entry ------------------------------------------- */
    const entry = await ctx.db.get(waitingListId);
    if (!entry) throw new Error("Waiting list entry not found");
    if (entry.status !== WAITING_LIST_STATUS.OFFERED) {
      throw new Error("Ticket offer is no longer valid");
    }
    if (entry.userId !== userId) {
      throw new Error("Waiting list entry does not belong to this user");
    }

    /* event existence --------------------------------------------- */
    const event = await ctx.db.get(eventId);
    if (!event || event.is_cancelled) throw new Error("Event not active");

    /* create ticket + update list ---------------------------------- */
    await ctx.db.insert("tickets", {
      eventId,
      userId,
      purchasedAt: Date.now(),
      status: TICKET_STATUS.VALID,
      paymentIntentId: paymentInfo.paymentIntentId,
      amount: paymentInfo.amount,
    });
    await ctx.db.patch(waitingListId, {
      status: WAITING_LIST_STATUS.PURCHASED,
    });

    /* move queue forward ------------------------------------------- */
    await ctx.runMutation(
      internal.waitingList.processQueue,
      { eventId },
    );
  },
});

/* ------------------------------------------------------------------ *
 *  User-centric helpers                                              *
 * ------------------------------------------------------------------ */

export const getUserTickets = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const tickets = await ctx.db
      .query("tickets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return Promise.all(
      tickets.map(async (t) => ({
        ...t,
        event: await ctx.db.get(t.eventId),
      })),
    );
  },
});

export const getUserWaitingList = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const entries = await ctx.db
      .query("waitingList")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return Promise.all(
      entries.map(async (e) => ({
        ...e,
        event: await ctx.db.get(e.eventId),
      })),
    );
  },
});

/* ------------------------------------------------------------------ *
 *  Availability snapshot (public)                                    *
 * ------------------------------------------------------------------ */

export const getEventAvailability = query({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error("Event not found");

    const purchasedCount = (
      await ctx.db
        .query("tickets")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect()
    ).filter(
      (t) =>
        t.status === TICKET_STATUS.VALID ||
        t.status === TICKET_STATUS.USED,
    ).length;

    const now = Date.now();
    const activeOffers = (
      await ctx.db
        .query("waitingList")
        .withIndex("by_event_status", (q) =>
          q.eq("eventId", eventId).eq("status", WAITING_LIST_STATUS.OFFERED),
        )
        .collect()
    ).filter((e) => (e.offerExpiresAt ?? 0) > now).length;

    const totalReserved = purchasedCount + activeOffers;

    return {
      isSoldOut: totalReserved >= event.totalTickets,
      totalTickets: event.totalTickets,
      purchasedCount,
      activeOffers,
      remainingTickets: Math.max(0, event.totalTickets - totalReserved),
    };
  },
});

/* ------------------------------------------------------------------ *
 *  Seller dashboard helpers                                          *
 * ------------------------------------------------------------------ */

export const search = query({
  args: { searchTerm: v.string() },
  handler: async (ctx, { searchTerm }) => {
    const all = await ctx.db
      .query("events")
      .filter((q) => q.eq(q.field("is_cancelled"), undefined))
      .collect();

    const term = searchTerm.toLowerCase();
    return all.filter(
      (e) =>
        e.name.toLowerCase().includes(term) ||
        e.description.toLowerCase().includes(term) ||
        e.location.toLowerCase().includes(term),
    );
  },
});

export const getSellerEvents = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const events = await ctx.db
      .query("events")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();

    return Promise.all(
      events.map(async (ev) => {
        const tickets = await ctx.db
          .query("tickets")
          .withIndex("by_event", (q) => q.eq("eventId", ev._id))
          .collect();

        const sold = tickets.filter(
          (t) =>
            t.status === TICKET_STATUS.VALID ||
            t.status === TICKET_STATUS.USED,
        );
        const refunded = tickets.filter(
          (t) => t.status === TICKET_STATUS.REFUNDED,
        );
        const cancelled = tickets.filter(
          (t) => t.status === TICKET_STATUS.CANCELLED,
        );

        const metrics: Metrics = {
          soldTickets: sold.length,
          refundedTickets: refunded.length,
          cancelledTickets: cancelled.length,
          revenue: sold.length * ev.price,
        };

        return { ...ev, metrics };
      }),
    );
  },
});

/* ------------------------------------------------------------------ *
 *  Admin mutations                                                   *
 * ------------------------------------------------------------------ */

export const updateEvent = mutation({
  args: {
    eventId: v.id("events"),
    name: v.string(),
    description: v.string(),
    location: v.string(),
    eventDate: v.number(),
    price: v.number(),
    totalTickets: v.number(),
  },
  handler: async (ctx, { eventId, ...updates }) => {
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error("Event not found");

    const soldCount = (
      await ctx.db
        .query("tickets")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect()
    ).filter(
      (t) =>
        t.status === TICKET_STATUS.VALID ||
        t.status === TICKET_STATUS.USED,
    ).length;

    if (updates.totalTickets < soldCount) {
      throw new Error(
        `Cannot reduce total tickets below ${soldCount} (already sold)`,
      );
    }

    await ctx.db.patch(eventId, updates);
    return eventId;
  },
});

export const cancelEvent = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error("Event not found");

    const activeTickets = (
      await ctx.db
        .query("tickets")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect()
    ).filter(
      (t) =>
        t.status === TICKET_STATUS.VALID ||
        t.status === TICKET_STATUS.USED,
    );

    if (activeTickets.length > 0) {
      throw new Error(
        "Cannot cancel event with active tickets. Please refund them first.",
      );
    }

    /* mark event as cancelled -------------------------------------- */
    await ctx.db.patch(eventId, { is_cancelled: true });

    /* clean waiting list ------------------------------------------- */
    const wlEntries = await ctx.db
      .query("waitingList")
      .withIndex("by_event_status", (q) => q.eq("eventId", eventId))
      .collect();
    for (const e of wlEntries) await ctx.db.delete(e._id);

    return { success: true };
  },
});
