/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { backendUrl, currency } from "../../App";
import { toast } from "react-toastify";
import { usePermissions } from "../../auth/PermissionsContext";

const fieldClass = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500";
const numericValue = (value, fallback = 0) => (value === null || value === undefined ? fallback : Number(value));

const DistributorProfileSection = ({ distributor, token, onUpdated }) => {
  const [profile, setProfile] = useState({});
  const [rate, setRate] = useState({});
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingRate, setSavingRate] = useState(false);
  const { can } = usePermissions();
  const canEdit = can("distributor:admin_review");

  useEffect(() => {
    setProfile({
      name: distributor.name || "",
      phone: distributor.phone || "",
      address: distributor.address || "",
      city: distributor.city || "",
      province: distributor.province || "",
      district: distributor.district || "",
      street: distributor.street || "",
      landmark: distributor.landmark || "",
      ncmPickupBranch: distributor.ncmPickupBranch || "",
      pickupAddress: distributor.pickupAddress || "",
      pickupContactName: distributor.pickupContactName || "",
      pickupContactPhone: distributor.pickupContactPhone || "",
      pickupWindow: distributor.pickupWindow || "",
      returnInstructions: distributor.returnInstructions || "",
    });
    const generalRate = distributor.deliveryChargeNegotiations?.find((item) => !item.productId && item.status === "APPROVED") || {};
    setRate({
      deliveryCharge: numericValue(generalRate.deliveryCharge),
      returnCharge: numericValue(generalRate.returnCharge),
      commissionRate: numericValue(generalRate.commissionRate),
      bonusRate: numericValue(generalRate.bonusRate),
      incentiveRate: numericValue(generalRate.incentiveRate),
      vatRate: numericValue(generalRate.vatRate, 13),
      vatInclusive: Boolean(generalRate.vatInclusive),
    });
  }, [distributor]);

  const updateField = (field, value) => setProfile((current) => ({ ...current, [field]: value }));

  const saveProfile = async (event) => {
    event.preventDefault();
    setSavingProfile(true);
    try {
      const response = await axios.put(
        `${backendUrl}/api/admin/distributor-applications/${distributor.id}/profile`,
        profile,
        { headers: { token } },
      );
      if (response.data?.success === false) throw new Error(response.data.message || "Unable to update distributor profile.");
      toast.success("Distributor profile updated.");
      onUpdated();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to update distributor profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  const saveRate = async (event) => {
    event.preventDefault();
    setSavingRate(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/admin/distributor-rates`,
        { distributorId: distributor.id, ...rate, status: "APPROVED", notes: "Updated from distributor detail profile." },
        { headers: { token } },
      );
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to update distributor rates.");
      toast.success("Approved distributor rates updated.");
      onUpdated();
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to update distributor rates.");
    } finally {
      setSavingRate(false);
    }
  };

  const setRateValue = (field, value) => setRate((current) => ({ ...current, [field]: Number(value) }));

  return (
    <div className="space-y-4">
      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Pickup branch verification", distributor.pickupBranchStatus || "UNVERIFIED"],
          ["Quality rating", `${Number(distributor.qualityRating || 0).toFixed(1)} · ${distributor.ratingCount || 0} ratings`],
          ["Contract period", `${distributor.contractStartDate ? new Date(distributor.contractStartDate).toLocaleDateString() : "—"} to ${distributor.contractExpiryDate ? new Date(distributor.contractExpiryDate).toLocaleDateString() : "—"}`],
          ["Account created", distributor.account?.createdAt ? new Date(distributor.account.createdAt).toLocaleDateString() : "—"],
        ].map(([label, value]) => <div key={label}><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-800">{value}</p></div>)}
        <div className="sm:col-span-2 xl:col-span-4"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Service coverage</p><div className="mt-2 flex flex-wrap gap-2">{(distributor.locations || []).length ? distributor.locations.map((location) => <span key={location.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{location.district}, {location.province}</span>) : <span className="text-xs text-slate-500">No additional covered districts.</span>}</div></div>
      </section>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <form onSubmit={saveProfile} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div><h2 className="font-bold text-slate-900">Business profile</h2><p className="mt-1 text-xs text-slate-500">Update contact, address and pickup details. Changes use the existing audited admin profile endpoint.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["name", "Business name"], ["phone", "Contact number"], ["city", "City"], ["province", "Province"], ["district", "District"], ["street", "Street"], ["landmark", "Landmark"], ["ncmPickupBranch", "NCM pickup branch"], ["pickupContactName", "Pickup contact"], ["pickupContactPhone", "Pickup contact number"], ["pickupWindow", "Pickup window"], ["pickupAddress", "Pickup address"],
          ].map(([field, label]) => (
            <label key={field} className="text-xs font-semibold text-slate-600">{label}<input value={profile[field] || ""} onChange={(event) => updateField(field, event.target.value)} readOnly={!canEdit} className={`${fieldClass} read-only:bg-slate-50`} /></label>
          ))}
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Address<textarea rows={2} value={profile.address || ""} onChange={(event) => updateField("address", event.target.value)} readOnly={!canEdit} className={`${fieldClass} read-only:bg-slate-50`} /></label>
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Return instructions<textarea rows={2} value={profile.returnInstructions || ""} onChange={(event) => updateField("returnInstructions", event.target.value)} readOnly={!canEdit} className={`${fieldClass} read-only:bg-slate-50`} /></label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          {distributor.account?.manufacturerProfile ? (
            <Link to={`/manufacturers/${distributor.account.manufacturerProfile.id}`} className="text-xs font-bold text-indigo-700 hover:underline">
              Open separate manufacturer profile · {distributor.account.manufacturerProfile.name}
            </Link>
          ) : <span className="text-xs text-slate-500">No linked manufacturer profile.</span>}
          {canEdit && <button type="submit" disabled={savingProfile} className="rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">{savingProfile ? "Saving…" : "Save profile"}</button>}
        </div>
      </form>

      <form onSubmit={saveRate} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div><h2 className="font-bold text-slate-900">General rate card</h2><p className="mt-1 text-xs text-slate-500">Saving records an approved general rate using the existing rate-card workflow.</p></div>
        {[
          ["deliveryCharge", `Delivery charge (${currency})`], ["returnCharge", `Return charge (${currency})`], ["commissionRate", "Commission rate (stored value)"], ["bonusRate", "Bonus rate (stored value)"], ["incentiveRate", "Incentive rate (stored value)"], ["vatRate", "VAT rate (%)"],
        ].map(([field, label]) => (
          <label key={field} className="block text-xs font-semibold text-slate-600">{label}
            <input type="number" min="0" step="0.01" value={rate[field] ?? 0} onChange={(event) => setRateValue(field, event.target.value)} readOnly={!canEdit} className={`${fieldClass} read-only:bg-slate-50`} />
          </label>
        ))}
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={Boolean(rate.vatInclusive)} onChange={(event) => setRate((current) => ({ ...current, vatInclusive: event.target.checked }))} disabled={!canEdit} /> VAT inclusive</label>
        {canEdit && <button type="submit" disabled={savingRate} className="w-full rounded-lg bg-indigo-700 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">{savingRate ? "Saving…" : "Save approved rates"}</button>}
      </form>
      </div>
    </div>
  );
};

export default DistributorProfileSection;
