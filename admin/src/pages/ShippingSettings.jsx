/* eslint-disable no-unused-vars */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { backendUrl, currency } from "../App";
import { toast } from "react-toastify";

const NEPAL_DISTRICTS = [
  "Kathmandu", "Lalitpur", "Bhaktapur",
  "Achham", "Arghakhanchi", "Baglung", "Baitadi", "Bajhang", "Bajura", "Banke",
  "Bardiya", "Bhojpur", "Chitwan", "Dadeldhura", "Dailekh", "Dang", "Darchula",
  "Dhading", "Dhankuta", "Dhanusha", "Dolakha", "Dolpa", "Doti", "Gorkha",
  "Gulmi", "Humla", "Ilam", "Jajarkot", "Jhapa", "Jumla", "Kailali", "Kalikot",
  "Kanchanpur", "Kapilvastu", "Kaski", "Kavrepalanchok", "Khotang", "Lamjung",
  "Mahottari", "Makwanpur", "Manang", "Mustang", "Mugu", "Myagdi", "Nawalpur",
  "Nuwakot", "Okhaldhunga", "Palpa", "Panchthar", "Parasi", "Parbat", "Parsa",
  "Pyuthan", "Ramechhap", "Rasuwa", "Rautahat", "Rolpa", "Rukum East", "Rukum West",
  "Rupandehi", "Salyan", "Sankhuwasabha", "Saptari", "Sarlahi", "Sindhuli",
  "Sindhupalchok", "Siraha", "Solukhumbu", "Sunsari", "Surkhet", "Syangja",
  "Tanahun", "Taplejung", "Terhathum", "Udayapur"
];

