import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { backendUrl } from "../App";

const FEATURE_OPTIONS = [
  {
    key: "loyaltyEnabled",
    title: "Customer loyalty",
    description: "Show loyalty status and rewards at checkout, in customer profiles, and in distributor workflows.",
  },
  {
    key: "marketingCardsEnabled",
    title: "Marketing cards",
    description: "Enable customer card scanning and reward claims, and distributor card assignment.",
  },
  {
    key: "lettersEnabled",
    title: "Customer letters",
    description: "Enable personalized letter generation and the letter print/inclusion steps in fulfillment.",
  },
];

const PlatformFeatureSettings = ({ token }) => {
  const [features, setFeatures] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    axios.get(`${backendUrl}/api/features`)
      .then((response) => {
        if (!response.data?.success) throw new Error(response.data?.message || "Unable to load feature settings.");
        if (mounted) setFeatures(response.data.features);
      })
      .catch((error) => {
        toast.error(error.response?.data?.message || error.message || "Unable to load feature settings.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const toggle = (key) => {
    setFeatures((current) => ({ ...current, [key]: !current[key] }));
  };

  const save = async () => {
    if (!features || saving) return;
    setSaving(true);
    try {
      const response = await axios.patch(`${backendUrl}/api/features`, features, { headers: { token } });
      if (!response.data?.success) throw new Error(response.data?.message || "Unable to update feature settings.");
      setFeatures(response.data.features);
      toast.success("Feature settings saved.");
    } catch (error) {
      toast.error(error.response?.data?.message || error.message || "Unable to update feature settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-sm text-slate-500">Loading feature settings...</div>;
  if (!features) return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Feature settings could not be loaded. Refresh the page to retry.</div>;

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">Platform settings</p>
        <h1 className="mt-1 text-2xl font-black text-slate-950">Customer &amp; fulfillment features</h1>
        <p className="mt-2 text-sm text-slate-600">Turn customer-facing and distributor fulfillment features on or off. Disabling a feature hides its portal actions and prevents its related API operations. Existing loyalty and letter progress is retained.</p>
      </header>

      <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {FEATURE_OPTIONS.map((feature) => (
          <label key={feature.key} className="flex cursor-pointer items-start justify-between gap-5 p-5 sm:p-6">
            <span>
              <span className="block text-sm font-bold text-slate-900">{feature.title}</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">{feature.description}</span>
            </span>
            <span className="shrink-0 pt-0.5">
              <input
                type="checkbox"
                checked={Boolean(features[feature.key])}
                onChange={() => toggle(feature.key)}
                className="peer sr-only"
              />
              <span className={`relative block h-6 w-11 rounded-full transition ${features[feature.key] ? "bg-emerald-500" : "bg-slate-300"} after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform ${features[feature.key] ? "after:translate-x-5" : ""}`} />
              <span className="sr-only">{features[feature.key] ? "Enabled" : "Disabled"}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save feature settings"}
        </button>
      </div>
    </section>
  );
};

export default PlatformFeatureSettings;
