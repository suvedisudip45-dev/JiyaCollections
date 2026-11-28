/* eslint-disable react/prop-types */
import { useContext } from "react";
import { ShopContext } from "../context/ShopContext";

const TermsAndConditionsModal = ({ isOpen, onClose, onAccept }) => {
  const { storefrontContent } = useContext(ShopContext);
  const terms = storefrontContent?.termsAndConditions;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex animate-fadeIn items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-gray-100 bg-white shadow-2xl">
        <div className="flex flex-shrink-0 items-center justify-between rounded-t-2xl bg-gray-900 px-6 py-4 text-white">
          <div>
            <h3 className="text-lg font-bold">{terms?.title || "Terms & Conditions"}</h3>
            {terms?.subtitle && <p className="text-xs text-gray-300">{terms.subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close terms and conditions"
            className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-6 text-xs font-normal leading-relaxed text-gray-600">
          {terms?.notice && (
            <div className="whitespace-pre-wrap rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <strong>Important Notice:</strong> {terms.notice}
            </div>
          )}
          {(terms?.conditions || []).map((condition, index) => (
            <section key={`${condition.title}-${index}`}>
              <h4 className="mb-1 text-sm font-bold text-gray-900">
                {index + 1}. {condition.title}
              </h4>
              <p className="whitespace-pre-wrap">{condition.description}</p>
            </section>
          ))}
        </div>

        <div className="flex flex-shrink-0 items-center justify-end gap-3 rounded-b-2xl border-t border-gray-200 bg-gray-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-5 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200"
          >
            Close
          </button>
          {onAccept && (
            <button
              type="button"
              onClick={() => {
                onAccept();
                onClose();
              }}
              className="rounded-xl bg-black px-6 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-gray-800 active:scale-95"
            >
              I Accept Terms
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default TermsAndConditionsModal;
