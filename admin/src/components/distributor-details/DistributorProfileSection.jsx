/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { backendUrl, currency } from "../../App";
import { toast } from "react-toastify";
import { usePermissions } from "../../auth/PermissionsContext";
import { getBranchesForLocation, getDistrictsForProvince, useLocationLookups } from "../../utils/locationLookups";

const fieldClass = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500";
const numericValue = (value, fallback = 0) => (value === null || value === undefined ? fallback : Number(value));

const DistributorProfileSection = ({ distributor, token, onUpdated }) => {
  const [profile, setProfile] = useState({});
  const [rate, setRate] = useState({});
  const [bonusPlans, setBonusPlans] = useState([]);
  const [bonusTiers, setBonusTiers] = useState([{ targetCount: "", bonusAmount: "" }]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingRate, setSavingRate] = useState(false);
  const [savingBonusPlan, setSavingBonusPlan] = useState(false);
  const { lookups: locationLookups, lookupError } = useLocationLookups(backendUrl);
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
      vatRate: numericValue(generalRate.vatRate, 13),
      vatInclusive: Boolean(generalRate.vatInclusive),
    });
  }, [distributor, locationLookups]);

  useEffect(() => {
    let active = true;
    axios.get(`${backendUrl}/api/admin/distributor-rates/bonus-plans`, {
      headers: { token },
      params: { distributorId: distributor.id },
    }).then((response) => {
      if (!active) return;
      const plans = response.data?.plans || [];
      setBonusPlans(plans);
      const plan = plans.find((item) => item.status === "ACTIVE" && !item.effectiveUntil);
      if (plan && Array.isArray(plan.tiers)) {
        setBonusTiers(plan.tiers.map((tier) => ({
          targetCount: String(tier.targetCount),
          bonusAmount: String(tier.bonusAmount),
        })));
      }
    }).catch((error) => {
      console.error("Failed to load distributor bonus plans", error);
      toast.error(error.response?.data?.message || "Unable to load distributor bonus plans.");
    });
    return () => { active = false; };
  }, [distributor.id, token]);

  const updateField = (field, value) => setProfile((current) => {
    if (field === "province") {
      return {
        ...current,
        province: value,
        district: getDistrictsForProvince(locationLookups, value)[0] || "",
        city: "",
        ncmPickupBranch: "",
        street: "",
      };
    }
    if (field === "district") {
      return { ...current, district: value, city: "", ncmPickupBranch: "", street: "" };
    }
    if (field === "city") {
      return { ...current, city: value, ncmPickupBranch: value.toUpperCase(), street: "" };
    }
    return { ...current, [field]: value };
  });

  const selectedBranch = locationLookups?.branches?.find(
    (branch) => branch.name.toLocaleLowerCase() === String(profile.ncmPickupBranch || "").toLocaleLowerCase(),
  );
  const streetOptions = selectedBranch?.coveredAreas || [];

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
  const saveBonusPlan = async (event) => {
    event.preventDefault();
    const tiers = bonusTiers
      .filter((tier) => tier.targetCount !== "" || tier.bonusAmount !== "")
      .map((tier) => ({ targetCount: Number(tier.targetCount), bonusAmount: Number(tier.bonusAmount) }));
    if (!tiers.length || tiers.some((tier) => !Number.isInteger(tier.targetCount) || tier.targetCount < 1 || !Number.isFinite(tier.bonusAmount) || tier.bonusAmount <= 0)) {
      toast.error("Every bonus tier needs a whole-delivery target and a positive bonus amount.");
      return;
    }
    setSavingBonusPlan(true);
    try {
      const response = await axios.post(
        `${backendUrl}/api/admin/distributor-rates/bonus-plans`,
        { distributorId: distributor.id, tiers, notes: "Monthly completed-delivery target bonus." },
        { headers: { token } },
      );
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to save the bonus plan.");
      setBonusPlans((current) => [response.data.plan, ...current.map((plan) => (
        plan.status === "ACTIVE" && !plan.effectiveUntil
          ? { ...plan, effectiveUntil: response.data.plan.effectiveFrom }
          : plan
      ))]);
      toast.success("Monthly delivery bonus plan saved.");
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || error.message || "Unable to save the bonus plan.");
    } finally {
      setSavingBonusPlan(false);
    }
  };

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
        {lookupError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{lookupError}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["name", "Business name"], ["phone", "Contact number"], ["province", "Province"], ["district", "District"], ["city", "City / NCM branch"], ["street", "Street / covered area"], ["landmark", "Landmark"], ["pickupContactName", "Pickup contact"], ["pickupContactPhone", "Pickup contact number"], ["pickupWindow", "Pickup window"], ["pickupAddress", "Pickup address"],
          ].map(([field, label]) => (
            <label key={field} className="text-xs font-semibold text-slate-600">{label}
              {["province", "district", "city", "street"].includes(field) ? (
                <select
                  value={profile[field] || ""}
                  onChange={(event) => updateField(field, event.target.value)}
                  disabled={!canEdit || !locationLookups}
                  className={`${fieldClass} bg-white disabled:bg-slate-50`}
                >
                  <option value="">Select {label.toLowerCase()}</option>
                  {(field === "province"
                    ? locationLookups?.provinces || []
                    : field === "district"
                      ? getDistrictsForProvince(locationLookups, profile.province)
                      : field === "city"
                        ? getBranchesForLocation(locationLookups, profile.province, profile.district).map(({ name }) => name)
                        : streetOptions
                  ).map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : (
                <input value={profile[field] || ""} onChange={(event) => updateField(field, event.target.value)} readOnly={!canEdit} className={`${fieldClass} read-only:bg-slate-50`} />
              )}
            </label>
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
          ["deliveryCharge", `Delivery charge (${currency})`], ["returnCharge", `Return service charge (${currency})`], ["commissionRate", "Commission deduction (%)"], ["vatRate", "VAT rate (%)"],
        ].map(([field, label]) => (
          <label key={field} className="block text-xs font-semibold text-slate-600">{label}
            <input type="number" min="0" step="0.01" value={rate[field] ?? 0} onChange={(event) => setRateValue(field, event.target.value)} readOnly={!canEdit} className={`${fieldClass} read-only:bg-slate-50`} />
          </label>
        ))}
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={Boolean(rate.vatInclusive)} onChange={(event) => setRate((current) => ({ ...current, vatInclusive: event.target.checked }))} disabled={!canEdit} /> VAT inclusive</label>
        <p className="rounded-lg bg-blue-50 p-3 text-xs leading-5 text-blue-800">Delivery and return charges are fixed per completed service. No per-delivery incentive is added. Configure monthly target bonuses separately below.</p>
        {canEdit && <button type="submit" disabled={savingRate} className="w-full rounded-lg bg-indigo-700 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50">{savingRate ? "Saving…" : "Save approved rates"}</button>}
      </form>
      </div>
      <form onSubmit={saveBonusPlan} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="font-bold text-slate-900">Monthly completed-delivery bonus</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">Each tier adds its bonus once the distributor reaches that many completed self-deliveries in a Kathmandu-time calendar month. Terms take effect now, apply only to full future months, and are locked into the eventual settlement record.</p>
        </div>
        <div className="space-y-2">
          {bonusTiers.map((tier, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <label className="text-xs font-semibold text-slate-600">Monthly delivery target
                <input type="number" min="1" step="1" value={tier.targetCount} onChange={(event) => setBonusTiers((current) => current.map((item, row) => row === index ? { ...item, targetCount: event.target.value } : item))} readOnly={!canEdit} className={`${fieldClass} read-only:bg-slate-50`} />
              </label>
              <label className="text-xs font-semibold text-slate-600">Additional bonus ({currency})
                <input type="number" min="0.01" step="0.01" value={tier.bonusAmount} onChange={(event) => setBonusTiers((current) => current.map((item, row) => row === index ? { ...item, bonusAmount: event.target.value } : item))} readOnly={!canEdit} className={`${fieldClass} read-only:bg-slate-50`} />
              </label>
              {canEdit && <button type="button" onClick={() => setBonusTiers((current) => current.filter((_, row) => row !== index))} disabled={bonusTiers.length === 1} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-40">Remove</button>}
            </div>
          ))}
        </div>
        {canEdit && <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setBonusTiers((current) => [...current, { targetCount: "", bonusAmount: "" }])} disabled={bonusTiers.length >= 10} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">Add tier</button>
          <button type="submit" disabled={savingBonusPlan || !bonusTiers.length} className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{savingBonusPlan ? "Saving…" : "Save future bonus plan"}</button>
        </div>}
        <div className="space-y-1 border-t border-slate-100 pt-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Plan history</p>
          {bonusPlans.length ? bonusPlans.map((plan) => (
            <p key={plan.id} className="text-xs text-slate-600">{new Date(plan.effectiveFrom).toLocaleDateString()} · {plan.status} · {(plan.tiers || []).map((item) => `${item.targetCount} deliveries = ${currency}${Number(item.bonusAmount).toFixed(2)}`).join(" + ")}</p>
          )) : <p className="text-xs text-slate-500">No target bonus plan configured.</p>}
        </div>
      </form>
    </div>
  );
};

export default DistributorProfileSection;
