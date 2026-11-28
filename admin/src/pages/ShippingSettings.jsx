/* eslint-disable no-unused-vars */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { backendUrl, currency } from "../App";
import { toast } from "react-toastify";
import { getDistrictsForProvince, useLocationLookups } from "../utils/locationLookups";

const ShippingSettings = ({ token }) => {
  const { lookups: locationLookups, lookupError } = useLocationLookups(backendUrl);
  const [config, setConfig] = useState({
    sameDistrictFee: 50,
    differentDistrictFee: 120,
    sameProvinceFee: 120,
    differentProvinceFee: 120,
    sameProvinceDoorToDoorFee: 120,
    sameProvinceDoorToHubFee: 120,
    differentProvinceDoorToDoorFee: 120,
    differentProvinceDoorToHubFee: 120,
    splitShipmentFee: 200,
    splitShipmentDoorToDoorFee: 200,
    splitShipmentDoorToHubFee: 200,
    routeOverrides: [],
    freeShippingMin: 0,
    ncmReturnSettlementRate: 0,
    ncmExchangeSettlementRate: 0,
    distributorReturnSettlementRate: 0,
    distributorExchangeSettlementRate: 0,
    customerReturnChargeRate: 0,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [simDistrict, setSimDistrict] = useState("Kathmandu");
  const [simProvince, setSimProvince] = useState("Bagmati Province");
  const [simOriginDistrict, setSimOriginDistrict] = useState("Kathmandu");
  const [simOriginProvince, setSimOriginProvince] = useState("Bagmati Province");
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
          sameProvinceFee: Number(c.sameProvinceFee ?? c.differentDistrictFee ?? 120),
          differentProvinceFee: Number(c.differentProvinceFee ?? c.differentDistrictFee ?? 120),
          sameProvinceDoorToDoorFee: Number(c.sameProvinceDoorToDoorFee ?? c.sameProvinceFee ?? 120),
          sameProvinceDoorToHubFee: Number(c.sameProvinceDoorToHubFee ?? c.sameProvinceFee ?? 120),
          differentProvinceDoorToDoorFee: Number(c.differentProvinceDoorToDoorFee ?? c.differentProvinceFee ?? 120),
          differentProvinceDoorToHubFee: Number(c.differentProvinceDoorToHubFee ?? c.differentProvinceFee ?? 120),
          splitShipmentFee: Number(c.splitShipmentFee ?? 200),
          splitShipmentDoorToDoorFee: Number(c.splitShipmentDoorToDoorFee ?? c.splitShipmentFee ?? 200),
          splitShipmentDoorToHubFee: Number(c.splitShipmentDoorToHubFee ?? c.splitShipmentFee ?? 200),
          routeOverrides: Array.isArray(c.routeOverrides) ? c.routeOverrides : [],
          freeShippingMin: Number(c.freeShippingMin ?? 0),
          ncmReturnSettlementRate: Number(c.ncmReturnSettlementRate ?? 0),
          ncmExchangeSettlementRate: Number(c.ncmExchangeSettlementRate ?? 0),
          distributorReturnSettlementRate: Number(c.distributorReturnSettlementRate ?? 0),
          distributorExchangeSettlementRate: Number(c.distributorExchangeSettlementRate ?? 0),
          customerReturnChargeRate: Number(c.customerReturnChargeRate ?? 0),
        });
      }
    } catch (err) {
      toast.error("Failed to load shipping config");
    } finally {
      setLoading(false);
    }
  };

  const runSimulation = async (district, province, amount, originDistrict, originProvince) => {
    try {
      setSimulating(true);
      const res = await axios.get(`${backendUrl}/api/shipping/calculate`, {
        params: { district, province, subtotal: amount, originDistrict, originProvince },
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
    runSimulation(simDistrict, simProvince, simAmount, simOriginDistrict, simOriginProvince);
  }, [simDistrict, simProvince, simAmount, simOriginDistrict, simOriginProvince, config]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setConfig((prev) => ({
      ...prev,
      [name]: Math.max(0, Number(value)),
    }));
  };

  const updateRouteOverride = (index, field, value) => {
    setConfig((current) => ({
      ...current,
      routeOverrides: current.routeOverrides.map((route, routeIndex) =>
        routeIndex === index
          ? {
              ...route,
              [field]: value,
              ...(field === "originProvince" ? {
                originDistrict: getDistrictsForProvince(locationLookups, value)[0] || "",
              } : {}),
              ...(field === "destinationProvince" ? {
                destinationDistrict: getDistrictsForProvince(locationLookups, value)[0] || "",
              } : {}),
            }
          : route
      ),
    }));
  };

  const addRouteOverride = () => {
    setConfig((current) => ({
      ...current,
      routeOverrides: [
        ...current.routeOverrides,
        {
          originProvince: "Bagmati Province",
          originDistrict: "Kathmandu",
          destinationProvince: "Gandaki Province",
          destinationDistrict: "Kaski",
          fee: 250,
        },
      ],
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
          sameProvinceFee: config.sameProvinceFee,
          differentProvinceFee: config.differentProvinceFee,
          sameProvinceDoorToDoorFee: config.sameProvinceDoorToDoorFee,
          sameProvinceDoorToHubFee: config.sameProvinceDoorToHubFee,
          differentProvinceDoorToDoorFee: config.differentProvinceDoorToDoorFee,
          differentProvinceDoorToHubFee: config.differentProvinceDoorToHubFee,
          splitShipmentFee: config.splitShipmentFee,
          splitShipmentDoorToDoorFee: config.splitShipmentDoorToDoorFee,
          splitShipmentDoorToHubFee: config.splitShipmentDoorToHubFee,
          routeOverrides: config.routeOverrides,
          freeShippingMin: config.freeShippingMin,
          ncmReturnSettlementRate: config.ncmReturnSettlementRate,
          ncmExchangeSettlementRate: config.ncmExchangeSettlementRate,
          distributorReturnSettlementRate: config.distributorReturnSettlementRate,
          distributorExchangeSettlementRate: config.distributorExchangeSettlementRate,
          customerReturnChargeRate: config.customerReturnChargeRate,
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

  const isFreeShipping = simResult.tier === "FREE_SHIPPING";
  const isSameZone = ["SAME_DISTRICT", "SAME_PROVINCE"].includes(simResult.tier);

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
            <p className="text-sm text-gray-500">Shared route tiers with optional corridor exceptions</p>
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
            {lookupError && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{lookupError}</p>}

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

            {[
              ["sameProvinceDoorToDoorFee", "Within Province · Door to Door", 120],
              ["sameProvinceDoorToHubFee", "Within Province · Door to Hub", 120],
              ["differentProvinceDoorToDoorFee", "Cross-Province · Door to Door", 120],
              ["differentProvinceDoorToHubFee", "Cross-Province · Door to Hub", 120],
              ["splitShipmentDoorToDoorFee", "Split Shipment · Door to Door", 200],
              ["splitShipmentDoorToHubFee", "Split Shipment · Door to Hub", 200],
            ].map(([name, label, placeholder]) => (
              <div key={name}>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  {label} Fee (Rs.)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-semibold">Rs.</span>
                  <input
                    type="number"
                    name={name}
                    value={config[name]}
                    onChange={handleChange}
                    min="0"
                    step="1"
                    className="w-full border border-gray-200 rounded-lg py-2.5 pl-10 pr-3 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200"
                    placeholder={String(placeholder)}
                  />
                </div>
                {name.startsWith("splitShipment") && (
                  <p className="mt-1 text-[11px] text-gray-500">
                    Flat customer delivery charge when an order ships from more than one distributor hub.
                  </p>
                )}
              </div>
            ))}

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

            <details className="rounded-lg border border-gray-200 p-3">
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-gray-700">
                Customer return refund policy
              </summary>
              <p className="mt-2 text-xs leading-5 text-gray-500">
                This percentage is charged against returned product value. The original delivery fee is never included in the customer refund. The rate is snapshotted when Admin approves a return.
              </p>
              <label className="mt-3 block max-w-xs text-[11px] font-semibold text-gray-600">
                Customer return charge (%)
                <input
                  type="number"
                  name="customerReturnChargeRate"
                  value={config.customerReturnChargeRate}
                  onChange={handleChange}
                  min="0"
                  max="100"
                  step="0.01"
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-xs"
                />
              </label>
            </details>

            <details className="rounded-lg border border-gray-200 p-3">
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-gray-700">
                Optional route exceptions ({config.routeOverrides.length})
              </summary>
              <p className="mt-2 text-xs leading-5 text-gray-500">
                Add exceptions only for routes with a known different carrier charge. All other routes use the three shared rates above.
              </p>
              <div className="mt-3 space-y-3">
                {config.routeOverrides.map((route, index) => (
                  <div key={`${index}-${route.originDistrict}-${route.destinationDistrict}`} className="rounded-lg bg-gray-50 p-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {[
                        ["originProvince", "Origin province"],
                        ["originDistrict", "Origin district"],
                        ["destinationProvince", "Destination province"],
                        ["destinationDistrict", "Destination district"],
                      ].map(([field, label]) => {
                        const isProvince = field.endsWith("Province");
                        const provinceField = field.startsWith("origin") ? "originProvince" : "destinationProvince";
                        const options = isProvince
                          ? locationLookups?.provinces || []
                          : getDistrictsForProvince(locationLookups, route[provinceField]);
                        return (
                          <label key={field} className="block text-[11px] font-semibold text-gray-600">
                            {label}
                            <select
                              value={route[field]}
                              onChange={(event) => updateRouteOverride(index, field, event.target.value)}
                              disabled={!locationLookups}
                              className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-2 text-xs"
                            >
                              {options.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                          </label>
                        );
                      })}
                      <label className="block text-[11px] font-semibold text-gray-600">
                        Route fee (Rs.)
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={route.fee}
                          onChange={(event) => updateRouteOverride(index, "fee", event.target.value)}
                          className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-2 text-xs"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => setConfig((current) => ({
                          ...current,
                          routeOverrides: current.routeOverrides.filter((_, routeIndex) => routeIndex !== index),
                        }))}
                        className="self-end rounded-md border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        Remove route
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addRouteOverride}
                  disabled={config.routeOverrides.length >= 50}
                  className="w-full rounded-lg border border-dashed border-gray-300 py-2 text-xs font-semibold text-gray-700 hover:border-indigo-400 disabled:opacity-50"
                >
                  Add corridor exception
                </button>
              </div>
            </details>

            <details className="rounded-lg border border-gray-200 p-3">
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-gray-700">
                Return and exchange settlement rates
              </summary>
              <p className="mt-2 text-xs leading-5 text-gray-500">
                Company-paid logistics settlement amounts. Rates are snapshotted when a request is approved and become payables after the logistics work is completed; they do not change the customer’s delivery charge.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  ["ncmReturnSettlementRate", "NCM return settlement"],
                  ["ncmExchangeSettlementRate", "NCM exchange settlement"],
                  ["distributorReturnSettlementRate", "Distributor return settlement"],
                  ["distributorExchangeSettlementRate", "Distributor exchange settlement"],
                ].map(([name, label]) => (
                  <label key={name} className="block text-[11px] font-semibold text-gray-600">
                    {label} (Rs.)
                    <input
                      type="number"
                      name={name}
                      value={config[name]}
                      onChange={handleChange}
                      min="0"
                      step="0.01"
                      className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-xs"
                    />
                  </label>
                ))}
              </div>
            </details>

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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[
                  {
                    title: "Shipment origin",
                    province: simOriginProvince,
                    district: simOriginDistrict,
                    setProvince: setSimOriginProvince,
                    setDistrict: setSimOriginDistrict,
                  },
                  {
                    title: "Delivery destination",
                    province: simProvince,
                    district: simDistrict,
                    setProvince: setSimProvince,
                    setDistrict: setSimDistrict,
                  },
                ].map((location) => (
                  <fieldset key={location.title} className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-gray-600">{location.title}</legend>
                    <select
                      value={location.province}
                      onChange={(event) => {
                        location.setProvince(event.target.value);
                        location.setDistrict(getDistrictsForProvince(locationLookups, event.target.value)[0] || "");
                      }}
                      disabled={!locationLookups}
                      className="w-full border border-gray-200 rounded-lg py-2 px-2 text-xs bg-white"
                    >
                      {(locationLookups?.provinces || []).map((province) => <option key={province} value={province}>{province}</option>)}
                    </select>
                    <select
                      value={location.district}
                      onChange={(event) => location.setDistrict(event.target.value)}
                      disabled={!locationLookups}
                      className="w-full border border-gray-200 rounded-lg py-2 px-2 text-xs bg-white"
                    >
                      {getDistrictsForProvince(locationLookups, location.province).map((district) => (
                        <option key={district} value={district}>{district}</option>
                      ))}
                    </select>
                  </fieldset>
                ))}
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
              {[
                ["Within Province · Door to Door", config.sameProvinceDoorToDoorFee, "bg-amber-50 text-amber-800"],
                ["Within Province · Door to Hub", config.sameProvinceDoorToHubFee, "bg-amber-50 text-amber-800"],
                ["Cross-Province · Door to Door", config.differentProvinceDoorToDoorFee, "bg-violet-50 text-violet-800"],
                ["Cross-Province · Door to Hub", config.differentProvinceDoorToHubFee, "bg-violet-50 text-violet-800"],
                ["Split Shipment · Door to Door", config.splitShipmentDoorToDoorFee, "bg-orange-50 text-orange-800"],
                ["Split Shipment · Door to Hub", config.splitShipmentDoorToHubFee, "bg-orange-50 text-orange-800"],
              ].map(([label, fee, colors]) => (
                <div key={label} className={`flex items-center justify-between py-2 px-3 ${colors.split(" ")[0]} rounded-lg`}>
                  <span className="text-xs text-gray-600">{label}</span>
                  <span className={`text-sm font-bold ${colors.split(" ")[1]}`}>Rs. {fee}</span>
                </div>
              ))}
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
