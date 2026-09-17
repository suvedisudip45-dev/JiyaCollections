import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { MapPin, Phone, Clock3, RefreshCcw, ShieldCheck } from "lucide-react";
import { useManufacturer } from "../context/ManufacturerContext";

const PickupProfile = () => {
  const { token, manufacturer, backendUrl, fetchProfile } = useManufacturer();
  const [form, setForm] = useState({
    pickupAddress: "",
    pickupContactName: "",
    pickupContactPhone: "",
    pickupWindow: "",
    returnInstructions: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (manufacturer) {
      setForm({
        pickupAddress: manufacturer.pickupAddress || "",
        pickupContactName: manufacturer.pickupContactName || "",
        pickupContactPhone: manufacturer.pickupContactPhone || "",
        pickupWindow: manufacturer.pickupWindow || "",
        returnInstructions: manufacturer.returnInstructions || "",
      });
    }
  }, [manufacturer]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) return;

    setSaving(true);
    try {
      const res = await axios.post(
        `${backendUrl}/api/manufacturer/pickup-profile`,
        form,
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success("Pickup profile saved successfully");
        await fetchProfile();
      } else {
        toast.error(res.data.message || "Failed to save pickup profile");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to save pickup profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-emerald-700 via-slate-900 to-slate-900 p-6 rounded-2xl text-white shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="w-5 h-5 text-emerald-300" />
          <span className="text-xs uppercase tracking-[0.18em] text-emerald-200">Operational pickup setup</span>
        </div>
        <h1 className="text-2xl font-black">Pickup readiness and local handoff</h1>
        <p className="text-sm text-slate-200 mt-2 max-w-2xl">
          Update your factory handoff details. Admin controls the NCM pickup branch assignment; you manage the operational pickup readiness profile for your local hub.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
        <div className="grid md:grid-cols-2 gap-4 mb-5">
          <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Assigned NCM branch</p>
            <p className="mt-2 font-black text-slate-900">{manufacturer?.ncmPickupBranch || "Not assigned yet"}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Branch status</p>
            <p className="mt-2 font-black text-amber-600">{manufacturer?.pickupBranchStatus || "UNVERIFIED"}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-emerald-600" />
              Pickup Address
            </label>
            <textarea
              rows={3}
              value={form.pickupAddress}
              onChange={(e) => setForm({ ...form, pickupAddress: e.target.value })}
              placeholder="Factory or warehouse address where courier can collect goods"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-sky-600" />
                Contact Name
              </label>
              <input
                type="text"
                value={form.pickupContactName}
                onChange={(e) => setForm({ ...form, pickupContactName: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-sky-600" />
                Contact Phone
              </label>
              <input
                type="text"
                value={form.pickupContactPhone}
                onChange={(e) => setForm({ ...form, pickupContactPhone: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
              <Clock3 className="w-3.5 h-3.5 text-violet-600" />
              Preferred Pickup Window
            </label>
            <input
              type="text"
              value={form.pickupWindow}
              onChange={(e) => setForm({ ...form, pickupWindow: e.target.value })}
              placeholder="e.g. 10:00 AM - 4:00 PM"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
            />
          </div>

          <div>
            <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
              <RefreshCcw className="w-3.5 h-3.5 text-orange-600" />
              Return / Handover Instructions
            </label>
            <textarea
              rows={4}
              value={form.returnInstructions}
              onChange={(e) => setForm({ ...form, returnInstructions: e.target.value })}
              placeholder="Gate instructions, loading notes, return requirements, or packaging remarks"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2.5 disabled:opacity-60"
          >
            {saving ? "Saving pickup setup..." : "Save pickup setup"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default PickupProfile;
