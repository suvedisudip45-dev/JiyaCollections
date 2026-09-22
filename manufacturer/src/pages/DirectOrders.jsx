import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  ShoppingBag,
  PhoneCall,
  Store,
  Plus,
  Search,
  CheckCircle,
  Clock,
  User,
  MapPin,
  DollarSign,
  Printer,
  Trash2,
  RefreshCw,
  X,
  PackageCheck,
  CreditCard,
  Layers,
} from "lucide-react";
import { useManufacturer } from "../context/ManufacturerContext";

const DirectOrders = () => {
  const { token, backendUrl, currency, manufacturer } = useManufacturer();
  const [directOrders, setDirectOrders] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");

  // Modal State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [receiptModalOpen, setReceiptModalOpen] = useState(false);
  const [activeReceiptOrder, setActiveReceiptOrder] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Direct Order Form State
  const [orderType, setOrderType] = useState("HUB_VISIT"); // "HUB_VISIT" | "PHONE_ORDER"
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [streetAddress, setStreetAddress] = useState("");
  const [city, setCity] = useState(manufacturer?.city || "Kathmandu");
  const [paymentMethod, setPaymentMethod] = useState("CASH"); // "CASH", "QR_PAYMENT", "COD", "CARD"
  const [isPaid, setIsPaid] = useState(true);
  const [discountAmount, setDiscountAmount] = useState("");
  const [orderNotes, setOrderNotes] = useState("");

  // Cart / Line Items in Direct Order Form
  const [cartItems, setCartItems] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(0);
  const [itemQty, setItemQty] = useState(1);

  const fetchDirectOrders = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [ordersRes, invRes] = await Promise.all([
        axios.get(`${backendUrl}/api/manufacturer-order/my-orders`, {
          headers: { token },
        }),
        axios.get(`${backendUrl}/api/manufacturer-inventory/my`, {
          headers: { token },
        }),
      ]);

      if (ordersRes.data.success) {
        setDirectOrders(ordersRes.data.orders || []);
      }
      if (invRes.data.success) {
        setInventory(invRes.data.inventory || []);
      }
    } catch (err) {
      toast.error("Failed to load direct orders");
    } finally {
      setLoading(false);
    }
  }, [token, backendUrl]);

  useEffect(() => {
    fetchDirectOrders();
  }, [fetchDirectOrders]);

  const selectedProduct = inventory.find((i) => i.productId === selectedProductId);
  const selectedProductVariants = selectedProduct?.variantsStock || [];
  const currentVariant = selectedProductVariants[selectedVariantIdx] || selectedProductVariants[0];

  const handleAddToCart = () => {
    if (!selectedProduct) {
      toast.error("Please select a garment");
      return;
    }

    if (!currentVariant) {
      toast.error("No variants available for this garment");
      return;
    }

    const available = Math.max(0, (currentVariant.quantity || 0) - (currentVariant.reservedQty || 0));
    const qtyNum = parseInt(itemQty, 10) || 1;

    if (qtyNum <= 0) {
      toast.error("Quantity must be at least 1");
      return;
    }

    // Check if already in cart
    const existingIdx = cartItems.findIndex(
      (c) =>
        c.productId === selectedProduct.productId &&
        c.size === currentVariant.size &&
        c.color === currentVariant.color
    );

    const existingQty = existingIdx >= 0 ? cartItems[existingIdx].quantity : 0;
    if (existingQty + qtyNum > available) {
      toast.error(
        `Exceeds available hub stock! Only ${available} units available in ${currentVariant.size} / ${currentVariant.color}.`
      );
      return;
    }

    const unitPrice = selectedProduct.product?.price || 0;

    if (existingIdx >= 0) {
      const updated = [...cartItems];
      updated[existingIdx].quantity += qtyNum;
      updated[existingIdx].lineTotal = updated[existingIdx].quantity * unitPrice;
      setCartItems(updated);
    } else {
      setCartItems([
        ...cartItems,
        {
          productId: selectedProduct.productId,
          name: selectedProduct.product?.name || selectedProduct.productName,
          image: selectedProduct.product?.image || selectedProduct.image,
          size: currentVariant.size,
          color: currentVariant.color,
          price: unitPrice,
          quantity: qtyNum,
          lineTotal: unitPrice * qtyNum,
          maxAvailable: available,
        },
      ]);
    }

    setItemQty(1);
    toast.success(`Added ${selectedProduct.product?.name} (${currentVariant.size}) to bill`);
  };

  const handleRemoveCartItem = (index) => {
    setCartItems(cartItems.filter((_, i) => i !== index));
  };

  const subtotal = cartItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const discountVal = Math.min(subtotal, Math.max(0, parseFloat(discountAmount) || 0));
  const totalAmount = Math.max(0, subtotal - discountVal);

  const handleCreateDirectOrder = async (e) => {
    e.preventDefault();
    if (cartItems.length === 0) {
      toast.error("Please add at least 1 garment to the order.");
      return;
    }
    if (!customerName.trim() || !customerPhone.trim()) {
      toast.error("Customer Name and Phone number are required.");
      return;
    }
    if (customerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())) {
      toast.error("Please enter a valid customer email address.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        directOrderType: orderType,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerEmail: customerEmail.trim() || undefined,
        street: streetAddress.trim() || undefined,
        city: city.trim() || manufacturer?.city || "Kathmandu",
        paymentMethod,
        isPaid: orderType === "HUB_VISIT" ? isPaid : paymentMethod !== "COD",
        discountAmount: discountVal,
        notes: orderNotes.trim(),
        items: cartItems.map((c) => ({
          productId: c.productId,
          size: c.size,
          color: c.color,
          quantity: c.quantity,
          price: c.price,
        })),
      };

      const res = await axios.post(`${backendUrl}/api/manufacturer-order/create`, payload, {
        headers: { token },
      });

      if (res.data.success) {
        toast.success(res.data.message || "Direct order created successfully!");
        setCreateModalOpen(false);
        setActiveReceiptOrder(res.data.order);
        setReceiptModalOpen(true);
        // Reset form
        setCartItems([]);
        setCustomerName("");
        setCustomerPhone("");
        setCustomerEmail("");
        setStreetAddress("");
        setDiscountAmount("");
        setOrderNotes("");
        fetchDirectOrders();
      } else {
        toast.error(res.data.message || "Failed to create direct order");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to create direct order");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateOrderStatus = async (orderId, newStatus) => {
    try {
      const res = await axios.post(
        `${backendUrl}/api/manufacturer-order/update-status`,
        { orderId, status: newStatus, payment: newStatus === "Delivered" ? true : undefined },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success(`Order marked as ${newStatus}!`);
        fetchDirectOrders();
      } else {
        toast.error(res.data.message || "Failed to update order status");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Error updating order status");
    }
  };

  const filteredOrders = directOrders.filter((o) => {
    if (filterType === "hub_visit" && o.directOrderType !== "HUB_VISIT") return false;
    if (filterType === "phone_order" && o.directOrderType !== "PHONE_ORDER") return false;
    if (filterType === "delivered" && o.status !== "Delivered") return false;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const name = (o.address?.name || "").toLowerCase();
      const phone = (o.address?.phone || "").toLowerCase();
      const orderId = (o.id || "").toLowerCase();
      return name.includes(term) || phone.includes(term) || orderId.includes(term);
    }
    return true;
  });

  const totalWalkInSales = directOrders.filter((o) => o.directOrderType === "HUB_VISIT").length;
  const totalPhoneSales = directOrders.filter((o) => o.directOrderType === "PHONE_ORDER").length;
  const totalRevenue = directOrders
    .filter((o) => o.payment)
    .reduce((sum, o) => sum + (o.amount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-emerald-600" />
            Direct Hub Orders &amp; Counter Sales
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Generate direct sales for physical hub walk-ins (over-the-counter) or phone orders delivered directly by your manufacturing hub.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchDirectOrders}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Direct Order
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Total Direct Sales
          </span>
          <p className="text-2xl font-black text-slate-900 mt-1">{directOrders.length}</p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Store className="w-3.5 h-3.5 text-emerald-600" />
            Walk-in Hub Purchases
          </span>
          <p className="text-2xl font-black text-emerald-700 mt-1">
            {totalWalkInSales} <span className="text-xs font-normal text-slate-400">No Courier</span>
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <PhoneCall className="w-3.5 h-3.5 text-indigo-600" />
            Direct Phone Orders
          </span>
          <p className="text-2xl font-black text-indigo-700 mt-1">
            {totalPhoneSales} <span className="text-xs font-normal text-slate-400">Self-Delivered</span>
          </p>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Paid Revenue Collected
          </span>
          <p className="text-2xl font-black text-slate-900 mt-1">
            {currency}{totalRevenue.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by customer, phone, order ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
          {[
            { id: "all", label: "All Direct Orders" },
            { id: "hub_visit", label: "🏪 Hub Walk-In" },
            { id: "phone_order", label: "📞 Phone Orders" },
            { id: "delivered", label: "✓ Delivered / Paid" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer transition-all ${
                filterType === tab.id
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Direct Orders Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">
            <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs">Loading direct sales records...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <ShoppingBag className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="font-semibold text-slate-600 text-sm">No direct orders found</p>
            <p className="text-xs text-slate-400 mt-1">
              Create a direct order for walk-in customers or phone-in orders.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold tracking-wider border-b border-slate-100">
                <tr>
                  <th className="py-3 px-4">Order / Channel</th>
                  <th className="py-3 px-4">Customer Details</th>
                  <th className="py-3 px-4">Garments &amp; Varieties</th>
                  <th className="py-3 px-4 text-center">Amount &amp; Payment</th>
                  <th className="py-3 px-4 text-center">Fulfillment</th>
                  <th className="py-3 px-4 text-right">Receipt / Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredOrders.map((o) => {
                  const isWalkIn = o.directOrderType === "HUB_VISIT";
                  const items = Array.isArray(o.items) ? o.items : [];
                  const address = o.address || {};
                  const dateStr = o.date ? new Date(o.date).toLocaleDateString() : "Today";

                  return (
                    <tr key={o.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Order / Channel */}
                      <td className="py-3.5 px-4 align-top">
                        <span className="font-bold text-slate-900 block font-mono text-[11px]">
                          #{o.id.slice(-8).toUpperCase()}
                        </span>
                        <span className="text-[10px] text-slate-400 block">{dateStr}</span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold mt-1 ${
                            isWalkIn
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-indigo-50 text-indigo-700 border border-indigo-200"
                          }`}
                        >
                          {isWalkIn ? <Store className="w-3 h-3" /> : <PhoneCall className="w-3 h-3" />}
                          {isWalkIn ? "Hub Walk-In (No Courier)" : "Phone (Self Delivery)"}
                        </span>
                      </td>

                      {/* Customer Info */}
                      <td className="py-3.5 px-4 align-top">
                        <p className="font-bold text-slate-800 flex items-center gap-1">
                          <User className="w-3 h-3 text-slate-400" />
                          {address.name || "Counter Customer"}
                        </p>
                        <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                          📞 {address.phone || "N/A"}
                        </p>
                        {!isWalkIn && address.street && (
                          <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                            <MapPin className="w-2.5 h-2.5" />
                            {address.street}, {address.city}
                          </p>
                        )}
                      </td>

                      {/* Items */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="space-y-1 max-w-xs">
                          {items.map((it, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 text-[11px]">
                              <span className="font-bold text-slate-800">{it.name}</span>
                              <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 text-[10px]">
                                {it.size} {it.color && it.color !== "Standard" ? `• ${it.color}` : ""}
                              </span>
                              <span className="font-bold text-emerald-700">×{it.quantity}</span>
                            </div>
                          ))}
                        </div>
                      </td>

                      {/* Amount & Payment */}
                      <td className="py-3.5 px-4 text-center align-top">
                        <span className="font-bold text-slate-900 block text-sm">
                          {currency}{o.amount}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold mt-1 ${
                            o.payment
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-amber-50 text-amber-700 border border-amber-200"
                          }`}
                        >
                          {o.payment ? "✓ Paid (" + o.paymentMethod + ")" : "Pending " + o.paymentMethod}
                        </span>
                      </td>

                      {/* Fulfillment Status */}
                      <td className="py-3.5 px-4 text-center align-top">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                            o.status === "Delivered"
                              ? "bg-emerald-100 text-emerald-800"
                              : o.status === "Dispatched"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {o.status === "Delivered" ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                          {o.status}
                        </span>
                        {!isWalkIn && o.status !== "Delivered" && (
                          <button
                            onClick={() => handleUpdateOrderStatus(o.id, "Delivered")}
                            className="block mx-auto mt-1 text-[10px] font-bold text-emerald-600 hover:text-emerald-800 cursor-pointer underline"
                          >
                            Mark Self-Delivered
                          </button>
                        )}
                      </td>

                      {/* Actions & Receipt */}
                      <td className="py-3.5 px-4 text-right align-top">
                        <button
                          onClick={() => {
                            setActiveReceiptOrder(o);
                            setReceiptModalOpen(true);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer shadow-2xs transition-colors"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Receipt
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* --- CREATE DIRECT ORDER MODAL --- */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Create Direct Sale / Order
                </h3>
                <p className="text-xs text-slate-500">
                  Sell directly from your physical hub inventory with instant stock deduction.
                </p>
              </div>
              <button
                onClick={() => setCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Order Channel Selection */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setOrderType("HUB_VISIT");
                  setIsPaid(true);
                }}
                className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                  orderType === "HUB_VISIT"
                    ? "bg-emerald-50 border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs"
                    : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Store className={`w-5 h-5 ${orderType === "HUB_VISIT" ? "text-emerald-600" : "text-slate-400"}`} />
                  <span className="font-bold text-xs text-slate-900">Hub Walk-in Purchase</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Customer at manufacturing hub counter. Instant handoff. <strong>No delivery partner needed.</strong>
                </p>
              </button>

              <button
                type="button"
                onClick={() => setOrderType("PHONE_ORDER")}
                className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                  orderType === "PHONE_ORDER"
                    ? "bg-indigo-50 border-indigo-500 ring-2 ring-indigo-500/20 shadow-xs"
                    : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                }`}
              >
                <div className="flex items-center gap-2">
                  <PhoneCall className={`w-5 h-5 ${orderType === "PHONE_ORDER" ? "text-indigo-600" : "text-slate-400"}`} />
                  <span className="font-bold text-xs text-slate-900">Direct Phone Order</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Customer phoned the hub directly. <strong>Delivered directly by your hub staff.</strong>
                </p>
              </button>
            </div>

            {/* Garment / Item Selection Grid */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-600" />
                Select Garments from Hub Stock
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                {/* Product Select */}
                <div className="sm:col-span-6">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Garment</label>
                  <select
                    value={selectedProductId}
                    onChange={(e) => {
                      setSelectedProductId(e.target.value);
                      setSelectedVariantIdx(0);
                    }}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Select In-Stock Product --</option>
                    {inventory.map((inv) => (
                      <option key={inv.productId} value={inv.productId}>
                        {inv.product?.name} ({currency}{inv.product?.price}) - Total: {inv.quantity} pcs
                      </option>
                    ))}
                  </select>
                </div>

                {/* Variant Select */}
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Variety (Size/Color)</label>
                  <select
                    value={selectedVariantIdx}
                    disabled={!selectedProduct || selectedProductVariants.length === 0}
                    onChange={(e) => setSelectedVariantIdx(Number(e.target.value))}
                    className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                  >
                    {selectedProductVariants.map((v, idx) => (
                      <option key={idx} value={idx}>
                        {v.size} {v.color && v.color !== "Standard" ? `(${v.color})` : ""} - {Math.max(0, (v.quantity || 0) - (v.reservedQty || 0))} in stock
                      </option>
                    ))}
                  </select>
                </div>

                {/* Quantity */}
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Qty</label>
                  <input
                    type="number"
                    min="1"
                    value={itemQty}
                    onChange={(e) => setItemQty(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-xs text-slate-900 text-center font-bold focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Add Button */}
                <div className="sm:col-span-1 flex items-end">
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center cursor-pointer shadow-xs"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Items in Direct Cart */}
              {cartItems.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden mt-3">
                  {cartItems.map((item, idx) => (
                    <div key={idx} className="p-2.5 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-bold text-slate-900">{item.name}</span>
                        <span className="text-slate-500 ml-2">
                          [{item.size} {item.color && item.color !== "Standard" ? `• ${item.color}` : ""}]
                        </span>
                        <span className="text-slate-400 text-[10px] ml-2 font-mono">
                          {currency}{item.price} × {item.quantity}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-slate-900">{currency}{item.lineTotal}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveCartItem(idx)}
                          className="text-rose-500 hover:text-rose-700 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="p-2.5 bg-slate-50 flex justify-between items-center text-xs font-bold border-t border-slate-100">
                    <span>Subtotal:</span>
                    <span className="text-emerald-700 text-sm">{currency}{subtotal}</span>
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={handleCreateDirectOrder} className="space-y-4">
              {/* Customer Details Form */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Customer Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Suman Shrestha"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Customer Phone Number *
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="e.g. 9841234567"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {orderType === "PHONE_ORDER" && (
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Delivery Address (Street / Area)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Near New Road Gate, House #42"
                      value={streetAddress}
                      onChange={(e) => setStreetAddress(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                )}
              </div>

              {/* Payment & Discount */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Payment Method
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="CASH">Cash at Counter</option>
                    <option value="QR_PAYMENT">QR / Fonepay / eSewa</option>
                    <option value="CARD">Debit / Credit Card</option>
                    {orderType === "PHONE_ORDER" && <option value="COD">Cash on Delivery (COD)</option>}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Discount Amount ({currency})
                  </label>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={discountAmount}
                    onChange={(e) => setDiscountAmount(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 flex flex-col justify-center">
                  <span className="text-[10px] uppercase font-bold text-emerald-800 tracking-wider">
                    Total Payable
                  </span>
                  <span className="text-lg font-black text-emerald-900">
                    {currency}{totalAmount}
                  </span>
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || cartItems.length === 0}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer disabled:opacity-50 transition-colors"
                >
                  {submitting ? "Processing Sale..." : "Complete Sale & Print Receipt"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- PRINTABLE RECEIPT MODAL --- */}
      {receiptModalOpen && activeReceiptOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <PackageCheck className="w-4 h-4 text-emerald-600" />
                Customer Purchase Receipt
              </span>
              <button
                onClick={() => setReceiptModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Receipt Printable Canvas */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 font-mono text-xs">
              <div className="text-center border-b border-dashed border-slate-300 pb-2">
                <p className="font-bold text-sm text-slate-900">{manufacturer?.name || "Aama Clothing Hub"}</p>
                <p className="text-[10px] text-slate-500">{manufacturer?.city}, Nepal • Phone: {manufacturer?.phone}</p>
                <p className="text-[10px] text-slate-400 mt-1">
                  Receipt: #{activeReceiptOrder.id?.slice(-8).toUpperCase()} •{" "}
                  {new Date().toLocaleDateString()}
                </p>
              </div>

              <div>
                <p className="text-[11px] text-slate-700">
                  <strong>Customer:</strong> {activeReceiptOrder.address?.name}
                </p>
                <p className="text-[11px] text-slate-700">
                  <strong>Phone:</strong> {activeReceiptOrder.address?.phone}
                </p>
                <p className="text-[11px] text-slate-700">
                  <strong>Type:</strong>{" "}
                  {activeReceiptOrder.directOrderType === "HUB_VISIT"
                    ? "In-Person Hub Counter Sale"
                    : "Direct Phone Customer Delivery"}
                </p>
              </div>

              <div className="border-t border-b border-dashed border-slate-300 py-2 space-y-1">
                {(activeReceiptOrder.items || []).map((item, i) => (
                  <div key={i} className="flex justify-between text-[11px]">
                    <span>
                      {item.name} ({item.size}) × {item.quantity}
                    </span>
                    <span>{currency}{item.lineTotal || item.price * item.quantity}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center font-bold text-sm text-slate-900 pt-1">
                <span>TOTAL PAID:</span>
                <span>{currency}{activeReceiptOrder.amount}</span>
              </div>
              <p className="text-[10px] text-center text-slate-400 italic">
                Thank you for choosing Aama Clothings!
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReceiptModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white cursor-pointer shadow-xs flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                Print Receipt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DirectOrders;
