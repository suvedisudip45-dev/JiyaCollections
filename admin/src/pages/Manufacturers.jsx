import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import {
  Factory,
  Plus,
  Star,
  FileCheck,
  Upload,
  Calendar,
  Search,
  CheckCircle2,
  X,
  FileText,
  MapPin,
  Phone,
  Mail,
  Percent,
} from "lucide-react";
import { backendUrl, currency } from "../App";

const NEPAL_CITIES = [
  "Kathmandu",
  "Lalitpur",
  "Bhaktapur",
  "Pokhara",
  "Biratnagar",
  "Birgunj",
  "Butwal",
  "Dharan",
  "Chitwan",
  "Hetauda",
  "Nepalgunj",
  "Itahari",
  "Janakpur",
  "Dhangadhi",
];

const Manufacturers = ({ token }) => {
  const [manufacturers, setManufacturers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // Create Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingManufacturerId, setEditingManufacturerId] = useState(null);
  const [formData, setFormData] = useState({
    businessName: "",
    email: "",
    password: "",
    phone: "",
    address: "",
    city: "Kathmandu",
    ncmPickupBranch: "",
    pickupAddress: "",
    pickupContactName: "",
    pickupContactPhone: "",
    pickupWindow: "",
    returnInstructions: "",
    pickupBranchStatus: "UNVERIFIED",
    commissionRate: 12,
    contractStart: new Date().toISOString().split("T")[0],
    contractEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
  });

  // Quality Modal
  const [qualityModalOpen, setQualityModalOpen] = useState(false);
  const [selectedMfg, setSelectedMfg] = useState(null);
  const [qualityRating, setQualityRating] = useState(5.0);
  const [qualityNotes, setQualityNotes] = useState("");

  // Contract Modal
  const [contractModalOpen, setContractModalOpen] = useState(false);
  const [contractStatus, setContractStatus] = useState("ACTIVE");
  const [contractStart, setContractStart] = useState("");
  const [contractEnd, setContractEnd] = useState("");
  const [contractFile, setContractFile] = useState(null);
  const [contractLoading, setContractLoading] = useState(false);

  const fetchManufacturers = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await axios.get(`${backendUrl}/api/manufacturer/admin/list`, {
        headers: { token },
      });
      if (res.data.success) {
        setManufacturers(res.data.manufacturers || []);
      }
    } catch (err) {
      toast.error("Failed to load manufacturers");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const handleSyncRatings = async () => {
    try {
      const res = await axios.post(
        `${backendUrl}/api/manufacturer/admin/sync-ratings`,
        {},
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success(res.data.message || "Quality ratings synchronized from customer reviews!");
        fetchManufacturers();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to sync ratings");
    }
  };

  useEffect(() => {
    fetchManufacturers();
  }, [fetchManufacturers]);

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...formData,
        name: formData.businessName,
        pickupBranchStatus: formData.pickupBranchStatus || "UNVERIFIED",
      };

      if (editingManufacturerId) {
        const res = await axios.put(
          `${backendUrl}/api/manufacturer/admin/update/${editingManufacturerId}`,
          payload,
          { headers: { token } }
        );
        if (res.data.success) {
          toast.success("Manufacturer pickup settings updated successfully!");
        } else {
          throw new Error(res.data.message || "Failed to update manufacturer settings");
        }
      } else {
        const res = await axios.post(
          `${backendUrl}/api/manufacturer/admin/register`,
          payload,
          { headers: { token } }
        );
        if (res.data.success) {
          toast.success("Manufacturer registered successfully!");
        } else {
          throw new Error(res.data.message || "Failed to register manufacturer");
        }
      }

      setCreateModalOpen(false);
      setEditingManufacturerId(null);
      setFormData({
        businessName: "",
        email: "",
        password: "",
        phone: "",
        address: "",
        city: "Kathmandu",
        ncmPickupBranch: "",
        pickupAddress: "",
        pickupContactName: "",
        pickupContactPhone: "",
        pickupWindow: "",
        returnInstructions: "",
        pickupBranchStatus: "UNVERIFIED",
        commissionRate: 12,
        contractStart: new Date().toISOString().split("T")[0],
        contractEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      });
      fetchManufacturers();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || "Failed to save manufacturer settings");
    }
  };

  const handleUpdateQuality = async (e) => {
    e.preventDefault();
    if (!selectedMfg) return;
    try {
      const res = await axios.put(
        `${backendUrl}/api/manufacturer/admin/quality/${selectedMfg.id}`,
        {
          qualityRating: Number(qualityRating),
          qualityNotes,
        },
        { headers: { token } }
      );
      if (res.data.success) {
        toast.success("Quality score updated!");
        setQualityModalOpen(false);
        fetchManufacturers();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update rating");
    }
  };

  const handleUpdateContract = async (e) => {
    e.preventDefault();
    if (!selectedMfg) return;
    setContractLoading(true);
    try {
      // 1. Update contract dates & status
      await axios.put(
        `${backendUrl}/api/manufacturer/admin/contract/${selectedMfg.id}`,
        {
          contractStatus,
          contractStart,
          contractEnd,
        },
        { headers: { token } }
      );

      // 2. Upload file if provided
      if (contractFile) {
        const uploadData = new FormData();
        uploadData.append("contractDoc", contractFile);
        await axios.post(
          `${backendUrl}/api/manufacturer/admin/contract-upload/${selectedMfg.id}`,
          uploadData,
          {
            headers: {
              token,
              "Content-Type": "multipart/form-data",
            },
          }
        );
      }

      toast.success("Contract terms & document updated!");
      setContractModalOpen(false);
      setContractFile(null);
      fetchManufacturers();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update contract");
    } finally {
      setContractLoading(false);
    }
  };

  const filteredMfg = manufacturers.filter((m) => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return (
        m.businessName?.toLowerCase().includes(term) ||
        m.city?.toLowerCase().includes(term) ||
        m.email?.toLowerCase().includes(term)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900">
            Regional Manufacturer Network
          </h1>
          <p className="text-xs text-slate-500">
            Manage distributed apparel manufacturers, quality ratings, and legally binding agreements
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSyncRatings}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs cursor-pointer"
          >
            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
            <span>Sync Ratings from Customer Reviews</span>
          </button>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Register New Manufacturer</span>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search manufacturers by business name, city, email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-900"
          />
        </div>
      </div>

      {/* Grid of Manufacturer Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {loading ? (
          <div className="col-span-full p-12 text-center text-slate-400">
            <div className="w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs">Loading manufacturers...</p>
          </div>
        ) : filteredMfg.length === 0 ? (
          <div className="col-span-full p-12 text-center text-slate-400 bg-white rounded-2xl border border-slate-200/80">
            <Factory className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p className="font-semibold text-slate-600 text-sm">No manufacturers found</p>
            <p className="text-xs text-slate-400 mt-1">
              Click &quot;Register New Manufacturer&quot; to onboard your first partner hub.
            </p>
          </div>
        ) : (
          filteredMfg.map((m) => (
            <div
              key={m.id}
              className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs flex flex-col justify-between space-y-4 hover:border-slate-300 transition-all"
            >
              {/* Card Header */}
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 leading-tight">
                      {m.businessName}
                    </h3>
                    <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500">
                      <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{m.city}, Nepal</span>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      m.isAvailable
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-slate-100 text-slate-600 border-slate-200"
                    }`}
                  >
                    {m.isAvailable ? "Online" : "Paused"}
                  </span>
                </div>

                {/* Info Rows */}
                <div className="mt-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">Quality Score:</span>
                    <span className="font-bold text-amber-600 flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 fill-amber-500" />
                      {m.qualityRating?.toFixed(1) || "5.0"} / 5.0
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">Total Fulfillments:</span>
                    <span className="font-bold text-slate-800">
                      {m.totalOrdersHandled || 0} orders
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">NCM Pickup Branch:</span>
                    <span className="font-bold text-slate-800">
                      {m.ncmPickupBranch || "Not assigned"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">Agreement Status:</span>
                    <span
                      className={`font-semibold ${
                        m.contractStatus === "ACTIVE" ? "text-emerald-600" : "text-amber-600"
                      }`}
                    >
                      {m.contractStatus || "ACTIVE"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">Pickup Status:</span>
                    <span className={`font-semibold ${m.pickupBranchStatus === "VERIFIED" ? "text-emerald-600" : "text-amber-600"}`}>
                      {m.pickupBranchStatus || "UNVERIFIED"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between py-1">
                    <span className="text-slate-400">Payout Model:</span>
                    <span className="font-bold text-emerald-600">100% Agreed COGS</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-100 grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setSelectedMfg(m);
                    setQualityRating(m.qualityRating || 5.0);
                    setQualityNotes(m.qualityNotes || "");
                    setQualityModalOpen(true);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 font-semibold text-xs border border-amber-200 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Star className="w-3.5 h-3.5" />
                  Rate Quality
                </button>

                <button
                  onClick={() => {
                    setSelectedMfg(m);
                    setContractStatus(m.contractStatus || "ACTIVE");
                    setContractStart(
                      m.contractStart
                        ? new Date(m.contractStart).toISOString().split("T")[0]
                        : ""
                    );
                    setContractEnd(
                      m.contractEnd
                        ? new Date(m.contractEnd).toISOString().split("T")[0]
                        : ""
                    );
                    setContractModalOpen(true);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs flex items-center justify-center gap-1 cursor-pointer"
                >
                  <FileCheck className="w-3.5 h-3.5" />
                  Contract
                </button>
              </div>

              <div className="pt-2 border-t border-slate-100">
                <button
                  onClick={() => {
                    setSelectedMfg(m);
                    setEditingManufacturerId(m.id);
                    setFormData((prev) => ({
                      ...prev,
                      businessName: m.businessName || "",
                      email: m.email || "",
                      password: "",
                      phone: m.phone || "",
                      address: m.address || "",
                      city: m.city || "Kathmandu",
                      ncmPickupBranch: m.ncmPickupBranch || "",
                      pickupAddress: m.pickupAddress || "",
                      pickupContactName: m.pickupContactName || "",
                      pickupContactPhone: m.pickupContactPhone || "",
                      pickupWindow: m.pickupWindow || "",
                      returnInstructions: m.returnInstructions || "",
                      pickupBranchStatus: m.pickupBranchStatus || "UNVERIFIED",
                    }));
                    setCreateModalOpen(true);
                  }}
                  className="w-full px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-semibold text-xs border border-emerald-200 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Pickup Config
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Register Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                {editingManufacturerId ? "Edit Manufacturing Partner" : "Register New Manufacturing Partner"}
              </h3>
              <button
                onClick={() => {
                  setCreateModalOpen(false);
                  setEditingManufacturerId(null);
                }}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Business / Factory Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Kathmandu Himalayan Textiles Pvt Ltd"
                  value={formData.businessName}
                  onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Login Email</label>
                  <input
                    type="email"
                    required
                    placeholder="factory@textiles.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Contact Phone</label>
                  <input
                    type="text"
                    required
                    placeholder="+977-98..."
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Assigned City Hub</label>
                  <select
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                  >
                    {NEPAL_CITIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Street Address</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ward No. 4, Balaju Industrial Area"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Admin Assigned NCM Pickup Branch</label>
                <input
                  type="text"
                  placeholder="e.g. TINKUNE"
                  value={formData.ncmPickupBranch}
                  onChange={(e) => setFormData({ ...formData, ncmPickupBranch: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Pickup Address for Manufacturer</label>
                <input
                  type="text"
                  placeholder="Pickup warehouse or factory address"
                  value={formData.pickupAddress}
                  onChange={(e) => setFormData({ ...formData, pickupAddress: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Pickup Contact Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Ramesh Karki"
                    value={formData.pickupContactName}
                    onChange={(e) => setFormData({ ...formData, pickupContactName: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Pickup Contact Phone</label>
                  <input
                    type="text"
                    placeholder="e.g. +977-98..."
                    value={formData.pickupContactPhone}
                    onChange={(e) => setFormData({ ...formData, pickupContactPhone: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Pickup Window</label>
                  <input
                    type="text"
                    placeholder="e.g. 10:00 AM - 4:00 PM"
                    value={formData.pickupWindow}
                    onChange={(e) => setFormData({ ...formData, pickupWindow: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Pickup Status</label>
                  <select
                    value={formData.pickupBranchStatus || "UNVERIFIED"}
                    onChange={(e) => setFormData({ ...formData, pickupBranchStatus: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                  >
                    <option value="UNVERIFIED">UNVERIFIED</option>
                    <option value="VERIFIED">VERIFIED</option>
                    <option value="REJECTED">REJECTED</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Return Instructions</label>
                <textarea
                  rows={2}
                  placeholder="Instructions for return or handover"
                  value={formData.returnInstructions}
                  onChange={(e) => setFormData({ ...formData, returnInstructions: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Contract Start</label>
                  <input
                    type="date"
                    value={formData.contractStart}
                    onChange={(e) => setFormData({ ...formData, contractStart: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Contract End</label>
                  <input
                    type="date"
                    value={formData.contractEnd}
                    onChange={(e) => setFormData({ ...formData, contractEnd: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setCreateModalOpen(false);
                    setEditingManufacturerId(null);
                  }}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold cursor-pointer"
                >
                  {editingManufacturerId ? "Save Settings" : "Register Partner"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quality Rating Modal */}
      {qualityModalOpen && selectedMfg && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Audit Quality Score: {selectedMfg.businessName}
              </h3>
              <button
                onClick={() => setQualityModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Set the audit quality rating (1.0 to 5.0). Higher scores prioritize this hub in the proximity auto-allocation engine.
            </p>

            <form onSubmit={handleUpdateQuality} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Quality Score (1.0 - 5.0)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="1.0"
                  max="5.0"
                  required
                  value={qualityRating}
                  onChange={(e) => setQualityRating(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Quality Audit Feedback &amp; Notes
                </label>
                <textarea
                  rows={3}
                  placeholder="e.g. Excellent stitching precision. Fabric tested 100% compliant."
                  value={qualityNotes}
                  onChange={(e) => setQualityNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-900 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setQualityModalOpen(false)}
                  className="px-3.5 py-2 rounded-xl font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl font-bold bg-amber-500 hover:bg-amber-600 text-white cursor-pointer"
                >
                  Save Rating
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Contract Management Modal */}
      {contractModalOpen && selectedMfg && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">
                Contract &amp; Agreement: {selectedMfg.businessName}
              </h3>
              <button
                onClick={() => setContractModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateContract} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Contract Status</label>
                <select
                  value={contractStatus}
                  onChange={(e) => setContractStatus(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="PENDING">PENDING</option>
                  <option value="EXPIRED">EXPIRED</option>
                  <option value="TERMINATED">TERMINATED</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Contract Start Date</label>
                  <input
                    type="date"
                    value={contractStart}
                    onChange={(e) => setContractStart(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Contract End Date</label>
                  <input
                    type="date"
                    value={contractEnd}
                    onChange={(e) => setContractEnd(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Upload Signed Contract Document (PDF or Scan)
                </label>
                <input
                  type="file"
                  accept=".pdf,image/*"
                  onChange={(e) => setContractFile(e.target.files[0])}
                  className="w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-900 file:text-white hover:file:bg-slate-800"
                />
                {selectedMfg.contractDocUrl && (
                  <p className="text-[11px] text-emerald-600 mt-1">
                    Current Document:{" "}
                    <a
                      href={selectedMfg.contractDocUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline font-bold"
                    >
                      View Signed Agreement (Cloudinary)
                    </a>
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setContractModalOpen(false)}
                  className="px-3.5 py-2 rounded-xl font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={contractLoading}
                  className="px-4 py-2 rounded-xl font-bold bg-slate-900 hover:bg-slate-800 text-white cursor-pointer disabled:opacity-50"
                >
                  {contractLoading ? "Uploading & Saving..." : "Update Agreement"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Manufacturers;
