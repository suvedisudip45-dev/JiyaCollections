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
  Printer,
  Weight,
  Layers,
  AlertCircle,
  ShieldCheck,
  User,
  Phone,
  Gift,
  HeartHandshake,
  CreditCard,
  CheckSquare,
  Square,
  Sparkles,
} from "lucide-react";
import { useManufacturer } from "../context/ManufacturerContext";
import StatusBadge from "../components/StatusBadge";
import FulfillmentProgressStepper from "../components/FulfillmentProgressStepper";
import FulfillmentChecklistModal from "../components/FulfillmentChecklistModal";

const parseBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  return ["true", "1", "yes", "y"].includes(String(value || "").trim().toLowerCase());
};

const OrderDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token, backendUrl, currency, manufacturer } = useManufacturer();
  const [assignment, setAssignment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [packageWeight, setPackageWeight] = useState("");
  const [packageDimensions, setPackageDimensions] = useState("");
  const [packagingNotes, setPackagingNotes] = useState("");
  const [productType, setProductType] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [packageType, setPackageType] = useState("Box");
  const [isFragile, setIsFragile] = useState(false);
  const [deliveryInstruction, setDeliveryInstruction] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [storyLetter, setStoryLetter] = useState(null);
  const [checklistModalOpen, setChecklistModalOpen] = useState(false);

  // Pre-Dispatch Packaging Checklist State
  const [checklist, setChecklist] = useState({
    productVerified: false,
    sizeColorVerified: false,
    stitchingVerified: false,
    brandingVerified: false,
    qualityVerified: false,
    customerLetterIncluded: false,
    addressVerified: false,
    packagingMaterialsVerified: false,
    loyaltyGift: false,
    thankYouLetter: false,
    additionalLetter: false,
    marketingCard: false,
    marketingCardId: "",
    qualityCheck: false,
  });

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
          const notes = (() => {
            if (!found.notes) return {};
            try {
              return JSON.parse(found.notes);
            } catch {
              return {};
            }
          })();
          const order = found.order;
          const itemsList = Array.isArray(order?.items) ? order.items : [];
          const fallbackItem = itemsList[0] || null;
          setAssignment(found);
          setPackageWeight(notes.packageWeight || found.packageWeight || "");
          setPackageDimensions(notes.packageDimensions || found.packageDimensions || "");
          setPackagingNotes(notes.packagingNotes || found.packagingNotes || "");
          setProductType(notes.productType || fallbackItem?.productType || fallbackItem?.category || "");
          setProductDescription(notes.productDescription || fallbackItem?.description || fallbackItem?.productDescription || "");
          setPackageType(notes.packageType || "Box");
          setIsFragile(parseBoolean(notes.isFragile));
          setDeliveryInstruction(
            notes.deliveryInstruction ||
            notes.instruction ||
            found.deliveryInstruction ||
            order?.address?.deliveryInstruction ||
            order?.address?.orderNotes ||
            ""
          );

          if (notes.packagingChecklist) {
            setChecklist({
              productVerified: Boolean(notes.packagingChecklist.productVerified),
              sizeColorVerified: Boolean(notes.packagingChecklist.sizeColorVerified),
              stitchingVerified: Boolean(notes.packagingChecklist.stitchingVerified),
              brandingVerified: Boolean(notes.packagingChecklist.brandingVerified),
              qualityVerified: Boolean(notes.packagingChecklist.qualityVerified),
              customerLetterIncluded: Boolean(notes.packagingChecklist.customerLetterIncluded || notes.packagingChecklist.thankYouLetter),
              addressVerified: Boolean(notes.packagingChecklist.addressVerified),
              packagingMaterialsVerified: Boolean(notes.packagingChecklist.packagingMaterialsVerified),
              loyaltyGift: Boolean(notes.packagingChecklist.loyaltyGift),
              thankYouLetter: Boolean(notes.packagingChecklist.thankYouLetter),
              additionalLetter: Boolean(notes.packagingChecklist.additionalLetter),
              marketingCard: Boolean(notes.packagingChecklist.marketingCard),
              marketingCardId: notes.packagingChecklist.marketingCardId || "",
              qualityCheck: Boolean(notes.packagingChecklist.qualityCheck),
            });
          }
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

  const fetchStoryLetterStatus = useCallback(async () => {
    if (!token || !assignment?.order?.id) return;
    try {
      const res = await axios.get(`${backendUrl}/api/personalized-letter/${assignment.order.id}`, { headers: { token } });
      if (res.data.success) {
        setStoryLetter(res.data.data || null);
      }
    } catch (error) {
      setStoryLetter(null);
    }
  }, [assignment?.order?.id, backendUrl, token]);

  useEffect(() => {
    fetchAssignment();
    fetchStoryLetterStatus();
  }, [fetchAssignment, fetchStoryLetterStatus]);

  const validateChecklist = () => {
    const benefits = assignment?.order?.fulfillmentBenefits || {};
    const hasLoyaltyGift = Boolean(benefits.giftDescription || (benefits.giftAmount && benefits.giftAmount > 0));
    const hasHandwrittenLetter = Boolean(benefits.handwrittenCard);

    if (hasLoyaltyGift && !checklist.loyaltyGift) {
      toast.warning(`Please verify that the Loyalty Card Gift (${benefits.giftDescription || "Gift Item"}) is included.`);
      return false;
    }
    if (hasHandwrittenLetter && !checklist.thankYouLetter) {
      toast.warning("Please verify that the Handwritten Thank-You Letter is enclosed as requested for this tier.");
      return false;
    }
    if (checklist.marketingCard && !checklist.marketingCardId.trim()) {
      toast.warning("Please enter the Marketing Partner Card ID.");
      return false;
    }
    return true;
  };

  const toggleChecklistField = (field) => {
    if (isDispatchLocked) return;
    setChecklist((previous) => ({ ...previous, [field]: !previous[field] }));
  };

  const handleStatusChange = async (newStatus, extraData = {}) => {
    if (newStatus === "packed" || newStatus === "ready_for_pickup") {
      if (!validateChecklist()) return;
    }
    setActionLoading(true);
    try {
      const res = await axios.put(
        `${backendUrl}/api/order-assignment/status/${id}`,
        {
          status: newStatus,
          ...extraData,
          packageWeight,
          packageDimensions,
          packagingNotes,
          productType,
          productDescription,
          packageType,
          isFragile,
          deliveryInstruction,
          packagingChecklist: {
            ...checklist,
            ...extraData.packagingChecklist,
            verifiedAt: new Date().toISOString(),
          },
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
    if (!validateChecklist()) return;
    setActionLoading(true);
    try {
      const res = await axios.post(
        `${backendUrl}/api/delivery-job/ready-for-pickup/${id}`,
        {
          packagingNotes,
          packageWeight,
          packageDimensions,
          productType,
          productDescription,
          packageType,
          isFragile,
          deliveryInstruction,
          packagingChecklist: {
            ...checklist,
            verifiedAt: new Date().toISOString(),
          },
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

  const handleReject = async () => {
    const reason = window.prompt("Why are you rejecting this production assignment?", "No capacity");
    if (reason === null) return;

    setActionLoading(true);
    try {
      const res = await axios.post(
        `${backendUrl}/api/order-assignment/reject/${id}`,
        { reason: reason.trim() || "No capacity" },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.info("Assignment rejected. The order has been returned for admin reassignment.");
        navigate("/orders");
      } else {
        toast.error(res.data.message || "Unable to reject assignment");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Unable to reject assignment");
    } finally {
      setActionLoading(false);
    }
  };

  const handlePrintPersonalizedLetter = async () => {
    const orderId = assignment?.order?.id || id;
    if (!orderId) {
      toast.error("Order not available for personalized letter print.");
      return;
    }

    setActionLoading(true);
    try {
      const stableIdempotencyKey = `story-letter-${orderId}-${storyLetter?.letter?.id || "draft"}`;
      const res = await axios.post(
        `${backendUrl}/api/personalized-letter/${orderId}/print`,
        { idempotencyKey: stableIdempotencyKey },
        { headers: { token } }
      );

      if (res.data.success && res.data.data?.renderedHtml) {
        const printWindow = window.open("", "_blank", "width=900,height=1100");
        if (printWindow) {
          const printDocument = res.data.data.renderedHtml.includes("<html")
            ? res.data.data.renderedHtml
            : `<!doctype html><html lang="ne"><head><meta charset="UTF-8" /><title>Personalized Story Letter</title><style>@import url("https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap"); @page { size: A4; margin: 18mm; } body { margin:0; font-family:"Noto Sans Devanagari","Noto Sans Nepali","Mangal","Arial",sans-serif; color:#111827; } .letter-wrapper { max-width: 760px; margin: 0 auto; padding: 24px; } .letter-inner { white-space: pre-wrap; line-height:1.75; font-size:14px; word-break: break-word; } </style></head><body><div class="letter-wrapper"><div class="letter-inner">${res.data.data.renderedHtml}</div></div></body></html>`;

          printWindow.document.write(printDocument);
          printWindow.document.close();
          printWindow.focus();
          setTimeout(() => printWindow.print(), 400);
        }
        setStoryLetter(res.data.data);
        setChecklist((prev) => ({ ...prev, customerLetterIncluded: true, thankYouLetter: true }));
        toast.success("Personalized letter is ready to print.");
        return;
      }

      if (res.data.success) {
        toast.info(res.data.message || "Personalized letter is available.");
      } else {
        toast.error(res.data.message || "Unable to print personalized letter.");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to print personalized letter");
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
  const delivery = assignment.delivery || null;
  const benefits = order?.fulfillmentBenefits || {};
  const isDispatchLocked = ["ready_for_pickup", "picked_up", "in_transit", "arrived_at_destination", "out_for_delivery", "delivered", "return_requested"].includes((assignment.status || "").toLowerCase());

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

  // Delivery tracking steps definition
  const DELIVERY_STEPS = [
    { key: "ready_for_pickup",       label: "Courier Booked",           emoji: "📋" },
    { key: "picked_up",              label: "Picked Up" },
    { key: "in_transit",             label: "In Transit" },
    { key: "arrived_at_destination", label: "Arrived at Hub" },
    { key: "out_for_delivery",       label: "Out for Delivery" },
    { key: "delivered",              label: "Delivered" },
  ];
  const stepOrder = DELIVERY_STEPS.map((s) => s.key);
  const currentStepIdx = stepOrder.indexOf(assignment.status);

  const WORKFLOW_STEPS = [
    { key: "assigned", label: "Accept order", description: "Confirm this assignment for your hub." },
    { key: "accepted", label: "Stitching & branding", description: "Complete tailoring, labels, and branding." },
    { key: "preparing", label: "Quality check", description: "Inspect the finished garment before letter preparation." },
    { key: "quality_check", label: "Customer letter", description: "Print and include the compulsory customer letter." },
    { key: "letter_ready", label: "Final checklist", description: "Confirm every required item before packing." },
    { key: "checklist_complete", label: "Pack order", description: "Seal the verified order." },
    { key: "packed", label: "Package details", description: "Record weight, dimensions, type, and handling." },
    { key: "package_details_complete", label: "Call delivery partner", description: "Submit the completed parcel for pickup." },
  ];
  const workflowStatus = assignment.status === "PENDING_ACCEPTANCE" ? "assigned" : String(assignment.status || "assigned").toLowerCase();
  const workflowIndex = Math.max(0, WORKFLOW_STEPS.findIndex((step) => step.key === workflowStatus));
  const handleWorkflowNext = async () => {
    if (workflowStatus === "assigned") return handleAccept();
    if (workflowStatus === "accepted") return handleStatusChange("preparing", { stitchingBrandingCompleted: true });
    if (workflowStatus === "preparing") {
      setChecklist((prev) => ({ ...prev, qualityVerified: true }));
      return handleStatusChange("quality_check", { stitchingBrandingCompleted: true });
    }
    if (workflowStatus === "quality_check") {
      if (!storyLetter?.letter) return toast.warning("Print the compulsory customer letter before continuing.");
      setChecklist((prev) => ({ ...prev, customerLetterIncluded: true, thankYouLetter: true }));
      return handleStatusChange("letter_ready", { packagingChecklist: { ...checklist, customerLetterIncluded: true, thankYouLetter: true } });
    }
    if (workflowStatus === "letter_ready") {
      setChecklistModalOpen(true);
      return;
    }
    if (workflowStatus === "checklist_complete") return handleStatusChange("packed");
    if (workflowStatus === "packed") return handleStatusChange("package_details_complete");
    if (workflowStatus === "package_details_complete") return handleMarkReadyForPickup();
  };

  const handleWorkflowPrevious = async () => {
    if (workflowIndex <= 0 || ["ready_for_pickup", "picked_up", "in_transit", "delivered"].includes(workflowStatus)) return;
    return handleStatusChange(WORKFLOW_STEPS[workflowIndex - 1].key);
  };

  const handleChecklistConfirm = async (confirmedChecklist) => {
    setChecklist(confirmedChecklist);
    setChecklistModalOpen(false);
    await handleStatusChange("checklist_complete", { packagingChecklist: confirmedChecklist });
  };

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

      <FulfillmentProgressStepper
        steps={WORKFLOW_STEPS}
        currentIndex={workflowIndex}
        onPrevious={handleWorkflowPrevious}
        onNext={handleWorkflowNext}
        nextLabel={workflowStatus === "assigned" ? "Accept production" : workflowStatus === "accepted" ? "Start stitching & branding" : workflowStatus === "preparing" ? "Complete quality check" : workflowStatus === "quality_check" ? "Letter printed" : workflowStatus === "checklist_complete" ? "Mark packed" : workflowStatus === "packed" ? "Enter package details" : workflowStatus === "package_details_complete" ? "Call delivery partner" : "Continue"}
        nextDisabled={workflowStatus === "ready_for_pickup" || workflowStatus === "delivered"}
        previousDisabled={workflowIndex <= 0 || ["ready_for_pickup", "picked_up", "in_transit", "delivered"].includes(workflowStatus)}
        busy={actionLoading}
      >
        {workflowStatus === "quality_check" && (
          <button type="button" onClick={handlePrintPersonalizedLetter} disabled={actionLoading} className="w-full rounded-2xl border border-violet-200 bg-violet-50 px-4 py-4 text-left transition hover:border-violet-300 hover:bg-violet-100 disabled:opacity-50">
            <span className="flex items-center gap-2 text-sm font-black text-violet-900"><Printer className="h-4 w-4" /> Print compulsory customer letter</span>
            <span className="mt-1 block text-xs text-violet-700">Every customer receives a letter before the order can continue.</span>
          </button>
        )}
        {workflowStatus === "assigned" && (
          <button type="button" onClick={handleReject} disabled={actionLoading} className="mt-3 w-full rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-left text-xs font-bold text-rose-800 transition hover:border-rose-300 hover:bg-rose-100 disabled:opacity-50">
            Reject production assignment
            <span className="mt-1 block text-[10px] font-normal text-rose-700">Use this only when your hub cannot produce or accept the order.</span>
          </button>
        )}
        {workflowStatus === "letter_ready" && <button type="button" onClick={() => setChecklistModalOpen(true)} className="w-full rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-4 text-left text-xs font-semibold text-indigo-950 transition hover:border-indigo-300 hover:bg-indigo-100">Open the final checklist to verify every required item before packing.</button>}
        {workflowStatus === "package_details_complete" && <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-xs font-semibold text-emerald-900">Package details are complete. The next action will call the delivery partner.</p>}
        {workflowStatus !== "quality_check" && workflowStatus !== "letter_ready" && workflowStatus !== "package_details_complete" && <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-xs text-slate-600">{WORKFLOW_STEPS[workflowIndex]?.description}</p>}
      </FulfillmentProgressStepper>

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

            {(benefits.loyaltyTier !== "Standard customer" || benefits.totalDiscount > 0 || benefits.giftDescription || benefits.handwrittenCard || benefits.customPerk) && (
              <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50/60 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-teal-900">Customer benefits &amp; packing instructions</h3>
                  {benefits.rewardUsage && <span className="text-[10px] font-semibold text-teal-700">{benefits.rewardUsage}</span>}
                </div>
                <p className="text-sm font-black text-slate-900">{benefits.loyaltyTier}</p>
                {benefits.rewardTitle && <p className="text-xs text-slate-700">{benefits.rewardTitle}</p>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  {benefits.totalDiscount > 0 && <div className="rounded-lg bg-white/70 border border-teal-100 p-2">Discount applied: <strong>{currency}{benefits.totalDiscount.toLocaleString()}</strong></div>}
                  {benefits.freeShipping && <div className="rounded-lg bg-white/70 border border-teal-100 p-2">Free delivery benefit applied</div>}
                  {benefits.giftDescription && <div className="rounded-lg bg-white/70 border border-teal-100 p-2">Gift: <strong>{benefits.giftDescription}</strong></div>}
                  {benefits.handwrittenCard && <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 font-bold text-amber-900">Include a handwritten thank-you card</div>}
                  {benefits.customPerk && <div className="rounded-lg bg-white/70 border border-teal-100 p-2">Perk: <strong>{benefits.customPerk}</strong></div>}
                </div>
                {benefits.offerItems?.length > 0 && (
                  <div className="pt-2 border-t border-teal-100 text-[11px] text-slate-700">
                    <span className="font-bold">Product offers: </span>
                    {benefits.offerItems.map((offer) => `${offer.name} (${offer.discountPercentage}% off)`).join(", ")}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Pre-Dispatch Packaging Verification Checklist Card */}
          <div className="hidden">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <span>Pre-Dispatch Packaging Verification Checklist</span>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                Dispatch Verification
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Dynamically fetched perks and physical inclusions to be added with this product before handover.
            </p>

            {/* Standard Order Banner if no special perks apply */}
            {!benefits.giftDescription && !benefits.handwrittenCard && !benefits.customPerk && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center gap-2.5">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <p className="text-[11px] text-slate-600">
                  <strong>Standard Package:</strong> No mandatory extra loyalty gifts or handwritten letters for this order.
                </p>
              </div>
            )}

            <div className="space-y-3 pt-1">
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-800">Required before packing</p>
                {[
                  ["productVerified", "Product and quantity verified"],
                  ["sizeColorVerified", "Size and color verified"],
                  ["stitchingVerified", "Stitching completed and inspected"],
                  ["brandingVerified", "Branding, tags, and labels verified"],
                  ["qualityVerified", "Quality check passed"],
                  ["customerLetterIncluded", "Compulsory customer letter included"],
                  ["addressVerified", "Customer address and phone verified"],
                  ["packagingMaterialsVerified", "Packaging materials and seal verified"],
                ].map(([field, label]) => (
                  <label key={field} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={Boolean(checklist[field])} disabled={isDispatchLocked} onChange={() => toggleChecklistField(field)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

              {/* 1. Gifts from loyalty card — only shown if customer earned a gift */}
              {(benefits.giftDescription || (benefits.giftAmount && benefits.giftAmount > 0)) && (
                <div
                  onClick={() => !isDispatchLocked && setChecklist((prev) => ({ ...prev, loyaltyGift: !prev.loyaltyGift }))}
                  className={`p-3.5 rounded-2xl border transition-all select-none ${
                    isDispatchLocked ? "opacity-80 cursor-default" : "cursor-pointer"
                  } flex items-start gap-3.5 ${
                    checklist.loyaltyGift
                      ? "bg-emerald-50/70 border-emerald-300"
                      : "bg-slate-50 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="mt-0.5 text-emerald-600 shrink-0">
                    {checklist.loyaltyGift ? (
                      <CheckSquare className="w-5 h-5 text-emerald-600 fill-emerald-100" />
                    ) : (
                      <Square className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Gift className="w-4 h-4 text-emerald-600" />
                      <span className="text-xs font-bold text-slate-900">
                        Gifts from Loyalty Card Included <span className="text-rose-500">*</span>
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Loyalty card bonus gift, VIP reward, or promotional freebie added to parcel.
                    </p>
                    {benefits.giftDescription && (
                      <span className="inline-block mt-1 text-[10px] font-bold text-emerald-800 bg-emerald-100/70 px-2 py-0.5 rounded-md">
                        Required Item: {benefits.giftDescription}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* 2. Handwritten thank-you letter — only shown if requested for this tier */}
              {benefits.handwrittenCard && (
                <div
                  onClick={() => !isDispatchLocked && setChecklist((prev) => ({ ...prev, thankYouLetter: !prev.thankYouLetter }))}
                  className={`p-3.5 rounded-2xl border transition-all select-none ${
                    isDispatchLocked ? "opacity-80 cursor-default" : "cursor-pointer"
                  } flex items-start gap-3.5 ${
                    checklist.thankYouLetter
                      ? "bg-emerald-50/70 border-emerald-300"
                      : "bg-slate-50 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="mt-0.5 text-emerald-600 shrink-0">
                    {checklist.thankYouLetter ? (
                      <CheckSquare className="w-5 h-5 text-emerald-600 fill-emerald-100" />
                    ) : (
                      <Square className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <HeartHandshake className="w-4 h-4 text-rose-500" />
                      <span className="text-xs font-bold text-slate-900">
                        Handwritten Thank-You Letter <span className="text-rose-500">*</span>
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Personalized, handwritten note on Aama brand paper enclosed inside the package.
                    </p>
                  </div>
                </div>
              )}

              {/* 3. Custom Perk Fulfilled if present */}
              {benefits.customPerk && (
                <div
                  onClick={() => !isDispatchLocked && setChecklist((prev) => ({ ...prev, customPerkIncluded: !prev.customPerkIncluded }))}
                  className={`p-3.5 rounded-2xl border transition-all select-none ${
                    isDispatchLocked ? "opacity-80 cursor-default" : "cursor-pointer"
                  } flex items-start gap-3.5 ${
                    checklist.customPerkIncluded
                      ? "bg-emerald-50/70 border-emerald-300"
                      : "bg-slate-50 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="mt-0.5 text-emerald-600 shrink-0">
                    {checklist.customPerkIncluded ? (
                      <CheckSquare className="w-5 h-5 text-emerald-600 fill-emerald-100" />
                    ) : (
                      <Square className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-teal-600" />
                      <span className="text-xs font-bold text-slate-900">
                        Custom Perk Fulfilled: {benefits.customPerk}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* 4. Additional letter */}
              <div
                onClick={() => !isDispatchLocked && setChecklist((prev) => ({ ...prev, additionalLetter: !prev.additionalLetter }))}
                className={`p-3.5 rounded-2xl border transition-all select-none ${
                  isDispatchLocked ? "opacity-80 cursor-default" : "cursor-pointer"
                } flex items-start gap-3.5 ${
                  checklist.additionalLetter
                    ? "bg-emerald-50/70 border-emerald-300"
                    : "bg-slate-50 border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="mt-0.5 text-emerald-600 shrink-0">
                  {checklist.additionalLetter ? (
                    <CheckSquare className="w-5 h-5 text-emerald-600 fill-emerald-100" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-400" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-indigo-500" />
                    <span className="text-xs font-bold text-slate-900">
                      Additional Letter
                    </span>
                  </div>
                </div>
              </div>

              {/* 5. Marketing partner card */}
              <div
                className={`p-3.5 rounded-2xl border transition-all space-y-3 ${
                  checklist.marketingCard
                    ? "bg-amber-50/50 border-amber-300"
                    : "bg-slate-50 border-slate-200"
                }`}
              >
                <div
                  onClick={() => !isDispatchLocked && setChecklist((prev) => ({ ...prev, marketingCard: !prev.marketingCard }))}
                  className={`flex items-start gap-3.5 select-none ${
                    isDispatchLocked ? "opacity-80 cursor-default" : "cursor-pointer"
                  }`}
                >
                  <div className="mt-0.5 text-amber-600 shrink-0">
                    {checklist.marketingCard ? (
                      <CheckSquare className="w-5 h-5 text-amber-600 fill-amber-100" />
                    ) : (
                      <Square className="w-5 h-5 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-amber-600" />
                      <span className="text-xs font-bold text-slate-900">
                        Marketing Partner Card
                      </span>
                    </div>
                  </div>
                </div>

                {checklist.marketingCard && (
                  <div className="pt-2 border-t border-amber-200/80 pl-8 space-y-1.5 animate-in fade-in duration-150">
                    <label className="block text-[11px] font-bold text-amber-900">
                      Marketing Partner Card ID <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Enter Card ID"
                      value={checklist.marketingCardId}
                      disabled={isDispatchLocked}
                      onChange={(e) => setChecklist((prev) => ({ ...prev, marketingCardId: e.target.value }))}
                      className="w-full bg-white border border-amber-300 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 disabled:opacity-60"
                      required={checklist.marketingCard}
                    />
                  </div>
                )}
              </div>

              {/* 6. Garment quality check & packaging seal */}
              <div
                onClick={() => !isDispatchLocked && setChecklist((prev) => ({ ...prev, qualityCheck: !prev.qualityCheck }))}
                className={`p-3.5 rounded-2xl border transition-all select-none ${
                  isDispatchLocked ? "opacity-80 cursor-default" : "cursor-pointer"
                } flex items-start gap-3.5 ${
                  checklist.qualityCheck
                    ? "bg-emerald-50/70 border-emerald-300"
                    : "bg-slate-50 border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="mt-0.5 text-emerald-600 shrink-0">
                  {checklist.qualityCheck ? (
                    <CheckSquare className="w-5 h-5 text-emerald-600 fill-emerald-100" />
                  ) : (
                    <Square className="w-5 h-5 text-slate-400" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span className="text-xs font-bold text-slate-900">
                      Garment Quality &amp; Packaging Sealed
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Inspected fabric quality, size labels, stitching, and wrapped in tamper-proof seal.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Packaging & Quality Specs Card */}
          <div className={`${workflowStatus === "packed" || workflowStatus === "package_details_complete" ? "" : "hidden"} bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4`}>
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
                  Product Type
                </label>
                <input
                  type="text"
                  placeholder="e.g. Shirt, Kurta, Jacket"
                  value={productType}
                  disabled={isDispatchLocked}
                  onChange={(e) => setProductType(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Package Type
                </label>
                <select
                  value={packageType}
                  disabled={isDispatchLocked}
                  onChange={(e) => setPackageType(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="Box">Box</option>
                  <option value="Polybag">Polybag</option>
                  <option value="Envelope">Envelope</option>
                  <option value="Carton">Carton</option>
                  <option value="Gift Box">Gift Box</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Product Description
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Premium cotton shirt with size label and care instructions"
                  value={productDescription}
                  disabled={isDispatchLocked}
                  onChange={(e) => setProductDescription(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Delivery Instructions
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Leave at gate, call before delivery, handle with care"
                  value={deliveryInstruction}
                  disabled={isDispatchLocked}
                  onChange={(e) => setDeliveryInstruction(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

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
                    disabled={isDispatchLocked}
                    onChange={(e) => setPackageWeight(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
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
                    disabled={isDispatchLocked}
                    onChange={(e) => setPackageDimensions(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div>
                <p className="text-xs font-semibold text-slate-700">Fragile item</p>
                <p className="text-[10px] text-slate-500">Mark this package for extra handling</p>
              </div>
              <button
                type="button"
                disabled={isDispatchLocked}
                onClick={() => setIsFragile((prev) => !prev)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${isFragile ? "bg-amber-500" : "bg-slate-300"} disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white transition ${isFragile ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Quality Inspection &amp; Packaging Notes
              </label>
              <textarea
                rows={3}
                placeholder="e.g. Ironed, tagged with Aama hologram, wrapped in waterproof polybag."
                value={packagingNotes}
                disabled={isDispatchLocked}
                onChange={(e) => setPackagingNotes(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:outline-none focus:border-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
          </div>

          {/* Live NCM Delivery Tracking Card — only when delivery data exists */}
          {delivery && (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                  <Truck className="w-4 h-4 text-sky-600" />
                  Live Delivery &amp; Carrier Tracking
                </div>
                {delivery.ncmOrderId && (
                  <span className="font-mono text-[11px] font-bold text-sky-700 bg-sky-50 border border-sky-200 px-2.5 py-1 rounded-lg">
                    Waybill #{delivery.ncmOrderId}
                  </span>
                )}
              </div>

              {/* Route */}
              {(delivery.originBranchName || delivery.destinationBranchName) && (
                <div className="flex items-center gap-2 text-xs p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <MapPin className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                  <span className="font-bold text-orange-700">{delivery.originBranchName || "—"}</span>
                  <span className="text-slate-300">→</span>
                  <span className="font-bold text-emerald-700">{delivery.destinationBranchName || "—"}</span>
                  {delivery.deliveryType && (
                    <span className="ml-auto text-[10px] text-slate-500 font-semibold">{delivery.deliveryType}</span>
                  )}
                </div>
              )}

              {/* NCM Live Status */}
              {delivery.ncmStatus && (
                <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl text-xs text-sky-900">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-sky-500 block mb-1">Courier Status (NCM)</span>
                  <span className="font-black text-sm">{delivery.ncmStatus}</span>
                </div>
              )}

              {/* Step Timeline */}
              {currentStepIdx >= 0 && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-3">Delivery Progress</span>
                  <div className="space-y-2">
                    {DELIVERY_STEPS.map((step, idx) => {
                      const isCompleted = idx < currentStepIdx;
                      const isCurrent = idx === currentStepIdx;
                      const isPending = idx > currentStepIdx;
                      return (
                        <div key={step.key} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all ${
                          isCurrent ? "bg-sky-50 border border-sky-200" :
                          isCompleted ? "bg-slate-50 border border-slate-100" :
                          "opacity-40"
                        }`}>
                          <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 ${
                            isCompleted ? "bg-emerald-500 text-white" :
                            isCurrent ? "bg-sky-500 text-white animate-pulse" :
                            "bg-slate-200 text-slate-400"
                          }`}>
                            {isCompleted ? "✓" : idx + 1}
                          </span>
                          <span className={`text-xs font-semibold ${
                            isCurrent ? "text-sky-800 font-black" :
                            isCompleted ? "text-slate-600" :
                            "text-slate-400"
                          }`}>
                            {step.label}
                          </span>
                          {isCurrent && (
                            <span className="ml-auto text-[10px] text-sky-600 font-bold animate-pulse">LIVE</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Event Log */}
              {delivery.comments && delivery.comments.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">NCM Delivery Comments</span>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {delivery.comments.slice(0, 8).map((comment, idx) => (
                      <div key={comment.id || idx} className="rounded-lg border border-amber-100 bg-amber-50 p-2.5">
                        <p className="text-[11px] text-amber-900">{comment.comments}</p>
                        <p className="text-[10px] text-amber-700 mt-1">
                          {comment.addedBy || "NCM"} · {new Date(comment.addedAt || comment.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {delivery.events && delivery.events.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">Recent Events</span>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {delivery.events.slice(0, 8).map((evt, idx) => (
                      <div key={evt.id || idx} className="flex items-start gap-2.5 p-2 rounded-lg bg-slate-50 border border-slate-100">
                        <div className="w-1.5 h-1.5 rounded-full bg-sky-500 mt-1.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-[10px] font-bold text-slate-700">
                            {evt.ncmStatus || evt.toState || evt.eventType || "Update"}
                          </span>
                          {evt.payloadJson && (() => {
                            try {
                              const p = typeof evt.payloadJson === "string" ? JSON.parse(evt.payloadJson) : evt.payloadJson;
                              return p?.remarks || p?.reason ? (
                                <p className="text-[10px] text-slate-500 mt-0.5 truncate">{p.remarks || p.reason}</p>
                              ) : null;
                            } catch { return null; }
                          })()}
                        </div>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                          {new Date(evt.occurredAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Delivery Timestamps */}
              <div className="grid grid-cols-2 gap-3 text-[11px] pt-2 border-t border-slate-100">
                {delivery.pickedUpAt && (
                  <div>
                    <span className="text-slate-400 block">Picked up</span>
                    <span className="font-bold text-slate-800">{new Date(delivery.pickedUpAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                )}
                {delivery.deliveredAt && (
                  <div>
                    <span className="text-slate-400 block">Delivered</span>
                    <span className="font-bold text-emerald-700">{new Date(delivery.deliveredAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                )}
                {delivery.vendorReference && (
                  <div>
                    <span className="text-slate-400 block">Vendor Ref</span>
                    <span className="font-mono font-bold text-slate-700">{delivery.vendorReference}</span>
                  </div>
                )}
                {delivery.state && (
                  <div>
                    <span className="text-slate-400 block">System State</span>
                    <span className="font-mono font-bold text-slate-700 text-[10px]">{delivery.state}</span>
                  </div>
                )}
              </div>
            </div>
          )}
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

            <div className="hidden">
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
                  onClick={handlePrintPersonalizedLetter}
                  disabled={actionLoading}
                  className="w-full py-3 px-4 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Printer className="w-4 h-4" />
                  Print Personalized Letter
                </button>

                {storyLetter?.letter && (
                  <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-[11px] text-violet-900">
                    <div className="font-bold uppercase tracking-wider text-violet-700">Allocated letter</div>
                    <div className="mt-1 text-sm font-black">#{storyLetter.letter.sequenceNumber || "1"}</div>
                    <div className="text-violet-700">{storyLetter.letter.title || "Personalized Story"}</div>
                  </div>
                )}

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
      <FulfillmentChecklistModal
        isOpen={checklistModalOpen}
        assignment={assignment}
        checklist={checklist}
        benefits={benefits}
        busy={actionLoading}
        onClose={() => setChecklistModalOpen(false)}
        onConfirm={handleChecklistConfirm}
      />
    </div>
  );
};

export default OrderDetail;
