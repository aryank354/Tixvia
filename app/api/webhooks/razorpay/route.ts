import { NextRequest, NextResponse } from 'next/server';
import { getConvexClient } from '@/lib/convex';
import { api } from '@/convex/_generated/api';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    console.error("Razorpay webhook secret is not set.");
    return new NextResponse('Webhook secret not configured', { status: 500 });
  }

  try {
    const bodyText = await req.text(); // Read the raw body
    const signature = req.headers.get('x-razorpay-signature');

    if (!signature) {
      return new NextResponse('Signature missing', { status: 400 });
    }

    const shasum = crypto.createHmac('sha256', secret);
    shasum.update(bodyText);
    const digest = shasum.digest('hex');

    if (digest !== signature) {
      return new NextResponse('Invalid signature', { status: 403 });
    }

    // Signature is valid, now parse the body
    const body = JSON.parse(bodyText);

    // This is a good place for secondary logic, e.g., logging or handling refunds.
    // The primary ticket creation logic is in the client-side handler for a better UX.
    if (body.event === 'payment.captured') {
      const payment = body.payload.payment.entity;
      console.log(`Payment captured for Order ID: ${payment.order_id}, Payment ID: ${payment.id}`);
      // You can add further logic here if needed.
    }

    return new NextResponse(null, { status: 200 });

  } catch (error) {
    console.error("Error processing Razorpay webhook:", error);
    return new NextResponse('Webhook processing error', { status: 500 });
  }
}