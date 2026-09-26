import React from "react";
import { Link } from "react-router-dom";
import { HelpCircle, ArrowLeft } from "lucide-react";

const NotFoundPage = () => (
  <div className="min-h-[70vh] flex items-center justify-center p-4">
    <div className="bg-white rounded-3xl p-8 sm:p-12 max-w-md w-full border border-[var(--mp-line)] shadow-sm text-center space-y-4">
      <div className="w-16 h-16 rounded-2xl bg-[var(--mp-brand-light)] text-brand-700 flex items-center justify-center mx-auto">
        <HelpCircle size={32} />
      </div>
      <div>
        <h1 className="text-3xl font-black text-[var(--mp-ink)]">404</h1>
        <h2 className="text-base font-bold text-[var(--mp-ink)] mt-1">Page Not Found</h2>
        <p className="text-xs text-[var(--mp-muted)] mt-1">
          The marketing portal page or card resource you requested does not exist or has been moved.
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

export default NotFoundPage;
