// components/SellerDashboard.tsx
"use client";

import Link from "next/link";
import { CalendarDays, Plus, Info } from "lucide-react";

export default function SellerDashboard() {
  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        {/* Header Section */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-800 px-6 py-8 text-white">
          <h2 className="text-2xl font-bold">Seller Dashboard</h2>
          <p className="text-blue-100 mt-2">
            Create and manage your events.
          </p>
        </div>

        {/* Main Content */}
        <div className="p-6 space-y-8">
          <div className="bg-blue-50 border-l-4 border-blue-400 p-4" role="alert">
            <div className="flex">
              <div className="py-1">
                <Info className="h-5 w-5 text-blue-500 mr-3" />
              </div>
              <div>
                <p className="font-bold text-blue-800">Your Seller Account is Active</p>
                <p className="text-sm text-blue-700">
                  Payments are processed via Razorpay, which is configured on the server. You can start creating and managing your events right away.
                </p>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xl font-semibold text-gray-800 mb-4">
              Manage Your Events
            </h3>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <Link
                href="/seller/new-event"
                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 transition-colors text-center font-medium"
              >
                <Plus className="w-5 h-5" />
                Create New Event
              </Link>
              <Link
                href="/seller/events"
                className="flex-1 flex items-center justify-center gap-2 bg-gray-100 text-gray-700 px-4 py-3 rounded-lg hover:bg-gray-200 transition-colors text-center font-medium"
              >
                <CalendarDays className="w-5 h-5" />
                View My Events
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}