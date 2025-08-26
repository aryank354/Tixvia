"use client";

import { createRazorpayOrder } from "@/app/actions/createRazorpayOrder";
import { Id } from "@/convex/_generated/dataModel";
import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import { useQuery, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import ReleaseTicket from "./ReleaseTicket";

// Add this interface to your component file
declare global {
  interface Window {
    Razorpay: any;
  }
}

export default function PurchaseTicket({ eventId }: { eventId: Id<"events"> }) {
  const { user } = useUser();
  const router = useRouter();
  const event = useQuery(api.events.getById, { eventId });
  const purchaseTicket = useMutation(api.events.purchaseTicket);
  const waitingListEntry = useQuery(api.waitingList.getQueuePosition, {
    eventId,
    userId: user?.id ?? "",
  });

  const [isLoading, setIsLoading] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState("");
  const offerExpiresAt = waitingListEntry?.offerExpiresAt ?? 0;
  const isExpired = Date.now() > offerExpiresAt;

  useEffect(() => {
    const calculateTimeRemaining = () => {
      if (isExpired) {
        setTimeRemaining("Expired");
        return;
      }
      const diff = offerExpiresAt - Date.now();
      const minutes = Math.floor(diff / 1000 / 60);
      const seconds = Math.floor((diff / 1000) % 60);
      setTimeRemaining(
        `${minutes}m ${seconds.toString().padStart(2, "0")}s`
      );
    };

    calculateTimeRemaining();
    const interval = setInterval(calculateTimeRemaining, 1000);
    return () => clearInterval(interval);
  }, [offerExpiresAt, isExpired]);

  const handlePurchase = async () => {
    if (!user || !event || !waitingListEntry) return;
    setIsLoading(true);

    try {
      const { orderId, amount, currency } = await createRazorpayOrder({ eventId });

      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount,
        currency,
        name: event.name,
        description: `Ticket for ${event.name}`,
        order_id: orderId,
        handler: async function (response: any) {
          setIsLoading(true); // Show loader during verification and DB update
          try {
            // Server-side verification of the payment
            const verificationResult = await fetch('/api/webhooks/razorpay/verify', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });

            const verificationData = await verificationResult.json();

            if (verificationData.isOk) {
              // If payment is verified, update Convex database
              await purchaseTicket({
                eventId,
                userId: user.id,
                waitingListId: waitingListEntry._id,
                paymentInfo: {
                  paymentIntentId: response.razorpay_payment_id,
                  amount: amount / 100, // Convert back from paise
                },
              });
              router.push('/tickets/purchase-success');
            } else {
              alert(verificationData.message || "Payment verification failed. Please contact support.");
              setIsLoading(false);
            }
          } catch (dbError) {
            console.error("Failed to save ticket after payment:", dbError);
            alert("Payment was successful, but we had trouble issuing your ticket. Please contact support.");
            setIsLoading(false);
          }
        },
        prefill: {
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          email: user.primaryEmailAddress?.emailAddress,
        },
        theme: {
          color: "#2563EB", // Blue color to match your theme
        },
        modal: {
          ondismiss: function() {
            setIsLoading(false); // Re-enable button if user closes modal
          }
        }
      };

      const paymentObject = new window.Razorpay(options);
      paymentObject.open();

    } catch (error) {
      console.error("Error initiating Razorpay purchase:", error);
      alert("Could not initiate payment. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg border border-amber-200">
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">
          Your Ticket is Reserved!
        </h3>
        <p className="text-sm text-gray-500">
          Complete your purchase before the timer runs out. Time remaining:{" "}
          <span className="font-bold text-gray-800">{timeRemaining}</span>
        </p>
        <button
          onClick={handlePurchase}
          disabled={isExpired || isLoading}
          className="w-full bg-gradient-to-r from-blue-600 to-blue-800 text-white px-8 py-4 rounded-lg font-bold shadow-md hover:from-blue-700 hover:to-blue-900 transform hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 text-lg"
        >
          {isLoading ? "Processing..." : `Purchase for £${event?.price.toFixed(2)}`}
        </button>
        <div className="mt-4">
          <ReleaseTicket eventId={eventId} waitingListId={waitingListEntry._id} />
        </div>
      </div>
    </div>
  );
}