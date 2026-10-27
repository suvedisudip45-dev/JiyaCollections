import React, { useState, useMemo } from "react";
import { useManufacturer } from "../context/ManufacturerContext";
import "./DistributorCourierSlip.css";

const ShippingLabelModal = ({ order, orders = [], currency = "Rs.", onClose }) => {
  const { manufacturer } = useManufacturer();

  const orderList = useMemo(() => {
    if (orders && orders.length > 0) return orders;
    if (order) return [order];
    return [];
  }, [order, orders]);

  const [previewIndex, setPreviewIndex] = useState(0);

  const senderInfo = {
    name: manufacturer?.name || "Aama Clothing Hub",
    phone: manufacturer?.phone || "+977-9801234567",
    street: manufacturer?.address || "Hub Operations Facility",
    city: manufacturer?.city || "Kathmandu",
    state: "Nepal",
    zipcode: "44600",
    country: "Nepal",
  };

  const handlePrint = () => {
    window.print();
  };

  if (orderList.length === 0) return null;

  const currentOrder = orderList[previewIndex] || orderList[0];
  const items = Array.isArray(currentOrder.items) ? currentOrder.items : [];
  const address = currentOrder.address || {};
  const orderIdShort = (currentOrder.id || currentOrder._id || "").slice(-8).toUpperCase();
  const totalQty = items.reduce((acc, it) => acc + Number(it.quantity || 1), 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              4×6&quot; Courier Dispatch Shipping Slip
            </h3>
            <p className="text-xs text-slate-500">
              Thermal print label with barcode, hub sender details, and COD collection amount.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 font-bold p-1 text-sm cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Multi-order Pagination */}
        {orderList.length > 1 && (
          <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-xs">
            <span className="font-semibold text-slate-700">
              Label {previewIndex + 1} of {orderList.length}
            </span>
            <div className="flex gap-2">
              <button
                disabled={previewIndex === 0}
                onClick={() => setPreviewIndex((p) => p - 1)}
                className="px-3 py-1 bg-white border border-slate-200 rounded-lg font-bold disabled:opacity-40 cursor-pointer"
              >
                Previous
              </button>
              <button
                disabled={previewIndex === orderList.length - 1}
                onClick={() => setPreviewIndex((p) => p + 1)}
                className="px-3 py-1 bg-white border border-slate-200 rounded-lg font-bold disabled:opacity-40 cursor-pointer"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* 4x6 Printable Slip Canvas */}
        <div className="thermal-shipping-label border-2 border-slate-900 p-5 rounded-2xl bg-white space-y-3 font-sans text-xs print:m-0 print:border-none">
          {/* Header Row */}
          <div className="flex justify-between items-start border-b-2 border-slate-900 pb-3">
            <div>
              <span className="text-xl font-black tracking-tight text-slate-900 block">
                AAMA CLOTHINGS
              </span>
              <span className="text-[10px] font-bold tracking-wider uppercase">
                Regional Hub: {senderInfo.city}
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs font-mono font-bold block">
                TRACK: #{orderIdShort}
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                {new Date().toLocaleDateString()}
              </span>
            </div>
          </div>

          {/* Addresses Grid: From Hub & To Customer */}
          <div className="grid grid-cols-2 gap-3 border-b-2 border-slate-900 pb-3">
            {/* Sender Hub */}
            <div className="space-y-0.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                FROM (Fulfillment Hub):
              </span>
              <p className="font-bold text-slate-900">{senderInfo.name}</p>
              <p>{senderInfo.street}</p>
              <p>{senderInfo.city}, Nepal</p>
              <p>Phone: {senderInfo.phone}</p>
            </div>

            {/* Recipient Customer */}
            <div className="space-y-0.5 p-2">
              <span className="text-[10px] font-bold uppercase tracking-wider block">
                SHIP TO (Customer):
              </span>
              <p className="font-black text-slate-900 text-sm">
                {address.name || `${address.firstName || ""} ${address.lastName || ""}`.trim()}
              </p>
              <p className="text-slate-700 font-semibold">{address.street || "Direct Address"}</p>
              {address.landmark && (
                <p className="text-[10px] font-bold">
                  Landmark: {address.landmark}
                </p>
              )}
              <p className="text-slate-800 font-bold">{address.city}, Nepal</p>
              <p className="font-bold">Phone: {address.phone}</p>
            </div>
          </div>

          {/* Items Breakdown Table */}
          <div className="border-b border-slate-200 pb-2">
            <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase mb-1">
              <span>Garments &amp; Sizes ({totalQty} pcs)</span>
              <span>Qty</span>
            </div>
            <div className="space-y-1">
              {items.map((it, idx) => (
                <div key={idx} className="flex justify-between text-[11px]">
                  <div>
                    <span className="font-bold text-slate-900">{it.name}</span>
                    <span className="text-slate-500 ml-1.5">
                      [{it.size} {it.color && it.color !== "Standard" ? `• ${it.color}` : ""}]
                    </span>
                  </div>
                  <span className="font-bold text-slate-900">×{it.quantity}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Payment & COD Badge */}
          <div className="thermal-payment flex items-center justify-between p-3">
            <div>
              <span className="text-[10px] uppercase tracking-wider block">
                Payment Method
              </span>
              <span className="font-bold text-xs">{currentOrder.paymentMethod}</span>
            </div>

            <div className="text-right">
              <span className="text-[10px] uppercase tracking-wider block">
                {currentOrder.payment ? "PAID IN FULL" : "CASH TO COLLECT (COD)"}
              </span>
              <span className="text-base font-black">
                {currency}{currentOrder.payment ? "0.00" : currentOrder.amount}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white shadow-xs cursor-pointer flex items-center gap-1.5"
          >
            <span>🖨️ Print Courier Slip (4×6)</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShippingLabelModal;
