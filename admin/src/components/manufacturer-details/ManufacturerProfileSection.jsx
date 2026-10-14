/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../../App";
import { usePermissions } from "../../auth/PermissionsContext";

const inputClass = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 read-only:bg-slate-50";

const ManufacturerProfileSection = ({ manufacturer, token, onUpdated }) => {
  const { can } = usePermissions();
  const [profile, setProfile] = useState({});
  const [saving, setSaving] = useState(false);
  const canEdit = can("manufacturer:admin_update");

  useEffect(() => {
    setProfile({
      name: manufacturer.name || "",
      email: manufacturer.email || "",
      phone: manufacturer.phone || "",
      city: manufacturer.city || "",
      address: manufacturer.address || "",
      pickupAddress: manufacturer.pickupAddress || "",
      pickupContactName: manufacturer.pickupContactName || "",
      pickupContactPhone: manufacturer.pickupContactPhone || "",
      pickupWindow: manufacturer.pickupWindow || "",
      returnInstructions: manufacturer.returnInstructions || "",
      contractStartDate: manufacturer.contractStartDate ? new Date(manufacturer.contractStartDate).toISOString().slice(0, 10) : "",
      contractExpiryDate: manufacturer.contractExpiryDate ? new Date(manufacturer.contractExpiryDate).toISOString().slice(0, 10) : "",
    });
  }, [manufacturer]);

  const update = (field, value) => setProfile((current) => ({ ...current, [field]: value }));
  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await axios.put(
        `${backendUrl}/api/manufacturer/admin/update/${manufacturer.id}`,
        profile,
        { headers: { token } },
      );
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to update manufacturer profile.");
      toast.success("Manufacturer profile updated.");
      onUpdated();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to update manufacturer profile.");
    } finally {
      setSaving(false);
    }
  };

  const fields = [
    ["name", "Business name", "text"],
    ["email", "Email / login email", "email"],
    ["phone", "Contact number", "tel"],
    ["city", "City / hub", "text"],
    ["pickupContactName", "Pickup contact", "text"],
    ["pickupContactPhone", "Pickup contact number", "tel"],
    ["pickupWindow", "Pickup window", "text"],
    ["contractStartDate", "Contract start", "date"],
    ["contractExpiryDate", "Contract end", "date"],
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
      <form onSubmit={save} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div><h2 className="font-bold text-slate-900">Business profile</h2><p className="mt-1 text-xs text-slate-500">Updates reuse the existing manufacturer admin endpoint. Email changes synchronize the linked login account.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map(([field, label, type]) => (
            <label key={field} className="text-xs font-semibold text-slate-600">{label}<input type={type} value={profile[field] || ""} onChange={(event) => update(field, event.target.value)} readOnly={!canEdit} className={inputClass} /></label>
          ))}
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Business address
            <textarea rows={2} value={profile.address || ""} onChange={(event) => update("address", event.target.value)} readOnly={!canEdit} className={inputClass} />
          </label>
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Pickup address
            <textarea rows={2} value={profile.pickupAddress || ""} onChange={(event) => update("pickupAddress", event.target.value)} readOnly={!canEdit} className={inputClass} />
          </label>
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Return instructions
            <textarea rows={2} value={profile.returnInstructions || ""} onChange={(event) => update("returnInstructions", event.target.value)} readOnly={!canEdit} className={inputClass} />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500">
          <span>Account created {manufacturer.account?.createdAt ? new Date(manufacturer.account.createdAt).toLocaleDateString() : "—"}</span>
          {canEdit && <button type="submit" disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2.5 font-bold text-white disabled:opacity-50">{saving ? "Saving…" : "Save profile"}</button>}
        </div>
      </form>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div><h2 className="font-bold text-slate-900">Partner performance</h2><p className="mt-1 text-xs text-slate-500">Existing contract and fulfillment measures.</p></div>
        <Metric label="Quality rating" value={`${Number(manufacturer.qualityRating || 0).toFixed(1)} / 5 · ${manufacturer.ratingCount || 0} ratings`} />
        <Metric label="Orders fulfilled" value={manufacturer.totalOrdersFulfilled || 0} />
        <Metric label="On-time rate" value={`${manufacturer.onTimeRate || "0.0"}%`} />
        <Metric label="Defect rate" value={`${manufacturer.defectRate || "0.0"}%`} />
        <Metric label="Contract / availability" value={`${manufacturer.contractStatus || "ACTIVE"} · ${manufacturer.isAvailable ? "Accepting work" : "Paused"}`} />
        <Metric label="Commission" value={`${manufacturer.agreedCommissionRate ?? manufacturer.proposedCommissionRate ?? 0}% · ${manufacturer.commissionStatus || "PENDING"}`} />
        <Metric label="NCM pickup branch" value={`${manufacturer.ncmPickupBranch || "—"} · ${manufacturer.pickupBranchStatus || "UNVERIFIED"}`} />
        <Metric label="Login account" value={`${manufacturer.account?.email || manufacturer.email} · ${manufacturer.account?.status || "No linked account"}`} />
      </section>
    </div>
  );
};

const Metric = ({ label, value }) => (
  <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
    <span className="text-xs text-slate-500">{label}</span><span className="text-right text-xs font-semibold text-slate-800">{value}</span>
  </div>
);

export default ManufacturerProfileSection;
