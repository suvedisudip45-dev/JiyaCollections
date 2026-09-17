import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { toast } from "react-toastify";
import {
  ArrowLeft,
  Package,
  Truck,
  CheckCircle,
  Clock,
  MapPin,
  FileText,
  Weight,
  Layers,
  AlertCircle,
  ShieldCheck,
  User,
  Phone,
} from "lucide-react";
import { useManufacturer } from "../context/ManufacturerContext";
import StatusBadge from "../components/StatusBadge";

const OrderDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token, backendUrl, currency, manufacturer } = useManufacturer();
  const [assignment, setAssignment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [packageWeight, setPackageWeight] = useState("");
  const [packageDimensions, setPackageDimensions] = useState("");
  const [packagingNotes, setPackagingNotes] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const fetchAssignment = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await axios.get(`${backendUrl}/api/order-assignment/my`, {
        headers: { token },
      });
      if (res.data.success) {
        const found = (res.data.assignments || []).find((a) => a.id === id);
        if (found) {
          setAssignment(found);
          setPackageWeight(found.packageWeight || "");
          setPackageDimensions(found.packageDimensions || "");
          setPackagingNotes(found.packagingNotes || "");
        } else {
          toast.error("Assignment not found");
          navigate("/orders");
        }
      }
    } catch (err) {
      toast.error("Failed to load assignment details");
    } finally {
      setLoading(false);
    }
  }, [id, token, backendUrl, navigate]);

  useEffect(() => {
    fetchAssignment();
  }, [fetchAssignment]);

  const handleStatusChange = async (newStatus) => {
    setActionLoading(true);
    try {
      const res = await axios.put(
        `${backendUrl}/api/order-assignment/status/${id}`,
        {
          status: newStatus,
          packageWeight,
          packageDimensions,
          packagingNotes,
        },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success(`Order marked as ${newStatus}`);
        fetchAssignment();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update status");
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkReadyForPickup = async () => {
    setActionLoading(true);
    try {
      const res = await axios.post(
        `${backendUrl}/api/delivery-job/ready-for-pickup/${id}`,
        {
          packagingNotes,
          packageWeight,
        },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success("Ready for pickup! Delivery partner notified.");
        fetchAssignment();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to set ready for pickup");
    } finally {
      setActionLoading(false);
    }
  };

  const handleAccept = async () => {
    setActionLoading(true);
    try {
      const res = await axios.post(
        `${backendUrl}/api/order-assignment/accept/${id}`,
        {},
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success("Order accepted!");
        fetchAssignment();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to accept");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading || !assignment) {
    return (
      <div className="p-12 text-center text-slate-400">
        <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-xs">Loading order assignment...</p>
      </div>
    );
  }

  const order = assignment.order;
  const items = order?.items || [];

  const pickupReadiness = (() => {
    const branch = (manufacturer?.ncmPickupBranch || "").trim();
    const address = (manufacturer?.pickupAddress || "").trim();
    const contactName = (manufacturer?.pickupContactName || "").trim();
    const contactPhone = (manufacturer?.pickupContactPhone || "").trim();
    const pickupWindow = (manufacturer?.pickupWindow || "").trim();

    const missingFields = [];
    if (!branch) missingFields.push("NCM pickup branch assignment");
    if (!address) missingFields.push("pickup address");
    if (!contactName) missingFields.push("contact name");
    if (!contactPhone) missingFields.push("contact phone");
    if (!pickupWindow) missingFields.push("pickup window");

    return {
      isReady: missingFields.length === 0,
      branch,
      missingFields,
    };
  })();

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Top Breadcrumb & Actions */}
      <div className="flex items-center justify-between">
        <Link
          to="/orders"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Orders
        </Link>
        <div className="flex items-center gap-2">
          <StatusBadge status={assignment.status} />
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Order & Packaging Specs */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Header Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Customer Order Reference
                </span>
                <h1 className="text-xl font-black text-slate-900 font-mono">
                  #{order?.id || assignment.id}
                </h1>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Assigned Date
                </span>
                <span className="text-xs font-bold text-slate-700">
                  {new Date(assignment.createdAt).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Items List */}
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3">
              Manufactured Items &amp; Garments
            </h3>
            <div className="space-y-3">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-100"
                >
                  <div className="flex items-center gap-3">
                    {item.image ? (
                      <img
                        src={item.image[0] || item.image}
                        alt={item.name}
                        className="w-12 h-12 rounded-lg object-cover border border-slate-200"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-slate-200 flex items-center justify-center text-slate-400">
                        <Package className="w-6 h-6" />
                      </div>
                    )}
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">
                        {item.name || item.product?.name}
                      </h4>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                        <span className="font-semibold text-slate-700">Size: {item.size || "Standard"}</span>
                        <span>•</span>
                        <span>Qty: {item.quantity || 1}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-slate-900 block">
                      {currency}
                      {((item.price || 0) * (item.quantity || 1)).toLocaleString()}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {currency}{item.price} each
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Order Financials Summary */}
            <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">
                Payment Type: <strong className="text-slate-800">{order?.paymentMethod || "COD"}</strong>
              </span>
              <span className="text-sm font-black text-slate-900">
                Total Value: {currency}{order?.amount?.toLocaleString() || 0}
              </span>
            </div>
          </div>

          {/* Packaging & Quality Specs Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Packaging &amp; Quality Dispatch Parameters
            </div>
            <p className="text-xs text-slate-500">
              Ensure proper packaging, tag inspection, and correct box dimensions before handing over to the delivery partner.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Package Weight (approx. kg)
                </label>
                <div className="relative">
                  <Weight className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="e.g. 0.8 kg"
                    value={packageWeight}
                    onChange={(e) => setPackageWeight(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Package Dimensions (L x W x H cm)
                </label>
                <div className="relative">
                  <Layers className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="e.g. 30 x 20 x 5 cm"
                    value={packageDimensions}
                    onChange={(e) => setPackageDimensions(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Quality Inspection &amp; Packaging Notes
              </label>
              <textarea
                rows={3}
                placeholder="e.g. Ironed, tagged with Aama hologram, wrapped in waterproof polybag."
                value={packagingNotes}
                onChange={(e) => setPackagingNotes(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
        </div>

        {/* Right Col: Step Actions & Destination */}
        <div className="space-y-6">
          {/* Action Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Hub Workflow Actions
            </h3>

            <div
              className={`rounded-xl border p-3 text-[11px] ${
                pickupReadiness.isReady
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              <div className="flex items-center gap-2 font-bold">
                {pickupReadiness.isReady ? (
                  <CheckCircle className="w-4 h-4" />
                ) : (
                  <AlertCircle className="w-4 h-4" />
                )}
                <span>{pickupReadiness.isReady ? "Pickup-ready" : "Pickup blocked"}</span>
              </div>

              <div className="mt-2 space-y-1.5">
                <p>
                  Assigned branch: <strong>{pickupReadiness.branch || "Not assigned"}</strong>
                </p>
                {pickupReadiness.isReady ? (
                  <p>All pickup requirements are complete and dispatch can proceed.</p>
                ) : (
                  <div className="space-y-1">
                    {pickupReadiness.missingFields.map((field) => (
                      <p key={field}>• {field} is missing.</p>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {assignment.status === "assigned" && (
              <div className="space-y-2">
                <button
                  onClick={handleAccept}
                  disabled={actionLoading}
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs cursor-pointer disabled:opacity-50"
                >
                  Accept Order Assignment
                </button>
                <button
                  onClick={() => handleStatusChange("rejected")}
                  disabled={actionLoading}
                  className="w-full py-2 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-xs border border-rose-200 cursor-pointer disabled:opacity-50"
                >
                  Decline Order
                </button>
              </div>
            )}

            {assignment.status === "accepted" && (
              <button
                onClick={() => handleStatusChange("preparing")}
                disabled={actionLoading}
                className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-xs cursor-pointer disabled:opacity-50"
              >
                Start Preparation / Tailoring
              </button>
            )}

            {assignment.status === "preparing" && (
              <div className="space-y-2">
                <button
                  onClick={() => handleStatusChange("packed")}
                  disabled={actionLoading}
                  className="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-xs cursor-pointer disabled:opacity-50"
                >
                  Mark as Packed &amp; Sealed
                </button>
              </div>
            )}

            {assignment.status === "packed" && (
              <div className="space-y-2">
                <button
                  onClick={handleMarkReadyForPickup}
                  disabled={actionLoading || !pickupReadiness.isReady}
                  className={`w-full py-3 px-4 rounded-xl font-bold text-xs shadow-md flex items-center justify-center gap-2 ${
                    pickupReadiness.isReady
                      ? "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white cursor-pointer"
                      : "bg-slate-200 text-slate-500 cursor-not-allowed"
                  }`}
                >
                  <Truck className="w-4 h-4" />
                  {pickupReadiness.isReady ? "Mark Ready for Delivery Pickup" : "Pickup blocked"}
                </button>
                <p className="text-[11px] text-slate-500 text-center">
                  This will notify the nearest available Delivery Partner to collect the package from your hub.
                </p>
              </div>
            )}

            {["ready_for_pickup", "picked_up", "in_transit", "delivered"].includes(
              assignment.status
            ) && (
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-2">
                <div className="flex items-center gap-2 font-bold text-xs">
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                  Hub Handoff Complete
                </div>
                <p className="text-[11px] text-emerald-700">
                  {assignment.status === "ready_for_pickup"
                    ? "Delivery partner has been assigned / notified for pickup."
                    : `Order is currently in state: ${assignment.status}`}
                </p>
              </div>
            )}
          </div>

          {/* Delivery Destination Privacy Card */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-3">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Shipping Destination
            </h3>
            <div className="flex items-start gap-2.5 text-xs">
              <MapPin className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-slate-900 block">
                  {order?.address?.city || order?.shippingAddress?.city || "Nepal"}
                </span>
                <span className="text-slate-500 text-[11px]">
                  Region / State: {order?.address?.state || "Bagmati"}
                </span>
                <p className="text-[10px] text-slate-400 mt-1">
                  Full street address is dispatched securely to the delivery driver to preserve customer privacy.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderDetail;
