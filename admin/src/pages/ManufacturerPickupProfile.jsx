import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { PackageCheck, MapPin, Phone, Clock3, RefreshCcw } from "lucide-react";
import { backendUrl } from "../App";

const ManufacturerPickupProfile = ({ token, manufacturerId }) => {
  const [form, setForm] = useState({
    pickupAddress: "",
    pickupContactName: "",
    pickupContactPhone: "",
    pickupWindow: "",
    returnInstructions: "",
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!token || !manufacturerId) return;
      try {
        const res = await axios.get(`${backendUrl}/api/manufacturer/profile`, {
          headers: { token },
        });
        if (res.data.success && res.data.manufacturer) {
          setForm({
            pickupAddress: res.data.manufacturer.pickupAddress || "",
            pickupContactName: res.data.manufacturer.pickupContactName || "",
            pickupContactPhone: res.data.manufacturer.pickupContactPhone || "",
            pickupWindow: res.data.manufacturer.pickupWindow || "",
            returnInstructions: res.data.manufacturer.returnInstructions || "",
          });
        }
      } catch (err) {
        console.error(err);
      }
    };

    fetchProfile();
  }, [token, manufacturerId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await axios.post(
        `${backendUrl}/api/manufacturer/pickup-profile`,
        form,
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success("Pickup profile updated successfully");
      } else {
        toast.error(res.data.message || "Failed to update pickup profile");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update pickup profile");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
      <div className="flex items-center gap-2 mb-4">
        <PackageCheck className="w-5 h-5 text-slate-900" />
        <h3 className="font-bold text-slate-900 text-sm">Pickup Profile</h3>
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
            placeholder="Factory address for pickup and handover"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
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
            placeholder="e.g. 10:00 AM – 4:00 PM"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
          />
        </div>

        <div>
          <label className="font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
            <RefreshCcw className="w-3.5 h-3.5 text-orange-600" />
            Return Instructions
          </label>
          <textarea
            rows={3}
            value={form.returnInstructions}
            onChange={(e) => setForm({ ...form, returnInstructions: e.target.value })}
            placeholder="Return pickup notes, packaging instructions, or handover instructions"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-2.5 disabled:opacity-60"
        >
          {loading ? "Saving..." : "Save Pickup Profile"}
        </button>
      </form>
    </div>
  );
};

export default ManufacturerPickupProfile;
