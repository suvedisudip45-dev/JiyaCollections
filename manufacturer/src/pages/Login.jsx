import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { Factory, Lock, Mail, ArrowRight, Shield, UserPlus } from "lucide-react";
import { useManufacturer } from "../context/ManufacturerContext";

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

const defaultRegisterForm = {
  businessName: "",
  email: "",
  password: "",
  phone: "",
  city: "Kathmandu",
  address: "",
  ncmPickupBranch: "",
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

  useEffect(() => {
    const fetchBranches = async () => {
      try {
        const response = await axios.get(`${backendUrl}/api/manufacturer/branches`, {
          params: { city: registerForm.city },
        });
        if (response.data.success && Array.isArray(response.data.branches)) {
          setNcmBranches(response.data.branches);
        }
      } catch (error) {
        console.error("Failed to fetch NCM branches", error);
      }
    };

    fetchBranches();
  }, [backendUrl, registerForm.city]);

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
    setRegisterLoading(true);
    try {
      const payload = {
        ...registerForm,
        name: registerForm.businessName,
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
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-3xl">
          <div className="bg-slate-800/90 border border-slate-700 rounded-2xl p-6 sm:p-8 shadow-2xl">
            <div className="flex items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-black text-white">Register as Manufacturer</h2>
                <p className="text-xs text-slate-400 mt-1">Submit your manufacturing profile for admin approval</p>
              </div>
              <button
                type="button"
                onClick={() => setShowRegister(false)}
                className="text-sm text-slate-300 hover:text-white"
              >
                Back to login
              </button>
            </div>

            <form onSubmit={handleRegisterSubmit} className="space-y-4 text-sm text-slate-200">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Business / Factory Name</label>
                  <input
                    type="text"
                    required
                    value={registerForm.businessName}
                    onChange={(e) => setRegisterForm({ ...registerForm, businessName: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Official Email</label>
                  <input
                    type="email"
                    required
                    value={registerForm.email}
                    onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Password</label>
                  <input
                    type="password"
                    required
                    value={registerForm.password}
                    onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Phone</label>
                  <input
                    type="text"
                    required
                    value={registerForm.phone}
                    onChange={(e) => setRegisterForm({ ...registerForm, phone: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">City</label>
                  <select
                    required
                    value={registerForm.city}
                    onChange={(e) => setRegisterForm({ ...registerForm, city: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-emerald-500"
                  >
                    {NEPAL_CITIES.map((city) => (
                      <option key={city} value={city}>{city}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Pickup Branch / Location</label>
                  <input
                    list="ncm-branches-list"
                    type="text"
                    placeholder="Search pickup branch"
                    value={registerForm.ncmPickupBranch}
                    onChange={(e) => setRegisterForm({ ...registerForm, ncmPickupBranch: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                  <datalist id="ncm-branches-list">
                    {ncmBranches.map((branch) => (
                      <option key={branch} value={branch} />
                    ))}
                  </datalist>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Business / Factory Address</label>
                  <input
                    type="text"
                    required
                    value={registerForm.address}
                    onChange={(e) => setRegisterForm({ ...registerForm, address: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Order Pickup Address</label>
                  <input
                    type="text"
                    required
                    value={registerForm.pickupAddress}
                    onChange={(e) => setRegisterForm({ ...registerForm, pickupAddress: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Pickup Contact Name</label>
                  <input
                    type="text"
                    value={registerForm.pickupContactName}
                    onChange={(e) => setRegisterForm({ ...registerForm, pickupContactName: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Pickup Contact Phone</label>
                  <input
                    type="text"
                    value={registerForm.pickupContactPhone}
                    onChange={(e) => setRegisterForm({ ...registerForm, pickupContactPhone: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Pickup Window</label>
                  <input
                    type="text"
                    value={registerForm.pickupWindow}
                    onChange={(e) => setRegisterForm({ ...registerForm, pickupWindow: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Contract Start</label>
                  <input
                    type="date"
                    value={registerForm.contractStartDate}
                    onChange={(e) => setRegisterForm({ ...registerForm, contractStartDate: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Contract End</label>
                  <input
                    type="date"
                    value={registerForm.contractExpiryDate}
                    onChange={(e) => setRegisterForm({ ...registerForm, contractExpiryDate: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">Return Instructions</label>
                  <textarea
                    rows={3}
                    value={registerForm.returnInstructions}
                    onChange={(e) => setRegisterForm({ ...registerForm, returnInstructions: e.target.value })}
                    className="w-full bg-slate-900/80 border border-slate-700 rounded-xl px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={registerLoading}
                className="w-full mt-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold py-3 px-4 rounded-xl text-sm flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {registerLoading ? (
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Submit Manufacturer Registration</span>
                    <UserPlus className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mb-4 shadow-lg">
            <Factory className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            Aama Manufacturer Hub
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Production, Quality Compliance &amp; Order Fulfillment
          </p>
        </div>

        <div className="bg-slate-800/90 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-6 sm:p-8 shadow-2xl">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-white">Partner Authentication</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Sign in with your registered manufacturer email
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Manufacturer Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  placeholder="hub@nepaltextile.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-900/80 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-900/80 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold py-3 px-4 rounded-xl text-sm flex items-center justify-center gap-2 transition-all shadow-lg hover:shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>Sign In to Hub</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <button
            type="button"
            onClick={() => setShowRegister(true)}
            className="w-full mt-4 border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 font-semibold py-3 px-4 rounded-xl text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Register as Manufacturer</span>
          </button>

          <div className="mt-6 pt-5 border-t border-slate-700/60 flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              Quality Agreement Enforced
            </span>
            <span>Aama Clothings v2.4</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
