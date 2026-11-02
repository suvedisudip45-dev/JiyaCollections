import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { CheckCircle2, Clock3, ReceiptText, RefreshCw } from "lucide-react";
import { backendUrl, useManufacturer } from "../context/ManufacturerContext";

const formatSerial = (book, serial) =>
  `${book.seriesPrefix}${String(serial).padStart(book.serialWidth || 0, "0")}`;

const formatDate = (value) => value
  ? new Date(value).toLocaleString()
  : "—";

const DistributorPaperBills = () => {
  const { token } = useManufacturer();
  const [allocations, setAllocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState("");

  const loadAllocations = useCallback(async () => {
    try {
      const response = await axios.get(`${backendUrl}/api/distributor/paper-bills/allocations`, {
        headers: { token },
      });
      if (!response.data?.success) {
        throw new Error(response.data?.message || "Allocated bill ranges could not be loaded.");
      }
      setAllocations(response.data.allocations || []);
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Allocated bill ranges could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) loadAllocations();
  }, [token, loadAllocations]);

  const acceptAllocation = async (allocation) => {
    const billType = allocation.book.documentType === "VAT_TAX_INVOICE" ? "VAT tax invoice" : "PAN bill";
    const range = `${formatSerial(allocation.book, allocation.startNumber)}–${formatSerial(allocation.book, allocation.endNumber)}`;
    const confirmed = window.confirm(
      `Confirm that you physically received the ${billType} range ${range} and checked it against the bills handed to you?`,
    );
    if (!confirmed) return;

    try {
      setAcceptingId(allocation.id);
      const response = await axios.post(
        `${backendUrl}/api/distributor/paper-bills/allocations/${allocation.id}/accept`,
        {},
        { headers: { token } },
      );
      if (!response.data?.success) {
        throw new Error(response.data?.message || "Bill range could not be accepted.");
      }
      toast.success(response.data.message || "Physical bill range accepted.");
      await loadAllocations();
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Bill range could not be accepted.");
    } finally {
      setAcceptingId("");
    }
  };

  const pending = allocations.filter((allocation) => allocation.status === "PENDING_ACCEPTANCE");
  const activeRanges = allocations.filter((allocation) => allocation.status === "ACTIVE");

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 pb-12 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-emerald-800">
            <ReceiptText className="h-5 w-5" />
            <p className="text-xs font-black uppercase tracking-wider">Distributor documents</p>
          </div>
          <h1 className="mt-2 text-2xl font-black text-slate-950">Physical bill books</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Review the serial range Admin physically handed to your hub. Confirm receipt before using any PAN bill or VAT tax invoice from that range.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            loadAllocations();
          }}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      {pending.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-bold text-amber-950">Receipt confirmation required</h2>
            <p className="text-xs text-amber-800">These serials cannot be recorded on customer orders until you confirm physical receipt.</p>
          </div>
          {pending.map((allocation) => {
            const book = allocation.book;
            const isVat = book.documentType === "VAT_TAX_INVOICE";
            return (
              <article key={allocation.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-slate-950">{book.bookLabel}</p>
                    <p className="mt-1 text-xs font-semibold text-amber-900">{isVat ? "VAT tax invoice" : "PAN bill"}</p>
                    <p className="mt-2 font-mono text-sm font-bold text-slate-900">
                      {formatSerial(book, allocation.startNumber)} – {formatSerial(book, allocation.endNumber)}
                    </p>
                    <p className="mt-2 text-[11px] text-slate-600">
                      Assigned {formatDate(allocation.allocatedAt)}{allocation.notes ? ` · ${allocation.notes}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => acceptAllocation(allocation)}
                    disabled={Boolean(acceptingId)}
                    className="inline-flex items-center gap-2 rounded-lg bg-amber-800 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {acceptingId === allocation.id ? "Recording receipt..." : "Confirm physical receipt"}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-bold text-slate-950">Active ranges</h2>
          <p className="text-xs text-slate-600">These ranges are active for recording the corresponding bill serials during order packing.</p>
        </div>
        {loading && allocations.length === 0 && <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Loading allocated bill ranges...</p>}
        {!loading && allocations.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <Clock3 className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-2 text-sm font-semibold text-slate-800">No physical bill ranges assigned</p>
            <p className="mt-1 text-xs text-slate-500">Ask Admin to allocate a PAN bill or VAT invoice range after handing over the physical book.</p>
          </div>
        )}
        {activeRanges.map((allocation) => {
          const book = allocation.book;
          return (
            <article key={allocation.id} className="rounded-xl border border-emerald-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-950">{book.bookLabel}</p>
                  <p className="mt-1 text-xs font-semibold text-emerald-800">
                    {book.documentType === "VAT_TAX_INVOICE" ? "VAT tax invoice" : "PAN bill"}
                    {allocation.acceptedAt ? " · Receipt accepted" : " · Previously active"}
                  </p>
                  <p className="mt-2 font-mono text-sm font-bold text-slate-900">
                    {formatSerial(book, allocation.startNumber)} – {formatSerial(book, allocation.endNumber)}
                  </p>
                  <p className="mt-2 text-[11px] text-slate-500">
                    {allocation.acceptedAt
                      ? `Accepted ${formatDate(allocation.acceptedAt)} · Assigned ${formatDate(allocation.allocatedAt)}`
                      : `Receipt confirmation predates tracking · Assigned ${formatDate(allocation.allocatedAt)}`}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase text-emerald-800">
                  {allocation.acceptedAt ? "Ready to use" : "Active legacy range"}
                </span>
              </div>
            </article>
          );
        })}
      </section>
      <p className="text-[11px] text-slate-500">
        Receipt confirmation records who accepted the range and when. When packing an eligible order, enter the serial number printed on the physical bill attached to that parcel.
      </p>
    </main>
  );
};

export default DistributorPaperBills;
