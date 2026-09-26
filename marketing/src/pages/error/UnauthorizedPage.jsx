import React from "react";
import { Link } from "react-router-dom";
import { ShieldAlert, ArrowLeft } from "lucide-react";

const UnauthorizedPage = () => (
  <div className="min-h-[70vh] flex items-center justify-center p-4">
    <div className="bg-white rounded-3xl p-8 sm:p-12 max-w-md w-full border border-red-200 shadow-sm text-center space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto">
        <ShieldAlert size={32} />
      </div>
      <div>
        <h1 className="text-3xl font-black text-red-700">403</h1>
        <h2 className="text-base font-bold text-[var(--mp-ink)] mt-1">Access Forbidden</h2>
        <p className="text-xs text-[var(--mp-muted)] mt-1">
          You do not have permission to access this marketing resource or campaign. All data is scoped strictly to authorized partners.
        </p>
      </div>
      <div className="pt-2">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs shadow-xs transition-all"
        >
          <ArrowLeft size={14} />
          Return to Dashboard
        </Link>
      </div>
    </div>
  </div>
);

export default UnauthorizedPage;
