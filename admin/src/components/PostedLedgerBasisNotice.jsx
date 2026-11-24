/* eslint-disable react/prop-types */
const PostedLedgerBasisNotice = ({ reportBasis }) => {
  const isPostedLedger = reportBasis?.classification === "POSTED_JOURNAL_LEDGER";
  const limitations = Array.isArray(reportBasis?.limitations) ? reportBasis.limitations : [];

  return (
    <aside
      aria-label="Report basis and limitations"
      className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-950"
    >
      <p className="font-semibold">
        {isPostedLedger
          ? "Basis: posted and reversed General Ledger journal entries."
          : "Reporting-basis metadata is unavailable."}
      </p>
      <p className="mt-1">
        {isPostedLedger
          ? "This report does not establish source-event completeness or operational subledger reconciliation."
          : "Do not treat a balanced total as proof of source completeness or reconciliation."}
      </p>
      {limitations.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
        </ul>
      )}
    </aside>
  );
};

export default PostedLedgerBasisNotice;
