// convex/waitingList.ts
import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  DURATIONS,
  WAITING_LIST_STATUS,
  TICKET_STATUS,
} from "./constants";
import { internal, api } from "./_generated/api";

/* ------------------------------------------------------------------ *
 * Utility                                                            *
 * ------------------------------------------------------------------ */

/** Group offending offers by event so we can batch-process them. */
function groupByEvent(
  offers: Array<{ eventId: Id<"events">; _id: Id<"waitingList"> }>
) {
  return offers.reduce((acc, offer) => {
    (acc[offer.eventId] ??= []).push(offer);
    return acc;
  }, {} as Record<Id<"events">, typeof offers>);
}

/* ------------------------------------------------------------------ *
 * Position in queue                                                  *
 * ------------------------------------------------------------------ */

export const getQueuePosition = query({
  args: {
    eventId: v.id("events"),
    userId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("waitingList"),
      eventId: v.id("events"),
      userId: v.string(),
      status: v.string(),
      position: v.number(),
    })
  ),
  handler: async (ctx, { eventId, userId }) => {
    /* the caller's entry … */
    const entry = await ctx.db
      .query("waitingList")
      .withIndex("by_user_event", q =>
        q.eq("userId", userId).eq("eventId", eventId)
      )
      .filter(q =>
        q.neq(q.field("status"), WAITING_LIST_STATUS.EXPIRED)
      )
      .first();

    if (!entry) return null;

    /* …and how many people are ahead of them */
    const ahead = await ctx.db
      .query("waitingList")
      .withIndex("by_event_status", q => q.eq("eventId", eventId))
      .filter(q =>
        q.and(
          q.lt(q.field("_creationTime"), entry._creationTime),
          q.or(
            q.eq(q.field("status"), WAITING_LIST_STATUS.WAITING),
            q.eq(q.field("status"), WAITING_LIST_STATUS.OFFERED)
          )
        )
      )
      .collect();

    return { ...entry, position: ahead.length + 1 };
  },
});

/* ------------------------------------------------------------------ *
 * Main queue processor (INTERNAL)                                    *
 * ------------------------------------------------------------------ */

export const processQueue = internalMutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) throw new Error("Event not found");

    /* compute free slots ------------------------------------------------ */
    const purchased = (
      await ctx.db
        .query("tickets")
        .withIndex("by_event", q => q.eq("eventId", eventId))
        .collect()
    ).filter(
      t =>
        t.status === TICKET_STATUS.VALID ||
        t.status === TICKET_STATUS.USED
    ).length;

    const now = Date.now();
    const offers = (
      await ctx.db
        .query("waitingList")
        .withIndex("by_event_status", q =>
          q.eq("eventId", eventId).eq("status", WAITING_LIST_STATUS.OFFERED)
        )
        .collect()
    ).filter(e => (e.offerExpiresAt ?? 0) > now).length;

    const free = event.totalTickets - (purchased + offers);
    if (free <= 0) return;

    /* pick next users --------------------------------------------------- */
    const waiting = await ctx.db
      .query("waitingList")
      .withIndex("by_event_status", q =>
        q.eq("eventId", eventId).eq("status", WAITING_LIST_STATUS.WAITING)
      )
      .order("asc")
      .take(free);

    const deadline = now + DURATIONS.TICKET_OFFER;
    for (const user of waiting) {
      /* mark as offered */
      await ctx.db.patch(user._id, {
        status: WAITING_LIST_STATUS.OFFERED,
        offerExpiresAt: deadline,
      });

      /* schedule auto-expiry */
      await ctx.scheduler.runAfter(
        DURATIONS.TICKET_OFFER,
        internal.waitingList.expireOffer,
        { waitingListId: user._id, eventId }
      );
    }
  },
});

/* ------------------------------------------------------------------ *
 * Expire a single offer (INTERNAL)                                   *
 * ------------------------------------------------------------------ */

export const expireOffer = internalMutation({
  args: {
    waitingListId: v.id("waitingList"),
    eventId: v.id("events"),
  },
  // returns: v.void(),
  handler: async (ctx, { waitingListId, eventId }) => {
    const offer = await ctx.db.get(waitingListId);
    if (!offer || offer.status !== WAITING_LIST_STATUS.OFFERED) return;

    await ctx.db.patch(waitingListId, {
      status: WAITING_LIST_STATUS.EXPIRED,
    });

    /* kick the queue */
    await ctx.runMutation(internal.waitingList.processQueue, { eventId });
  },
});

/* ------------------------------------------------------------------ *
 * Safety‐net cleaner (INTERNAL)                                      *
 * ------------------------------------------------------------------ */

export const cleanupExpiredOffers = internalMutation({
  args: {},
  // returns: v.void(),
  handler: async ctx => {
    const now = Date.now();

    /* find forgotten offers */
    const expired = await ctx.db
      .query("waitingList")
      .filter(q =>
        q.and(
          q.eq(q.field("status"), WAITING_LIST_STATUS.OFFERED),
          q.lt(q.field("offerExpiresAt"), now)
        )
      )
      .collect();

    if (expired.length === 0) return;

    /* group per event for efficiency */
    const byEvent = groupByEvent(expired);
    for (const [eventId, offers] of Object.entries(byEvent)) {
      await Promise.all(
        offers.map(o =>
          ctx.db.patch(o._id, { status: WAITING_LIST_STATUS.EXPIRED })
        )
      );

      await ctx.runMutation(internal.waitingList.processQueue, {
        eventId: eventId as Id<"events">,
      });
    }
  },
});

/* ------------------------------------------------------------------ *
 * User-initiated ticket release                                      *
 * ------------------------------------------------------------------ */

export const releaseTicket = mutation({
  args: {
    eventId: v.id("events"),
    waitingListId: v.id("waitingList"),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, { eventId, waitingListId }) => {
    const entry = await ctx.db.get(waitingListId);
    if (!entry || entry.status !== WAITING_LIST_STATUS.OFFERED) {
      throw new Error("No valid ticket offer found");
    }

    /* mark expired */
    await ctx.db.patch(waitingListId, {
      status: WAITING_LIST_STATUS.EXPIRED,
    });

    /* move queue forward */
    await ctx.runMutation(internal.waitingList.processQueue, { eventId });
    return { success: true };
  },
});