const ShippingSettings = ({ token }) => {
  const [config, setConfig] = useState({
    sameDistrictFee: 50,
    differentDistrictFee: 120,
    freeShippingMin: 0,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [simDistrict, setSimDistrict] = useState("Kathmandu");
  const [simAmount, setSimAmount] = useState(1500);
  const [simResult, setSimResult] = useState({
    fee: 50,
    tier: "SAME_DISTRICT",
    label: "Within District",
  });
  const [simulating, setSimulating] = useState(false);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${backendUrl}/api/shipping/config`);
      if (res.data.success && res.data.config) {
        const c = res.data.config;
        setConfig({
          sameDistrictFee: Number(c.sameDistrictFee ?? c.sameCityFee ?? 50),
          differentDistrictFee: Number(c.differentDistrictFee ?? c.differentCityFee ?? 120),
          freeShippingMin: Number(c.freeShippingMin ?? 0),
        });
      }
    } catch (err) {
      toast.error("Failed to load shipping config");
    } finally {
      setLoading(false);
    }
  };

  const runSimulation = async (district, amount) => {
    try {
      setSimulating(true);
      const res = await axios.get(`${backendUrl}/api/shipping/calculate`, {
        params: { district, subtotal: amount },
      });
      if (res.data.success) {
        setSimResult({
          fee: res.data.fee,
          tier: res.data.tier,
          label: res.data.label,
        });
      }
    } catch (err) {
      console.error("Simulation error:", err);
    } finally {
      setSimulating(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  useEffect(() => {
    runSimulation(simDistrict, simAmount);
  }, [simDistrict, simAmount, config]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]: Math.max(0, Number(value)),
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await axios.post(
        `${backendUrl}/api/shipping/update`,
        {
          sameDistrictFee: config.sameDistrictFee,
          differentDistrictFee: config.differentDistrictFee,
          freeShippingMin: config.freeShippingMin,
        },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success("Shipment rates updated successfully!");
        fetchConfig();
      } else {
        toast.error(res.data.message || "Failed to update");
      }
    } catch (err) {
      toast.error(err.message || "Network error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-gray-300 border-t-black rounded-full animate-spin"></div>
      </div>
    );
  }

  const isFreeShipping = simResult.fee === 0 && Number(config.freeShippingMin || 0) > 0;
  const isSameZone = simResult.tier === "SAME_DISTRICT";

  return (
    <div className="max-w-4xl mx-auto pb-16">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2.5 bg-indigo-50 rounded-2xl border border-indigo-100">
            <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"
                d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Shipment Rate Settings</h1>
            <p className="text-sm text-gray-500">Configure delivery tier pricing</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left: Configuration Card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-gray-900 to-gray-800 px-5 py-4">
            <h2 className="text-white font-semibold text-base flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Rate Configuration
            </h2>
          </div>
          <div className="p-5 space-y-5">

            {/* Same District Fee */}
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Within District Fee (Rs.)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-semibold">Rs.</span>
                <input
                  type="number"
                  name="sameDistrictFee"
                  value={config.sameDistrictFee}
                  onChange={handleChange}
                  min="0"
                  step="1"
                  className="w-full border border-gray-200 rounded-lg py-2.5 pl-10 pr-3 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200"
                  placeholder="50"
                />
              </div>
            </div>

            {/* Different District Fee */}
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Outside District Fee (Rs.)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-semibold">Rs.</span>
                <input
                  type="number"
                  name="differentDistrictFee"
                  value={config.differentDistrictFee}
                  onChange={handleChange}
                  min="0"
                  step="1"
                  className="w-full border border-gray-200 rounded-lg py-2.5 pl-10 pr-3 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200"
                  placeholder="120"
                />
              </div>
            </div>

            {/* Free Shipping Minimum */}
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Free Delivery Threshold (Rs.)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-semibold">Rs.</span>
                <input
                  type="number"
                  name="freeShippingMin"
                  value={config.freeShippingMin}
                  onChange={handleChange}
                  min="0"
                  step="1"
                  className="w-full border border-gray-200 rounded-lg py-2.5 pl-10 pr-3 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200"
                  placeholder="0"
                />
              </div>
            </div>

            {/* Save Button */}
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-black text-white font-semibold py-3 rounded-xl text-sm hover:bg-gray-800 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-sm mt-2 cursor-pointer"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        {/* Right: Live Simulator + Current Rates Summary */}
        <div className="space-y-5">

          {/* Live Simulator */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-4">
              <h2 className="text-white font-semibold text-base flex items-center gap-2">
                <svg className="w-4 h-4 text-indigo-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Rate Simulator
              </h2>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  District
                </label>
                <select
                  value={simDistrict}
                  onChange={(e) => setSimDistrict(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg py-2.5 px-3 text-sm bg-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {NEPAL_DISTRICTS.map((dist) => (
                    <option key={dist} value={dist}>{dist}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Order Subtotal (Rs.)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-semibold">Rs.</span>
                  <input
                    type="number"
                    value={simAmount}
                    onChange={(e) => setSimAmount(Number(e.target.value))}
                    min="0"
                    className="w-full border border-gray-200 rounded-lg py-2.5 pl-10 pr-3 text-sm focus:outline-none focus:border-indigo-500"
                    placeholder="1500"
                  />
                </div>
              </div>

              {/* Result Badge */}
              <div className={`rounded-xl p-4 border-2 ${isFreeShipping ? "bg-emerald-50 border-emerald-300" : isSameZone ? "bg-sky-50 border-sky-300" : "bg-amber-50 border-amber-300"}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-bold uppercase tracking-wider ${isFreeShipping ? "text-emerald-700" : isSameZone ? "text-sky-700" : "text-amber-700"}`}>
                    {simResult.label}
                  </span>
                </div>
                <div className="flex items-end gap-1">
                  <span className={`text-3xl font-black ${isFreeShipping ? "text-emerald-600" : isSameZone ? "text-sky-700" : "text-amber-700"}`}>
                    Rs. {simResult.fee}
                  </span>
                  <span className="text-xs text-gray-500 mb-1">delivery fee</span>
                </div>
                <div className="mt-2 pt-2 border-t border-current border-opacity-20">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600">Subtotal</span>
                    <span className="font-semibold text-gray-800">Rs. {simAmount}</span>
                  </div>
                  <div className="flex justify-between text-xs mt-0.5">
                    <span className="text-gray-600">Shipping</span>
                    <span className="font-semibold text-gray-800">Rs. {simResult.fee}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold mt-1">
                    <span className="text-gray-900">Total</span>
                    <span className="text-gray-900">Rs. {simAmount + simResult.fee}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Current Active Rates Summary */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-1.5">
              <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Active Rates
            </h3>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between py-2 px-3 bg-sky-50 rounded-lg">
                <span className="text-xs text-gray-600">Within District Fee</span>
                <span className="text-sm font-bold text-sky-800">Rs. {config.sameDistrictFee}</span>
              </div>
              <div className="flex items-center justify-between py-2 px-3 bg-amber-50 rounded-lg">
                <span className="text-xs text-gray-600">Outside District Fee</span>
                <span className="text-sm font-bold text-amber-800">Rs. {config.differentDistrictFee}</span>
              </div>
              {Number(config.freeShippingMin) > 0 && (
                <div className="flex items-center justify-between py-2 px-3 bg-emerald-50 rounded-lg">
                  <span className="text-xs text-gray-600">Free Shipping Above</span>
                  <span className="text-sm font-bold text-emerald-700">Rs. {config.freeShippingMin}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShippingSettings;
