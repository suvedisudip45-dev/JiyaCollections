import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { Factory, Lock, Mail, ArrowRight, Shield, UserPlus, MapPin, Building, Phone, Calendar, Clock, RotateCcw } from "lucide-react";
import { useManufacturer } from "../context/ManufacturerContext";
import { NEPAL_PROVINCES } from "../data/nepalLocations";
import { NEPAL_DISTRICTS_BY_PROVINCE } from "../data/nepalDistricts";

const isValidNepalMobileNumber = (value = "") => {
  const digits = String(value || "").replace(/\D/g, "");
  const normalized = digits.replace(/^0+/, "").replace(/^977/, "");
  return /^9[78]\d{8}$/.test(normalized);
};

const defaultRegisterForm = {
  businessName: "",
  email: "",
  password: "",
  phone: "",
  province: "Bagmati Province",
  district: "Kathmandu",
  city: "",
  street: "",
  landmark: "",
  address: "",
  pickupAddress: "",
  pickupContactName: "",
  pickupContactPhone: "",
  pickupWindow: "",
  returnInstructions: "",
  contractStartDate: new Date().toISOString().split("T")[0],
  contractExpiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
};

const Login = () => {
  const { setToken, setManufacturer, backendUrl } = useManufacturer();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [registerForm, setRegisterForm] = useState(defaultRegisterForm);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [ncmBranches, setNcmBranches] = useState([]);
  const [coveredAreas, setCoveredAreas] = useState([]);
  const [loadingNcmBranches, setLoadingNcmBranches] = useState(false);

  // Cascading NCM branches based on province and district
  useEffect(() => {
    const fetchDistrictBranches = async () => {
      if (!registerForm.province || !registerForm.district) {
        setNcmBranches([]);
        setCoveredAreas([]);
        return;
      }
      setLoadingNcmBranches(true);
      try {
        const response = await axios.get(`${backendUrl}/api/manufacturer/branches`, {
          params: { province: registerForm.province, district: registerForm.district },
        });
        const branches = response.data.success ? response.data.branches || [] : [];
        setNcmBranches(branches);
        if (branches.length > 0 && !branches.includes(registerForm.city)) {
          setRegisterForm((prev) => ({ ...prev, city: branches[0] }));
        } else if (branches.length === 0) {
          setRegisterForm((prev) => ({ ...prev, city: "", street: "" }));
        }
      } catch (error) {
        setNcmBranches([]);
        console.error("Failed to load NCM branches", error);
      } finally {
        setLoadingNcmBranches(false);
      }
    };

    fetchDistrictBranches();
  }, [backendUrl, registerForm.province, registerForm.district]);

  // Fetch covered areas when NCM town/branch changes
  useEffect(() => {
    const fetchCoveredAreas = async () => {
      if (!registerForm.city) {
        setCoveredAreas([]);
        return;
      }
      try {
        const response = await axios.get(`${backendUrl}/api/manufacturer/branches`, {
          params: {
            branch: registerForm.city,
            district: registerForm.district,
            province: registerForm.province,
          },
        });
        const areas = response.data.success ? response.data.coveredAreas || [] : [];
        setCoveredAreas(areas);
        if (areas.length > 0 && !areas.includes(registerForm.street)) {
          setRegisterForm((prev) => ({ ...prev, street: areas[0] }));
        } else if (areas.length === 0) {
          setRegisterForm((prev) => ({ ...prev, street: "" }));
        }
      } catch (error) {
        setCoveredAreas([]);
      }
    };

    fetchCoveredAreas();
  }, [backendUrl, registerForm.city, registerForm.district, registerForm.province]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await axios.post(`${backendUrl}/api/manufacturer/login`, {
        email,
        password,
      });
      if (response.data.success) {
        setToken(response.data.token);
        setManufacturer(response.data.manufacturer);
        toast.success(`Welcome back, ${response.data.manufacturer.businessName}!`);
      } else {
        toast.error(response.data.message || "Invalid credentials");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Login failed. Check connection.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    if (!registerForm.province || !registerForm.district || !registerForm.city) {
      toast.error("Please select province, district, and NCM town branch");
      return;
    }
    if (!isValidNepalMobileNumber(registerForm.phone)) {
      toast.error("Please enter a valid mobile number starting with 98 or 97.");
      return;
    }
    if (registerForm.pickupContactPhone && !isValidNepalMobileNumber(registerForm.pickupContactPhone)) {
      toast.error("Please enter a valid pickup contact mobile number starting with 98 or 97.");
      return;
    }

    setRegisterLoading(true);
    try {
      const formattedAddress = registerForm.address
        ? registerForm.address
        : [registerForm.street, registerForm.landmark, registerForm.city, registerForm.district, registerForm.province]
            .filter(Boolean)
            .join(", ");

      const formattedPickupAddress = registerForm.pickupAddress
        ? registerForm.pickupAddress
        : [registerForm.street, registerForm.landmark, registerForm.city].filter(Boolean).join(", ");

      const payload = {
        ...registerForm,
        name: registerForm.businessName,
        phone: registerForm.phone.replace(/[^0-9]/g, "").replace(/^0+/, "").replace(/^977/, ""),
        pickupContactPhone: registerForm.pickupContactPhone ? registerForm.pickupContactPhone.replace(/[^0-9]/g, "").replace(/^0+/, "").replace(/^977/, "") : "",
        city: registerForm.city,
        ncmPickupBranch: registerForm.city,
        address: formattedAddress,
        pickupAddress: formattedPickupAddress,
      };

      const response = await axios.post(`${backendUrl}/api/manufacturer/register`, payload);
      if (response.data.success) {
        toast.success(response.data.message || "Registration submitted successfully");
        setShowRegister(false);
        setRegisterForm(defaultRegisterForm);
      } else {
        toast.error(response.data.message || "Registration failed");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Unable to submit manufacturer registration");
    } finally {
      setRegisterLoading(false);
    }
  };

  if (showRegister) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 sm:p-6 text-slate-100">
        <div className="w-full max-w-4xl">
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl backdrop-blur-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-6 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Factory className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-white tracking-tight">Register as Manufacturer</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Join Aama Clothings distributed apparel fulfillment network
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRegister(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 transition-all self-start sm:self-auto cursor-pointer"
              >
                ← Back to Login
              </button>
            </div>

            <form onSubmit={handleRegisterSubmit} className="space-y-6 text-sm">
              {/* Section 1: Business & Account Credentials */}
              <div>
                <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Shield className="w-4 h-4" /> 1. Business &amp; Authentication Credentials
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Business / Factory Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Kathmandu Himalayan Textiles Pvt Ltd"
                      value={registerForm.businessName}
                      onChange={(e) => setRegisterForm({ ...registerForm, businessName: e.target.value })}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Official Contact Phone *</label>
                    <input
                      type="tel"
                      required
                      placeholder="e.g. 9841234567"
                      value={registerForm.phone}
                      onChange={(e) => setRegisterForm({ ...registerForm, phone: e.target.value.replace(/[^0-9]/g, "") })}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Login Email *</label>
                    <input
                      type="email"
                      required
                      placeholder="factory@domain.com"
                      value={registerForm.email}
                      onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Secure Password *</label>
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={registerForm.password}
                      onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Address & NCM Branch Selection (Identical customer checkout logic) */}
              <div className="pt-4 border-t border-slate-800">
                <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <MapPin className="w-4 h-4" /> 2. Location &amp; Nepal Can Move (NCM) Logistics Integration
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Province *</label>
                    <select
                      required
                      value={registerForm.province}
                      onChange={(e) => {
                        const nextProvince = e.target.value;
                        const nextDistrict = NEPAL_DISTRICTS_BY_PROVINCE[nextProvince]?.[0] || "";
                        setRegisterForm({
                          ...registerForm,
                          province: nextProvince,
                          district: nextDistrict,
                          city: "",
                          street: "",
                        });
                      }}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                    >
                      {NEPAL_PROVINCES.map((prov) => (
                        <option key={prov} value={prov} className="bg-slate-900 text-white">
                          {prov}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">District *</label>
                    <select
                      required
                      value={registerForm.district}
                      onChange={(e) => {
                        setRegisterForm({
                          ...registerForm,
                          district: e.target.value,
                          city: "",
                          street: "",
                        });
                      }}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-emerald-500 cursor-pointer"
                    >
                      {(NEPAL_DISTRICTS_BY_PROVINCE[registerForm.province] || []).map((dist) => (
                        <option key={dist} value={dist} className="bg-slate-900 text-white">
                          {dist}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">NCM Town / Branch *</label>
                    <select
                      required
                      value={registerForm.city}
                      disabled={loadingNcmBranches || ncmBranches.length === 0}
                      onChange={(e) => setRegisterForm({ ...registerForm, city: e.target.value, street: "" })}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-emerald-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="" className="bg-slate-900 text-slate-400">
                        {loadingNcmBranches ? "Loading branches..." : "Select NCM Branch"}
                      </option>
                      {ncmBranches.map((branch) => (
                        <option key={branch} value={branch} className="bg-slate-900 text-white">
                          {branch}
                        </option>
                      ))}
                    </select>
                    {!loadingNcmBranches && ncmBranches.length === 0 && (
                      <p className="text-[10px] text-rose-400 mt-1">No NCM branch found for this district.</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Street / Covered Area *</label>
                    <select
                      required
                      value={registerForm.street}
                      disabled={!registerForm.city || coveredAreas.length === 0}
                      onChange={(e) => setRegisterForm({ ...registerForm, street: e.target.value })}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-emerald-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="" className="bg-slate-900 text-slate-400">
                        {registerForm.city && coveredAreas.length === 0
                          ? "No covered areas returned by NCM"
                          : "Select Covered Area"}
                      </option>
                      {coveredAreas.map((area) => (
                        <option key={area} value={area} className="bg-slate-900 text-white">
                          {area}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Nearest Landmark / Unit Details *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Near Industrial Area Gate 2, Ward 4"
                      value={registerForm.landmark}
                      onChange={(e) => setRegisterForm({ ...registerForm, landmark: e.target.value })}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Full Factory / Warehouse Address</label>
                    <input
                      type="text"
                      placeholder="Factory building name, ward, road"
                      value={registerForm.address}
                      onChange={(e) => setRegisterForm({ ...registerForm, address: e.target.value })}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Pickup Warehouse Address (For Courier)</label>
                    <input
                      type="text"
                      placeholder="Exact pickup gate/room address for courier rider"
                      value={registerForm.pickupAddress}
                      onChange={(e) => setRegisterForm({ ...registerForm, pickupAddress: e.target.value })}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* Section 3: Dispatch & Fulfillment Details */}
              <div className="pt-4 border-t border-slate-800">
                <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> 3. Dispatch &amp; Handover Details
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Pickup Contact Person</label>
                    <input
                      type="text"
                      placeholder="e.g. Ramesh Karki"
                      value={registerForm.pickupContactName}
                      onChange={(e) => setRegisterForm({ ...registerForm, pickupContactName: e.target.value })}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Pickup Contact Phone</label>
                    <input
                      type="tel"
                      placeholder="e.g. 9800000000"
                      value={registerForm.pickupContactPhone}
                      onChange={(e) => setRegisterForm({ ...registerForm, pickupContactPhone: e.target.value.replace(/[^0-9]/g, "") })}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">Pickup Availability Window</label>
                    <input
                      type="text"
                      placeholder="e.g. 10:00 AM - 5:00 PM"
                      value={registerForm.pickupWindow}
                      onChange={(e) => setRegisterForm({ ...registerForm, pickupWindow: e.target.value })}
                      className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Return &amp; Defect Handling Instructions</label>
                  <textarea
                    rows={2}
                    placeholder="Instructions for courier return drop-offs or warehouse inspection protocol"
                    value={registerForm.returnInstructions}
                    onChange={(e) => setRegisterForm({ ...registerForm, returnInstructions: e.target.value })}
                    className="w-full bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Section 4: Agreement Dates */}
              <div className="pt-4 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Contract Start Date</label>
                  <input
                    type="date"
                    value={registerForm.contractStartDate}
                    onChange={(e) => setRegisterForm({ ...registerForm, contractStartDate: e.target.value })}
                    className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Contract Expiry Date</label>
                  <input
                    type="date"
                    value={registerForm.contractExpiryDate}
                    onChange={(e) => setRegisterForm({ ...registerForm, contractExpiryDate: e.target.value })}
                    className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowRegister(false)}
                  className="px-6 py-3 rounded-xl font-bold text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={registerLoading}
                  className="px-8 py-3 rounded-xl font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 cursor-pointer flex items-center gap-2"
                >
                  {registerLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                      <span>Submitting Registration...</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4" />
                      <span>Submit Application for Review</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Glow */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-4 shadow-lg shadow-emerald-500/5">
            <Factory className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">Manufacturer Hub</h1>
          <p className="text-sm text-slate-400 mt-1">Sign in to manage your order fulfillment pipeline</p>
        </div>

        {/* Card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  placeholder="manufacturer@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-sm transition-all duration-200 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 disabled:opacity-50 cursor-pointer mt-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-800 text-center">
            <p className="text-xs text-slate-400 mb-2">Want to partner as an apparel manufacturing hub?</p>
            <button
              type="button"
              onClick={() => setShowRegister(true)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Register new manufacturer account</span>
            </button>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-800/60 flex items-center justify-center gap-2 text-slate-500 text-xs">
            <Shield className="w-3.5 h-3.5" />
            <span>Encrypted &amp; secure partner portal</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
