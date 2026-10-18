/* eslint-disable react/prop-types */
import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import { backendUrl, currency } from "../App";
import { toast } from "react-toastify";
import Pagination from "../components/Pagination";
import { usePermissions } from "../auth/PermissionsContext";
import Customer360Panel from "../components/Customer360Panel";

const pageLimit = 10;
const dateText = (value) => (value ? new Date(value).toLocaleString() : "—");
const amountText = (value) => `${currency}${Number(value || 0).toLocaleString()}`;

const Metric = ({ label, value }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4">
    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-lg font-black text-slate-900">{value}</p>
  </div>
);

const CustomerOrdersModal = ({ customerId, token, onClose }) => {
  const [orders, setOrders] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async (requestedPage) => {
    setLoading(true);
    try {
      const response = await axios.get(
        `${backendUrl}/api/customer/details/${customerId}/orders?page=${requestedPage}&limit=${pageLimit}`,
        { headers: { token } },
      );
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to load orders.");
      setOrders(response.data.orders || []);
      setPagination(response.data.pagination || null);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to load customer orders.");
      setOrders([]);
      setPagination(null);
    } finally {
      setLoading(false);
    }
  }, [customerId, token]);

  useEffect(() => {
    loadOrders(page);
  }, [loadOrders, page]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 sm:p-6" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="customer-orders-title" className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="customer-orders-title" className="text-lg font-black text-slate-900">Order history</h2>
            <p className="mt-0.5 text-xs text-slate-500">Newest orders appear first. Order history is paginated.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close order history" className="rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-100">✕</button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-500">Loading orders…</p>
          ) : orders.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">No orders found for this customer.</p>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => (
                <article key={order.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-bold text-slate-900">Order {order.id}</h3>
                      <p className="mt-0.5 text-xs text-slate-500">Created {dateText(Number(order.date))}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-black text-slate-900">{amountText(order.amount)}</p>
                      <p className="text-xs text-slate-600">{order.status}</p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-x-6 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600 sm:grid-cols-2">
                    <p><b>Payment:</b> {order.payment ? "Paid" : "Unpaid"} · {order.paymentMethod || "—"}</p>
                    <p><b>Delivery fee:</b> {amountText(order.deliveryFee)}</p>
                    <p><b>Delivered:</b> {dateText(order.delivery?.deliveredAt || order.assignment?.deliveredAt)}</p>
                    <p><b>COD:</b> {amountText(order.delivery?.codAmount)}</p>
                    <p><b>Fulfillment:</b> {order.fulfillmentStatus || order.assignment?.status || "—"}</p>
                    <p><b>Delivery method:</b> {order.delivery?.deliveryType || order.assignment?.deliveryType || "—"}</p>
                  </div>
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Items</p>
                    <ul className="space-y-1 text-xs text-slate-700">
                      {(Array.isArray(order.items) ? order.items : []).map((item, index) => (
                        <li key={`${order.id}-${index}`}>
                          {item.product?.name || item.name || item.productName || "Product"} · {item.size || "—"} / {item.color || "—"} · Qty {item.quantity || item.qty || 1} · {amountText(item.price || item.unitPrice)}
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
        {pagination && (
          <footer className="border-t border-slate-100 px-5">
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              limit={pagination.limit}
              onPageChange={setPage}
              loading={loading}
            />
          </footer>
        )}
      </section>
    </div>
  );
};

const CustomerDetail = ({ token }) => {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityData, setActivityData] = useState(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [lettersOpen, setLettersOpen] = useState(false);
  const [letters, setLetters] = useState([]);
  const [letterPagination, setLetterPagination] = useState(null);
  const [letterPage, setLetterPage] = useState(1);
  const [lettersLoading, setLettersLoading] = useState(false);
  const [letterFile, setLetterFile] = useState(null);
  const [letterTitle, setLetterTitle] = useState("");
  const [letterNotes, setLetterNotes] = useState("");
  const [uploadingLetter, setUploadingLetter] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/customer/details/${customerId}/profile`, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to load customer profile.");
      setProfile(response.data);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to load customer profile.");
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [customerId, token]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const loadLetters = useCallback(async (requestedPage = letterPage) => {
    setLettersLoading(true);
    try {
      const response = await axios.get(`${backendUrl}/api/customer/details/${customerId}/letters?page=${requestedPage}&limit=${pageLimit}`, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to load letter records.");
      setLetters(response.data.letters || []);
      setLetterPagination(response.data.pagination || null);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to load letter records.");
    } finally {
      setLettersLoading(false);
    }
  }, [customerId, letterPage, token]);

  const toggleActivity = async () => {
    if (activityOpen) {
      setActivityOpen(false);
      return;
    }
    setActivityOpen(true);
    if (activityData) return;
    setActivityLoading(true);
    try {
      const response = await axios.get(
        `${backendUrl}/api/customer/details/${customerId}?includeOrders=false`,
        { headers: { token } },
      );
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to load customer activity.");
      setActivityData(response.data);
    } catch (error) {
      console.error(error);
      setActivityOpen(false);
      toast.error(error.response?.data?.message || error.message || "Unable to load customer activity.");
    } finally {
      setActivityLoading(false);
    }
  };

  useEffect(() => {
    if (lettersOpen) loadLetters(letterPage);
  }, [lettersOpen, letterPage, loadLetters]);

  const updateAccountStatus = async () => {
    const isDisabled = !profile.customer.isDisabled;
    let reason = "";
    if (isDisabled) {
      reason = window.prompt("Why are you disabling this customer account?") || "";
      if (!reason.trim()) return;
    } else if (!window.confirm("Re-enable this customer account?")) {
      return;
    }

    setSavingStatus(true);
    try {
      const response = await axios.patch(
        `${backendUrl}/api/customer/admin/${customerId}/status`,
        { disabled: isDisabled, reason },
        { headers: { token } },
      );
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to update account status.");
      toast.success(isDisabled ? "Customer account disabled." : "Customer account re-enabled.");
      await loadProfile();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to update account status.");
    } finally {
      setSavingStatus(false);
    }
  };

  const uploadLetter = async (event) => {
    event.preventDefault();
    if (!letterFile) {
      toast.error("Choose a letter image to upload.");
      return;
    }
    setUploadingLetter(true);
    try {
      const formData = new FormData();
      formData.append("image", letterFile);
      formData.append("userId", customerId);
      formData.append("title", letterTitle || "Handwritten Letter");
      formData.append("notes", letterNotes);
      const response = await axios.post(`${backendUrl}/api/customer/letter/upload`, formData, {
        headers: { token, "Content-Type": "multipart/form-data" },
      });
      if (!response.data?.success) throw new Error(response.data?.message || "Letter upload failed.");
      toast.success("Letter image saved.");
      setLetterFile(null);
      setLetterTitle("");
      setLetterNotes("");
      setLetterPage(1);
      await Promise.all([loadLetters(1), loadProfile()]);
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to upload letter.");
    } finally {
      setUploadingLetter(false);
    }
  };

  const deleteLetter = async (letterId) => {
    if (!window.confirm("Delete this letter record?")) return;
    try {
      const response = await axios.delete(`${backendUrl}/api/customer/letter/${letterId}`, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to delete letter.");
      toast.success("Letter removed.");
      const nextPage = letters.length === 1 && letterPage > 1 ? letterPage - 1 : letterPage;
      setLetterPage(nextPage);
      await loadLetters(nextPage);
      await loadProfile();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to delete letter.");
    }
  };

  if (loading) return <p className="p-8 text-center text-sm text-slate-500">Loading customer profile…</p>;
  if (!profile) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <p className="font-semibold text-slate-700">Customer profile could not be loaded.</p>
        <button type="button" onClick={() => navigate("/customers")} className="mt-4 text-sm font-bold text-indigo-700">Back to customers</button>
      </div>
    );
  }

  const { customer, metrics, loyalty } = profile;
  const addresses = Array.isArray(customer.addresses) ? customer.addresses : [];
  const loyaltyReward = loyalty?.activeReward || {};

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 pb-10">
      <button type="button" onClick={() => navigate("/customers")} className="text-sm font-semibold text-indigo-700 hover:text-indigo-900">← Back to customers</button>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">Customer profile</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">{customer.name}</h1>
            <p className="mt-1 text-sm text-slate-600">{customer.email || "No email"}{customer.phone ? ` · ${customer.phone}` : ""}</p>
            <p className="mt-1 text-xs text-slate-500">Customer since {dateText(customer.createdAt)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${customer.isDisabled ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
              {customer.isDisabled ? "Account disabled" : "Account active"}
            </span>
            {can("customer:account_manage") && (
              <button
                type="button"
                onClick={updateAccountStatus}
                disabled={savingStatus}
                className={`rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-50 ${customer.isDisabled ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}`}
              >
                {savingStatus ? "Saving…" : customer.isDisabled ? "Re-enable account" : "Disable account"}
              </button>
            )}
          </div>
        </div>

        {customer.isDisabled && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-800">
            Disabled {dateText(customer.disabledAt)} · {customer.disabledReason || "No reason recorded"}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-3">
          <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-700">Customer code</span>
          <code className="rounded-md bg-white px-2.5 py-1 font-mono text-sm font-bold tracking-widest text-slate-900">
            {customer.socialCustomerCode || "Not assigned"}
          </code>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Lifetime order value" value={amountText(metrics.totalPurchaseAmount)} />
          <Metric label="Orders" value={metrics.orderCount} />
          <Metric label="Exchanges" value={metrics.exchangeCount} />
          <Metric label="Returns" value={metrics.returnCount} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Reviews" value={metrics.reviewCount} />
          <Metric label="Letters" value={metrics.letterCount} />
          <Metric label="Average order" value={amountText(metrics.averageOrderAmount)} />
          <Metric label="Loyalty level" value={loyalty?.currentLevel?.name || "—"} />
          <Metric label="Marketing cards scanned" value={metrics.marketingCardsScanned ?? 0} />
          <Metric label="Rewards claimed" value={metrics.marketingRewardsClaimed ?? 0} />
          <Metric label="Rewards used" value={metrics.marketingRewardsUsed ?? 0} />
        </div>
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-800">Loyalty status</p>
            <h2 className="mt-1 text-lg font-black text-slate-900">
              {loyalty?.currentLevel?.badgeIcon ? `${loyalty.currentLevel.badgeIcon} ` : ""}
              {loyalty?.currentLevel?.name || customer.loyaltyTier || "No loyalty tier"}
            </h2>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${
            loyaltyReward.isEligible
              ? "bg-emerald-100 text-emerald-800"
              : "bg-slate-100 text-slate-700"
          }`}>
            {loyaltyReward.isEligible ? "Reward available" : "No active reward"}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Eligible orders" value={loyalty?.totalOrders ?? "—"} />
          <Metric label="Eligible spend" value={amountText(loyalty?.totalSpend)} />
          <Metric
            label="Reward uses remaining"
            value={loyaltyReward.isEligible
              ? `${loyaltyReward.remainingUses} of ${loyaltyReward.orderLimit}`
              : "—"}
          />
          <Metric label="Next loyalty level" value={loyalty?.nextLevel?.name || "Highest level"} />
        </div>
        {loyaltyReward.title && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-white p-3">
            <p className="text-xs font-bold text-slate-900">{loyaltyReward.title}</p>
            {loyaltyReward.description && <p className="mt-1 text-xs leading-5 text-slate-600">{loyaltyReward.description}</p>}
            {Array.isArray(loyaltyReward.perkTags) && loyaltyReward.perkTags.length > 0 && (
              <p className="mt-2 text-xs text-amber-900">{loyaltyReward.perkTags.join(" · ")}</p>
            )}
          </div>
        )}
        <p className="mt-3 text-[11px] leading-4 text-slate-500">
          Marketing-card scans and claimed/used rewards are summarized above. Open customer activity below to inspect individual cards and reward history.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-900">Contact & addresses</h2>
            <p className="mt-1 text-xs text-slate-500">Basic customer details and saved delivery addresses.</p>
          </div>
          {can("customer:admin_orders_read") && (
            <button type="button" onClick={() => setOrdersOpen(true)} className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">
              View orders ({metrics.orderCount})
            </button>
          )}
        </div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <p><span className="text-xs font-bold uppercase text-slate-500">Email</span><br />{customer.email || "—"}</p>
          <p><span className="text-xs font-bold uppercase text-slate-500">Phone</span><br />{customer.phone || "—"}</p>
          <p><span className="text-xs font-bold uppercase text-slate-500">Account status</span><br />{customer.accountStatus || "—"}</p>
          <p><span className="text-xs font-bold uppercase text-slate-500">Last login</span><br />{dateText(customer.lastLoginAt)}</p>
        </div>
        <div className="mt-4 space-y-2">
          {addresses.length ? addresses.map((address, index) => (
            <article key={`${address.street || address.city || "address"}-${index}`} className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Address {index + 1}{address.isDefault ? " · Default" : ""}</p>
              <p className="mt-1 text-sm text-slate-800">{[address.name, address.phone, address.street, address.landmark, address.city, address.district, address.province, address.zipcode].filter(Boolean).join(", ") || "No address details"}</p>
            </article>
          )) : <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No saved addresses.</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-900">Letters & delivery notes</h2>
            <p className="mt-1 text-xs text-slate-500">Open this section to view or archive handwritten customer letters.</p>
          </div>
          {can("customer:admin_detail") && (
            <button type="button" onClick={() => setLettersOpen((open) => !open)} aria-expanded={lettersOpen} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
              {lettersOpen ? "Hide letters" : "View letters"}
            </button>
          )}
        </div>
        {lettersOpen && (
          <div className="mt-4 space-y-4">
            {can("customer:letter_manage") && (
              <form onSubmit={uploadLetter} className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-700">
                  Letter image
                  <input type="file" accept="image/*" onChange={(event) => setLetterFile(event.target.files?.[0] || null)} className="mt-1 block w-full text-xs" />
                </label>
                <label className="text-xs font-semibold text-slate-700">
                  Title
                  <input value={letterTitle} onChange={(event) => setLetterTitle(event.target.value)} placeholder="Handwritten letter" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                </label>
                <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
                  Notes
                  <textarea value={letterNotes} onChange={(event) => setLetterNotes(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                </label>
                <button type="submit" disabled={uploadingLetter} className="w-fit rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
                  {uploadingLetter ? "Uploading…" : "Save letter"}
                </button>
              </form>
            )}
            {lettersLoading ? <p className="text-sm text-slate-500">Loading letters…</p> : letters.length === 0 ? (
              <p className="text-sm text-slate-500">No archived letters.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {letters.map((letter) => (
                  <article key={letter.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <a href={letter.imageUrl} target="_blank" rel="noreferrer" className="text-sm font-bold text-indigo-700 hover:underline">{letter.title || "Handwritten letter"}</a>
                      <p className="mt-0.5 text-xs text-slate-500">{dateText(letter.createdAt)}{letter.orderId ? ` · Order ${letter.orderId}` : ""}</p>
                      {letter.notes && <p className="mt-1 text-xs text-slate-600">{letter.notes}</p>}
                    </div>
                    {can("customer:letter_manage") && (
                      <button type="button" onClick={() => deleteLetter(letter.id)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">Delete</button>
                    )}
                  </article>
                ))}
              </div>
            )}
            {letterPagination && (
              <Pagination
                page={letterPagination.page}
                totalPages={letterPagination.totalPages}
                total={letterPagination.total}
                limit={letterPagination.limit}
                onPageChange={setLetterPage}
                loading={lettersLoading}
              />
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-900">Other customer activity</h2>
            <p className="mt-1 text-xs text-slate-500">Reviews, returns, exchanges, rewards, letters, and recorded notifications.</p>
          </div>
          <button type="button" onClick={toggleActivity} aria-expanded={activityOpen} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
            {activityOpen ? "Hide activity" : "View activity"}
          </button>
        </div>
        {activityOpen && (
          <div className="mt-4">
            {activityLoading ? (
              <p className="py-8 text-center text-sm text-slate-500">Loading customer activity…</p>
            ) : activityData ? (
              <Customer360Panel data={activityData} token={token} hideProfile hideOrders />
            ) : null}
          </div>
        )}
      </section>

      {ordersOpen && <CustomerOrdersModal customerId={customerId} token={token} onClose={() => setOrdersOpen(false)} />}
    </main>
  );
};

export default CustomerDetail;
