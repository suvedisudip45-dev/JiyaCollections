/* eslint-disable react/prop-types */
/* eslint-disable no-unused-vars */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { backendUrl, currency } from "../App";
import { toast } from "react-toastify";
import Pagination from "../components/Pagination";

const Customers = ({ token }) => {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [customerDetails, setCustomerDetails] = useState(null);

  // Letter upload modal / form state
  const [uploadingLetter, setUploadingLetter] = useState(false);
  const [letterFile, setLetterFile] = useState(null);
  const [letterPreview, setLetterPreview] = useState(null);
  const [letterTitle, setLetterTitle] = useState("");
  const [letterNotes, setLetterNotes] = useState("");
  const [letterOrderId, setLetterOrderId] = useState("");
  const [activeImageZoom, setActiveImageZoom] = useState(null);

  // Fetch all customers
  const fetchCustomers = async (searchQuery = search, requestedPage = page) => {
    try {
      setLoading(true);
      const res = await axios.get(`${backendUrl}/api/customer/list?search=${encodeURIComponent(searchQuery)}&page=${requestedPage}&limit=10`, {
        headers: { token },
      });
      if (res.data.success) {
        setCustomers(res.data.customers || []);
        setPagination(res.data.pagination || null);
      } else {
        toast.error(res.data.message || "Failed to load customers");
      }
    } catch (err) {
      console.error(err);
      toast.error("Error fetching customers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchCustomers(search);
    }
  }, [token]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    fetchCustomers(search, 1);
  };

  const handlePageChange = (nextPage) => {
    setPage(nextPage);
    fetchCustomers(search, nextPage);
  };

  // Open customer details modal
  const handleOpenDetails = async (cust) => {
    setSelectedCustomer(cust);
    setLetterFile(null);
    setLetterPreview(null);
    setLetterTitle("");
    setLetterNotes("");
    setLetterOrderId("");
    try {
      setDetailsLoading(true);
      const res = await axios.get(`${backendUrl}/api/customer/details/${cust.id}`, {
        headers: { token },
      });
      if (res.data.success) {
        setCustomerDetails(res.data);
      } else {
        toast.error(res.data.message || "Failed to load customer details");
      }
    } catch (err) {
      console.error(err);
      toast.error("Error loading customer data");
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setLetterFile(file);
      setLetterPreview(URL.createObjectURL(file));
      if (!letterTitle) {
        setLetterTitle(`Letter sent on ${new Date().toLocaleDateString()}`);
      }
    }
  };

  const handleUploadLetter = async (e) => {
    e.preventDefault();
    if (!letterFile || !selectedCustomer) {
      toast.error("Please select a letter image file to upload");
      return;
    }

    try {
      setUploadingLetter(true);
      const formData = new FormData();
      formData.append("image", letterFile);
      formData.append("userId", selectedCustomer.id);
      formData.append("title", letterTitle || "Handwritten Letter");
      formData.append("notes", letterNotes);
      if (letterOrderId) formData.append("orderId", letterOrderId);

      const res = await axios.post(`${backendUrl}/api/customer/letter/upload`, formData, {
        headers: { token, "Content-Type": "multipart/form-data" },
      });

      if (res.data.success) {
        toast.success("Letter image saved successfully!");
        setLetterFile(null);
        setLetterPreview(null);
        setLetterTitle("");
        setLetterNotes("");
        setLetterOrderId("");
        // Refresh customer details
        const refreshed = await axios.get(`${backendUrl}/api/customer/details/${selectedCustomer.id}`, {
          headers: { token },
        });
        if (refreshed.data.success) {
          setCustomerDetails(refreshed.data);
        }
        // Also refresh list letter count
        fetchCustomers(search);
      } else {
        toast.error(res.data.message || "Upload failed");
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to upload letter image");
    } finally {
      setUploadingLetter(false);
    }
  };

  const handleDeleteLetter = async (letterId) => {
    if (!window.confirm("Are you sure you want to delete this letter record?")) return;
    try {
      const res = await axios.delete(`${backendUrl}/api/customer/letter/${letterId}`, {
        headers: { token },
      });
      if (res.data.success) {
        toast.success("Letter removed");
        setCustomerDetails((prev) => ({
          ...prev,
          letters: prev.letters.filter((l) => l.id !== letterId),
        }));
        fetchCustomers(search);
      } else {
        toast.error(res.data.message || "Failed to delete");
      }
    } catch (err) {
      console.error(err);
      toast.error("Error deleting letter image");
    }
  };

  // Aggregated Stats
  const totalRevenue = customers.reduce((sum, c) => sum + c.totalSpend, 0);
  const totalCustomerOrders = customers.reduce((sum, c) => sum + c.totalOrders, 0);
  const totalLettersArchived = customers.reduce((sum, c) => sum + c.letterCount, 0);

  return (
    <div className="w-full max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2.5">
              Customers &amp; Loyalty Records
            </h1>
            <p className="text-xs text-gray-500 mt-1">
              Track customer purchase game levels, order stats, and archive handwritten letters/gift notes sent.
            </p>
          </div>

          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, phone, city..."
                className="w-64 sm:w-80 px-3.5 py-2 pl-9 bg-white border border-gray-300 rounded-xl text-xs focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
              />
              <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
            >
              Search
            </button>
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  fetchCustomers("");
                }}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-semibold"
              >
                Clear
              </button>
            )}
          </form>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Total Customers</p>
            <p className="text-xl font-black text-gray-900 mt-1">{customers.length}</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Total Revenue</p>
            <p className="text-xl font-black text-indigo-600 mt-1">{currency}{totalRevenue.toLocaleString()}</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Total Orders Placed</p>
            <p className="text-xl font-black text-emerald-600 mt-1">{totalCustomerOrders}</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Letter Images Stored</p>
            <p className="text-xl font-black text-amber-500 mt-1">{totalLettersArchived} 💌</p>
          </div>
        </div>
      </div>

      {/* Customer List Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-xs font-semibold">Loading customer database...</p>
          </div>
        ) : customers.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <span className="text-3xl mb-2 block">🔍</span>
            <p className="text-sm font-semibold">No customers found</p>
            <p className="text-xs text-gray-400 mt-1">Try adjusting your search query.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Loyalty Level</th>
                  <th className="py-3 px-4">Social Code</th>
                  <th className="py-3 px-4">Total Spend</th>
                  <th className="py-3 px-4">Orders</th>
                  <th className="py-3 px-4">Letters Sent</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {customers.map((c) => {
                  const lvl = c.currentLevel || { name: "Level 1", badgeIcon: "🥉", color: "#CD7F32" };
                  return (
                    <tr key={c.id} className="hover:bg-indigo-50/30 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 text-white font-bold text-xs flex items-center justify-center shadow-sm">
                            {(c.name || "C").charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-bold text-gray-900">{c.name}</p>
                            <p className="text-[11px] text-gray-500">{c.email}</p>
                            {c.phone && <p className="text-[10px] text-gray-400">📞 {c.phone}</p>}
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold shadow-xs border"
                          style={{
                            backgroundColor: `${lvl.color}15`,
                            color: lvl.color,
                            borderColor: `${lvl.color}40`,
                          }}
                        >
                          <span>{lvl.badgeIcon}</span>
                          <span>{lvl.name}</span>
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        {c.socialCustomerCode ? (
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-violet-100 text-violet-700 font-black px-2 py-1 border border-violet-200">
                              {c.socialCustomerCode}
                            </span>
                            {c.loyaltyTier && (
                              <span className="text-[10px] text-gray-500">Tier: {c.loyaltyTier}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400 text-[11px]">—</span>
                        )}
                      </td>

                      <td className="py-3 px-4 font-black text-gray-900">
                        {currency}{c.totalSpend.toLocaleString()}
                      </td>

                      <td className="py-3 px-4 font-semibold text-gray-700">
                        {c.totalOrders} {c.totalOrders === 1 ? "order" : "orders"}
                      </td>

                      <td className="py-3 px-4">
                        {c.letterCount > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 font-bold text-[11px] border border-amber-200">
                            💌 {c.letterCount} {c.letterCount === 1 ? "letter" : "letters"}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-[11px]">No letters</span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => handleOpenDetails(c)}
                          className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg text-xs transition-colors"
                        >
                          View & Add Letters →
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={pagination?.page || page}
          totalPages={pagination?.totalPages || 0}
          total={pagination?.total || 0}
          onPageChange={handlePageChange}
          loading={loading}
        />
      </div>

      {/* Customer Detail & Letters Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-indigo-600 text-white font-black text-sm flex items-center justify-center shadow-md">
                  {(selectedCustomer.name || "C").charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                    {selectedCustomer.name}
                    {customerDetails?.loyalty?.currentLevel && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-bold border"
                        style={{
                          backgroundColor: `${customerDetails.loyalty.currentLevel.color}15`,
                          color: customerDetails.loyalty.currentLevel.color,
                          borderColor: `${customerDetails.loyalty.currentLevel.color}40`,
                        }}
                      >
                        {customerDetails.loyalty.currentLevel.badgeIcon} {customerDetails.loyalty.currentLevel.name}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {selectedCustomer.email} • Phone: {selectedCustomer.phone || "N/A"}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-full transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
              {detailsLoading ? (
                <div className="py-16 text-center text-gray-400">
                  <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="font-semibold">Loading full customer record...</p>
                </div>
              ) : customerDetails ? (
                <>
                  {/* Loyalty Level Progress Card */}
                  {customerDetails.loyalty && (
                    <div className="p-4 rounded-2xl bg-gradient-to-r from-gray-900 to-indigo-950 text-white shadow-lg">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl">{customerDetails.loyalty.currentLevel?.badgeIcon}</span>
                          <div>
                            <p className="text-[10px] uppercase font-bold tracking-widest text-indigo-300">Current Loyalty Level</p>
                            <h4 className="text-lg font-black">{customerDetails.loyalty.currentLevel?.name}</h4>
                            <p className="text-xs text-gray-300 mt-0.5">
                              🎁 Reward: <strong>{customerDetails.loyalty.currentLevel?.rewardTitle}</strong>
                            </p>
                          </div>
                        </div>

                        <div className="bg-white/10 backdrop-blur-md px-4 py-2.5 rounded-xl border border-white/10 flex items-center gap-6">
                          <div>
                            <p className="text-[10px] text-gray-300 uppercase font-semibold">Total Spend</p>
                            <p className="text-sm font-black text-emerald-400">
                              {currency}{customerDetails.loyalty.totalSpend.toLocaleString()}
                            </p>
                          </div>
                          <div className="w-px h-8 bg-white/20" />
                          <div>
                            <p className="text-[10px] text-gray-300 uppercase font-semibold">Total Orders</p>
                            <p className="text-sm font-black text-amber-300">
                              {customerDetails.loyalty.totalOrders}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Next level progress bar */}
                      {customerDetails.loyalty.nextLevel ? (
                        <div className="mt-4 pt-4 border-t border-white/10">
                          <div className="flex justify-between text-xs mb-1.5">
                            <span className="font-semibold text-gray-200">
                              Progress to Next Level: <strong>{customerDetails.loyalty.nextLevel.badgeIcon} {customerDetails.loyalty.nextLevel.name}</strong>
                            </span>
                            <span className="font-black text-indigo-300">{customerDetails.loyalty.progressPercentage}%</span>
                          </div>
                          <div className="w-full bg-white/20 h-2.5 rounded-full overflow-hidden">
                            <div
                              className="bg-gradient-to-r from-amber-400 to-emerald-400 h-full rounded-full transition-all duration-500"
                              style={{ width: `${Math.min(100, customerDetails.loyalty.progressPercentage)}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-[11px] text-gray-300 mt-1.5">
                            <span>
                              Spend {currency}{customerDetails.loyalty.remainingSpend.toLocaleString()} more
                            </span>
                            <span>
                              {customerDetails.loyalty.remainingOrders > 0
                                ? `Place ${customerDetails.loyalty.remainingOrders} more order(s)`
                                : "Order count met! ✅"}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 pt-3 border-t border-white/10 text-emerald-300 font-bold text-xs flex items-center gap-1.5">
                          <span>👑</span> Maximum Level Achieved! Top VIP customer.
                        </div>
                      )}
                    </div>
                  )}

                  {/* LETTER IMAGES ARCHIVE SECTION */}
                  <div className="bg-amber-50/60 p-5 rounded-2xl border border-amber-200">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-sm font-black text-amber-900 flex items-center gap-2">
                          <span>💌</span> Handwritten Letters & Gift Notes Archive
                        </h4>
                        <p className="text-[11px] text-amber-700 mt-0.5">
                          Store photos of personalized letters, dispatch cards, and gift vouchers sent to this customer.
                        </p>
                      </div>
                      <span className="px-2.5 py-1 bg-amber-200 text-amber-900 font-black rounded-full text-xs">
                        {customerDetails.letters?.length || 0} Archived
                      </span>
                    </div>

                    {/* Upload New Letter Form */}
                    <form onSubmit={handleUploadLetter} className="bg-white p-4 rounded-xl border border-amber-200 shadow-sm space-y-3 mt-3">
                      <div className="font-bold text-gray-800 text-xs flex items-center gap-1.5">
                        <span>📤</span> Upload New Letter / Note Image
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                            Letter Image File (Photo/Scan) *
                          </label>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleFileChange}
                            required
                            className="w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-amber-100 file:text-amber-800 hover:file:bg-amber-200 cursor-pointer"
                          />
                          {letterPreview && (
                            <div className="mt-2 relative inline-block">
                              <img
                                src={letterPreview}
                                alt="Preview"
                                className="w-20 h-20 object-cover rounded-lg border border-amber-300 shadow-xs"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setLetterFile(null);
                                  setLetterPreview(null);
                                }}
                                className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 text-[10px] flex items-center justify-center shadow"
                              >
                                ✕
                              </button>
                            </div>
                          )}
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                            Letter Title / Occasion
                          </label>
                          <input
                            type="text"
                            value={letterTitle}
                            onChange={(e) => setLetterTitle(e.target.value)}
                            placeholder="e.g. VIP Level 2 Thank You Letter"
                            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:border-amber-500 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                            Related Order (Optional)
                          </label>
                          <select
                            value={letterOrderId}
                            onChange={(e) => setLetterOrderId(e.target.value)}
                            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:border-amber-500 focus:outline-none"
                          >
                            <option value="">-- None / General Customer Letter --</option>
                            {customerDetails.orders?.map((ord) => (
                              <option key={ord.id} value={ord.id}>
                                Order #{ord.id.slice(-6).toUpperCase()} ({currency}{ord.amount}) - {new Date(Number(ord.date)).toLocaleDateString()}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">
                            Notes on What Was Written / Sent
                          </label>
                          <input
                            type="text"
                            value={letterNotes}
                            onChange={(e) => setLetterNotes(e.target.value)}
                            placeholder="e.g. Sent 100 off voucher code 'AAMA100' + handwritten letter"
                            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-xs focus:border-amber-500 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end pt-1">
                        <button
                          type="submit"
                          disabled={uploadingLetter || !letterFile}
                          className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold rounded-lg text-xs shadow-sm transition-all flex items-center gap-2"
                        >
                          {uploadingLetter ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              <span>Uploading to Archive...</span>
                            </>
                          ) : (
                            <>
                              <span>💾</span> Save Letter to Customer Record
                            </>
                          )}
                        </button>
                      </div>
                    </form>

                    {/* Stored Letters Gallery Grid */}
                    <div className="mt-4">
                      <p className="text-[11px] font-bold uppercase text-amber-900 tracking-wider mb-2">
                        Archived Letters History ({customerDetails.letters?.length || 0})
                      </p>
                      {customerDetails.letters?.length === 0 ? (
                        <div className="p-6 bg-white/70 rounded-xl border border-dashed border-amber-300 text-center text-amber-800">
                          <p className="font-semibold text-xs">No letters archived yet.</p>
                          <p className="text-[11px] text-amber-600 mt-0.5">
                            Upload a photo of your handwritten letter above so you always remember what you wrote!
                          </p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                          {customerDetails.letters.map((letter) => (
                            <div
                              key={letter.id}
                              className="bg-white rounded-xl border border-amber-200 overflow-hidden shadow-xs hover:shadow-md transition-shadow group flex flex-col justify-between"
                            >
                              <div
                                onClick={() => setActiveImageZoom(letter.imageUrl)}
                                className="relative aspect-4/3 bg-gray-100 cursor-pointer overflow-hidden"
                              >
                                <img
                                  src={letter.imageUrl}
                                  alt={letter.title}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                />
                                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white font-bold text-xs">
                                  🔍 Click to Zoom
                                </div>
                              </div>

                              <div className="p-2.5">
                                <p className="font-bold text-gray-900 truncate" title={letter.title}>
                                  {letter.title || "Handwritten Letter"}
                                </p>
                                {letter.notes && (
                                  <p className="text-[10px] text-gray-500 line-clamp-2 mt-0.5" title={letter.notes}>
                                    📝 {letter.notes}
                                  </p>
                                )}
                                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 text-[10px] text-gray-400">
                                  <span>{new Date(letter.createdAt).toLocaleDateString()}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteLetter(letter.id)}
                                    className="text-red-500 hover:text-red-700 font-bold hover:underline"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Past Orders History List */}
                  <div>
                    <h4 className="text-sm font-black text-gray-900 mb-2 flex items-center gap-1.5">
                      <span>📦</span> Customer Orders History ({customerDetails.orders?.length || 0})
                    </h4>
                    {customerDetails.orders?.length === 0 ? (
                      <p className="text-gray-400 text-xs italic">No orders placed yet.</p>
                    ) : (
                      <div className="space-y-2">
                        {customerDetails.orders.map((ord) => (
                          <div
                            key={ord.id}
                            className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-black text-gray-900">
                                  #{ord.id.slice(-8).toUpperCase()}
                                </span>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">
                                  {ord.status}
                                </span>
                                <span className="text-[10px] text-gray-400">
                                  {new Date(ord.date).toLocaleDateString()}
                                </span>
                              </div>
                              <p className="text-[11px] text-gray-500 mt-1">
                                {ord.items?.length || 0} item(s): {ord.items?.map((i) => i.name).join(", ")}
                              </p>
                            </div>

                            <div className="text-right">
                              <p className="font-black text-indigo-600 text-sm">
                                {currency}{Number(ord.amount).toLocaleString()}
                              </p>
                              <p className="text-[10px] text-gray-400">Payment: {ord.paymentMethod}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-xl text-xs font-bold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULLSCREEN IMAGE LIGHTBOX ZOOM */}
      {activeImageZoom && (
        <div
          onClick={() => setActiveImageZoom(null)}
          className="fixed inset-0 z-60 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 cursor-pointer"
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img
              src={activeImageZoom}
              alt="Zoomed Letter"
              className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl border-2 border-white/20"
            />
            <p className="text-center text-white/70 text-xs mt-2">Click anywhere to close preview</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Customers;
