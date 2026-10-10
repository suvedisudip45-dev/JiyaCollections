import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { MapPin, Phone, Clock3, RefreshCcw, ShieldCheck, Building, Factory, Truck } from "lucide-react";
import { useManufacturer } from "../context/ManufacturerContext";

const PickupProfile = () => {
  const { token, manufacturer, distributor, activeProfile, activeWorkspace, backendUrl, fetchProfile } = useManufacturer();
  const [form, setForm] = useState({
    pickupAddress: "",
    pickupContactName: "",
    pickupContactPhone: "",
    pickupWindow: "",
    returnInstructions: "",
  });
  const [saving, setSaving] = useState(false);

  const isDistributor = activeWorkspace === "DISTRIBUTOR";
  const profile = isDistributor ? (distributor || activeProfile) : (manufacturer || activeProfile);

  useEffect(() => {
    if (profile) {
      setForm({
        pickupAddress: profile.pickupAddress || "",
        pickupContactName: profile.pickupContactName || "",
        pickupContactPhone: profile.pickupContactPhone || "",
        pickupWindow: profile.pickupWindow || "",
        returnInstructions: profile.returnInstructions || "",
      });
    }
  }, [profile]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) return;

    setSaving(true);
    try {
      const endpoint = isDistributor
        ? `${backendUrl}/api/distributor/pickup-profile`
        : `${backendUrl}/api/manufacturer/pickup-profile`;

      const res = await axios.post(endpoint, form, { headers: { token } });
      if (res.data.success) {
        toast.success(
          isDistributor
            ? "Distributor hub pickup setup saved successfully."
            : "Factory pickup profile saved successfully."
        );
        await fetchProfile();
      } else {
        toast.error(res.data.message || "Failed to save pickup profile.");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to save pickup profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-[#171717] p-6 rounded-2xl text-white shadow-xs border border-[#dedbd3]">
        <div className="flex items-center gap-2 mb-2">
          <Truck className="w-5 h-5 text-emerald-400" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-300">
            {isDistributor ? "Distributor Courier Pickup Setup" : "Factory Handoff Setup"}
          </span>
        </div>
        <h1 className="text-2xl font-bold font-heading">
          {isDistributor ? "Hub Pickup Readiness & NCM Logistics Setup" : "Factory Pickup Readiness & Carrier Handoff"}
        </h1>
        <p className="text-sm text-[#dedbd3] mt-1.5 max-w-2xl leading-relaxed">
          {isDistributor
            ? "Configure your regional distribution hub pickup address, contact phone, and handover instructions. NCM and courier partners use these details for customer order pickup."
            : "Update your factory collection coordinates. Admin assigns the NCM branch; you control the local pickup contact and gate instructions."}
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-[#dedbd3] p-6 shadow-xs space-y-6">
        {/* Branch Verification Status */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-xl bg-[#f8f7f4] p-4 border border-[#dedbd3]">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#575757]">
              Assigned NCM Branch
            </p>
            <p className="mt-1.5 text-base font-bold text-[#171717]">
              {profile?.ncmPickupBranch || "Branch pending admin verification"}
            </p>
          </div>
          <div className="rounded-xl bg-[#f8f7f4] p-4 border border-[#dedbd3]">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#575757]">
              Branch Operational Status
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${profile?.pickupBranchStatus === "VERIFIED" ? "bg-emerald-500" : "bg-amber-500"}`} />
              <p className="text-sm font-bold text-[#171717]">
                {profile?.pickupBranchStatus || "UNVERIFIED"}
              </p>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[#575757]">
              {profile?.pickupBranchStatus === "REJECTED"
                ? "This branch was rejected. Contact an administrator to assign another NCM branch."
                : "NCM booking validates this branch against the active NCM branch catalog and marks it verified when it matches. Pickup address and contact are separate details."}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 text-xs">
          <div>
            <label className="font-bold text-[#171717] mb-1.5 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-emerald-600" />
              {isDistributor ? "Hub Warehouse / Pickup Address" : "Factory Pickup Address"}
            </label>
            <textarea
              rows={3}
              value={form.pickupAddress}
              onChange={(e) => setForm({ ...form, pickupAddress: e.target.value })}
              placeholder="Exact building, road, landmark, or hub address where delivery partner collects packages"
              className="w-full bg-[#f8f7f4] border border-[#dedbd3] rounded-xl px-3.5 py-2.5 text-sm text-[#171717] focus:outline-none focus:border-[#171717] transition-all"
              required
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="font-bold text-[#171717] mb-1.5 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-blue-600" />
                Pickup Dispatch Contact Person
              </label>
              <input
                type="text"
                value={form.pickupContactName}
                onChange={(e) => setForm({ ...form, pickupContactName: e.target.value })}
                placeholder="Manager / Dispatch Officer Name"
                className="w-full bg-[#f8f7f4] border border-[#dedbd3] rounded-xl px-3.5 py-2.5 text-sm text-[#171717] focus:outline-none focus:border-[#171717] transition-all"
                required
              />
            </div>

            <div>
              <label className="font-bold text-[#171717] mb-1.5 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-blue-600" />
                Dispatch Contact Phone
              </label>
              <input
                type="text"
                value={form.pickupContactPhone}
                onChange={(e) => setForm({ ...form, pickupContactPhone: e.target.value })}
                placeholder="e.g. 98XXXXXXXX"
                className="w-full bg-[#f8f7f4] border border-[#dedbd3] rounded-xl px-3.5 py-2.5 text-sm text-[#171717] focus:outline-none focus:border-[#171717] transition-all"
                required
              />
            </div>
          </div>

          <div>
            <label className="font-bold text-[#171717] mb-1.5 flex items-center gap-1.5">
              <Clock3 className="w-3.5 h-3.5 text-purple-600" />
              Daily Courier Collection Window
            </label>
            <input
              type="text"
              value={form.pickupWindow}
              onChange={(e) => setForm({ ...form, pickupWindow: e.target.value })}
              placeholder="e.g. 10:00 AM - 4:00 PM (Sun - Fri)"
              className="w-full bg-[#f8f7f4] border border-[#dedbd3] rounded-xl px-3.5 py-2.5 text-sm text-[#171717] focus:outline-none focus:border-[#171717] transition-all"
            />
          </div>

          <div>
            <label className="font-bold text-[#171717] mb-1.5 flex items-center gap-1.5">
              <RefreshCcw className="w-3.5 h-3.5 text-amber-600" />
              Return, Gate &amp; Handover Instructions
            </label>
            <textarea
              rows={3}
              value={form.returnInstructions}
              onChange={(e) => setForm({ ...form, returnInstructions: e.target.value })}
              placeholder="Gate security instructions, packaging verification rules, customer return intake desk notes"
              className="w-full bg-[#f8f7f4] border border-[#dedbd3] rounded-xl px-3.5 py-2.5 text-sm text-[#171717] focus:outline-none focus:border-[#171717] transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-[#171717] hover:bg-[#262626] text-white text-xs font-bold py-3 transition-colors shadow-xs disabled:opacity-60"
          >
            {saving ? "Saving Pickup Setup..." : "Save Operational Pickup Setup"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PickupProfile;
