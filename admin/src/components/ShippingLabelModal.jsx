import React, { useState, useEffect, useMemo } from "react";
import { useLocationLookups } from "../utils/locationLookups";
import axios from "axios";
import { backendUrl } from "../App";

const ShippingLabelModal = ({ order, orders = [], currency, onClose }) => {
  const { lookups: locationLookups, lookupError } = useLocationLookups(backendUrl);
  // Normalize order list: if orders array is provided, use it; otherwise wrap single order
  const orderList = useMemo(() => {
    if (orders && orders.length > 0) return orders;
    if (order) return [order];
    return [];
  }, [order, orders]);

  const [senderLocations, setSenderLocations] = useState([]);
  const [activeSender, setActiveSender] = useState(null);
  const [isConfiguringSender, setIsConfiguringSender] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0); // For batch preview pagination
  const [loyaltyMap, setLoyaltyMap] = useState({});

  // Form state for creating/editing sender
  const [senderForm, setSenderForm] = useState({
    name: "Aama Clothings",
    phone: "",
    street: "",
    city: "Kathmandu",
    state: "Bagmati Province",
    zipcode: "44600",
    country: "Nepal",
    note: "Main Warehouse",
  });

  // Fetch customer loyalty mappings
  useEffect(() => {
    const fetchLoyalty = async () => {
      try {
        const token = localStorage.getItem("token") || "";
        if (!token) return;
        const res = await axios.get(`${backendUrl}/api/customer/list`, {
          headers: { token },
        });
        if (res.data.success && res.data.customers) {
          const map = {};
          res.data.customers.forEach((c) => {
            if (c.id) map[c.id] = { ...c.currentLevel, totalSpend: c.totalSpend, totalOrders: c.totalOrders, name: c.name };
            if (c.email) map[c.email.toLowerCase()] = { ...c.currentLevel, totalSpend: c.totalSpend, totalOrders: c.totalOrders, name: c.name };
          });
          setLoyaltyMap(map);
        }
      } catch (e) {
        console.error("Error fetching loyalty in shipping label:", e);
      }
    };
    fetchLoyalty();
  }, []);

  // Load saved sender locations on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("aama_admin_sender_locations");
      const recent = localStorage.getItem("aama_admin_recent_sender");

      let locations = [];
      if (stored) {
        locations = JSON.parse(stored);
      }

      if (locations.length === 0) {
        // First time ever: Ask sender location
        setIsConfiguringSender(true);
        setSenderForm((prev) => ({
          ...prev,
          phone: "+977-9801234567",
          street: "New Road",
          city: "Kathmandu",
          state: "Bagmati Province",
          zipcode: "44600",
        }));
      } else {
        setSenderLocations(locations);
        if (recent) {
          try {
            const parsedRecent = JSON.parse(recent);
            setActiveSender(parsedRecent);
          } catch {
            setActiveSender(locations[0]);
          }
        } else {
          setActiveSender(locations[0]);
        }
        setIsConfiguringSender(false);
      }
    } catch (e) {
      console.error("Error reading sender locations:", e);
      setIsConfiguringSender(true);
    }
  }, []);

  // Handle city selection change in sender form
  const handleCityChange = (cityName) => {
    const matched = locationLookups?.branches?.find((branch) => branch.name === cityName);
    setSenderForm((prev) => ({
      ...prev,
      city: cityName,
      state: matched ? matched.province : prev.state,
    }));
  };

  // Save new or updated sender location
  const handleSaveSender = (e) => {
    e.preventDefault();
    if (
      !senderForm.name ||
      !senderForm.phone ||
      !senderForm.street ||
      !senderForm.city
    ) {
      alert("Please fill in the store name, phone, street address, and city.");
      return;
    }

    const newSender = {
      ...senderForm,
      id: "sender-" + Date.now(),
      savedAt: Date.now(),
    };

    const updated = [
      newSender,
      ...senderLocations.filter(
        (s) => s.street !== newSender.street || s.city !== newSender.city
      ),
    ].slice(0, 5);

    setSenderLocations(updated);
    setActiveSender(newSender);
    setIsConfiguringSender(false);

    try {
      localStorage.setItem(
        "aama_admin_sender_locations",
        JSON.stringify(updated)
      );
      localStorage.setItem(
        "aama_admin_recent_sender",
        JSON.stringify(newSender)
      );
    } catch (err) {
      console.error("Error saving sender to localStorage", err);
    }
  };

  const handleSelectRecentSender = (sender) => {
    setActiveSender(sender);
    try {
      localStorage.setItem("aama_admin_recent_sender", JSON.stringify(sender));
    } catch (err) {
      console.error(err);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (orderList.length === 0) return null;

  const isBatch = orderList.length > 1;
  const currentPreviewOrder = orderList[previewIndex] || orderList[0];

  // Helper component to render an individual 4x6" shipping label
  const renderSingleLabel = (ord, isScreenPreview = false) => {
    const recipientFullName = (ord.address?.firstName || "")
      .concat(" ")
      .concat(ord.address?.lastName || "")
      .trim();

    const isCOD = ord.paymentMethod === "COD" || !ord.payment;
    const orderDateFormatted = new Date(ord.date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    const itemsSubtotal = (ord.items || []).reduce(
      (acc, item) =>
        acc +
        Number(item.purchasedUnitPrice ?? item.price ?? 0) *
          Number(item.quantity || 1),
      0
    );
    const deliveryFee = Math.max(
      0,
      Math.round(Number(ord.amount || 0) - itemsSubtotal)
    );
    const totalQtyCount = (ord.items || []).reduce(
      (acc, item) => acc + Number(item.quantity || 1),
      0
    );

    return (
      <div
        key={ord._id}
        className={`printable-single-label bg-white text-black border-2 border-black rounded-none shadow-md print:shadow-none print:border-2 print:border-black font-sans box-border ${
          isScreenPreview ? "mx-auto" : "print:break-after-page"
        }`}
        style={{
          width: "4in",
          minHeight: "6in",
          maxHeight: "6in",
          padding: "0.18in",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          fontSize: "11px",
          lineHeight: "1.25",
          pageBreakAfter: "always",
          breakAfter: "page",
        }}
      >
        {/* TOP: STORE BRANDING & COURIER HEADER */}
        <div>
          <div className="flex items-center justify-between border-b-2 border-black pb-1.5">
            <div>
              <h1 className="text-base font-black tracking-tight uppercase leading-none">
                {activeSender?.name || "AAMA CLOTHINGS"}
              </h1>
              <p className="text-[9px] font-bold tracking-wider text-gray-700 uppercase mt-0.5">
                Domestic Courier & Delivery Slip
              </p>
            </div>
            <div className="text-right">
              <span className="inline-block bg-black text-white text-[9px] font-extrabold px-1.5 py-0.5 uppercase tracking-wide">
                {isCOD ? "COD PARCEL" : "PREPAID"}
              </span>
              <p className="text-[9px] font-semibold text-gray-600 mt-0.5">
                {orderDateFormatted}
              </p>
            </div>
          </div>

          {/* TRACKING BARCODE SIMULATION */}
          <div className="my-2 py-1 text-center border-b border-black">
            <div className="flex justify-center items-center gap-[2px] h-7 mx-auto overflow-hidden">
              {(ord._id || "ORDER12345678").split("").map((char, i) => {
                const code = char.charCodeAt(0);
                const width = (code % 3) + 1;
                const isBlack = (code + i) % 2 === 0;
                return (
                  <div
                    key={i}
                    style={{
                      width: `${width * 1.5}px`,
                      backgroundColor: isBlack ? "#000" : "#fff",
                    }}
                    className="h-full inline-block"
                  />
                );
              })}
            </div>
            <p className="text-[9px] font-mono tracking-widest font-bold mt-0.5">
              * {ord._id?.toUpperCase()} *
            </p>
          </div>

          {/* SENDER (FROM) & RECIPIENT (TO) SPLIT */}
          <div className="grid grid-cols-2 gap-2 border-b-2 border-black pb-2 text-[10px]">
            {/* SENDER BLOCK */}
            <div className="border-r border-gray-400 pr-1.5">
              <p className="text-[8px] font-extrabold uppercase tracking-wider text-gray-500 mb-0.5">
                FROM (Shipper / Warehouse):
              </p>
              <p className="font-bold text-[11px] leading-tight">
                {activeSender?.name || "Aama Clothings"}
              </p>
              <p className="leading-tight text-gray-800">{activeSender?.street}</p>
              <p className="leading-tight text-gray-800">
                {activeSender?.city}, {activeSender?.state}
              </p>
              <p className="leading-tight text-gray-800">
                Nepal - {activeSender?.zipcode}
              </p>
              <p className="font-bold text-[10px] mt-1">
                Ph: {activeSender?.phone}
              </p>
            </div>

            {/* RECIPIENT BLOCK */}
            <div className="pl-1">
              <p className="text-[8px] font-extrabold uppercase tracking-wider text-gray-500 mb-0.5">
                TO (Recipient / Consignee):
              </p>
              <p className="font-black text-[12px] text-black leading-tight">
                {recipientFullName}
              </p>
              <p className="font-bold text-[11px] text-black tracking-wide my-0.5">
                📞 {ord.address?.phone}
              </p>
              <p className="leading-tight text-gray-900 font-medium">
                {ord.address?.street}
              </p>
              <p className="leading-tight text-gray-900 font-medium">
                {ord.address?.city}, {ord.address?.state}
              </p>
              <p className="leading-tight text-gray-800">
                Nepal {ord.address?.zipcode ? `- ${ord.address?.zipcode}` : ""}
              </p>
            </div>
          </div>

          {/* CRITICAL NEPAL LANDMARK BOX */}
          {ord.address?.landmark && (
            <div className="my-1 p-1 bg-yellow-50 border-2 border-dashed border-black text-center">
              <p className="text-[8px] uppercase tracking-wider font-extrabold text-gray-600">
                📍 Nearest Delivery Landmark:
              </p>
              <p className="font-black text-[11px] uppercase tracking-wide text-black">
                {ord.address.landmark}
              </p>
            </div>
          )}

          {/* CUSTOMER PURCHASE LEVEL & REWARD / LETTER NOTICE */}
          {(() => {
            let applied = null;
            if (ord.rewardApplied) {
              if (typeof ord.rewardApplied === "object") applied = ord.rewardApplied;
              else {
                try { applied = JSON.parse(ord.rewardApplied); } catch { applied = null; }
              }
            }

            const loyalty = loyaltyMap[ord.userId] || loyaltyMap[ord.address?.email?.toLowerCase()];
            if (!applied && !loyalty) return null;

            return (
              <div className="my-1 px-1.5 py-1 bg-gray-50 border border-black flex items-center justify-between text-[8.5px]">
                <div className="flex items-center gap-1 font-bold">
                  <span>{applied?.levelIcon || loyalty?.badgeIcon || "⭐"}</span>
                  <span className="uppercase font-black text-black">
                    {applied?.levelName || loyalty?.name || `VIP Level`}
                  </span>
                  {loyalty && (
                    <span className="text-gray-600 font-normal">
                      (Spend: {currency}{loyalty.totalSpend?.toLocaleString() || 0})
                    </span>
                  )}
                </div>
                <div className="font-black text-black uppercase text-[8px] bg-white px-1.5 py-0.5 border border-black">
                  {applied?.title ? `🎁 REWARD: ${applied.title} (${applied.usage || "Applied"})` : `🎁 ${loyalty?.rewardTitle || "Loyalty Member"}`}
                </div>
              </div>
            );
          })()}

          {/* PACKAGE CONTENT SUMMARY TABLE WITH RATE & LINE TOTALS */}
          <div className="my-1.5">
            <table className="w-full text-left text-[9px] border-collapse">
              <thead>
                <tr className="border-b border-black text-gray-700 uppercase text-[8px]">
                  <th className="py-0.5">Item</th>
                  <th className="py-0.5 text-center">Var</th>
                  <th className="py-0.5 text-center">Qty</th>
                  <th className="py-0.5 text-right">Rate</th>
                  <th className="py-0.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {ord.items?.slice(0, 3).map((item, idx) => {
                  const unitRate = Number(item.purchasedUnitPrice ?? item.price ?? 0);
                  const qty = Number(item.quantity || 1);
                  const lineTotal = unitRate * qty;

                  return (
                    <tr key={idx} className="border-b border-gray-200">
                      <td className="py-0.5 font-medium truncate max-w-[125px]">
                        {item.name}
                      </td>
                      <td className="py-0.5 text-center text-gray-600 text-[8px]">
                        {item.size || ""}
                        {item.color ? `/${item.color}` : ""}
                      </td>
                      <td className="py-0.5 text-center font-bold">
                        {qty}
                      </td>
                      <td className="py-0.5 text-right text-gray-600">
                        {currency}{unitRate}
                      </td>
                      <td className="py-0.5 text-right font-bold text-black">
                        {currency}{lineTotal}
                      </td>
                    </tr>
                  );
                })}
                {ord.items?.length > 3 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-0.5 text-gray-500 italic text-center text-[8px]"
                    >
                      + {ord.items.length - 3} more item(s) in package
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* FINANCIAL TOTALS BREAKDOWN */}
            <div className="border-t border-black pt-1 my-1 text-[8.5px] space-y-0.5">
              <div className="flex justify-between items-center text-gray-700">
                <span>Items Subtotal ({totalQtyCount} pcs):</span>
                <span className="font-semibold text-black">{currency} {itemsSubtotal}</span>
              </div>
              {Number(ord.loyaltyDiscount || 0) > 0 && (
                <div className="flex justify-between items-center text-black font-bold">
                  <span>VIP Level Reward Discount:</span>
                  <span className="text-black">-{currency} {ord.loyaltyDiscount}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-gray-700">
                <span>Delivery / Shipping Fee:</span>
                <span className="font-semibold text-black">
                  {deliveryFee > 0 ? `${currency} ${deliveryFee}` : "FREE"}
                </span>
              </div>
              <div className="flex justify-between items-center font-black text-[9.5px] text-black border-t border-dashed border-gray-400 pt-0.5">
                <span>Grand Total:</span>
                <span>{currency} {ord.amount}</span>
              </div>
            </div>
          </div>
        </div>

        {/* BOTTOM: COD CASH TO COLLECT BANNER & COURIER HANDOVER */}
        <div>
          {/* PAYMENT SUMMARY BOX */}
          <div
            className={`p-1.5 border-2 text-center my-1 ${
              isCOD ? "border-black bg-gray-100" : "border-black bg-white"
            }`}
          >
            <p className="text-[8px] font-extrabold uppercase tracking-widest text-gray-700">
              {isCOD ? "CASH ON DELIVERY (COD)" : "PREPAID ONLINE ORDER"}
            </p>
            <p className="text-sm font-black leading-tight tracking-tight mt-0.5">
              {isCOD ? (
                <span>
                  COLLECT EXACT CASH: {currency} {ord.amount}
                </span>
              ) : (
                <span>PAID ONLINE - DO NOT COLLECT CASH</span>
              )}
            </p>
            <p className="text-[8px] text-gray-600 mt-0.5 font-medium">
              {isCOD
                ? `(Items: ${currency}${itemsSubtotal} + Shipping: ${currency}${deliveryFee})`
                : `(Total Paid: ${currency}${ord.amount})`}{" "}
              • Payment: {ord.paymentMethod}
            </p>
          </div>

          {/* SIGNATURE & DISPATCH ACKNOWLEDGEMENT */}
          <div className="grid grid-cols-2 gap-2 text-[8px] border-t border-black pt-1 mt-1">
            <div>
              <p className="font-bold">Courier Partner:</p>
              <p className="text-gray-600">________________________</p>
            </div>
            <div className="text-right">
              <p className="font-bold">Receiver's Signature:</p>
              <p className="text-gray-600">________________________</p>
            </div>
          </div>

          <div className="text-center text-[7px] text-gray-500 mt-1 uppercase tracking-widest">
            Aama Clothings • Order #{ord._id?.slice(-8).toUpperCase()} • Standard 4x6" Courier Label
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-5 overflow-y-auto print:p-0 print:bg-white print:static">
      {/* Container - Screen vs Print Mode */}
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full border border-gray-200 overflow-hidden my-auto flex flex-col max-h-[92vh] print:max-h-none print:max-w-none print:shadow-none print:border-none print:rounded-none">
        
        {/* Screen Header (Hidden on Print) */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/80 print:hidden">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 border border-indigo-100 font-bold">
              {isBatch ? `${orderList.length}x` : "4x6"}
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 leading-tight">
                {isBatch
                  ? `Batch Courier Shipping Labels (${orderList.length} New Orders)`
                  : 'Courier Shipping Label (4" x 6" Format)'}
              </h2>
              <p className="text-xs text-gray-500">
                {isBatch
                  ? `Ready to print ${orderList.length} labels at once in standard 4x6" thermal format`
                  : `Order #${currentPreviewOrder._id?.slice(-8).toUpperCase()} • ${(currentPreviewOrder.address?.firstName || "").concat(" ").concat(currentPreviewOrder.address?.lastName || "")}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isConfiguringSender && activeSender && (
              <button
                type="button"
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-lg text-sm font-semibold shadow-sm transition-all"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                  />
                </svg>
                <span>
                  {isBatch
                    ? `Print All ${orderList.length} Labels (4x6)`
                    : "Print 4x6 Label"}
                </span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 print:p-0 print:overflow-visible">
          {/* Sender Location Config Bar / Alert (Screen Only) */}
          <div className="print:hidden mb-5">
            {isConfiguringSender ? (
              <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse"></span>
                    <h3 className="font-bold text-indigo-950 text-sm">
                      {senderLocations.length === 0
                        ? "First-time Setup: Sender / Warehouse Location"
                        : "Update Sender Location"}
                    </h3>
                  </div>
                  {senderLocations.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsConfiguringSender(false)}
                      className="text-xs text-gray-500 hover:text-gray-800 underline font-medium"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-600 mb-4">
                  Please provide your store dispatch address. This will appear
                  in the <strong>FROM</strong> section of all 4x6 courier labels
                  and will be remembered for future prints.
                </p>

                <form
                  onSubmit={handleSaveSender}
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
                >
                  {lookupError && <p role="alert" className="sm:col-span-2 lg:col-span-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{lookupError}</p>}
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-700 uppercase mb-1">
                      Store / Sender Name
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-md focus:border-indigo-500"
                      value={senderForm.name}
                      onChange={(e) =>
                        setSenderForm({ ...senderForm, name: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-700 uppercase mb-1">
                      Sender Contact Phone
                    </label>
                    <input
                      type="text"
                      placeholder="+977-9800000000"
                      className="w-full px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-md focus:border-indigo-500"
                      value={senderForm.phone}
                      onChange={(e) =>
                        setSenderForm({ ...senderForm, phone: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-700 uppercase mb-1">
                      Street / Area / Ward
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. New Road, Ward 22"
                      className="w-full px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-md focus:border-indigo-500"
                      value={senderForm.street}
                      onChange={(e) =>
                        setSenderForm({ ...senderForm, street: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-700 uppercase mb-1">
                      City (Nepal)
                    </label>
                    <select
                      className="w-full px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-md focus:border-indigo-500"
                      value={senderForm.city}
                      onChange={(e) => handleCityChange(e.target.value)}
                    >
                      {(locationLookups?.branches || []).map((branch) => (
                        <option key={branch.name} value={branch.name}>
                          {branch.name} ({branch.province})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-700 uppercase mb-1">
                      Province / State
                    </label>
                    <select
                      className="w-full px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-md focus:border-indigo-500"
                      value={senderForm.state}
                      onChange={(e) =>
                        setSenderForm({ ...senderForm, state: e.target.value })
                      }
                    >
                      {(locationLookups?.provinces || []).map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-700 uppercase mb-1">
                      Zipcode & Country
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        className="w-1/2 px-2 py-1.5 text-xs bg-white border border-gray-300 rounded-md"
                        value={senderForm.zipcode}
                        onChange={(e) =>
                          setSenderForm({
                            ...senderForm,
                            zipcode: e.target.value,
                          })
                        }
                      />
                      <input
                        type="text"
                        disabled
                        value="Nepal"
                        className="w-1/2 px-2 py-1.5 text-xs bg-gray-100 border border-gray-300 rounded-md text-gray-500"
                      />
                    </div>
                  </div>

                  <div className="sm:col-span-2 lg:col-span-3 flex justify-end gap-2 mt-2">
                    <button
                      type="submit"
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm"
                    >
                      Save & Use This Sender Location
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  <div>
                    <span className="text-gray-500 font-medium">
                      Active Sender (FROM):{" "}
                    </span>
                    <span className="font-bold text-gray-800">
                      {activeSender?.name} • {activeSender?.street},{" "}
                      {activeSender?.city} ({activeSender?.phone})
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Suggest / Switch from recent sender locations */}
                  {senderLocations.length > 1 && (
                    <select
                      className="px-2 py-1 text-xs bg-white border border-gray-300 rounded-md text-gray-700 font-medium"
                      value={activeSender?.id || ""}
                      onChange={(e) => {
                        const sel = senderLocations.find(
                          (s) => s.id === e.target.value
                        );
                        if (sel) handleSelectRecentSender(sel);
                      }}
                    >
                      {senderLocations.map((loc, idx) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name} - {loc.street}, {loc.city}{" "}
                          {idx === 0 ? "(Most Recent)" : ""}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (activeSender) {
                        setSenderForm(activeSender);
                      }
                      setIsConfiguringSender(true);
                    }}
                    className="px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md border border-indigo-200 transition-colors"
                  >
                    Change Sender Location
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Batch Mode Navigation Bar (Screen Only) */}
          {isBatch && (
            <div className="print:hidden mb-4 bg-indigo-50/80 border border-indigo-100 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="bg-indigo-600 text-white font-bold text-xs px-2.5 py-0.5 rounded-full">
                  Label {previewIndex + 1} of {orderList.length}
                </span>
                <span className="text-xs font-medium text-indigo-900">
                  Previewing:{" "}
                  <strong>
                    #
                    {currentPreviewOrder._id?.slice(-8).toUpperCase()}
                  </strong>{" "}
                  -{" "}
                  {(currentPreviewOrder.address?.firstName || "")
                    .concat(" ")
                    .concat(currentPreviewOrder.address?.lastName || "")}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={previewIndex === 0}
                  onClick={() => setPreviewIndex((prev) => Math.max(0, prev - 1))}
                  className="px-3 py-1 bg-white border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                >
                  ← Previous
                </button>
                <button
                  type="button"
                  disabled={previewIndex === orderList.length - 1}
                  onClick={() =>
                    setPreviewIndex((prev) =>
                      Math.min(orderList.length - 1, prev + 1)
                    )
                  }
                  className="px-3 py-1 bg-white border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {/* SCREEN PREVIEW CONTAINER */}
          <div className="flex justify-center bg-gray-100 p-4 sm:p-6 rounded-xl border border-gray-200 print:hidden">
            {renderSingleLabel(currentPreviewOrder, true)}
          </div>

          {/* PRINT-ONLY CONTAINER (Prints ALL labels in sequence, each on a fresh 4x6 page) */}
          <div id="printable-batch-container" className="hidden print:block">
            {orderList.map((ord) => renderSingleLabel(ord, false))}
          </div>
        </div>

        {/* Modal Footer Controls (Hidden on Print) */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50 print:hidden text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <svg
              className="w-4 h-4 text-emerald-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span>
              {isBatch
                ? `Clicking "Print All Labels" will send all ${orderList.length} courier slips to your 4x6" thermal printer with automatic page breaks.`
                : 'Label dimensions formatted strictly for 4" x 6" thermal print sticker.'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-gray-600 hover:text-gray-800 font-medium hover:bg-gray-100 rounded-lg transition-colors"
            >
              Close
            </button>
            {activeSender && (
              <button
                type="button"
                onClick={handlePrint}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold shadow-sm transition-all"
              >
                {isBatch
                  ? `Print All ${orderList.length} Labels Now`
                  : "Print Label Now"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Global Print Styles Injection */}
      <style>{`
        @media print {
          @page {
            size: 4in 6in;
            margin: 0mm !important;
          }
          body {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          /* Hide everything in app except the print batch container */
          body * {
            visibility: hidden;
          }
          #printable-batch-container, #printable-batch-container * {
            visibility: visible !important;
          }
          #printable-batch-container {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .printable-single-label {
            position: relative !important;
            width: 4in !important;
            height: 6in !important;
            min-height: 6in !important;
            max-height: 6in !important;
            margin: 0 auto !important;
            padding: 0.18in !important;
            border: 2px solid #000 !important;
            box-sizing: border-box !important;
            page-break-after: always !important;
            break-after: page !important;
            background: white !important;
            overflow: hidden !important;
          }
        }
      `}</style>
    </div>
  );
};

export default ShippingLabelModal;
